# Patent Family Expansion V2 - Implementation Plan

**Status**: Ready for Implementation
**Date**: 2026-02-15
**Reference**: [FAMILY_EXPANSION_V2_ANALYSIS.md](./FAMILY_EXPANSION_V2_ANALYSIS.md)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Frontend (Vue 3)                              │
│  PatentFamilyExplorerPage.vue (redesigned)                          │
│  ├── SeedPanel (seed input, validation)                              │
│  ├── WeightSlidersPanel (9 dimensions + decay + thresholds)         │
│  ├── ExpansionControls (direction buttons, sibling toggle)          │
│  ├── CandidateGrid (scored, sortable, accept/reject/neutral)       │
│  └── FamilySummary (members, stats, focus area creation)            │
├─────────────────────────────────────────────────────────────────────┤
│                        API Layer                                      │
│  patent-families.routes.ts (new endpoints)                           │
│  ├── POST /expand          (one-generation expansion + scoring)      │
│  ├── POST /rescore         (recalculate with new weights)            │
│  ├── POST /accept-reject   (update candidate statuses)               │
│  ├── POST /expand-siblings (bidirectional sibling discovery)         │
│  ├── GET  /exploration/:id (get full state)                          │
│  └── POST /save            (persist exploration state)               │
├─────────────────────────────────────────────────────────────────────┤
│                    Service Layer                                      │
│  family-expansion-scorer.ts (NEW - scoring engine)                   │
│  patent-family-service.ts (modified - iterative expansion)           │
│  ├── expandOneGeneration()                                           │
│  ├── expandSiblings()                                                │
│  ├── computeSeedAggregate()                                          │
│  └── existing cache/fetch infrastructure (reused)                    │
├─────────────────────────────────────────────────────────────────────┤
│                    Database                                           │
│  PatentFamilyExploration (modified schema)                           │
│  PatentFamilyMember (modified - add score fields, status)            │
│  PatentFamilyExpansionStep (NEW - history tracking)                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Scoring Engine (Backend)

**Goal**: Build the scoring service that computes relevance scores for candidate patents against a seed set. This is the core new capability — everything else builds on it.

**New file**: `src/api/services/family-expansion-scorer.ts`

#### 1.1 Seed Aggregate Computation

Pre-compute aggregate data from seed patents:

```typescript
interface SeedAggregate {
  patentIds: Set<string>;
  backwardCitations: Set<string>;     // Union of all seeds' backward citations
  forwardCitations: Set<string>;      // Union of all seeds' forward citations
  subSectors: Set<string>;            // Sub-sectors of seed patents
  sectors: Set<string>;               // Sectors of seed patents
  superSectors: Set<string>;          // Super-sectors of seed patents
  competitors: Set<string>;           // Competitors in seeds' citation networks
  assignees: Set<string>;             // Assignees of seed patents
  filingDates: Date[];                // Filing dates of seed patents
  portfolioPatentIds: Set<string>;    // Which seeds are in portfolio
}
```

**Implementation**:
- Load seed patent data from portfolio cache (existing `loadPortfolioMap()`)
- Load seed citation data from cache files (existing `loadCachedForwardCitations()` / `loadCachedBackwardCitations()`)
- For external seed patents, use PatentsView cache or live fetch
- Use existing `sector-mapper.ts` for sector→CPC lookups for external patents
- Compute union sets for all aggregate fields

**Files touched**: New file only. Imports from `patent-family-service.ts` for cache loaders.

#### 1.2 Per-Candidate Scoring

Score a single candidate against the seed aggregate across 9 dimensions:

```typescript
interface CandidateScore {
  patentId: string;
  dimensions: {
    taxonomicOverlap: number;        // 0-1: sub-sector=1.0, sector=0.5, super-sector=0.2
    commonPriorArt: number;          // 0-1: Jaccard of backward citations
    commonForwardCites: number;      // 0-1: Jaccard of forward citations
    competitorOverlap: number;       // 0-1: shared competitor entities
    portfolioAffiliate: number;      // 0-1: in portfolio=1.0, affiliate=0.7
    citationSectorAlignment: number; // 0-1: fraction of connecting citations in-sector
    multiPathConnectivity: number;   // 0-1: capped at 3+ paths
    assigneeRelationship: number;    // 0-1: same assignee=1.0, same parent=0.5
    temporalProximity: number;       // 0-1: linear decay over 15 years
  };
  compositeScore: number;            // 0-100 weighted + depth multiplier
  generationDistance: number;
  depthMultiplier: number;
  dataCompleteness: number;          // 0-1: fraction of dimensions with data
}

interface ScoringWeights {
  taxonomicOverlap: number;
  commonPriorArt: number;
  commonForwardCites: number;
  competitorOverlap: number;
  portfolioAffiliate: number;
  citationSectorAlignment: number;
  multiPathConnectivity: number;
  assigneeRelationship: number;
  temporalProximity: number;
  depthDecayRate: number;            // Multiplier decay rate (not a weighted dimension)
}
```

**Key functions**:

| Function | Purpose |
|----------|---------|
| `computeSeedAggregate(seedIds, portfolioMap, caches)` | Build the aggregate from seed data |
| `scoreCandidateBatch(candidates, seedAgg, weights)` | Score an array of candidates |
| `scoreCandidate(candidate, seedAgg, weights)` | Score one candidate across all dimensions |
| `computeTaxonomicOverlap(candidate, seedAgg)` | Sector hierarchy matching |
| `computeCommonPriorArt(candidate, seedAgg)` | Jaccard on backward citations |
| `computeCommonForwardCites(candidate, seedAgg)` | Jaccard on forward citations |
| `computeCompetitorOverlap(candidate, seedAgg)` | Shared competitor entities |
| `computePortfolioAffiliate(candidate, portfolioMap)` | Portfolio/affiliate check |
| `computeCitationSectorAlignment(candidate, seedAgg)` | Sector-aligned citation paths |
| `computeMultiPathConnectivity(candidate, seedAgg)` | Count of independent paths |
| `computeAssigneeRelationship(candidate, seedAgg)` | Same assignee/parent company |
| `computeTemporalProximity(candidate, seedAgg)` | Filing date distance |
| `computeCompositeScore(dimensions, weights, genDist)` | Weighted sum + depth multiplier |
| `rescoreCandidates(candidates, newWeights)` | Recalculate composites from cached dimensions |

**External patent sector inference**: Use `sector-mapper.ts` to look up sector from CPC codes. The existing mapping (`config/sector-breakout-v2.json`) maps CPC prefixes to sectors.

**Testing**: Unit tests with mock seed/candidate data. Verify each dimension computes correctly in isolation, then verify composite scoring with various weight configurations.

#### 1.3 Default Weights and Presets

```typescript
const DEFAULT_WEIGHTS: ScoringWeights = {
  taxonomicOverlap: 0.20,
  commonPriorArt: 0.20,
  commonForwardCites: 0.20,
  competitorOverlap: 0.08,
  portfolioAffiliate: 0.10,
  citationSectorAlignment: 0.07,
  multiPathConnectivity: 0.05,
  assigneeRelationship: 0.05,
  temporalProximity: 0.05,
  depthDecayRate: 0.20,
};

const PRESETS: Record<string, ScoringWeights> = {
  balanced: DEFAULT_WEIGHTS,
  citationHeavy: { ...DEFAULT_WEIGHTS, commonPriorArt: 0.30, commonForwardCites: 0.30, taxonomicOverlap: 0.10 },
  portfolioFocused: { ...DEFAULT_WEIGHTS, portfolioAffiliate: 0.25, taxonomicOverlap: 0.25 },
  competitiveAnalysis: { ...DEFAULT_WEIGHTS, competitorOverlap: 0.20, citationSectorAlignment: 0.15 },
  broadDiscovery: { ...DEFAULT_WEIGHTS, temporalProximity: 0.0, depthDecayRate: 0.05 },
  tightTechnology: { ...DEFAULT_WEIGHTS, taxonomicOverlap: 0.35, temporalProximity: 0.10 },
};
```

---

### Phase 2: Iterative Expansion API (Backend)

**Goal**: Replace the multi-depth BFS with a one-generation-at-a-time expansion model. Reuse existing citation fetching and caching infrastructure.

**Files modified**: `src/api/services/patent-family-service.ts`, `src/api/routes/patent-families.routes.ts`

#### 2.1 Core Expansion Function

New function in `patent-family-service.ts`:

```typescript
async function expandOneGeneration(
  frontierPatentIds: string[],
  direction: 'forward' | 'backward' | 'both',
  seedAggregate: SeedAggregate,
  weights: ScoringWeights,
  alreadySeen: Set<string>,         // Members + candidates + excluded
  options: {
    membershipThreshold: number;
    expansionThreshold: number;
    maxCandidates: number;           // Hard cap, default 500
    portfolioWeighting?: { enabled: boolean; boostWeight: number; sectorStrengths: Record<string, number> };
  }
): Promise<ExpansionResult>
```

**Implementation**:
1. For each frontier patent, load citations in requested direction(s) using existing `loadCachedForwardCitations()` / `loadCachedBackwardCitations()` with live API fallback
2. Collect all new patent IDs (not in `alreadySeen`)
3. Batch fetch patent details for new candidates (reuse `fetchMissingPatentDetails()`)
4. Call `scoreCandidateBatch()` from Phase 1
5. Apply portfolio boost if enabled
6. Sort by composite score descending
7. Apply hard cap
8. Zone candidates: above membership / expansion zone / below expansion
9. Return `ExpansionResult`

```typescript
interface ExpansionResult {
  candidates: ScoredCandidate[];      // Sorted by score descending
  stats: {
    totalDiscovered: number;
    aboveMembership: number;
    inExpansionZone: number;
    belowExpansion: number;
    pruned: number;                   // Cut by hard cap
    direction: string;
    generationDepth: number;
  };
  scoreDistribution: number[];        // 10-bucket histogram for visualization
  warnings: string[];
}

interface ScoredCandidate {
  patentId: string;
  title?: string;
  assignee?: string;
  score: CandidateScore;              // Full score with dimension breakdown
  generation: number;
  relation: string;                   // parent / child / sibling
  inPortfolio: boolean;
  isCompetitor: boolean;
  competitorName?: string;
  isAffiliate: boolean;
  affiliateName?: string;
  sector?: string;
  superSector?: string;
  subSector?: string;
  filingDate?: string;
  remainingYears?: number;
  forwardCitationCount?: number;
  backwardCitationCount?: number;
  discoveredVia: string[];            // Which frontier patents led here
  dataStatus: DataRetrievalStatus;
  zone: 'member' | 'expansion' | 'rejected';  // Based on thresholds
}
```

#### 2.2 Sibling Expansion (Bidirectional)

New function:

```typescript
async function expandSiblings(
  frontierPatentIds: string[],
  direction: 'backward' | 'forward' | 'both',
  seedAggregate: SeedAggregate,
  weights: ScoringWeights,
  alreadySeen: Set<string>,
  options: ExpansionOptions
): Promise<ExpansionResult>
```

**Implementation**:
- **Backward siblings**: For each frontier patent, get its parents (backward citations), then get each parent's children (forward citations of parents). Siblings = those children minus the frontier patent itself.
- **Forward siblings (co-cited peers)**: For each frontier patent, get its children (forward citations), then get each child's parents (backward citations of children). Co-cited = those parents minus the frontier patent.
- **Both**: Union of backward and forward siblings, deduplicated.
- Score all siblings using the same scoring engine.
- Siblings get generation distance = 0 (same level as the frontier patent that found them) for depth multiplier purposes, but are labeled as "sibling" in the relation field.

#### 2.3 Rescore Endpoint

Fast recalculation when user changes weights:

```typescript
async function rescoreCandidates(
  explorationId: string,
  newWeights: ScoringWeights,
  membershipThreshold: number,
  expansionThreshold: number,
  portfolioBoost?: { enabled: boolean; boostWeight: number; sectorStrengths: Record<string, number> }
): Promise<ExpansionResult>
```

This reads cached dimension scores from the exploration state and recomputes composites only — no data fetching.

#### 2.4 Accept/Reject Endpoint

```typescript
async function updateCandidateStatuses(
  explorationId: string,
  updates: Array<{
    patentId: string;
    status: 'member' | 'excluded' | 'neutral';
  }>
): Promise<void>
```

Updates the exploration state. Members join the family. Excluded patents are recorded so they don't reappear. Neutral patents remain in the expansion frontier.

#### 2.5 New API Routes

Add to `patent-families.routes.ts`:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `POST /v2/explorations` | POST | Create v2 exploration with seeds + initial weights |
| `POST /v2/explorations/:id/expand` | POST | Expand one generation (direction, weights, thresholds) |
| `POST /v2/explorations/:id/expand-siblings` | POST | Sibling discovery (direction) |
| `POST /v2/explorations/:id/rescore` | POST | Recalculate scores with new weights |
| `POST /v2/explorations/:id/candidates` | POST | Update candidate statuses (accept/reject/neutral) |
| `GET /v2/explorations/:id` | GET | Get full exploration state |
| `POST /v2/explorations/:id/save` | POST | Save/name the exploration |
| `GET /v2/presets` | GET | Return available weight presets |
| `POST /v2/explorations/:id/create-focus-area` | POST | Create focus area from members |

**Route prefix**: `/v2/` keeps the existing v1 endpoints working during transition. Once v2 is stable, v1 routes can be deprecated.

---

### Phase 3: Database Schema Changes

**Goal**: Extend the Prisma schema to support iterative expansion state, per-candidate scores, and expansion history.

#### 3.1 Modified PatentFamilyExploration

```prisma
model PatentFamilyExploration {
  id                  String   @id @default(cuid())

  // Seeds
  seedPatentIds       String[] @map("seed_patent_ids")   // Changed: always multi-seed
  name                String?
  description         String?

  // Scoring configuration (persisted for resumability)
  weights             Json?    // ScoringWeights object
  membershipThreshold Float?   @map("membership_threshold")
  expansionThreshold  Float?   @map("expansion_threshold")
  depthDecayRate      Float?   @map("depth_decay_rate")
  portfolioWeighting  Json?    @map("portfolio_weighting")  // { enabled, boostWeight, sectorStrengths }

  // State
  currentGeneration   Int      @default(0) @map("current_generation")
  status              WorkflowStatus @default(PENDING)
  memberCount         Int      @default(0) @map("member_count")
  candidateCount      Int      @default(0) @map("candidate_count")

  // Seed aggregate cache (avoid recomputing)
  seedAggregate       Json?    @map("seed_aggregate")

  // Metadata
  errorMessage        String?  @map("error_message")
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  members             PatentFamilyMember[]
  expansionSteps      PatentFamilyExpansionStep[]

  // Remove old single-seed fields (migration drops these):
  // seedPatentId, maxAncestorDepth, maxDescendantDepth, includeSiblings,
  // includeCousins, limitToSectors, limitToCpcPrefixes, etc.

  @@map("patent_family_explorations")
}
```

#### 3.2 Modified PatentFamilyMember

```prisma
model PatentFamilyMember {
  id                  String   @id @default(cuid())

  explorationId       String   @map("exploration_id")
  exploration         PatentFamilyExploration @relation(fields: [explorationId], references: [id], onDelete: Cascade)

  patentId            String   @map("patent_id")
  status              String   @default("candidate") // "member", "candidate", "excluded"

  // Relationship info
  relationToSeed      String   @map("relation_to_seed")
  generationDepth     Int      @map("generation_depth")
  discoveredVia       String[] @map("discovered_via")    // Patent IDs that led to discovery
  discoveredAtStep    Int?     @map("discovered_at_step") // Which expansion step

  // Scoring (cached dimension scores for fast rescore)
  dimensionScores     Json?    @map("dimension_scores")  // { taxonomicOverlap: 0.85, ... }
  compositeScore      Float?   @map("composite_score")
  dataCompleteness    Float?   @map("data_completeness")

  // Patent data snapshot (avoid re-fetching for display)
  inPortfolio         Boolean  @default(false) @map("in_portfolio")
  title               String?
  assignee            String?
  sector              String?
  superSector         String?  @map("super_sector")
  filingDate          String?  @map("filing_date")
  remainingYears      Float?   @map("remaining_years")
  isCompetitor        Boolean  @default(false) @map("is_competitor")
  competitorName      String?  @map("competitor_name")

  createdAt           DateTime @default(now()) @map("created_at")

  @@unique([explorationId, patentId])
  @@index([explorationId])
  @@index([explorationId, status])
  @@index([compositeScore])
  @@map("patent_family_members")
}
```

#### 3.3 New PatentFamilyExpansionStep

```prisma
model PatentFamilyExpansionStep {
  id                  String   @id @default(cuid())

  explorationId       String   @map("exploration_id")
  exploration         PatentFamilyExploration @relation(fields: [explorationId], references: [id], onDelete: Cascade)

  stepNumber          Int      @map("step_number")
  direction           String   // "forward", "backward", "both", "siblings_backward", "siblings_forward", "siblings_both"
  generationDepth     Int      @map("generation_depth")

  // Results
  candidatesEvaluated Int      @map("candidates_evaluated")
  autoIncluded        Int      @map("auto_included")      // Above membership threshold
  expansionZone       Int      @map("expansion_zone")     // Between thresholds
  autoRejected        Int      @map("auto_rejected")      // Below expansion threshold
  userAccepted        Int      @default(0) @map("user_accepted")
  userExcluded        Int      @default(0) @map("user_excluded")

  // Config at time of step
  weightsUsed         Json     @map("weights_used")
  thresholdsUsed      Json     @map("thresholds_used")    // { membership, expansion }

  createdAt           DateTime @default(now()) @map("created_at")

  @@map("patent_family_expansion_steps")
  @@index([explorationId])
}
```

#### 3.4 Migration

- Add new columns to existing tables (non-breaking)
- New fields are nullable with defaults, so existing v1 explorations remain valid
- New table `PatentFamilyExpansionStep` is additive
- No data migration needed — v1 explorations don't have score data

---

### Phase 4: Frontend - Expansion Controls & Scoring Panel

**Goal**: Redesign the left panel from "configure depth and run" to "iterative expand with weight sliders and thresholds."

**File**: `frontend/src/pages/PatentFamilyExplorerPage.vue`

#### 4.1 New Reactive State

Replace the current config-driven state with iterative expansion state:

```typescript
// Seeds (keep existing pattern)
const seedInput = ref('');
const seedPatentIds = computed(() => /* existing parser */);

// Scoring weights (sliders)
const weights = reactive<ScoringWeights>({ ...DEFAULT_WEIGHTS });
const membershipThreshold = ref(60);
const expansionThreshold = ref(30);

// Portfolio weighting
const portfolioWeightingEnabled = ref(false);
const portfolioBoostWeight = ref(0.15);

// Expansion state
const explorationId = ref<string | null>(null);
const currentGeneration = ref(0);
const members = ref<ScoredCandidate[]>([]);        // Accepted members
const candidates = ref<ScoredCandidate[]>([]);      // Current generation candidates
const excluded = ref<Set<string>>(new Set());
const expansionHistory = ref<ExpansionStep[]>([]);

// UI state
const activePreset = ref('balanced');
const isExpanding = ref(false);
const isRescoring = ref(false);
const candidateView = ref<'all' | 'members' | 'candidates' | 'excluded'>('all');
```

#### 4.2 Left Panel Redesign

Replace the 4-card layout (Seeds, Expansion Config, Constraints, Preview) with:

**Card 1: Seed Patents** (keep existing, minor tweaks)
- Textarea for seed IDs
- Badge count
- After seeds are set, show seed summary: sectors, common citations count

**Card 2: Scoring Weights** (NEW)
- 9 sliders for dimension weights (0.00 to 0.50, step 0.01)
- 1 slider for depth decay rate (0.00 to 0.50)
- Preset dropdown (Balanced, Citation-Heavy, etc.)
- Reset to Defaults button
- Save as Preset button (localStorage)
- Section: Portfolio Context
  - Toggle: Apply portfolio sector weighting
  - Slider: Portfolio boost weight (when toggle on)

**Card 3: Thresholds** (NEW)
- Membership threshold slider (0-100)
- Expansion threshold slider (0-100)
- Visual: Score distribution histogram (updates after each expansion)
- Zone indicators: "N above membership, N in expansion zone, N rejected"

**Card 4: Expansion Controls** (NEW, replaces old depth selectors)
- Direction buttons: [Expand Backward] [Expand Forward] [Expand Both]
- Sibling buttons: [Find Siblings (via parents)] [Find Siblings (via children)] [Find Siblings (both)]
- Current generation indicator: "Generation 2 (3 expansion steps completed)"
- Expansion history: Collapsible list showing each step's stats

#### 4.3 Component Extraction

Extract panels into separate components for maintainability:

| Component | File | Responsibility |
|-----------|------|----------------|
| `SeedPatentPanel.vue` | `components/patent-family/` | Seed input, parsing, validation, seed summary |
| `ScoringWeightsPanel.vue` | `components/patent-family/` | 9 weight sliders, presets, portfolio boost |
| `ThresholdPanel.vue` | `components/patent-family/` | Threshold sliders, histogram, zone counts |
| `ExpansionControlsPanel.vue` | `components/patent-family/` | Direction buttons, sibling buttons, history |

The main `PatentFamilyExplorerPage.vue` composes these and manages the grid.

#### 4.4 Weight Change Handling

When user moves a weight slider or changes thresholds:
1. Debounce 300ms
2. Call `POST /v2/explorations/:id/rescore` with new weights
3. Update candidates in-place (no data refetch)
4. Update histogram and zone counts
5. Re-sort grid

This should feel instant — pure math on cached dimensions.

---

### Phase 5: Frontend - Candidate Grid

**Goal**: Redesign the results table to show scored candidates with accept/reject/neutral controls.

#### 5.1 Grid Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ Family Members: 12  │  Candidates: 47  │  Excluded: 23          │
│ [Members] [Candidates] [All] [Excluded]    [Column Selector ▼]  │
├──────────────────────────────────────────────────────────────────┤
│ Status │ Score │ Patent ID │ Title │ Sector │ Relation │ ...    │
│  [✓]   │  82   │ US1045..  │ ...   │ ...    │ child    │        │
│  [?]   │  71   │ US1023..  │ ...   │ ...    │ child    │        │
│  [✗]   │  34   │ US0987..  │ ...   │ ...    │ parent   │        │
├──────────────────────────────────────────────────────────────────┤
│ Bulk: [Accept All Above Threshold] [Reject All Below] [Clear]   │
│       [Create Focus Area from Members]                           │
└──────────────────────────────────────────────────────────────────┘
```

#### 5.2 Status Column Interaction

Each row has a tri-state control:

| State | Icon | Color | Meaning |
|-------|------|-------|---------|
| Member | ✓ | Green | Included in family, will be expanded |
| Neutral | — | Grey | Threshold-based behavior (default) |
| Excluded | ✗ | Red | Rejected, won't be expanded |

Clicking cycles: Neutral → Member → Excluded → Neutral

Bulk actions:
- "Accept all above membership threshold" — set all green
- "Reject all below expansion threshold" — set all red
- "Accept auto-suggested" — apply threshold zones as statuses

#### 5.3 Score Column

- Color-coded: green (≥membership), amber (expansion zone), red (<expansion)
- Hover tooltip: full dimension breakdown with bar chart (from analysis doc)
- Sortable (default sort)

#### 5.4 Column Selector

Follow existing Patent Summary pattern with `useColumnSelector` composable:

- Persist preferences to localStorage per page
- Default visible: Status, Score, Patent ID, Title, Assignee, Sector, Relation, Portfolio, Years Left
- Optional: Sub-sector, Competitor, Filing Date, Common Prior Art count, Common Forward count, Multi-path count, IPR, Prosecution, V2/V3 Score, Generation, Score Breakdown, Data Status

#### 5.5 Score Distribution Histogram

Small inline histogram (Quasar sparkline or custom SVG) in the threshold panel:

```
  ██                        Score Distribution
  ██ ██                     ──────────────────
  ██ ██ ██                  ▓▓ Above membership (12)
  ██ ██ ██ ██ ██            ░░ Expansion zone (47)
  ██ ██ ██ ██ ██ ██ ██      ·· Below expansion (23)
  ───────────────────
  0  20  40  60  80  100
       ↑exp    ↑mem
```

Shows threshold lines as vertical markers.

---

### Phase 6: Frontend - API Client & Types

**File**: `frontend/src/services/api.ts`

#### 6.1 New Types

```typescript
interface ScoringWeights {
  taxonomicOverlap: number;
  commonPriorArt: number;
  commonForwardCites: number;
  competitorOverlap: number;
  portfolioAffiliate: number;
  citationSectorAlignment: number;
  multiPathConnectivity: number;
  assigneeRelationship: number;
  temporalProximity: number;
  depthDecayRate: number;
}

interface CandidateScore {
  patentId: string;
  dimensions: Record<string, number>;
  compositeScore: number;
  generationDistance: number;
  depthMultiplier: number;
  dataCompleteness: number;
}

interface ScoredCandidate {
  patentId: string;
  title?: string;
  assignee?: string;
  score: CandidateScore;
  generation: number;
  relation: string;
  inPortfolio: boolean;
  isCompetitor: boolean;
  competitorName?: string;
  sector?: string;
  superSector?: string;
  subSector?: string;
  filingDate?: string;
  remainingYears?: number;
  forwardCitationCount?: number;
  discoveredVia: string[];
  dataStatus: string;
  zone: 'member' | 'expansion' | 'rejected';
  status: 'member' | 'candidate' | 'excluded';
}

interface ExpansionResult {
  candidates: ScoredCandidate[];
  stats: { totalDiscovered: number; aboveMembership: number; inExpansionZone: number; belowExpansion: number; pruned: number };
  scoreDistribution: number[];
  warnings: string[];
}

interface ExplorationStateV2 {
  id: string;
  name?: string;
  seedPatentIds: string[];
  weights: ScoringWeights;
  membershipThreshold: number;
  expansionThreshold: number;
  currentGeneration: number;
  members: ScoredCandidate[];
  candidates: ScoredCandidate[];
  excluded: string[];
  expansionHistory: ExpansionStep[];
}
```

#### 6.2 New API Methods

```typescript
const patentFamilyApiV2 = {
  createExploration(seedPatentIds: string[], weights: ScoringWeights): Promise<ExplorationStateV2>,
  expand(explorationId: string, params: ExpandParams): Promise<ExpansionResult>,
  expandSiblings(explorationId: string, direction: string): Promise<ExpansionResult>,
  rescore(explorationId: string, weights: ScoringWeights, thresholds: Thresholds): Promise<ExpansionResult>,
  updateCandidates(explorationId: string, updates: CandidateUpdate[]): Promise<void>,
  getExploration(explorationId: string): Promise<ExplorationStateV2>,
  saveExploration(explorationId: string, name: string): Promise<void>,
  getPresets(): Promise<Record<string, ScoringWeights>>,
  createFocusArea(explorationId: string, name: string, description?: string): Promise<FocusArea>,
};
```

---

### Phase 7: Portfolio Sector Weighting

**Goal**: When portfolio context is enabled, compute sector strengths from portfolio aggregates and apply boost to candidate scoring.

#### 7.1 Portfolio Sector Strength Endpoint

Add to existing `patents.routes.ts` (reuse aggregate infrastructure):

```
GET /api/patents/sector-strengths
Response: { sectors: Array<{ sector, superSector, patentCount, avgScore, strength }> }
```

Uses existing aggregate query pattern to compute patent count and average score per sector, then normalizes.

#### 7.2 Integration with Scoring

When `portfolioWeighting.enabled = true`:
1. Frontend fetches sector strengths on toggle
2. Sends `sectorStrengths` map with expand/rescore requests
3. Scorer applies boost: `adjustedScore = baseScore × (1.0 + sectorStrengths[sector] × boostWeight)`

---

## Implementation Order and Dependencies

```
Phase 1: Scoring Engine        ← No dependencies, can start immediately
    │
Phase 3: Schema Changes        ← Can run in parallel with Phase 1
    │
Phase 2: Expansion API         ← Depends on Phase 1 (scoring) + Phase 3 (schema)
    │
Phase 6: API Client Types      ← Depends on Phase 2 (API shape finalized)
    │
Phase 4: Frontend Controls     ← Depends on Phase 6 (types available)
Phase 5: Frontend Grid         ← Depends on Phase 6 (types available)
    │                               Phases 4+5 can be done in parallel
Phase 7: Portfolio Weighting   ← Can start after Phase 2, integrates into 4+5
```

**Recommended implementation sequence**:

| Step | Phases | Description | Estimated Scope |
|------|--------|-------------|-----------------|
| 1 | 1 + 3 | Scoring engine + schema migration | New service file (~400 lines) + migration |
| 2 | 2 | Iterative expansion API endpoints | Modify service (~300 lines) + new routes (~200 lines) |
| 3 | 6 | Frontend API types and client methods | Modify api.ts (~150 lines) |
| 4 | 4 | Left panel: weight sliders, thresholds, expansion controls | 3-4 new components (~600 lines total) |
| 5 | 5 | Candidate grid redesign | Modify main page + new column config (~400 lines) |
| 6 | 7 | Portfolio sector weighting | Backend endpoint + frontend toggle (~150 lines) |

---

## Preserving Existing Functionality

The v1 exploration system continues to work during transition:

| Aspect | Approach |
|--------|----------|
| v1 API routes | Kept under existing paths, no changes |
| v2 API routes | Added under `/v2/` prefix |
| Database | Additive changes only — new nullable columns + new table |
| Frontend | Both v1 and v2 UIs coexist during development; v1 can be removed when v2 is complete |
| Citation caching | Shared — both v1 and v2 use same cache infrastructure |
| Enrichment | Shared — v2 reuses all existing detail/litigation enrichment |
| Focus area creation | Shared — v2 feeds into same focus area creation flow |

---

## Testing Strategy

| Test Area | Approach |
|-----------|----------|
| **Scoring dimensions** | Unit tests with known input → expected output for each dimension |
| **Composite scoring** | Test weight normalization, depth multiplier, missing data handling |
| **Expansion** | Integration test: seeds → expand → verify candidates contain expected patents |
| **Rescore** | Verify changing weights updates composites without data refetch |
| **Sibling bidirectional** | Test forward vs backward sibling discovery produces correct results |
| **Threshold zones** | Verify correct zone assignment at boundary values |
| **Portfolio boost** | Verify sector strengths correctly adjust scores |
| **Schema migration** | Verify migration runs cleanly, v1 data preserved |
| **Frontend** | Manual testing of slider interactions, grid sorting, accept/reject workflow |

---

## Risk Factors

| Risk | Mitigation |
|------|------------|
| Citation data not cached for external patents | Live API fallback exists; show loading state in UI |
| Large families exceed 500 candidates per generation | Hard cap with warning; suggest raising thresholds |
| Sector inference from CPC is imprecise for external patents | Acceptable for scoring; marked with lower data completeness |
| Weight slider interaction feels sluggish | Rescore is pure math on cached data — should be <100ms |
| Database growth from storing per-candidate dimension scores | JSON field is compact; can purge old explorations |
| User confusion with 9 sliders | Presets handle 80% of use cases; advanced users tune sliders |

---

*See also: [FAMILY_EXPANSION_V2_ANALYSIS.md](./FAMILY_EXPANSION_V2_ANALYSIS.md) for scoring design rationale*
