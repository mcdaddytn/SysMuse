# 05 — Data Enrichment & Auto-Calculation

## Current State

Enrichment runs are scoped to portfolio or super-sector, selecting topN patents by current score (base score or V2) and running LLM structured questions on those that lack LLM data or are marked stale. Job tracking uses the `BatchJob` table with status, progress, model, and batch mode fields.

Enrichment types: LLM scoring, prosecution history, IPR data, XML extraction, family expansion, citation classification.

Current limitations: binary staleness (has_llm_data flag), fixed scoping (portfolio or super-sector only), no automatic snapshot creation after enrichment, no cost-aware budgeting.

## Problems with Current Approach

1. **Binary staleness**: `hasLlmData` and `isStale` don't capture which version of questions was run or which model was used. Adding a question invalidates everything, even if only one new metric is missing.

2. **Fixed scoping**: Can only enrich "top N across portfolio" or "top N in super-sector." Cannot target a specific sector or sub-sector for iterative question development.

3. **No enrichment-scoring feedback loop**: Enrichment uses an existing score to pick topN, but that score may be stale relative to the questions being asked. The chicken-and-egg: we need scores to pick patents to enrich, but enrichment changes the scores.

4. **No cost awareness**: The system doesn't estimate LLM costs before running, doesn't budget across enrichment campaigns, and doesn't factor in model cost differences.

5. **Manual snapshot management**: After enrichment completes, the user must manually create and activate snapshots. No auto-snapshot to immediately leverage new data.

## Enrichment Pipeline

```
Select Score for Ranking
  │  (base_score, portfolio score, or snapshot)
  ▼
Select Scope
  │  (portfolio, super-sector, sector, sub-sector)
  ▼
Select TopN
  │  (how many patents to target)
  ▼
Currency Check (revAIQ comparison)
  │  → How many of topN need enrichment?
  │  → Which specific questions are missing?
  │  → Estimated cost (tokens × price)
  ▼
User Confirms Scope & Budget
  ▼
Execute Enrichment Jobs
  │  → Batch LLM calls with all relevant questions per patent
  │  → Track progress in BatchJob table
  │  → Record model and question versions
  ▼
Post-Enrichment Auto-Snapshot (optional)
  │  → Create fresh snapshot of enriched patents
  │  → Offer merge with broader active snapshot
  ▼
Scoring & Ranking Available
```

## Version-Aware Enrichment

### Using revAIQ for Enrichment Planning

The Currency Service (see `hmda-v2-architecture.md`, Section 6) replaces binary staleness with precise version tracking. When the user requests "enrich top 500 in VIDEO":

1. Get latest revAIQ for VIDEO's taxonomy path (e.g., "3.2.1.4")
2. For each patent in the topN (ranked by selected score):
   - Check patent's current revAIQ
   - Compute gap: which levels need updating?
3. Present to user: "Of top 500 VIDEO patents, 320 are current, 180 need portfolio questions v3, 45 need sector questions v1"
4. Estimate cost based on questions needed per patent × model pricing
5. User confirms; only out-of-date patents are enriched

This avoids re-running LLM questions on patents that already have current data, saving significant cost.

### The Chicken-and-Egg Solution

The enrichment-scoring feedback loop is resolved through snapshot-based ranking:

**Scenario**: New portfolio questions added. We want to enrich VIDEO sector patents.

1. **Start with existing snapshot** as ranking basis (this is stale but usable)
2. **Enrich top 1000 VIDEO** with new questions → creates fresh snapshot of 1000
3. **Score the fresh 1000** using current formula with new question weights
4. **Merge with broader snapshot** (Strategy 2 from `04-snapshots.md`):
   - Fresh 1000 VIDEO patents get their actual new scores
   - Remaining 200 VIDEO patents get aggregate-preserving estimates
   - Other super-sectors maintain their previous relative positions
5. **Activate merged snapshot** → now the system has reasonable rankings everywhere, with high-quality scores for the area we care about
6. **Repeat if needed**: enrich next batch using the merged snapshot for ranking

The key insight: we always have a "good enough" snapshot for ranking purposes. Fresh data goes into it as it arrives, and normalization fills gaps for patents we haven't reached yet.

### Enrichment at Any Taxonomy Level

The system should support enrichment scoped to any level:

| Scope | Use Case | Available Questions |
|-------|----------|-------------------|
| Portfolio-wide | Initial enrichment, broad rescoring | Portfolio questions only |
| Super-sector | Technology area focus | Portfolio + super-sector questions |
| Sector | Detailed sector analysis | Portfolio + super-sector + sector questions |
| Sub-sector | Fine-grained question iteration | All inherited questions |

For initial implementation, we keep the current options (portfolio and super-sector). Sector and sub-sector scoping is added when the taxonomy generalization (Phase 3) is complete.

## Auto-Calculation & Auto-Snapshot

### Triggers for Auto-Calculation

| Event | Action |
|-------|--------|
| LLM enrichment completes | Auto-snapshot enriched patents; offer merge with active snapshot |
| User changes weights | Recalculate using active snapshot's patent set; offer to save new snapshot |
| Competitor import changes | Recalculate base scores (citation analysis affected); offer snapshot refresh |
| Taxonomy refactoring | Mark affected patents as stale at appropriate revAIQ level |

### Auto-Snapshot Settings

Configurable per-portfolio (or global):
- **After enrichment**: Always / Ask / Never
- **After weight change**: Always / Ask / Never
- **Merge method**: Zero-weight infill (safest) / Aggregate-preserving / Ask each time
- **Auto-activate**: Never (always ask the user before activating)

## Multiple Taxonomy Association Impact

When a patent has multiple taxonomy associations (Phase 3), enrichment batches all questions from all classification paths:

```
Patent X: primary=video-codec, secondary=wireless-transmission

LLM question batch for Patent X:
  ├── Portfolio questions (6)
  ├── VIDEO_STREAMING super-sector questions (2)
  ├── video-codec sector questions (3)
  ├── WIRELESS super-sector questions (2)     ← from secondary classification
  └── wireless-transmission sector questions (2) ← from secondary classification
  Total: 15 questions in one LLM call
```

This maximizes the value of each LLM call (base context is the same regardless of question count) and ensures all taxonomy paths have current data.

The revAIQ tracking handles this naturally: each taxonomy path has its own version string, and the currency check evaluates each path independently.

## Cost Management

### Estimation Before Enrichment

Before confirming an enrichment run, the system shows:

- Number of patents needing enrichment (based on revAIQ gaps)
- Average tokens per patent (from `LlmResponseCache` historical data)
- Estimated total tokens and cost at selected model's pricing
- Comparison: cost with cheaper model vs. better model

### Budget Controls (Future)

- Per-enrichment-run budget cap
- Per-portfolio monthly budget
- Auto-downgrade to cheaper model when budget is tight
- Rate limiting to stay within API throttles

## Batch Job Management

Current job tracking via `BatchJob` is adequate. Enhancements:

- **Group awareness**: Jobs in the same enrichment campaign share a `groupId`
- **Concurrency limits**: System-level setting for max concurrent LLM jobs (respecting API throttling)
- **Resume on failure**: Failed jobs can be retried without re-processing already-completed patents
- **Post-job hooks**: Configurable actions after job completion (auto-snapshot, notification, next-job trigger)

## Iterative Goal-Seeking Enrichment (Phase 5)

An advanced enrichment mode that automatically iterates to improve topN quality:

```
Parameters:
  - target: top 500 VIDEO patents
  - overlap: 50 (how many to evaluate from below the boundary)
  - maxIterations: 3
  - budgetCap: 200 LLM calls per iteration

Loop:
  1. Enrich top 500 VIDEO with current questions
  2. Score and rank all 500
  3. Enrich next 50 below the boundary (patents 501-550)
  4. Score all 550
  5. Did any from 501-550 score higher than any in 500? If yes:
     - Swap in the higher-scoring patents
     - Update the boundary
     - Repeat from step 3
  6. Stop when no swaps occur or iteration limit reached
```

This is the automated version of the manual process described above. It requires all foundational pieces (revAIQ tracking, auto-snapshot, merge normalization) to be working first.

## Data Model Changes

### Phase 1 (Analysis Only — No Schema Changes)
- LLM Currency Analysis Service queries existing fields
- No new tables needed

### Phase 2 (Version Tracking)
- `QuestionVersion` table: current version at each taxonomy level
- `PatentQuestionCurrency` table: per-patent revAIQ tracking
- Enhanced `BatchJob` with post-completion hooks

### Phase 3 (Taxonomy-Level Enrichment)
- Enrichment scoping expanded beyond portfolio/super-sector
- Multi-taxonomy-association question batching

## Open Questions

- **Enrichment priority across super-sectors**: When doing portfolio-wide enrichment, should patents in already-well-enriched super-sectors be deprioritized? Or always use the selected score for ranking regardless of enrichment coverage?
- **Partial question runs**: If a patent needs 15 questions but only 3 are new, should we re-run all 15 or just the new 3? Re-running all provides consistency (same model, same context) but costs more. Running only new questions saves cost but may produce inconsistent reasoning.
- **Model downgrade strategy**: When to use Haiku vs. Sonnet vs. Opus? Initial data gathering with cheaper models, then upgrade topN to better models? The model comparison analysis will inform this.
- **LLM question batch size limits**: At what point does combining too many questions in one LLM call degrade answer quality? Empirical testing needed.
