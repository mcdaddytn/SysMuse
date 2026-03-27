# 04 — Scoring Snapshots & Normalization

## Current State

Snapshots persist scoring results so they can be used for filtering, aggregation, and enrichment decisions across sessions. A `ScoreSnapshot` record stores the configuration used (formula, weights, score type), and `PatentScoreEntry` rows store per-patent scores and ranks. One snapshot per (portfolioId, scoreType) can be marked as "active" — its scores appear in Patent Summary and Aggregate views.

Snapshots are created when users save scoring results from the V2/V3 scoring pages, and are activated (pushed as default) to make them available for filtering and enrichment ranking.

## Problems with Current Approach

1. **No provenance tracking**: A snapshot doesn't record whether it was created from fresh scoring, after enrichment, from a weight change, or by combining other snapshots. This makes it impossible to understand what data quality a snapshot represents.

2. **No version awareness**: Snapshots don't track which patents were scored with current-version questions vs. stale data. A snapshot of 2000 patents might have 500 freshly scored and 1500 using old metrics, but this isn't visible.

3. **Normalization is ad-hoc**: Recent normalization attempts focused on mathematical techniques (percentile, z-score) without enough consideration for the practical goal: combining fresh topN scores with older remaining scores for reasonable ranking that supports further enrichment.

4. **No snapshot combination**: When enriching topN within a sector, there's no principled way to merge the freshly-scored topN snapshot with the broader portfolio snapshot to produce a working ranking for the next round of enrichment.

5. **Snapshot proliferation**: No lifecycle management. Old snapshots accumulate without cleanup.

## Core Design Principles

**Principle 1: Source snapshots should be internally consistent.** A source snapshot should contain patents scored with the same version of questions and ideally the same LLM model. Mixing happens explicitly through combination, not silently during creation.

**Principle 2: Combination is explicit and tracked.** When two snapshots are merged, the resulting snapshot records its source snapshots, the normalization method used, and which entries were normalized vs. natively scored.

**Principle 3: Normalization preserves relative ranking within source.** Patents from the "old" source snapshot should maintain roughly their relative order, adjusted to accommodate new information from the "fresh" source. The goal is: don't artificially promote patents that haven't earned it with new data, but allow promising ones to bubble up for evaluation.

**Principle 4: Snapshots are cheap to create, expensive to activate.** Creating a snapshot is a lightweight operation (compute scores, store rows). Activating one — making it the default for Patent Summary, Aggregate, and enrichment — is a deliberate decision with user confirmation.

## Enhanced Snapshot Schema

See `hmda-v2-architecture.md`, Section 7 for full Prisma schema. Key additions:

```
ScoreSnapshot (enhanced)
  ├── formulaDefId          — which formula produced this
  ├── weightProfileId       — which weight profile was used
  ├── creationMethod        — FRESH_CALCULATION | USER_WEIGHT_CHANGE |
  │                           POST_ENRICHMENT | NORMALIZED_MERGE | CONSENSUS
  ├── sourceSnapshotIds[]   — for merged snapshots: what was combined
  ├── normalizationMethod   — which technique was applied
  ├── normalizationConfig   — parameters used
  ├── minRevAIQ / maxRevAIQ — oldest/newest question versions in snapshot
  ├── pctFullyCurrent       — what % of patents are at latest revAIQ
  └── fullConfig            — complete configuration for reproducibility

PatentSnapshotEntry (enhanced)
  ├── revAIQ                — this patent's question version at snapshot time
  ├── isCurrent             — was it current when scored?
  ├── wasNormalized         — was this entry produced by normalization?
  ├── originalScore         — score before normalization (if applicable)
  ├── originalRank          — rank before normalization (if applicable)
  └── sourceSnapshotId      — which source snapshot this entry came from
```

## Snapshot Types by Creation Method

### Fresh Calculation
Created when a user runs scoring with current weights on current data. All patents in the snapshot were evaluated with the same formula and weights. This is the most reliable snapshot type.

**Trigger**: User clicks "Calculate" on a scoring page, then "Save Snapshot."

### Post-Enrichment
Created automatically after an LLM enrichment run completes. Contains only the patents that were enriched with current-version questions. Internally consistent.

**Trigger**: Enrichment job completes → auto-snapshot option (configurable).

### User Weight Change
Created when a user modifies sliders and recalculates. Same data, different weights. The system can offer to recalculate using previously active snapshot's patent set.

**Trigger**: User adjusts weights → recalculate → save.

### Normalized Merge
Created by combining two or more source snapshots using a normalization strategy. Some entries are natively scored; others are estimated. Each entry tracks whether it was normalized and from which source.

**Trigger**: User initiates snapshot expansion, or auto-merge after enrichment.

### Consensus
Created from multiple weight profiles applied to the same patent set. Each profile evaluates independently; results are weighted-averaged.

**Trigger**: Consensus scoring page → save consensus snapshot.

## Normalization Strategies

### Strategy 1: Zero-Weight Infill (Simplest, Safest)

When new questions have been added but only some patents have answers:

1. In the scoring formula, new question weights start at 0
2. The formula produces scores using only the metrics that exist
3. Patents without new metrics get scores identical to their pre-question scores
4. As the user increases weights for new questions, only patents WITH the new data are affected
5. Unnormalized patents maintain their previous relative ranking

**When to use**: Always, as the default starting point. No estimation, no risk of artificial promotion.

### Strategy 2: Aggregate-Preserving Expansion

When merging a fresh topN snapshot with an older broader snapshot:

1. Take the fresh snapshot (e.g., top 500 VIDEO, scored with current questions)
2. Take the older broader snapshot (e.g., top 2000 portfolio, older questions)
3. For patents in the broader set but not in the fresh set:
   - Assign new-question metrics as the weighted average from the fresh set, scaled down by the ratio of (old patent's previous rank / average previous rank of fresh set)
   - This preserves the intuition: a patent previously ranked #1500 should not get the same new-question estimates as one ranked #100
4. Combine and re-rank

```
For patent P in old set but not fresh set:
  estimated_new_metric = avg(new_metric in fresh set) × (avg_rank_fresh / rank_P_old)
  Clamped to [min_observed, max_observed] from fresh set
```

**When to use**: When expanding a focused enrichment to a broader ranking. The overlap between fresh and old sets provides calibration.

### Strategy 3: Overlap-Based Cross-Model Normalization

When the same patents have been scored by two different LLM models:

1. Identify overlap set (patents scored by both models)
2. Compute per-metric correlation and average difference
3. Apply linear correction to transform old-model scores toward new-model scale
4. Track which entries were transformed

**When to use**: After upgrading to a better LLM model for topN, to estimate what the remaining patents would score under the new model. The LLM Currency Analysis Service provides `getModelComparisonOverlap()` for this.

### Strategy 4: Iterative Bubble-Up (Advanced, Future)

A goal-seeking enrichment loop:

1. Start with fresh topN snapshot merged into broader snapshot (Strategy 2)
2. Identify K patents just below the topN boundary that might be underestimated
3. Enrich those K patents with current questions
4. Re-evaluate: did any newly enriched patents score higher than the bottom of topN?
5. If yes, swap them in, update rankings, and repeat
6. Stop when no more swaps occur or iteration limit reached

Parameters: overlap size K (default: 10% of N), max iterations (default: 3), budget cap.

**When to use**: During major enrichment campaigns. Requires the simpler strategies to be working first. This is a Phase 5 enhancement.

## Snapshot Lifecycle

### Creation
Snapshots are created by scoring pages (manual), enrichment completion (auto), or snapshot combination operations (manual or auto).

### Activation
User explicitly activates a snapshot for a given scope (portfolio + score type). At most one snapshot is active per scope. Active snapshot scores appear in Patent Summary, Aggregate View, and are available for enrichment ranking.

### Comparison
Users can compare any two snapshots to see ranking movement. The snapshot comparison view shows: patents that moved up, moved down, entered/left the set, and overall correlation.

### Archival
Snapshots older than a configurable threshold (e.g., 30 days) with no active status are candidates for archival. Archived snapshots are kept but their PatentSnapshotEntry rows can be compressed or summarized.

### Deletion
Only archived snapshots can be deleted. Active or recently-created snapshots are protected.

## Auto-Snapshot After Enrichment

When enrichment completes, the system can automatically:

1. Create a fresh snapshot of the enriched patents using current weights
2. If a broader active snapshot exists, offer to merge using Strategy 2
3. Present the result to the user with a summary: "500 patents freshly scored, 1500 estimated from previous snapshot, normalization applied to N entries"
4. User can activate the merged snapshot or keep the previous one

This removes the burden of manually managing snapshots after every enrichment run while keeping the user in control of what gets activated.

## Snapshot-Aware Filtering

In Patent Summary and Aggregate views, a filter option shows snapshot currency:

- **All patents**: Shows whatever score is available (may mix versions)
- **Current snapshot only**: Limits to patents in the active snapshot
- **Fully current only**: Limits to patents where `isCurrent = true` (scored with latest questions)

This lets users choose their data quality tradeoff: completeness vs. consistency.

## Data Model Changes

### New Tables (Phase 2)
- Enhanced `ScoreSnapshot` with provenance fields (see schema above)
- Enhanced `PatentSnapshotEntry` with currency and normalization tracking

### Migration
- Existing snapshots receive `creationMethod: 'FRESH_CALCULATION'` and `pctFullyCurrent: null` (unknown for historical data)
- Existing entries receive `wasNormalized: false` (assumed fresh for historical data)
- No data loss — this is purely additive metadata

## Open Questions

- **Auto-snapshot granularity**: Should auto-snapshots be created per-enrichment-job or per-enrichment-batch (which may contain multiple jobs)? Recommendation: per-batch, to avoid snapshot explosion during large enrichment runs.
- **Normalization method selection**: Should the system auto-select normalization strategy or always ask the user? Recommendation: auto-select with a confirmation dialog showing what will happen. Advanced users can override.
- **Snapshot storage cost**: Each snapshot stores N PatentSnapshotEntry rows. For 5000 patents and frequent snapshots, this grows. Consider: summary-only archival after a retention period, or only storing deltas from a base snapshot.
- **Cross-scope normalization**: Can a sector-level snapshot's scores be normalized into a portfolio-level snapshot? Conceptually yes, but the metric sets differ (sector has more questions). This requires mapping sector group scores to portfolio-equivalent values. Deferred to Phase 3.
