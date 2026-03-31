# Taxonomy Refactor System

## Overview

A parameterized system for transforming one taxonomy into another, operating as a background process that can refactor an entire taxonomy hierarchy — from sub-sector granularity up through sector and super-sector levels — while optimizing toward configurable goals.

Replaces the ad-hoc per-sector scripts (`setup-v2-*.ts`, `run-v2-*-classification.ts`, `analyze-*-cpc.cjs`) with general-purpose code callable from the GUI.

---

## Core Concept: Taxonomy Transformation Operation

A **refactor operation** takes an input taxonomy and produces an output taxonomy, guided by a specification:

```
InputTaxonomy + RefactorSpec → OutputTaxonomy + ClassificationResults
```

The operation runs iteratively:
1. **Analyze** — CPC distribution, portfolio sizing, coverage gaps
2. **Propose** — Generate candidate sub-sectors from CPC clusters
3. **Classify** — Run priority-based classification against new rules
4. **Validate** — Check portfolio/size targets, identify violations
5. **Adjust** — Refine rules, merge/split nodes, re-prioritize
6. **Bubble Up** — Optionally reshape higher taxonomy levels based on lower results

Steps 2–6 repeat per taxonomy level (bottom-up), and the full cycle can repeat across rounds.

---

## Refactor Specification

### RefactorSpec

The specification that drives a transformation. Stored as JSON in the database (or passed as config to the service). Future: editable in GUI.

```typescript
interface RefactorSpec {
  // Identity
  id: string;
  name: string;
  description: string;

  // Source
  inputTaxonomyTypeId: string;       // e.g., 'tt_patent_v1'
  inputScope: InputScope;            // What subset of input to refactor

  // Destination
  outputTaxonomyTypeId: string;      // e.g., 'tt_patent_v2'
  outputPortfolioGroupId: string;    // Where classifications land

  // Hierarchy goals
  hierarchy: HierarchySpec;

  // Classification goals
  classification: ClassificationSpec;

  // Execution parameters
  execution: ExecutionSpec;

  // Future: structured question integration
  questionStrategy?: QuestionStrategySpec;
}
```

### InputScope — What to refactor

```typescript
interface InputScope {
  // Breadth of input (can combine filters)
  mode: 'full' | 'subtree' | 'filtered';

  // For 'subtree': refactor everything under this node
  rootNodeId?: string;               // e.g., the 'sdn-network' super-sector
  rootNodeCode?: string;             // Alternative: by code

  // For 'filtered': limit input patents
  filters?: {
    portfolioIds?: string[];         // Only patents in these portfolios
    superSectors?: string[];         // Only these super-sectors
    sectors?: string[];              // Only these sectors
    topN?: {                         // Top N patents by score
      metric: 'composite' | 'llm' | 'citation' | 'prosecution';
      n: number;
      scope: 'portfolio' | 'sector' | 'global';
    };
    minScore?: {                     // Minimum score threshold
      metric: string;
      value: number;
    };
    diversitySample?: {              // Stratified sampling
      stratifyBy: 'sector' | 'super-sector' | 'portfolio';
      sampleSize: number;
    };
  };

  // Exclude specific nodes from refactoring (keep as-is)
  excludeNodeCodes?: string[];
}
```

### HierarchySpec — Shape of the output taxonomy

```typescript
interface HierarchySpec {
  // Depth control
  maxDepth: number;                  // e.g., 3 for super-sector/sector/sub-sector
  minDepth?: number;                 // Minimum depth to create (default: maxDepth)

  // Level definitions with targets
  levels: LevelSpec[];

  // Naming conventions
  naming: NamingConvention;

  // Bubble-up: can we reshape higher levels?
  reshapeHigherLevels: boolean;      // If true, sectors/super-sectors can be reorganized
  preserveLevel1Structure?: boolean; // Even if reshaping, keep L1 stable
}

interface LevelSpec {
  level: number;                     // 1, 2, 3, ...
  label: string;                     // "Super-sector", "Sector", "Sub-sector"

  // Target count of nodes at this level
  targetNodeCount?: {
    min: number;                     // e.g., 10 super-sectors minimum
    max: number;                     // e.g., 15 super-sectors maximum
  };

  // Target size of each node (patent count)
  targetNodeSize?: {
    min: number;                     // e.g., 50 patents per sub-sector
    max: number;                     // e.g., 500 patents per sub-sector
    optimal?: number;                // e.g., 200 patents ideal
  };

  // Per-portfolio targets (the <500 Broadcom constraint)
  targetPortfolioSize?: {
    max: number;                     // e.g., 500 patents per portfolio per node
    referencePortfolioIds?: string[]; // Which portfolios to optimize for
    // If not specified, optimizes for largest portfolio
  };

  // How many child nodes should each parent have
  targetChildCount?: {
    min: number;                     // e.g., 3 children minimum
    max: number;                     // e.g., 30 children maximum
  };
}

interface NamingConvention {
  // Abbreviation rules
  level1AbbrevLength: number;        // e.g., 3 for "NET", "CMP"
  level2PlusAbbrevLength: number;    // e.g., 4-5 for "SWIT", "MGMT"
  codeFormat: 'prefix-chain';        // {L1_ABBREV}/{L2_ABBREV}/slug

  // Slug generation
  slugStyle: 'kebab-case';           // e.g., "sdn-control"
  maxSlugLength: number;             // e.g., 25 characters
}
```

### ClassificationSpec — How patents are assigned

```typescript
interface ClassificationSpec {
  // Privileged associations
  privilegedAssociationCount: number; // e.g., 3 (primary, secondary, tertiary)

  // Weighting
  inventiveSourceWeight: number;      // e.g., 1.0
  additionalSourceWeight: number;     // e.g., 0.3
  reinforcementBonus: number;         // e.g., 0.2

  // Rule generation
  ruleGeneration: {
    // Priority tiers
    specificSubgroupPriority: number;  // e.g., 85
    groupLevelPriority: number;        // e.g., 75
    broadCatchPriority: number;        // e.g., 60
    ultimateCatchAllPriority: number;  // e.g., 40

    // Minimum patents for a pattern to generate a rule
    minPatentsForRule: number;         // e.g., 10

    // Handle CPC dual numbering (H04L41/08xx vs H04L41/8xx)
    handleDualNumbering: boolean;      // e.g., true
  };

  // Association quality goals
  associationQuality?: {
    // Balance between exhaustive coverage and orthogonal differentiation
    // 'exhaustive' = fewer associations cover more CPCs per patent
    // 'orthogonal' = more associations reveal different tech facets
    strategy: 'exhaustive' | 'orthogonal' | 'balanced';

    // Target multi-classification rate
    targetMultiClassRate?: {
      min: number;                     // e.g., 0.5 (50% have 2+ associations)
      max: number;                     // e.g., 0.9
    };
  };
}
```

### ExecutionSpec — How the refactor runs

```typescript
interface ExecutionSpec {
  // Iteration control
  maxIterations: number;              // Cap on refinement rounds (e.g., 10)
  convergenceThreshold: number;       // Stop when <N% of patents move (e.g., 0.02)

  // Budget
  llmBudget?: {                       // For future LLM-assisted refactoring
    maxTokens: number;
    maxCalls: number;
    model: string;
  };

  // Execution mode
  mode: 'automatic' | 'interactive';
  // automatic: runs all iterations uninterrupted
  // interactive: pauses after each round for user review

  // Save intermediate results
  saveIntermediateResults: boolean;    // Save each candidate taxonomy
  intermediatePrefix?: string;        // e.g., 'refactor-round-'

  // Dry run
  dryRun: boolean;

  // Processing
  batchSize: number;                  // Patents per classification batch (e.g., 500)

  // Progress
  progressCallback?: 'batch-job' | 'log-file' | 'none';
}
```

### QuestionStrategySpec — Future: structured question integration

```typescript
interface QuestionStrategySpec {
  // When to refactor questions (future implementation)
  refactorQuestions: boolean;

  // Question inheritance
  // Higher-level questions can be specialized with appended text
  // for narrower taxonomy nodes (existing feature)
  inheritanceStrategy: 'append-specialize' | 'full-override' | 'mixed';

  // Optimization feedback
  // Run LLM scoring on sample patents to test if taxonomy
  // changes improve question differentiation
  feedbackLoop: boolean;
  sampleSize?: number;                // Patents to test per round
  sampleStrategy?: 'topN' | 'diversity' | 'random';

  // revAIQ integration
  // Different taxonomy candidates produce different score revisions
  trackRevisions: boolean;
}
```

---

## Algorithm: Bottom-Up Refactor with Bubble-Up

### Phase 1: Analysis (per level, bottom-up)

For each sector at the current level:

1. **CPC Distribution Analysis**
   - Query all patents in the sector
   - Group CPCs at multiple granularities (class, subclass, group, subgroup)
   - Count total, inventive, per-portfolio
   - Identify CPC groups exceeding `targetNodeSize.max`

2. **Portfolio Impact Analysis**
   - For each reference portfolio, count patents per CPC group
   - Flag groups exceeding `targetPortfolioSize.max`

3. **Dual Numbering Detection**
   - Detect cases like H04L41/08xx vs H04L41/8xx
   - Flag for separate rule treatment

### Phase 2: Propose Sub-sectors

1. **CPC Clustering**
   - Group related CPC codes into candidate sub-sectors
   - Use CPC hierarchy structure as primary guide
   - Split groups that exceed size targets
   - Merge groups that are below `targetNodeSize.min`

2. **Rule Generation**
   - For each candidate sub-sector, generate CPC_PREFIX rules
   - Assign priorities based on specificity tier
   - Handle dual numbering schemes
   - Create catch-all rules at lowest priority

3. **Node Creation**
   - Generate codes following naming convention
   - Build hierarchy with parent references
   - Assign abbreviations

### Phase 3: Classify

Run the existing `multi-classification-service.ts` algorithm (not the simplified script version):
- Load rules sorted by priority
- For each patent, match CPCs against rules
- Calculate weights with inventive/additional distinction
- Apply reinforcement bonus
- Select top N classifications
- Calculate confidence scores

### Phase 4: Validate

Check results against spec goals:

```typescript
interface ValidationResult {
  level: number;
  nodeCode: string;

  // Size checks
  totalPatents: number;
  portfolioSizes: Map<string, number>;  // portfolio → count
  violations: ValidationViolation[];

  // Quality checks
  multiClassRate: number;
  avgClassificationsPerPatent: number;
  noMatchCount: number;
  catchAllCount: number;               // Patents only matching catch-all rules
}

interface ValidationViolation {
  type: 'oversized' | 'undersized' | 'portfolio-exceeded' |
        'too-many-children' | 'too-few-children' | 'low-multi-class';
  nodeCode: string;
  actual: number;
  target: number;
  severity: 'error' | 'warning';
}
```

### Phase 5: Adjust

For each violation:
- **Oversized node**: Split by examining CPC distribution within the node
- **Undersized node**: Merge with sibling or absorb into parent catch-all
- **Portfolio exceeded**: Split using portfolio-specific CPC analysis
- **Low multi-class rate**: Broaden CPC patterns or lower priority thresholds

### Phase 6: Bubble Up

After lower levels converge, optionally reshape higher levels:

1. **Sector Rebalancing**
   - If sub-sectors cluster naturally into different groupings than current sectors
   - Move sub-sectors between sectors to improve balance
   - Rename sectors to reflect new contents

2. **Super-sector Rebalancing**
   - If sectors group differently than current super-sectors
   - Merge small super-sectors, split large ones

3. **Association Reshuffling**
   - Reshaping higher levels changes CPC coverage per node
   - Re-run classification to see how associations redistribute
   - More orthogonal higher-level groupings → more diverse associations → more differentiated LLM questions

---

## Structured Question Implications (Design Forward)

The taxonomy refactor affects structured questions in several ways:

### Question Inheritance Chain

```
Super-sector question (broad)
  + Sector specialization text
    + Sub-sector specialization text
```

Existing feature: questions at higher levels include appended text for lower-level specificity. When refactoring taxonomy, consider:

1. **Narrower sub-sectors** → more specific appended text → better LLM differentiation
2. **Orthogonal associations** → patent scores across multiple distinct dimensions
3. **Divergent patents** (different scores at different taxonomy levels) → higher differentiation value

### Future Integration Points

1. **Question Generation**: After taxonomy refactor, auto-generate candidate questions for new nodes
2. **Question Testing**: Score sample patents with new questions, measure differentiation
3. **Feedback Loop**: If questions don't differentiate, adjust taxonomy boundaries
4. **revAIQ Tracking**: Each taxonomy candidate has its own question set and score revision history

### Optimization Loop (Future)

```
Taxonomy Refactor → Question Refactor → LLM Scoring → Evaluate → Adjust
     ↑                                                               |
     └───────────────────────────────────────────────────────────────┘
```

Parameters user can tune between rounds:
- Size targets (class granularity)
- Association strategy (exhaustive vs orthogonal)
- Question differentiation goals
- LLM budget allocation
- Which portfolios to optimize for

---

## Integration with Existing Infrastructure

### Batch Job System

Refactor operations integrate with the existing `batch_jobs` table:

```
coverageType: 'taxonomy-refactor'
targetType: 'taxonomy'
status: pending → running → completed/failed
```

Progress tracked via existing log file pattern. Each iteration round creates a sub-job linked by `groupId`.

### Service Architecture

```
src/api/services/
  taxonomy-refactor-service.ts    ← NEW: orchestration
  taxonomy-analyzer-service.ts    ← NEW: CPC analysis (replaces analyze-*.cjs)
  taxonomy-proposer-service.ts    ← NEW: sub-sector generation (replaces setup-*.ts)
  multi-classification-service.ts ← EXISTING: classification engine
  cross-classification-service.ts ← EXISTING: query layer
```

### API Routes

```
POST /api/taxonomy/refactor          — Start a refactor operation
GET  /api/taxonomy/refactor/:id      — Get status and results
POST /api/taxonomy/refactor/:id/approve — Approve round (interactive mode)
POST /api/taxonomy/refactor/:id/adjust  — Adjust spec mid-run
DELETE /api/taxonomy/refactor/:id    — Cancel

GET  /api/taxonomy/analyze/:nodeId   — CPC distribution for a node
POST /api/taxonomy/propose/:nodeId   — Generate sub-sector candidates
POST /api/taxonomy/validate/:typeId  — Validate taxonomy against spec
```

---

## Migration from Ad-Hoc Scripts

### What scripts did → What service does

| Script | Service Method |
|--------|---------------|
| `analyze-network-mgmt-cpc.cjs` | `TaxonomyAnalyzerService.analyzeCpcDistribution(nodeId, options)` |
| `analyze-subsector-cpc-dist.cjs` | `TaxonomyAnalyzerService.analyzeSubsectorDistribution(nodeId, granularity)` |
| `analyze-broadcom-v2.cjs` | `TaxonomyAnalyzerService.analyzePortfolioDistribution(portfolioGroupId, portfolioIds)` |
| `setup-v2-refined.ts` | `TaxonomyProposerService.createSubsectors(parentNodeId, spec)` |
| `setup-v2-network-mgmt.ts` | `TaxonomyProposerService.createSubsectors(parentNodeId, spec)` |
| `run-v2-pilot-classification.ts` | `MultiClassificationService.assignMultiClassifications(patentIds, config)` |
| `run-v2-mgmt-classification.ts` | `MultiClassificationService.assignMultiClassifications(patentIds, config)` |

### Key Fixes in Generalization

1. **Weight formula consistency**: Scripts used `priority * 0.01`, service uses `priority * 0.1` — standardize on service formula
2. **Confidence scoring**: Scripts don't calculate confidence — use service's algorithm
3. **Indexing code filtering**: Scripts don't filter Y-section codes — use service's filter
4. **CPC dual numbering**: Detected in management refactor — built into analyzer
5. **Overlap handling**: Scripts clear/recreate per-sector causing cross-sector data loss — unified classification pass

---

## Current State & Next Steps

### Completed (ad-hoc)
- [x] network-switching: 30 sub-sectors, 83 rules
- [x] network-management: 18 sub-sectors, 190 rules
- [x] Combined: 48 sub-sectors, 273 rules, 9,653 patents

### Immediate (generalize)
- [ ] Build `TaxonomyAnalyzerService` (replaces analyze scripts)
- [ ] Build `TaxonomyProposerService` (replaces setup scripts)
- [ ] Integrate with existing `MultiClassificationService` for classification
- [ ] Create `RefactorSpec` schema and default spec for current v1→v2 transformation
- [ ] Complete remaining SDN_NETWORK sectors using generalized code

### Near-term (batch infrastructure)
- [ ] Wire into batch_jobs for background execution
- [ ] API routes for triggering and monitoring
- [ ] Run full v1→v2 taxonomy refactor as uninterrupted batch

### Future (GUI + optimization)
- [ ] GUI for editing RefactorSpec parameters
- [ ] Interactive mode with round-by-round approval
- [ ] Structured question refactor integration
- [ ] Multi-round optimization loop with LLM feedback
- [ ] revAIQ integration (taxonomy-versioned score revisions)

---

*Created: 2026-03-29*
