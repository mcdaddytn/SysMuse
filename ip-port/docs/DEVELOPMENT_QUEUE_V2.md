# Development Queue V2

**Updated**: 2026-01-28

---

## Guiding Principles

1. **Schema-first**: Get database relationships stable before accumulating data
2. **Generalize before specializing**: Build reusable patterns (LLM workflow engine, entity analysis) that enable multiple features
3. **Foundation before features**: Tournament summarization is one pattern on a generalized workflow engine
4. **Data enrichment continues**: LLM enrichment runs in parallel with development
5. **On-demand over bulk**: Patent families explored from seed patents, not bulk-imported

---

## Completed (Reference)

| Feature | Status |
|---------|--------|
| Citation Classification (P-0a) | Done |
| Scoring Engine V3 (P-0b) | Done |
| Portfolio Grid (P-0c) | Done |
| Sector Rankings (P-0d) | Done |
| CSV Export (P-0e) | Done |
| V3 Scoring Page | Done |
| Prompt Templates (STRUCTURED + FREE_FORM) | Done |
| Configurable delimiters | Done |
| Template execution engine | Done |
| Restaurant POS test case (13 patents) | Done |

---

## Tier 0: Schema Foundation (IMMEDIATE)

Get these models into the database now, while data is manageable and migrations are simple.

### 0A. LLM Workflow Engine

**Problem**: Prompt templates currently execute in isolation. Multi-stage workflows (tournament summarization, chained analyses, prerequisite resolution) need a generalized dependency framework where one job's output feeds into another's input.

**Design**:
- `LlmWorkflow` — A directed acyclic graph of jobs
- `LlmJob` — Individual unit of LLM work, wrapping a template execution
- `LlmJobDependency` — Edges in the DAG: output of job A feeds input of job B
- Jobs can reference outputs of upstream jobs as template inputs (not just system objects)
- The engine resolves the dependency tree and executes in correct order
- State tracking: which jobs are pending/running/complete/error

**Patterns this enables**:
| Pattern | Description |
|---------|-------------|
| **Tournament** | Multi-round clustering with summary rollup |
| **Two-stage** | Per-patent analysis → collective summary (what we do now, but tracked) |
| **Chained extraction** | LLM classifies patent → result feeds into scoring template |
| **Prerequisite resolution** | Template needs a field not yet computed → engine finds/runs the job that produces it |

**Future**: Templates can declare input parameters that are outputs of other templates. When a template with unresolved inputs is executed, the workflow engine identifies prerequisite jobs in the dependency tree and executes them first.

```prisma
model LlmWorkflow {
  id              String   @id @default(cuid())

  name            String
  description     String?
  workflowType    String   @default("custom") @map("workflow_type")
                           // "tournament", "two_stage", "chained", "custom"

  // Scope — polymorphic: what entity collection this operates on
  scopeType       String   @map("scope_type")   // "focus_area", "sector", "super_sector", "portfolio"
  scopeId         String?  @map("scope_id")      // Entity ID (null for portfolio-wide)

  status          WorkflowStatus @default(PENDING)
  config          Json?    // Workflow-specific config (cluster size, strategy, etc.)

  // Results
  finalResult     Json?    @map("final_result")

  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  jobs            LlmJob[]

  @@map("llm_workflows")
  @@index([scopeType, scopeId])
}

model LlmJob {
  id              String   @id @default(cuid())

  workflowId      String?  @map("workflow_id")   // Null for standalone jobs
  workflow        LlmWorkflow? @relation(fields: [workflowId], references: [id], onDelete: Cascade)

  // What template to run
  templateId      String   @map("template_id")
  template        PromptTemplate @relation(fields: [templateId], references: [id])

  // What to run it against
  targetType      String   @map("target_type")    // "patent", "patent_group", "summary_group"
  targetIds       String[] @map("target_ids")     // Patent IDs or upstream job IDs
  targetData      Json?    @map("target_data")    // Pre-computed input data

  // Execution
  status          WorkflowStatus @default(PENDING)
  priority        Int      @default(0)
  retryCount      Int      @default(0) @map("retry_count")

  // Ordering within workflow
  roundNumber     Int?     @map("round_number")   // For tournament pattern
  clusterIndex    Int?     @map("cluster_index")   // For tournament pattern
  sortScore       Float?   @map("sort_score")      // Tournament-relevant score for this round

  // Results
  result          Json?
  tokensUsed      Int?     @map("tokens_used")
  errorMessage    String?  @map("error_message")

  startedAt       DateTime? @map("started_at")
  completedAt     DateTime? @map("completed_at")
  createdAt       DateTime @default(now()) @map("created_at")

  // Dependencies
  dependsOn       LlmJobDependency[] @relation("downstream")
  dependedBy      LlmJobDependency[] @relation("upstream")

  @@map("llm_jobs")
  @@index([workflowId])
  @@index([status])
}

model LlmJobDependency {
  id              String   @id @default(cuid())

  upstreamJobId   String   @map("upstream_job_id")
  upstreamJob     LlmJob   @relation("upstream", fields: [upstreamJobId], references: [id], onDelete: Cascade)

  downstreamJobId String   @map("downstream_job_id")
  downstreamJob   LlmJob   @relation("downstream", fields: [downstreamJobId], references: [id], onDelete: Cascade)

  // How to map upstream output → downstream input
  outputField     String?  @map("output_field")   // Which field from upstream result
  inputField      String?  @map("input_field")    // Which template parameter to fill

  @@unique([upstreamJobId, downstreamJobId])
  @@map("llm_job_dependencies")
}

enum WorkflowStatus {
  PENDING
  RUNNING
  COMPLETE
  ERROR
  CANCELLED
}
```

### 0B. Sector/SuperSector as DB Entities

**Problem**: Sectors live in `config/sector-breakout-v2.json` and `config/super-sectors.json`. This blocks sector-level LLM workflows, summaries, and the sector refactoring tools.

**Existing code to refactor**:
- 15+ `scripts/breakout-*.ts` scripts (sector-specific, should become general case)
- `scripts/analyze-sector-sizes.ts` and `analyze-large-sector-cpc.ts`
- `scripts/expand-sector.ts` and `expand-sectors-mlt.ts`
- `src/api/utils/sector-mapper.ts`

**Sector size targets**: <500 patents per sector, median range 100-200.

```prisma
model SuperSector {
  id              String   @id @default(cuid())

  name            String   @unique
  displayName     String   @map("display_name")

  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  sectors         Sector[]

  @@map("super_sectors")
}

model Sector {
  id              String   @id @default(cuid())

  name            String   @unique
  displayName     String   @map("display_name")
  superSectorId   String?  @map("super_sector_id")
  superSector     SuperSector? @relation(fields: [superSectorId], references: [id])

  // CPC mapping
  cpcPrefixes     String[] @map("cpc_prefixes")

  // Metadata
  damagesTier     String?  @map("damages_tier")  // high, medium, low, very_high
  patentCount     Int      @default(0) @map("patent_count")  // Cached count

  // Sector management
  targetMinSize   Int?     @map("target_min_size")   // For refactoring guidance
  targetMaxSize   Int?     @map("target_max_size")   // Default: 500

  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@map("sectors")
}
```

**Migration plan**:
1. Create models, run migration
2. Import from `config/sector-breakout-v2.json` and `config/super-sectors.json`
3. Update `sector-mapper.ts` to read from DB (fallback to config)
4. Refactor breakout scripts into generalized `sector-refactor-service.ts`

### 0C. Entity Analysis Results (Generalized)

**Problem**: Prompt template results for focus areas are stored as files in `cache/focus-area-prompts/`. Other entity types (sectors, super-sectors, competitors, affiliates) will need similar analysis storage. A generic pattern avoids duplicating this for each entity type.

```prisma
model EntityAnalysisResult {
  id              String   @id @default(cuid())

  // Polymorphic entity reference
  entityType      String   @map("entity_type")    // "focus_area", "sector", "super_sector",
                                                    // "competitor", "affiliate"
  entityId        String   @map("entity_id")

  // What produced this result
  templateId      String?  @map("template_id")    // PromptTemplate that generated it
  jobId           String?  @map("job_id")          // LlmJob that generated it

  // What object within the entity this result is for (if per-object)
  objectType      String?  @map("object_type")     // "patent", null for collective
  objectId        String?  @map("object_id")       // Patent ID, null for collective

  // Result data
  result          Json     // The LLM response
  resultType      String   @map("result_type")     // "structured", "free_form", "tournament_summary"
  fieldValues     Json?    @map("field_values")     // Extracted typed fields for queries

  // Metadata
  model           String?
  tokensUsed      Int?     @map("tokens_used")
  executedAt      DateTime @map("executed_at")
  createdAt       DateTime @default(now()) @map("created_at")

  @@map("entity_analysis_results")
  @@index([entityType, entityId])
  @@index([entityType, entityId, objectId])
  @@index([templateId])
}
```

This replaces/generalizes the file-based `cache/focus-area-prompts/` storage and enables:
- Query across all analysis results for a sector
- Find all patents scored for POS relevance across focus areas
- Compare analysis results across entity types

### 0D. Patent Family Exploration Model

**Problem**: Patent families should be explored on-demand from a seed patent, not bulk-imported. The user sets limiting parameters (depth, breadth, sectors, CPC codes) and the system selectively expands.

```prisma
model PatentFamilyExploration {
  id              String   @id @default(cuid())

  // Seed
  seedPatentId    String   @map("seed_patent_id")

  // Exploration parameters
  maxAncestorDepth   Int   @default(2) @map("max_ancestor_depth")
  maxDescendantDepth Int   @default(2) @map("max_descendant_depth")
  includeSiblings    Boolean @default(true) @map("include_siblings")
  includeCousins     Boolean @default(false) @map("include_cousins")

  // Limiting filters
  limitToSectors     String[] @map("limit_to_sectors")    // Only include patents in these sectors
  limitToCpcPrefixes String[] @map("limit_to_cpc_prefixes")
  limitToFocusAreas  String[] @map("limit_to_focus_areas")
  requireInPortfolio Boolean  @default(false) @map("require_in_portfolio")

  // Results
  status          WorkflowStatus @default(PENDING)
  discoveredCount Int      @default(0) @map("discovered_count")

  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  members         PatentFamilyMember[]

  @@map("patent_family_explorations")
}

model PatentFamilyMember {
  id              String   @id @default(cuid())

  explorationId   String   @map("exploration_id")
  exploration     PatentFamilyExploration @relation(fields: [explorationId], references: [id], onDelete: Cascade)

  patentId        String   @map("patent_id")
  relationToSeed  String   @map("relation_to_seed")  // "seed", "parent", "grandparent",
                                                       // "child", "sibling", "cousin"
  generationDepth Int      @map("generation_depth")   // 0=seed, 1=parent/child, 2=grandparent/grandchild
  inPortfolio     Boolean  @default(false) @map("in_portfolio")

  createdAt       DateTime @default(now()) @map("created_at")

  @@map("patent_family_members")
  @@unique([explorationId, patentId])
  @@index([explorationId])
  @@index([patentId])
}
```

---

## Tier 1: LLM Workflow Engine (HIGH)

Build the execution engine that resolves dependency trees and runs jobs in order.

### 1A. Workflow Execution Service

```typescript
interface WorkflowEngine {
  // Create and plan a workflow
  createWorkflow(config: WorkflowConfig): Promise<LlmWorkflow>;
  planJobs(workflowId: string): Promise<LlmJob[]>;  // Build the DAG

  // Execute
  executeWorkflow(workflowId: string): Promise<void>;  // Resolves DAG, runs in order
  executeJob(jobId: string): Promise<void>;             // Single job execution

  // Status
  getWorkflowStatus(workflowId: string): Promise<WorkflowStatus>;
  getReadyJobs(workflowId: string): Promise<LlmJob[]>; // Jobs with all deps satisfied
}
```

**Key behaviors**:
- `getReadyJobs()` returns jobs whose upstream dependencies are all COMPLETE
- Engine polls for ready jobs and executes them (rate-limited)
- Downstream jobs receive upstream results as input parameters
- Failed jobs can be retried without re-running completed siblings

### 1B. Tournament Pattern (built on workflow engine)

Tournament becomes a **workflow factory** that generates the DAG:

```typescript
interface TournamentConfig {
  scopeType: string;           // "focus_area", "sector"
  scopeId: string;
  templateId: string;          // Per-cluster template
  metaTemplateId: string;      // Cross-cluster synthesis template
  clusterStrategy: string;     // "score", "tech_category", "custom"

  // Dynamic sizing
  clusterSizeHint?: number;    // Suggestion; engine may adjust
  maxRounds?: number;          // Cap on tournament depth

  // Per-round scoring
  sortScoreFormula?: string;   // How to rank items within each round
}

function planTournament(config: TournamentConfig, patents: Patent[]): LlmWorkflow {
  // 1. Calculate optimal cluster size based on:
  //    - Number of patents
  //    - Template question count/complexity
  //    - Target model context constraints
  //    - Point of diminishing returns
  // 2. Form clusters using strategy
  // 3. Create Round 1 jobs (one per cluster)
  // 4. Create Round 2 jobs (clusters of cluster summaries)
  // 5. Wire dependencies: Round 2 jobs depend on Round 1 jobs
  // 6. Continue until single synthesis job remains
  // Return: LlmWorkflow with full DAG
}
```

**Cluster size calculation**: Not a fixed default. Computed from:
- Patent count in scope
- Number of template questions × estimated tokens per answer
- Target model context window
- Diminishing returns threshold (contextual guidance provided to user)

**Per-round sort score**: Standardized field name `sortScore` on each job. The calculation can change per round — Round 1 might use portfolio score, Round 2 might use the LLM's relevance rating from Round 1 output.

### 1C. Workflow Status UI

- Job dashboard showing running/pending/complete workflows
- Per-workflow: DAG visualization or at minimum a round-by-round progress view
- Link to results from completed workflows

---

## Tier 2: Patent Family Exploration (HIGH)

### 2A. On-Demand Exploration Service

```typescript
interface FamilyExplorer {
  // Create exploration from seed patent
  explore(seedPatentId: string, params: ExplorationParams): Promise<PatentFamilyExploration>;

  // Expand incrementally
  expandMember(memberId: string, direction: 'ancestors' | 'descendants'): Promise<PatentFamilyMember[]>;

  // Suggest focus area additions
  suggestForFocusArea(explorationId: string, focusAreaId: string): Promise<SuggestionResult>;
}
```

**Exploration flow**:
1. User selects a high-ranked patent
2. Sets parameters: depth, breadth, limiting sectors/CPC codes
3. System fetches citation data (from cache or PatentsView API)
4. Builds family tree, marking in-portfolio members
5. User can expand specific branches further
6. System suggests relevant patents for focus area addition

### 2B. Family Visualization

- Tree/graph view on patent detail page
- In-portfolio patents highlighted
- Click to expand branches
- "Add to focus area" action on discovered patents

---

## Tier 3: Sector Management (MEDIUM-HIGH)

### 3A. Generalized Sector Refactoring Service

Refactor the 15+ individual `breakout-*.ts` scripts into a single parameterized service:

```typescript
interface SectorRefactorService {
  // Analysis
  analyzeSectorSizes(): Promise<SectorSizeReport>;
  analyzeCpcDistribution(sectorId: string): Promise<CpcDistribution>;

  // Refactoring
  proposeSplit(sectorId: string, params: SplitParams): Promise<SplitProposal>;
  executeSplit(proposalId: string): Promise<Sector[]>;
  mergeSectors(sectorIds: string[], newName: string): Promise<Sector>;

  // Expansion
  findExpansionCandidates(sectorId: string, params: ExpansionParams): Promise<PatentCandidate[]>;
}

interface SplitParams {
  strategy: 'cpc_prefix' | 'llm_clustering' | 'manual';
  targetMaxSize: number;          // Default: 500
  targetMedianSize: number;       // Default: 150
  minSubsectorSize: number;       // Don't create subsectors smaller than this
  cpcDepth?: number;              // For CPC strategy: how many chars of prefix
}
```

### 3B. Sector Detail Page

- Sector summary (from tournament or direct analysis)
- Patent count, score distribution
- CPC distribution visualization
- "Refactor" tools: propose split, analyze size
- Link to focus areas within this sector

---

## Tier 4: Deferred

| Feature | Reason to Defer | Prerequisites |
|---------|-----------------|---------------|
| Focus Area Chat | Manual analysis working well; tournament + families needed first | Workflow engine, entity analysis |
| LLM auto-naming | Nice-to-have | None |
| CPC tooltips | Cosmetic | None |
| Search scope fixes (P-1) | Lower urgency | None |
| Word count grid (P-1c) | Lower urgency | None |

---

## Implementation Roadmap

### Phase 1: Schema Migrations
1. Add `LlmWorkflow`, `LlmJob`, `LlmJobDependency` models
2. Add `Sector`, `SuperSector` models
3. Add `EntityAnalysisResult` model
4. Add `PatentFamilyExploration`, `PatentFamilyMember` models
5. Add relation from `PromptTemplate` → `LlmJob`
6. Run migration, seed sectors from config

### Phase 2: Workflow Engine Core
1. Workflow creation + DAG planning
2. Job execution with dependency resolution
3. Status tracking + error handling
4. Wire existing prompt template execution through workflow engine

### Phase 3: Tournament Pattern
1. Tournament workflow factory (plan DAG from config)
2. Cluster size calculation logic
3. Cluster formation strategies
4. Test: run on a mid-size sector (~200 patents)

### Phase 4: Patent Family Exploration
1. On-demand exploration from seed patent
2. Citation data fetching (cache-first)
3. Family tree construction with filters
4. UI: exploration panel on patent detail
5. Integration: suggest patents for focus area

### Phase 5: Sector Refactoring
1. Generalized refactor service (replace 15+ scripts)
2. Sector analysis endpoints
3. Split/merge operations
4. Sector detail page

### Phase 6: Integration
1. Entity analysis results in focus area UI
2. Tournament results visualization
3. Sector → Focus Area creation workflow
4. Family → Focus Area expansion workflow

---

## Parallel Work (Ongoing)

| Work | Status | Notes |
|------|--------|-------|
| LLM Enrichment | ~68% (batch in progress) | Continue until complete |
| Patent family cache | 7,000 patents | Available for exploration |

---

## Design Documents Index

| Document | Covers |
|----------|--------|
| `DEVELOPMENT_QUEUE_V2.md` | This document — current priorities |
| `DEVELOPMENT_QUEUE.md` | Original queue (P-0 through P-3, mostly complete) |
| `PROMPT_TEMPLATE_SYSTEM_DESIGN.md` | Template types, structured questions, execution |
| `FOCUS_AREA_SYSTEM_DESIGN.md` | Focus areas, search scope, word count grid |
| `PATENT_FAMILIES_DESIGN.md` | Patent families, citation counting |
| `FACET_SYSTEM_DESIGN.md` | Facet types, scoring as facets |
| `design-focus-area-chat.md` | Focus area chat feature (deferred) |
| `SCORING_METHODOLOGY_V3_DESIGN.md` | V3 scoring formula, weight profiles |
| `SECTOR_BREAKOUT_PROPOSALS_V2.md` | Sector split analysis and proposals |

---

*This document supersedes DEVELOPMENT_QUEUE.md for current prioritization.*
