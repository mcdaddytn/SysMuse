# Schema Design Notes

This document captures design considerations for upcoming schema changes. The goal is to accumulate changes and be deliberate about migrations.

---

## 1. Job Queue & Batch Job Persistence

### Current State
- Jobs stored in `logs/batch-jobs.json` (file-based)
- Simple structure: id, groupId, targetType, targetValue, coverageType, status, progress, rates

### Design Considerations

#### Job Dependencies
Current LLM templates have dependencies:
- **Restaurant POS**: Simple chain dependency
- **Tournament templates** (bracket generation, matchup evaluation, advancement): Three-phase dependency chain

Future needs:
- Batch jobs that spawn dependent jobs (e.g., "run tournaments on 10 sectors")
- Mixed batch + dependency patterns
- Parallel execution within a dependency group

#### Proposed Schema

```prisma
model BatchJob {
  id              String   @id @default(cuid())

  // Grouping
  groupId         String?  @map("group_id")
  parentJobId     String?  @map("parent_job_id")
  parentJob       BatchJob? @relation("JobDependency", fields: [parentJobId], references: [id])
  childJobs       BatchJob[] @relation("JobDependency")

  // Target
  targetType      JobTargetType  // tier, super-sector, sector, patent-list, custom
  targetValue     String         // Range "1001-2000", sector name, or JSON for complex targets
  targetMetadata  Json?          // Additional context (tier size, filters, etc.)

  // Job Type
  jobType         JobType        // enrichment, tournament, export, custom
  coverageType    CoverageType?  // llm, prosecution, ipr, family (for enrichment jobs)
  templateId      String?        // For LLM jobs - links to prompt template

  // Status & Progress
  status          JobStatus      @default(PENDING)
  progress        Json?          // { total, completed, errors }

  // Timing & Rates
  estimatedRate   Int?
  actualRate      Int?
  startedAt       DateTime?
  completedAt     DateTime?
  estimatedCompletion DateTime?

  // Execution
  pid             Int?
  logFile         String?
  error           String?

  // Audit
  createdBy       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@map("batch_jobs")
  @@index([groupId])
  @@index([parentJobId])
  @@index([status])
  @@index([jobType])
}

enum JobTargetType {
  TIER
  SUPER_SECTOR
  SECTOR
  PATENT_LIST
  CUSTOM
}

enum JobType {
  ENRICHMENT
  TOURNAMENT
  SCORING
  EXPORT
  IMPORT
  CUSTOM
}

enum JobStatus {
  PENDING
  QUEUED
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
  BLOCKED  // Waiting on dependency
}
```

#### Dependency Resolution
- Jobs with `parentJobId` are BLOCKED until parent completes
- Batch spawning: A job can create child jobs on completion
- Scheduler checks for unblocked jobs periodically

---

## 2. Sector Management & Expression Types

### Current State
- Sectors defined in JSON config files
- CPC prefix matching and regex-based term search
- No GUI for management

### Expression Type Design

Current implicit types:
- CPC prefix (e.g., "H04N19/")
- Regex patterns for terms

#### Proposed Expression Types

```prisma
enum SectorRuleType {
  CPC_PREFIX       // expression = "H04N19/" → matches H04N19/00, H04N19/70, etc.
  CPC_EXACT        // expression = "H04N19/00" → exact match only
  CPC_RANGE        // expression = "H04N19/00-H04N19/90" → range match

  KEYWORD          // Case-insensitive word boundary match
  PHRASE           // Exact phrase match
  KEYWORD_ALL      // All keywords must appear (AND)
  KEYWORD_ANY      // Any keyword matches (OR)

  FIELD_CONTAINS   // expression = "title:video codec" → field-specific
  FIELD_EQUALS     // Exact field value match

  REGEX            // Last resort - full regex (flagged for review)

  COMPOSITE        // expression = JSON with nested rules and boolean logic
}

model SectorRule {
  id            String   @id @default(cuid())
  sectorId      String
  sector        Sector   @relation(...)

  ruleType      SectorRuleType
  expression    String
  field         String?  @default("all")  // title, abstract, claims, all

  priority      Int      @default(0)
  isExclusion   Boolean  @default(false)
  isActive      Boolean  @default(true)

  // Validation
  lastValidated DateTime?
  matchCount    Int      @default(0)
  falsePositiveCount Int @default(0)

  // Audit
  notes         String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

#### Migration Path
1. Scan existing config files for all CPC patterns and search terms
2. Categorize each into appropriate SectorRuleType
3. Flag any complex regex for manual review
4. Import to database with LIBRARY scope

### Focus Area Expression Types

Focus areas may need additional expression capabilities:
- Product/technology keyword lists
- Assignee filters
- Date range filters
- Claim-specific matching
- Citation network rules

Consider a `FocusAreaRule` model similar to `SectorRule` but with extended fields.

---

## 3. Tournament & Scoring Enhancements

### Weight Adjustment UI
Tournament brackets allow users to reorder/correct rankings. Consider:
- Slider-based weight adjustment (like v2/v3 scoring page)
- Per-question weight overrides
- User voting on matchups with weighted influence

### Schema Additions

```prisma
model TournamentWeightOverride {
  id              String   @id @default(cuid())
  tournamentId    String
  tournament      SectorTournament @relation(...)

  questionKey     String   // Which question/facet
  originalWeight  Float
  adjustedWeight  Float
  adjustedBy      String?
  adjustedAt      DateTime
  reason          String?
}
```

---

## 4. Facet Engine & Formula System

### Current State
- Base scoring: Fixed formula in code
- V2/V3 scoring: Configurable weights via JSON/UI
- Scores stored in cache files and database columns

### Design Goals
- All scoring calculations should be formula-driven
- Formulas should be editable via UI
- Support for base, v2, v3, and custom scoring modes
- Metadata describing each calculation

### Proposed Schema

```prisma
model ScoringFormula {
  id          String   @id @default(cuid())
  name        String   @unique  // "base_score", "v2_score", "v3_score", "sector_video_score"
  displayName String
  description String?

  // Formula definition
  formula     String   // Expression syntax: "citations_weight * citations + recency_weight * recency_factor"
  variables   Json     // { "citations_weight": 0.3, "recency_weight": 0.2, ... }
  inputFields Json     // ["forward_citations", "backward_citations", "filing_date", ...]

  // Output
  outputField String   // Column or cache key where result is stored
  outputType  ScoreOutputType  // COLUMN, CACHE, COMPUTED

  // Metadata
  version     Int      @default(1)
  isActive    Boolean  @default(true)
  isEditable  Boolean  @default(true)

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

enum ScoreOutputType {
  COLUMN     // Stored in Patent table (score, v2_score, v3_score)
  CACHE      // Stored in cache/scores/
  COMPUTED   // Calculated on-demand, not persisted
}

model ScoringFormulaHistory {
  id          String   @id @default(cuid())
  formulaId   String
  formula     ScoringFormula @relation(...)

  previousFormula   String
  previousVariables Json
  changedBy   String?
  changedAt   DateTime @default(now())
  reason      String?
}
```

---

## 5. Data Storage Architecture

### Current State
- PostgreSQL: Patents, sectors, super-sectors, scoring configs
- File cache: LLM scores, prosecution, IPR, families, candidates JSON
- No search engine integration

### Target Architecture

| Data Type | Primary Storage | Secondary/Cache | Search |
|-----------|----------------|-----------------|--------|
| Patent metadata | PostgreSQL | - | Elasticsearch |
| Patent full text | Elasticsearch | PostgreSQL (summary) | Elasticsearch |
| Enrichment results | PostgreSQL | Redis (hot) | - |
| LLM responses | PostgreSQL | File cache (backup) | - |
| Candidates list | PostgreSQL | Redis | - |
| Scoring results | PostgreSQL | Redis (hot cache) | - |

### Metadata Schema

```prisma
model DataSourceMetadata {
  id          String   @id @default(cuid())
  entityType  String   // "patent", "enrichment", "score", etc.
  fieldName   String

  // Storage locations
  primaryStorage    StorageType  // POSTGRES, ELASTICSEARCH, REDIS, FILE
  primaryLocation   String       // Table name, index name, cache path

  secondaryStorage  StorageType?
  secondaryLocation String?

  // Sync
  syncStrategy      SyncStrategy  // WRITE_THROUGH, WRITE_BACK, READ_THROUGH
  ttlSeconds        Int?

  // Schema info
  dataType          String        // string, number, json, text
  isIndexed         Boolean       @default(false)
  isSearchable      Boolean       @default(false)

  description       String?

  @@unique([entityType, fieldName])
}

enum StorageType {
  POSTGRES
  ELASTICSEARCH
  REDIS
  FILE_JSON
  FILE_JSONL
}

enum SyncStrategy {
  WRITE_THROUGH  // Write to all stores synchronously
  WRITE_BACK     // Write to primary, async to secondary
  READ_THROUGH   // Read from cache, fallback to primary
  MANUAL         // No automatic sync
}
```

---

## 6. Migration Strategy

### Phase 1: Job Queue to Database
1. Create BatchJob model
2. Migrate existing file-based jobs
3. Update API to use database
4. Add dependency support

### Phase 2: Sector Management
1. Create SectorRule model with expression types
2. Seed from config files
3. Build management UI
4. Validate migration accuracy

### Phase 3: Scoring Formulas
1. Create ScoringFormula model
2. Extract current formulas to database
3. Build formula editor UI
4. Add versioning

### Phase 4: Data Architecture
1. Add DataSourceMetadata
2. Plan Elasticsearch integration
3. Plan Redis caching layer
4. Incremental migration of cache files to database

---

## Open Questions

1. **Job Dependencies**: Should we support arbitrary DAG dependencies or just parent-child?
2. **Expression Validation**: How do we validate regex patterns before saving?
3. **Formula Syntax**: What expression language for scoring formulas? (Math.js? Custom DSL?)
4. **Cache Migration**: Migrate all cache files to DB, or hybrid approach?
5. **Elasticsearch**: Self-hosted or managed service?

---

## Next Steps

- [ ] Review with stakeholder
- [ ] Finalize BatchJob schema
- [ ] Implement job queue migration (Phase 1)
- [ ] Update export/import scripts for new schema
- [ ] Plan sector rule migration
