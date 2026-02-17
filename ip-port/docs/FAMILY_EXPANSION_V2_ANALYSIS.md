# Patent Family Expansion V2 - Scored Generational Expansion Analysis

**Status**: Design Analysis
**Date**: 2026-02-15

---

## Executive Summary

This document analyzes a redesigned family expansion approach that replaces the current "set depth and run BFS" model with **incremental, one-generation-at-a-time expansion guided by a multi-factor relevance scoring system**. Each prospective family member receives a score based on commonalities with seed patents, and the user controls expansion through weight sliders and accept/reject decisions rather than upfront depth parameters.

---

## Problem Statement

The current implementation (Phases 1-4) uses BFS traversal with fixed depth limits (0-3 generations in each direction). This has several limitations:

1. **All-or-nothing depth**: Setting ancestors=2 fetches ALL grandparents regardless of relevance
2. **No relevance ranking**: A grandparent in a completely unrelated technology gets the same treatment as one in the same sector
3. **Explosion risk**: At depth 2+, combinatorics can produce hundreds of patents with no way to prioritize
4. **Filter-based pruning is blunt**: Current sector/CPC filters either include or exclude — no gradient
5. **No scoring signal**: Users must manually scan the results table to identify interesting candidates
6. **Citation path blindness**: The system doesn't distinguish between a candidate reachable through 5 independent citation paths vs. one reachable through a single tenuous link

---

## Proposed Approach: Scored Generational Expansion

### Core Concept

Instead of traversing N generations at once, expand **one generation at a time** and score every candidate against seed patents across multiple dimensions. The user sees candidates ranked by score and decides which to accept, reject, or leave for further expansion.

### Expansion Directions

Each expansion step can go in one of three modes:
- **Backward only** — discover prior art (parents of current frontier)
- **Forward only** — discover citing patents (children of current frontier)
- **Both directions** — expand one generation in each direction simultaneously

The "frontier" starts as the seed patents and grows as the user accepts candidates.

### Generational Flow

```
Step 0:  Seeds [S1, S2, S3]
            |
Step 1:  Expand backward → Score candidates → User reviews
         Expand forward  → Score candidates → User reviews
            |
         Family = Seeds + Accepted Gen-1 patents
            |
Step 2:  Expand backward from Gen-1 parents → Score → Review
         Expand forward from Gen-1 children → Score → Review
            |
         Family = Previous + Accepted Gen-2 patents
            |
Step N:  Continue as needed...
```

At each step, the system:
1. Fetches citations for the current frontier
2. Computes relevance scores for all new candidates
3. Presents candidates in a ranked grid
4. User accepts, rejects, or leaves neutral
5. Accepted patents join the family; neutral patents remain available for next expansion

---

## Scoring System Design

### Scoring Dimensions

Each candidate patent receives a score from 0-100, computed as a weighted sum of the following dimensions. All dimension scores are normalized to 0-1 before weighting.

#### 1. Taxonomic Overlap (Sector Hierarchy)

How closely does the candidate's taxonomic placement match the seed patents? More specific matches score higher — a sub-sector match is a much stronger signal than a super-sector match.

| Match Level | Score | Rationale |
|-------------|-------|-----------|
| Same sub-sector as any seed | 1.0 | Strongest signal — near-identical technology area |
| Same sector as any seed | 0.5 | Same technology domain, but could be different niche |
| Same super-sector as any seed | 0.2 | Same broad technology family — weak signal alone |
| No overlap | 0.0 | Different technology entirely |

**Computation**: Take the maximum match level across all seed patents. For candidates matching multiple seeds at different levels, use the best match.

**Multiple taxonomy matches**: If a candidate matches seed S1 at sub-sector level AND seed S2 at sector level, use the best (sub-sector = 1.0). In the future, we may support multiple taxonomy systems; for now, the sector hierarchy (sub-sector → sector → super-sector) is the primary taxonomy, mapped from CPC codes.

**For external patents** (not in portfolio): Sector may be unknown. Use the sector→CPC mapping to infer sector from the candidate's CPC codes. Since our sectors are derived from CPC prefixes, this provides a reasonable approximation. If CPC codes are also unavailable, exclude this dimension from scoring.

**Note on CPC overlap**: Since our sector taxonomy is currently mapped from CPC codes, a separate CPC overlap dimension would be largely redundant. CPC overlap is folded into this dimension via the sector→CPC inference path. If we add alternative taxonomies in the future (e.g., market-based or LLM-classified), CPC overlap could be reintroduced as an independent signal.

**Default weight**: 0.20

#### 2. Common Prior Art (Shared Backward Citations)

How many backward citations does the candidate share with seed patents?

```
Score = |candidate_backward ∩ seeds_backward| / max(|candidate_backward|, 1)
```

Alternative (Jaccard index for more balanced comparison):
```
Score = |candidate_backward ∩ seeds_backward| / |candidate_backward ∪ seeds_backward|
```

**Rationale**: Patents citing the same prior art are building on the same technological foundation. High overlap strongly suggests related technology even when sectors differ.

**Default weight**: 0.20

#### 3. Common Forward Citations (Shared Citing Patents)

How many forward citations does the candidate share with seed patents?

```
Score = |candidate_forward ∩ seeds_forward| / max(|candidate_forward|, 1)
```

**Rationale**: Patents cited by the same downstream patents are perceived as substitutes or complements by later inventors. This is one of the strongest relatedness signals.

**Default weight**: 0.20

#### 4. Competitor Overlap

Do the same competitors cite (or are cited by) both the candidate and the seeds?

```
competitor_set_candidate = competitors citing or cited by candidate
competitor_set_seeds = competitors citing or cited by any seed
Score = |intersection| / max(|competitor_set_seeds|, 1)
```

**Rationale**: When the same competitor companies appear in both citation networks, it suggests the patents operate in the same competitive landscape. However, competitor overlap is less specific than direct citation overlap — companies have broad patent portfolios — hence a lower default weight.

**Default weight**: 0.08

#### 5. Affiliate/Portfolio Membership

Is the candidate within the portfolio or owned by an affiliate?

| Condition | Score |
|-----------|-------|
| In portfolio | 1.0 |
| Owned by affiliate entity | 0.7 |
| Neither | 0.0 |

**Rationale**: Portfolio and affiliate patents are inherently more interesting for family building — they represent assets under the owner's control and expand the "friendly" family.

**Default weight**: 0.10

#### 6. Citation Sector Alignment

When the candidate is connected to seeds through citations, do those connecting citations share sector membership with the seeds?

```
citation_links = all citations connecting candidate to any seed patent
aligned_links = links where the cited/citing patent shares a sector with any seed
Score = aligned_links / max(citation_links, 1)
```

**Rationale**: This addresses the user's key insight — patents may cite or be cited by patents in very different sectors (normal and expected), but when we're building families, we value citation paths that stay within the same taxonomic neighborhood. A candidate reached through sector-aligned citations is more likely to share the prosecution history profile, competitive signature, and market positioning we care about.

**Default weight**: 0.07

#### 7. Multi-Path Connectivity

How many independent citation paths connect the candidate to the seed set?

```
paths = count of distinct citation chains from candidate to any seed
Score = min(paths / 3, 1.0)  // Cap at 3+ paths = maximum score
```

**Rationale**: A patent reachable through multiple independent citation paths is more strongly connected to the seed family than one reachable through a single chain. Multi-path connectivity is a strong signal that the candidate genuinely belongs in the same technological neighborhood rather than being connected through a tenuous or coincidental link.

**Default weight**: 0.05

#### 8. Assignee Relationship

Is the candidate assigned to the same entity as any seed patent?

```
Score = 1.0 if same assignee as any seed, 0.5 if same parent company, 0.0 otherwise
```

**Rationale**: Same-assignee patents are often part of the same R&D program. This is a quick signal especially useful for expanding within a portfolio holder's own patent estate.

**Default weight**: 0.05

#### 9. Temporal Proximity

Patents filed close in time to the seeds are more likely to represent the same technology generation.

```
years_apart = min(|candidate_filing_date - seed_filing_date|) across all seeds
Score = max(0, 1.0 - years_apart / 15)  // Linear decay over 15 years
```

**Rationale**: While siblings and cousins naturally tend to be temporally close (same generation of citing/cited patents), this isn't guaranteed. A sibling discovered through a very old parent might be decades apart from the seed. Temporal proximity adds a gentle penalty for large time gaps, preventing the family from drifting into irrelevant eras. The 15-year decay window is lenient — it only significantly penalizes patents more than a decade apart.

**Default weight**: 0.05

#### Generation Distance Multiplier (Applied Separately)

Closer generations should score higher than distant ones, all else equal. Applied as a multiplier on the composite score rather than as a separate dimension:

```
depth_multiplier = 1.0 / (1.0 + decay_rate * generation_distance)
// With decay_rate = 0.2: Gen 1: 0.83, Gen 2: 0.71, Gen 3: 0.63
```

The decay rate is configurable via slider. At 0.0, no distance penalty. At 0.3, generation 2 scores 62.5% of generation 1.

### Composite Score Formula

```
RawScore = Σ(dimension_i_score × weight_i) / Σ(weight_i)  // for dimensions with data

FinalScore = RawScore × depth_multiplier × 100
```

Dimensions where data is unavailable (e.g., no sector assignment for external patent) are excluded from both numerator and denominator, matching the pattern used in the existing LLM scoring system.

---

## Weight Sliders UI

### Slider Panel Design

```
┌─ Family Expansion Weights ─────────────────────────────────┐
│                                                              │
│  Taxonomic Overlap      [████████░░░░] 0.20                 │
│  Common Prior Art       [████████░░░░] 0.20                 │
│  Common Forward Cites   [████████░░░░] 0.20                 │
│  Portfolio/Affiliate    [████░░░░░░░░] 0.10                 │
│  Competitor Overlap     [███░░░░░░░░░] 0.08                 │
│  Citation Sector Align  [███░░░░░░░░░] 0.07                 │
│  Multi-Path Connect     [██░░░░░░░░░░] 0.05                 │
│  Assignee Relationship  [██░░░░░░░░░░] 0.05                 │
│  Temporal Proximity     [██░░░░░░░░░░] 0.05                 │
│                                                              │
│  Gen Distance Decay     [██░░░░░░░░░░] 0.20                 │
│                                                              │
│  [Reset to Defaults] [Save as Preset]                       │
│                                                              │
│  ── Portfolio Context ──────────────────                    │
│  ☐ Apply portfolio sector weighting                         │
│    Portfolio sector boost  [████░░░░░░] 0.15                │
│                                                              │
│  ── Thresholds ─────────────────────────                    │
│  Membership threshold   [████████░░░░] 60                   │
│  Expansion threshold    [████░░░░░░░░] 30                   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

Weights are automatically normalized at computation time (they don't need to sum to 1.0 in the UI).

### Preset Configurations

| Preset | Use Case | Emphasis |
|--------|----------|----------|
| **Balanced** | General exploration | Default weights, thresholds 60/30 |
| **Citation-Heavy** | Finding technologically related patents | Prior art + forward cites at 0.30 each, lower taxonomy |
| **Portfolio-Focused** | Internal family building | Portfolio/affiliate at 0.25, taxonomy at 0.25, portfolio boost on |
| **Competitive Analysis** | Finding competitor targets | Competitor overlap at 0.20, sector alignment at 0.15 |
| **Broad Discovery** | Casting a wide net | Lower thresholds (40/15), lower depth decay, temporal at 0.0 |
| **Tight Technology** | Specific sub-sector focus | Taxonomy at 0.35, temporal at 0.10, high membership threshold (75) |

---

## Handling the Combinatorial Explosion Problem

This is the core challenge. Three complementary approaches:

### Approach A: Two-Threshold System (Recommended Primary)

Two configurable score thresholds create three zones:

```
Score ≥ Membership Threshold (e.g., 60)  → AUTO-INCLUDE in family
Expansion Threshold ≤ Score < Membership → NEUTRAL (expand their citations but don't include)
Score < Expansion Threshold (e.g., 30)   → AUTO-REJECT (don't expand further)
```

**How this solves the explosion problem:**

Consider seed patent S with 50 forward citations:
- 8 score above 60 → included in family (high relevance)
- 15 score between 30-60 → their citations are explored in the next generation, but they aren't family members. They're "pass-through" nodes — valuable as connectors to find more distant relatives
- 27 score below 30 → pruned. Their subtrees aren't explored

This means generation 2 only explores citations of 23 patents (8+15) instead of all 50. By generation 3, the pruning effect compounds significantly.

**Key insight**: The expansion threshold is the primary explosion control. If 100 candidates appear and only 20 pass the expansion threshold, the next generation starts from 20 instead of 100 — an 80% reduction in branching factor at each level.

**User controls**:
- Sliders for both thresholds
- Visual feedback showing how many candidates fall in each zone
- Histogram of score distribution overlaid with threshold lines
- Warning when expansion zone is too large (>200 candidates for next generation)

### Approach B: Explicit Include/Exclude/Neutral (Complementary)

Beyond the automatic thresholds, users can manually override:

| Action | Icon | Effect |
|--------|------|--------|
| **Include** | ✓ (green) | Force into family regardless of score |
| **Exclude** | ✗ (red) | Remove and don't expand their citations |
| **Neutral** | — (grey) | Use threshold-based behavior (default) |

This pairs with Approach A: thresholds set the baseline, manual overrides handle edge cases.

**Use cases for manual override**:
- A low-scoring patent that the user knows is relevant (domain expertise)
- A high-scoring patent that's actually irrelevant (scoring artifact)
- Forcing exclusion of a prolific-but-irrelevant patent whose citations would explode the search space

### Approach C: Sibling/Cousin Level Control (Supplementary, Use with Caution)

The option to include siblings (lateral at same generation) and cousins (one additional generation through siblings).

**Bidirectional Sibling Discovery**:

Siblings can be found through EITHER direction depending on the patent's age and citation profile:

| Direction | Method | Best For |
|-----------|--------|----------|
| **Via parents (backward)** | Find seed's parents → find parents' other children | Newer patents — they cite established prior art that has many children |
| **Via children (forward)** | Find seed's children → find children's other parents (co-cited patents) | Older patents — they are cited by newer patents that also cite peer patents |
| **Both** | Union of above | General case — catches peers from both directions |

```
Via parents (backward siblings):
    Parent A ──→ Seed
    Parent A ──→ Sibling 1   ← same foundation
    Parent A ──→ Sibling 2

Via children (forward siblings / co-cited peers):
    Seed      ──→ Child X
    Sibling 3 ──→ Child X    ← cited together by same downstream patent
    Sibling 4 ──→ Child X
```

This is critical: for a very new patent with few forward citations, the only way to find siblings is through shared prior art (backward). For an older patent whose forward citations have matured, the co-cited pattern (forward) often reveals the most relevant peers.

**Temporal drift with siblings**: Siblings found via parents are naturally constrained in age — they cite the same prior art, so they tend to be from a similar era. Forward-discovered siblings (co-cited) can have wider temporal spread since a 2024 patent might cite both a 2010 and 2020 patent. The temporal proximity dimension handles this naturally, applying a gentle penalty when siblings drift too far in time from seeds.

**Cousins** (2-level lateral):
- Children of siblings (via either direction)
- **Risk**: If a seed has 20 parents and each parent has 50 children (siblings), those siblings have their own children (cousins) — potentially 20 × 50 × N candidates
- Should ONLY be used with strict scoring thresholds and expansion limits

**Recommendation**: Support siblings as a toggle with direction choice (backward / forward / both). For cousins, fold them into the generational expansion model — "expand forward from siblings" in the next generation step achieves the same result with scoring-based pruning already applied. This avoids the cousin explosion by making the user explicitly decide to expand through siblings before seeing their children.

### Approach Synthesis: Recommended Architecture

Combine A + B with measured use of C:

1. **Thresholds as default behavior** (Approach A) — always active
2. **Manual overrides** (Approach B) — available on every candidate row
3. **Siblings toggle** (Approach C, siblings only) — lateral expansion at current generation
4. **Cousins via iteration** — don't have a special "cousin" mode; instead, accept relevant siblings, then expand their children in the next generation step

This avoids the cousin explosion by making the user explicitly decide to expand through siblings before seeing their children.

### Explosion Guardrails

Regardless of approach, implement these safety measures:

| Guardrail | Trigger | Action |
|-----------|---------|--------|
| **Candidate count warning** | >200 candidates in a single expansion | Show warning, suggest raising expansion threshold |
| **Expansion estimate** | Before expanding | Show "This will evaluate ~N candidates" |
| **Hard cap** | >1000 candidates from single expansion | Require confirmation or auto-apply top-N by score |
| **Progressive loading** | Always | Show top 50 candidates first, load more on scroll/request |
| **Score histogram** | Always visible | Shows distribution so user can set thresholds intelligently |

---

## Portfolio-Weighted Scoring

### Concept

When a portfolio context is active, the scoring system receives an additional boost for candidates in sectors that are strong within the portfolio. This helps find patents that complement the portfolio's existing strengths.

### Portfolio Sector Strength Computation

Using the existing aggregate system:

```typescript
interface PortfolioSectorStrength {
  sector: string;
  superSector: string;
  patentCount: number;
  avgScore: number;         // Average patent score in this sector
  strength: number;         // Normalized 0-1 (by max across sectors)
}
```

Computation:
```
strength_raw = patentCount × avgScore
strength_normalized = strength_raw / max(strength_raw across all sectors)
```

### Applying Portfolio Boost

When portfolio weighting is enabled:

```
portfolio_sector_boost = portfolio_sector_strength[candidate_sector] × portfolio_boost_weight
adjusted_score = base_score × (1.0 + portfolio_sector_boost)
```

The boost weight (default 0.15, adjustable via slider) controls how much portfolio context influences scoring. At 0.15, a candidate in the portfolio's strongest sector gets a 15% score boost.

### When Portfolio Weighting Applies

- **Portfolio exploration**: Expanding families of patents within a portfolio → portfolio weighting natural fit
- **Non-portfolio exploration**: Can still enable portfolio context to find external patents in strategically relevant sectors
- **No portfolio**: Feature disabled, no boost applied

### Portfolio Weighting Example

Portfolio has 3,000 wireless patents (high strength) and 200 security patents (moderate strength). Exploring a seed patent in wireless:

| Candidate | Base Score | Sector | Portfolio Strength | Boost | Adjusted |
|-----------|-----------|--------|-------------------|-------|----------|
| Pat A | 72 | wireless-transmission | 0.95 | +14.3% | 82.3 |
| Pat B | 68 | network-security | 0.40 | +6.0% | 72.1 |
| Pat C | 75 | media-compression | 0.15 | +2.3% | 76.7 |

This gently nudges candidates in portfolio-strong sectors higher without overwhelming the primary scoring signals.

---

## Grid/Table Design

### Column Set (with Column Selector)

The grid follows the pattern established in Patent Summary and Focus Area views:

#### Always-Visible Columns

| Column | Description |
|--------|-------------|
| ☐ (checkbox) | Selection: include/exclude/neutral |
| Patent ID | Linked, with rich tooltip (existing pattern) |
| Score | Family expansion score (0-100, color-coded) |
| Relation | seed / parent / child / sibling / included / neutral |
| Status | Member ✓ / Candidate ? / Excluded ✗ |

#### Default-Visible Columns

| Column | Description |
|--------|-------------|
| Title | Patent title (truncated with tooltip) |
| Assignee | Assignee name |
| Super-Sector | Super-sector assignment |
| Sector | Primary sector |
| Portfolio | ✓ if in portfolio |
| Competitor | Competitor badge if applicable |
| Years Remaining | Remaining patent life |

#### Optional Columns (via column selector)

| Column | Description |
|--------|-------------|
| Sub-Sector | Sub-sector if assigned |
| Filing Date | Patent filing date |
| CPC Codes | Primary CPC codes (abbreviated) |
| Forward Cites | Forward citation count |
| Backward Cites | Backward citation count |
| Common Prior Art | Count shared with seeds |
| Common Forward | Count shared with seeds |
| Competitor Cites | Competitor citation count |
| IPR | IPR status (after enrichment) |
| Prosecution | Prosecution status (after enrichment) |
| Generation | Generational distance from seeds |
| Path Count | Number of citation paths to seeds |
| Score Breakdown | Mini-bar showing dimension contributions |
| V2/V3 Score | Portfolio score (if available) |
| Data Status | portfolio / cached / not_attempted |

### Score Breakdown Tooltip

Hovering on the score column shows the dimension-by-dimension breakdown:

```
┌─ Score Breakdown: US10456789 ──────────────────────┐
│                                                      │
│  Taxonomic Overlap     ████████░░ 0.85  × 0.20      │
│  Common Prior Art      ██████░░░░ 0.60  × 0.20      │
│  Common Forward Cites  ███████░░░ 0.72  × 0.20      │
│  CPC Code Overlap      █████░░░░░ 0.50  × 0.10      │
│  Portfolio/Affiliate   ██████████ 1.00  × 0.10      │
│  Competitor Overlap    ████░░░░░░ 0.40  × 0.08      │
│  Citation Alignment    ███░░░░░░░ 0.33  × 0.07      │
│  Multi-Path Connect    ██████░░░░ 0.67  × 0.05      │
│  ─────────────────────────────────────────           │
│  Weighted Score:  70.4                                │
│  Depth Multiplier: ×0.83 (Gen 1)                     │
│  Final Score:     58.4                                │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Sorting and Filtering

- **Default sort**: Score descending
- **Filterable by**: Status (member/candidate/excluded), relation, sector, portfolio, competitor, score range
- **Group by generation**: Optional toggle to group candidates by generation depth

---

## Exploration State Management

### Exploration Lifecycle

```
                    ┌─────────────────┐
                    │   CREATE        │
                    │   Enter seeds   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   CONFIGURE     │
                    │   Set weights   │
                    │   Set thresholds│
                    └────────┬────────┘
                             │
              ┌──────────────▼──────────────┐
              │         EXPAND              │
              │   Choose direction          │
              │   Fetch one generation      │
              │   Score candidates          │
              │   Present ranked grid       │
              └──────────────┬──────────────┘
                             │
              ┌──────────────▼──────────────┐
              │         REVIEW              │
              │   Accept / Reject / Neutral │
              │   Manual overrides          │
              │   Adjust thresholds         │
              └──────────────┬──────────────┘
                             │
                      ┌──────▼──────┐
                      │  Continue?  │──Yes──→ (back to EXPAND)
                      └──────┬──────┘
                             │ No
                    ┌────────▼────────┐
                    │   FINALIZE      │
                    │   Name family   │
                    │   Create Focus  │
                    │   Area (opt.)   │
                    └─────────────────┘
```

### Saving Exploration State

Explorations should be saveable/resumable:

```typescript
interface FamilyExplorationState {
  id: string;
  name?: string;

  // Seeds
  seedPatentIds: string[];

  // Configuration
  weights: Record<string, number>;    // dimension → weight
  membershipThreshold: number;
  expansionThreshold: number;
  portfolioWeighting: boolean;
  portfolioBoostWeight: number;
  depthMultiplierRate: number;

  // Current state
  currentGeneration: number;          // How many expansion steps completed
  members: PatentFamilyMember[];      // Accepted patents
  candidates: PatentCandidate[];      // Current candidates (neutral zone)
  excluded: string[];                 // Explicitly excluded patent IDs
  frontier: string[];                 // Patents to expand in next step

  // History
  expansionHistory: ExpansionStep[];  // Record of each expansion step

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  portfolioId?: string;
}

interface ExpansionStep {
  stepNumber: number;
  direction: 'forward' | 'backward' | 'both' | 'siblings';
  candidatesEvaluated: number;
  accepted: number;
  rejected: number;
  neutral: number;
  timestamp: Date;
}

interface PatentCandidate {
  patentId: string;
  scores: Record<string, number>;     // dimension → raw score
  compositeScore: number;
  generation: number;
  relation: string;
  status: 'member' | 'candidate' | 'excluded';
  overrideReason?: string;            // If manually overridden
  discoveredVia: string[];            // Which frontier patents led here
  pathCount: number;
}
```

---

## Data Requirements and Computation Strategy

### What Data Is Needed Per Candidate

To score a candidate, the system needs:

| Data | Source | Availability |
|------|--------|-------------|
| Backward citations | PatentsView API / cache | Must fetch for external patents |
| Forward citations | PatentsView API / cache | Must fetch for external patents |
| Sector assignment | Portfolio DB / CPC inference | Portfolio patents: yes. External: infer from CPC |
| CPC codes | PatentsView API / cache | Usually available |
| Assignee | PatentsView API / cache | Usually available |
| Competitor classification | Competitor normalizer | Computed on-the-fly |
| Portfolio membership | Portfolio DB | Instant lookup |

### Computation Order

For each expansion step:

1. **Fetch citations** for frontier patents (batch, cache-first)
2. **Deduplicate** against already-seen patents (members + candidates + excluded)
3. **Batch fetch patent details** for new candidates (title, assignee, CPC from PatentsView)
4. **Compute seed aggregate data** (union of seed backward/forward citations, sectors, CPC codes, competitors)
5. **Score each candidate** against the seed aggregate
6. **Sort by score** and apply thresholds
7. **Return to frontend** with scored, sorted, zoned candidates

### Seed Aggregate Pre-computation

Rather than comparing each candidate to each seed individually, pre-compute aggregate sets:

```typescript
interface SeedAggregate {
  backwardCitations: Set<string>;     // Union of all seeds' backward citations
  forwardCitations: Set<string>;      // Union of all seeds' forward citations
  sectors: Set<string>;               // All sectors of seed patents
  superSectors: Set<string>;
  subSectors: Set<string>;
  cpcCodes: Set<string>;              // All CPC codes of seed patents
  competitors: Set<string>;           // All competitors citing/cited by seeds
  assignees: Set<string>;             // Assignees of seed patents
}
```

This makes scoring O(candidates) instead of O(candidates × seeds).

As members are accepted, the aggregate can optionally be updated to include their data too — effectively making the "seed" context grow with the family. This is a design choice:

- **Fixed seed aggregate**: Only original seeds count. Consistent scoring across generations.
- **Growing aggregate**: Accepted members expand the context. Later generations score against a richer baseline.

**Recommendation**: Start with fixed seed aggregate for v1. Add "growing aggregate" as a toggle later — it's more powerful but harder to reason about.

---

## Handling Sector-Divergent Citation Paths

### The Problem

The user correctly identifies that citations frequently cross sector boundaries. A video codec patent might cite a signal processing patent, which cites a semiconductor patent, which is cited by an RF patent. Following this chain without sector awareness leads far from the original technology.

However, **sometimes the valuable family members ARE at the end of cross-sector paths**. The challenge is finding them without drowning in irrelevant patents.

### How the Scoring System Addresses This

The scoring system handles this naturally through the interaction of multiple dimensions:

1. **A cross-sector intermediate patent** (e.g., the semiconductor patent in the chain above) scores LOW on taxonomic overlap but may score HIGH on common prior art. If it passes the expansion threshold but not the membership threshold, it becomes a pass-through node — the system explores its citations without including it in the family.

2. **A cross-sector endpoint that shares other signals** (common competitors, CPC overlap, same assignee) can still score well enough for membership even without sector overlap. This captures the "technology convergence" cases described in PATENT_FAMILIES_DESIGN.md.

3. **The citation sector alignment dimension** specifically rewards paths that stay within the taxonomic neighborhood. A candidate reached through sector-aligned citations gets a boost over one reached through divergent paths.

### Practical Example

```
Seed (video-codec, Score threshold: 60, Expansion threshold: 30)
  │
  ├── Child A (video-codec, common prior art: 5)     → Score: 82 → MEMBER
  ├── Child B (signal-processing, common prior art: 3) → Score: 45 → NEUTRAL (expand)
  ├── Child C (semiconductor, common prior art: 0)     → Score: 18 → REJECTED
  │
  └── via Child B's children:
      ├── Grandchild D (video-codec, competitor match)  → Score: 65 → MEMBER
      └── Grandchild E (audio-processing, no overlap)   → Score: 22 → REJECTED
```

Child B is the "bridge" — it doesn't join the family but enables discovery of Grandchild D, which DOES share the seed's technology profile. This is exactly the "uncle as connector" concept from the original design.

---

## Implementation Considerations

### Backend Architecture

The scoring computation should happen server-side:

```
POST /api/patent-families/expand
Body: {
  explorationId: string,
  direction: 'forward' | 'backward' | 'both' | 'siblings',
  weights: Record<string, number>,
  membershipThreshold: number,
  expansionThreshold: number,
  portfolioWeighting?: { enabled: boolean, boostWeight: number },
  maxCandidates?: number          // Hard cap, default 500
}

Response: {
  candidates: ScoredCandidate[],  // Sorted by score descending
  stats: {
    totalDiscovered: number,
    aboveMembership: number,
    inExpansionZone: number,
    belowExpansion: number,
    pruned: number                // Excluded by hard cap
  },
  scoreHistogram: number[],       // Bucketed for visualization
  warnings: string[]              // "Large expansion", etc.
}
```

### Score Recalculation

When the user adjusts weights or thresholds, scores should recalculate **without re-fetching data**. The raw dimension scores are cached; only the weighted combination changes.

```
POST /api/patent-families/rescore
Body: {
  explorationId: string,
  weights: Record<string, number>,
  membershipThreshold: number,
  expansionThreshold: number
}
```

This should be fast — pure computation on already-fetched data.

### Integration with Existing Systems

| System | Integration Point |
|--------|------------------|
| **Competitor normalizer** | Score dimension 4 (competitor overlap) |
| **Affiliate normalizer** | Score dimension 5 (portfolio/affiliate) |
| **Sector mapper** | Score dimension 1 (taxonomic overlap), dimension 6 (citation sector alignment) |
| **PatentsView cache** | Citation data, patent details |
| **Portfolio DB** | Membership check, sector assignments, existing scores |
| **FlexFilterBuilder** | Could reuse for candidate filtering |
| **Column selector** | Reuse pattern from Patent Summary page |
| **Focus Area creation** | Final step — same as current implementation |

### Migration from Current Implementation

The current BFS-based implementation provides a useful foundation:
- `getBackwardCitations()` and `getForwardCitations()` → reuse for fetching
- `passesFilters()` → replace with scoring system
- `enrichMember()` → reuse for enriching candidates
- Multi-seed handling → adapt to work with growing frontier
- Patent detail caching → reuse entirely

The main changes:
1. Replace BFS depth loop with iterative single-generation expansion
2. Add scoring computation after each expansion
3. Replace filter-based pruning with threshold-based zoning
4. Add weight/threshold state management
5. Redesign the frontend from "configure-and-run" to "expand-review-repeat"

---

## Open Questions and Trade-offs

### 1. Fixed vs. Growing Seed Aggregate

Should accepted members expand the "seed" context for scoring future generations?

- **Fixed**: More predictable, easier to understand, scores comparable across generations
- **Growing**: More powerful discovery, adapts to the family as it forms, but scores drift as context changes

**Recommendation**: Fixed for v1, growing as opt-in for v2.

### 2. Score Stability Across Generations

A candidate scored in generation 1 with score=55 might score differently if re-scored in generation 3 (different frontier, potentially different context). Should we re-score existing candidates when new data arrives?

**Recommendation**: No. Score at time of discovery, display as-is. Users can manually re-score if needed.

### 3. Sibling Discovery Timing

Should siblings be offered as a separate expansion direction or automatically included when expanding backward?

**Recommendation**: Separate "Expand Siblings" button. Siblings of seeds are often the highest-value candidates and deserve explicit attention rather than being buried in a backward expansion.

### 4. External Patent Sector Inference

For external patents (not in portfolio), sector is unknown. Options:
1. Infer from CPC codes using sector→CPC mapping (fast, approximate)
2. Use LLM classification (slow, accurate)
3. Leave blank, exclude from taxonomic scoring dimension

**Recommendation**: Option 1 for v1. CPC-based inference is good enough for scoring purposes.

### 5. When to Fetch vs. When to Score

Fetching citation data from PatentsView is the main bottleneck. Should we:
1. Fetch all citations for a generation, then score → more data, slower
2. Score based on available data, fetch more for high-scoring candidates → faster iteration

**Recommendation**: Option 1 for correctness. The cache means subsequent expansions are fast. But implement the hard cap (max 500 candidates) to prevent fetching thousands of patent details.

---

## Comparison with Current Implementation

| Aspect | Current (v1) | Proposed (v2) |
|--------|-------------|---------------|
| Expansion model | Set depth, run BFS | One generation at a time |
| Pruning | Binary filters | Multi-factor scoring with thresholds |
| User interaction | Configure → Run → View | Configure → Expand → Review → Repeat |
| Ranking | No ranking (flat list) | Score-sorted with breakdown |
| Explosion control | Hard cap (500) | Scoring thresholds + hard cap |
| Intermediate patents | All included or excluded | Pass-through zone (expand but don't include) |
| Weight control | None | Full slider panel |
| Portfolio context | Portfolio filter only | Sector strength weighting |
| Persistence | Transient | Saveable/resumable explorations |

---

## Summary of Recommendations

1. **Primary mechanism**: Two-threshold scoring (membership + expansion) with manual overrides
2. **Scoring dimensions**: 8 core dimensions with weights adjustable via sliders
3. **Portfolio weighting**: Optional sector strength boost based on portfolio aggregates
4. **Explosion control**: Scoring thresholds are the main control; hard cap as safety net
5. **Siblings**: Available as explicit expansion direction; cousins achieved through iterative expansion
6. **Grid**: Column selector pattern with score breakdown tooltip, same UX patterns as existing pages
7. **Persistence**: Explorations saveable and resumable
8. **Seed aggregate**: Fixed (only original seeds) for v1; growing aggregate as v2 option
9. **External patent sectors**: Infer from CPC codes for scoring purposes
10. **Migration**: Reuse existing citation fetching, enrichment, and caching infrastructure

---

*See also: [PATENT_FAMILIES_DESIGN.md](./PATENT_FAMILIES_DESIGN.md), [PATENT_FAMILY_EXPLORER.md](./PATENT_FAMILY_EXPLORER.md)*
