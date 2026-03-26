# IP-Port Data Architecture Context

**Purpose:** Reference document for Claude Desktop project to design new data service layer architecture.

---

## 1. Data Storage Overview

The system uses a hybrid data storage approach with four primary storage mechanisms:

| Storage Type | Technology | Purpose | Data Characteristics |
|-------------|-----------|---------|---------------------|
| **Database** | PostgreSQL + Prisma ORM | Core entity relationships, scores, metadata | Structured, queryable, transactional |
| **JSON Cache** | File system (`cache/`) | API responses, LLM results, enrichment data | Per-patent JSON files, ~40K+ files |
| **XML Bulk Data** | USPTO bulk downloads | Full patent text, claims, prosecution history | Weekly ZIP archives, 2005-present |
| **Elasticsearch** | ES 7.x/8.x | Full-text search, term extraction, MLT queries | Indexed patent abstracts/titles |

### 1.1 Storage Location Summary

```
ip-port/
├── prisma/schema.prisma          # Database schema (PostgreSQL)
├── cache/                        # JSON cache (gitignored)
│   ├── api/                      # External API responses
│   │   ├── patentsview/patent/   # PatentsView API (~41K files)
│   │   ├── patentsview/forward-citations/
│   │   ├── file-wrapper/         # USPTO File Wrapper API
│   │   └── ptab/                 # PTAB/IPR data
│   ├── llm-scores/               # LLM analysis results (~34K files)
│   ├── citation-classification/  # Classified citations (~29K files)
│   ├── prosecution-scores/       # Prosecution quality scores (~42K files)
│   ├── ipr-scores/               # IPR risk scores (~41K files)
│   ├── prosecution-analysis/     # Detailed prosecution analysis
│   ├── prosecution-documents/    # Prosecution document cache
│   ├── patent-families/          # Family exploration data
│   ├── focus-area-prompts/       # Focus area LLM results
│   ├── batch-jobs/               # Batch job metadata
│   └── score-history/            # Score snapshots for comparison
├── config/                       # JSON configuration files
│   ├── competitors.json          # Competitor company definitions
│   ├── sector-taxonomy-cpc-only.json  # CPC→Sector mappings
│   ├── scoring-templates/        # LLM question templates
│   └── *.json                    # Various config files
└── /Volumes/GLSSD2/data/uspto/   # External bulk XML (env: USPTO_PATENT_GRANT_XML_DIR)
    ├── export/                   # Extracted individual XMLs
    └── bulkdata/{year}/          # Weekly ZIP archives
```

---

## 2. Database Schema (Prisma)

### 2.1 Core Entity Model

```
Companies ──┬── Affiliates (with patterns)
            ├── Portfolios ──── PortfolioPatent ──── Patent
            └── CompetitorRelationships

Patent ──┬── PatentCpc (CPC codes)
         ├── PatentCitationAnalysis (classified citations)
         ├── PatentProsecution (basic prosecution data)
         ├── ProsecutionTimeline (detailed claim analysis)
         ├── PatentScore (EAV pattern for LLM scores)
         ├── PatentCompositeScore (computed scores)
         └── PatentSubSectorScore (sector-specific LLM scores)

Sector ──── SuperSector
       └── SectorRule (CPC/keyword matching rules)
       └── SubSector (fine-grained groupings)

FocusArea ──── FocusAreaPatent
          └── SearchTerm
          └── FacetDefinition ──── FacetValue
          └── PromptTemplate

ScoreSnapshot ──── PatentScoreEntry (V2/V3 active scores)
```

### 2.2 Key Schema Patterns

**EAV Pattern (Entity-Attribute-Value):**
```prisma
model PatentScore {
  patentId    String
  fieldName   String   // e.g., "eligibility_score", "llm_summary"
  rating      Int?     // 1-5 numeric scores
  floatValue  Float?   // Computed sub-scores
  textValue   String?  // Categorical values
  reasoning   String?  // LLM reasoning text
  source      String   // "llm", "calculated", etc.
  templateId  String?  // Which template generated this
}
```

**Denormalized Display Fields on Patent:**
```prisma
model Patent {
  // Core fields
  patentId, title, abstract, grantDate, assignee

  // Denormalized for fast display (refreshed by enrichment)
  affiliate         String?   // Matched affiliate name
  superSector       String?   // Assigned super-sector
  primarySector     String?   // Assigned primary sector
  primaryCpc        String?   // Primary CPC code
  primarySubSectorId String?  // Sub-sector assignment

  // Enrichment flags
  hasLlmData, hasCitationData, hasProsecutionData, hasXmlData, hasIprData
}
```

**Score Snapshot Pattern:**
```prisma
model ScoreSnapshot {
  scoreType    ScoreType   // V2, V3, LLM
  portfolioId  String?     // Null = global
  isActive     Boolean     // Only one active per (portfolio, type)
  config       Json        // Full scoring config for reproducibility
}

model PatentScoreEntry {
  snapshotId  String
  patentId    String
  score       Float
  rank        Int
  rawMetrics  Json?       // Original metric values
}
```

---

## 3. Data Sources and Flow

### 3.1 USPTO API Data

**PatentsView API** (`cache/api/patentsview/patent/{patentId}.json`):
- Basic patent metadata: title, abstract, grant_date, assignee
- CPC codes, inventors, application info
- Used as primary source for patent details

**File Wrapper API** (`cache/api/file-wrapper/{patentId}.json`):
- Prosecution history documents
- Office actions, responses, amendments
- Used for prosecution quality scoring

**PTAB API** (`cache/api/ptab/{patentId}.json`):
- IPR/PGR proceedings
- Institution decisions, final written decisions
- Used for IPR risk scoring

### 3.2 USPTO Bulk XML Data

**Location:** External drive configured via `USPTO_PATENT_GRANT_XML_DIR`

**Structure:**
- Weekly ZIP archives: `bulkdata/{year}/ipgYYMMDD.zip`
- Individual XMLs extracted to: `export/US{patentId}.xml`

**Extraction Logic** (`patent-xml-extractor-service.ts`):
1. Patent ID + grant date → find publication Tuesday
2. Locate weekly ZIP → extract large combined XML
3. Split on `<?xml` declarations → find matching patent
4. Save individual XML to export directory

**XML Parser** (`patent-xml-parser-service.ts`):
- Extracts claims, description, drawings metadata
- Full patent text for detailed analysis
- Used for deep claim analysis, not routine queries

### 3.3 LLM-Generated Data

**Primary Storage:** `cache/llm-scores/{patentId}.json`

**Generated Fields:**
```typescript
{
  summary: string,              // Attorney-style summary
  prior_art_problem: string,    // Problem solved
  technical_solution: string,   // How it solves it

  // Numeric scores (1-5 scale)
  eligibility_score: number,
  validity_score: number,
  claim_breadth: number,
  enforcement_clarity: number,
  design_around_difficulty: number,
  market_relevance_score: number,

  // Classifications
  technology_category: string,
  implementation_type: string,
  standards_relevance: string,
  market_segment: string,

  // Each score has reasoning
  eligibility_score_reasoning: string,
  // ...etc
}
```

**DB Storage:** Imported to `PatentScore` (EAV) and `PatentSubSectorScore` tables

### 3.4 Derived/Computed Data

**Citation Classification** (`cache/citation-classification/{patentId}.json`):
```typescript
{
  competitor_citations: number,
  affiliate_citations: number,
  neutral_citations: number,
  competitor_names: string[],
  adjusted_forward_citations: number,  // Weighted sum
  competitor_density: number           // competitor/(competitor+neutral)
}
```

**Prosecution Scores** (`cache/prosecution-scores/{patentId}.json`):
- Office action counts, rejection types
- Prosecution quality score (1-5)

**IPR Scores** (`cache/ipr-scores/{patentId}.json`):
- IPR filing risk assessment
- Challenge history analysis

---

## 4. Query Patterns by Page

### 4.1 Patent Summary (PortfolioPage.vue)

**Data Flow:**
```
GET /api/patents?portfolioId=X&page=1&limit=100&sortBy=score&filters=...
  │
  ├── Query Patent table with Prisma (joins: PatentCpc, PatentCitationAnalysis)
  ├── Load active V2/V3 snapshot scores → overlay onto results
  ├── Load LLM scores from PatentScore EAV table
  ├── Apply filters (search, sectors, score ranges, etc.)
  └── Return paginated PatentDTO[]
```

**Key Service:** `patent-data-service.ts`

**Filter Implementation:**
```typescript
// Dynamic WHERE clause building
const where: Prisma.PatentWhereInput = {};
if (filters.search) {
  where.OR = [
    { title: { contains: filters.search, mode: 'insensitive' } },
    { patentId: { contains: filters.search } },
    { assignee: { contains: filters.search, mode: 'insensitive' } },
  ];
}
if (filters.primarySectors?.length) {
  where.primarySector = { in: filters.primarySectors };
}
// ... ~20 filter conditions
```

### 4.2 V2 Scoring Page

**Data Flow:**
```
GET /api/scores/v2-enhanced?portfolioId=X&presetId=Y&topN=500
  │
  ├── Load patent metrics from DB (citations, years, etc.)
  ├── Load LLM scores from file cache OR PatentSubSectorScore
  ├── Apply scoring formula with preset weights
  ├── Normalize and rank
  └── Return V2EnhancedScoredPatent[]
```

**Scoring Formula:**
```
score = Σ(normalized_metric × weight) × year_multiplier × 100

Normalization:
- competitor_citations: min(1, cc / 20)
- adjusted_forward_citations: min(1, sqrt(adj_fc) / 30)
- years_remaining: min(1, years / 15)
- LLM scores (1-5): (score - 1) / 4
```

### 4.3 Aggregate View

**Data Flow:**
```
GET /api/patents/aggregate?groupBy=superSector&portfolioId=X
  │
  ├── Query with Prisma groupBy
  ├── Aggregate counts, score averages
  ├── Join with Sector table for display names
  └── Return aggregated summaries
```

**Current Implementation:** Raw Prisma queries with manual joins

---

## 5. Hard-Coded Paths in Code

### 5.1 Cache Directory Constants

```typescript
// prosecution-document-service.ts
const DOCUMENT_CACHE_DIR = path.join(process.cwd(), 'cache/prosecution-documents');
const PROSECUTION_SCORES_DIR = path.join(process.cwd(), 'cache/prosecution-scores');

// patent-fetch-service.ts
const PATENTSVIEW_CACHE_DIR = path.join(process.cwd(), 'cache/api/patentsview/patent');

// scoring-service.ts
const CLASSIFICATION_CACHE_DIR = path.join(process.cwd(), 'cache/citation-classification');
const LLM_SCORES_DIR = path.join(process.cwd(), 'cache/llm-scores');

// prompt-template-service.ts
const CACHE_BASE_DIR = path.join(process.cwd(), 'cache/focus-area-prompts');

// scoring-template-service.ts
const CONFIG_DIR = path.resolve(__dirname, '../../../config/scoring-templates');
```

### 5.2 Config File Paths

```typescript
// sector-mapper.ts
path.join(process.cwd(), 'config/sector-breakout-v2.json')
path.join(process.cwd(), 'config/super-sectors.json')

// affiliate-normalizer.ts
path.join(process.cwd(), 'config/portfolio-affiliates.json')

// portfolio-enrichment-service.ts
path.join(process.cwd(), 'config/sector-damages.json')
path.join(process.cwd(), 'config/competitors.json')
```

### 5.3 Environment Variables

```
DATABASE_URL=postgresql://...
USPTO_PATENT_GRANT_XML_DIR=/Volumes/GLSSD2/data/uspto/export
ELASTICSEARCH_URL=http://localhost:9200
ANTHROPIC_API_KEY=...
```

---

## 6. Coding Patterns and Conventions

### 6.1 Service Layer Pattern

```typescript
// Each service owns a domain
patent-data-service.ts      // Core patent queries
scoring-service.ts          // V2/V3 scoring calculations
llm-scoring-service.ts      // LLM prompt execution
patent-family-service.ts    // Family exploration
```

### 6.2 DTO/Interface Pattern

```typescript
// Frontend types in frontend/src/types/index.ts
// Backend DTOs in service files
// Manual mapping between Prisma models and DTOs
```

### 6.3 Cache Pattern

```typescript
// File-based with in-memory maps
const scoreCache = new Map<string, CachedScore>();
const CACHE_TTL = 60 * 1000; // 1 minute

async function getWithCache(key: string): Promise<Data> {
  const cached = scoreCache.get(key);
  if (cached && Date.now() < cached.expiry) return cached.data;
  const data = await loadFromFileOrDB(key);
  scoreCache.set(key, { data, expiry: Date.now() + CACHE_TTL });
  return data;
}
```

### 6.4 Areas for Improvement

1. **No unified data service layer** - queries spread across routes and services
2. **Inconsistent cache invalidation** - manual cache clearing scattered
3. **Hard-coded paths** - ~50+ path constants across services
4. **EAV performance** - PatentScore queries require pivot operations
5. **No materialized views** - complex joins computed on every request
6. **Dual storage** - LLM scores in both files AND database
7. **No query builders** - raw Prisma queries duplicated
8. **Missing indexes** - some common filter patterns not indexed

---

## 7. Elasticsearch Usage

**Current State:** Optional, not fully integrated

**Index:** `patents` with fields:
- patent_id, title, abstract (with patent_analyzer)
- assignee, cpc_codes, cpc_classes
- primary_sector, super_sector
- forward_citations, competitor_citations

**Use Cases:**
- Full-text search across abstracts/titles
- More-like-this (MLT) similarity queries
- Term extraction for keyword analysis
- Sector-based aggregations

**Integration Points:**
- `services/elasticsearch-service.ts` - Core ES client
- `services/import-to-elasticsearch.ts` - Bulk import
- `scripts/expand-sectors-mlt.ts` - MLT-based sector expansion

---

## 8. Scoring and Snapshot System

### 8.1 V2 Enhanced Scoring

**Presets:** Stored in `config/user-weight-profiles.json`
```json
{
  "executive": { "citation": 0.4, "years": 0.3, "competitor": 0.3 },
  "litigation": { "citation": 0.5, "years": 0.2, "competitor": 0.3 }
}
```

**Metrics Used:**
- Quantitative: competitor_citations, adjusted_forward_citations, years_remaining
- LLM: eligibility_score, validity_score, claim_breadth, etc.
- API-derived: ipr_risk_score, prosecution_quality_score

### 8.2 Snapshot Persistence

**Flow:**
1. User configures scoring in UI
2. Click "Save Snapshot" → creates ScoreSnapshot + PatentScoreEntry rows
3. Mark as active → used for filtering in Portfolio/Aggregate views
4. Old snapshots retained for comparison

### 8.3 Score Field Mapping (EAV → DTO)

```typescript
const SCORE_FIELD_MAP = {
  eligibility_score: { dtoKey: 'eligibility_score', valueType: 'rating' },
  validity_score: { dtoKey: 'validity_score', valueType: 'rating' },
  summary: { dtoKey: 'llm_summary', valueType: 'reasoning' },
  // ... 20+ mappings
};
```

---

## 9. Config and Preset Data

### 9.1 Sector Taxonomy

**File:** `config/sector-taxonomy-cpc-only.json`
```json
{
  "WIRELESS": {
    "displayName": "Wireless & RF",
    "sectors": {
      "wireless-transmission": { "cpcPrefixes": ["H04L1", "H04L5"] },
      "rf-acoustic": { "cpcPrefixes": ["H03H9", "H10N30"] }
    }
  }
}
```

**DB Migration:** Now also stored in Sector/SuperSector/SectorRule tables

### 9.2 Competitor Definitions

**File:** `config/competitors.json`
```json
{
  "competitors": [
    { "name": "Qualcomm", "aliases": ["QUALCOMM INCORPORATED", "Qualcomm Technologies"] },
    { "name": "Intel", "aliases": ["Intel Corporation", "INTEL CORP"] }
  ]
}
```

### 9.3 Scoring Templates

**Location:** `config/scoring-templates/`
```
scoring-templates/
├── sectors/
│   └── {sector-name}.json
├── sub-sectors/
│   └── {super-sector}.json
└── base-template.json
```

**Template Structure:**
```json
{
  "questions": [
    {
      "fieldName": "technical_novelty",
      "displayName": "Technical Novelty",
      "question": "Rate the technical novelty of this patent...",
      "answerType": "numeric",
      "scale": { "min": 1, "max": 5 },
      "weight": 0.2
    }
  ]
}
```

---

## 10. Data Service Refactor Considerations

### 10.1 Proposed Unified Data Service Layer

```typescript
interface DataService {
  // Core queries
  getPatents(options: QueryOptions): Promise<PatentDTO[]>;
  getPatentById(id: string, include?: string[]): Promise<PatentDTO>;

  // Aggregations
  aggregateBy(groupField: string, metrics: string[]): Promise<AggregateResult[]>;

  // Scoring
  scorePatents(config: ScoringConfig): Promise<ScoredPatent[]>;

  // Enrichment data (abstracts file vs DB)
  getLlmScores(patentIds: string[]): Promise<Map<string, LlmScores>>;
  getCitations(patentIds: string[]): Promise<Map<string, Citations>>;
}
```

### 10.2 Materialized View Candidates

```sql
-- Flattened patent view with scores
CREATE MATERIALIZED VIEW patent_summary AS
SELECT
  p.patent_id, p.title, p.assignee, p.grant_date,
  p.primary_sector, p.super_sector,
  pca.competitor_citations, pca.affiliate_citations,
  -- Pivot LLM scores
  MAX(CASE WHEN ps.field_name = 'eligibility_score' THEN ps.rating END) AS eligibility_score,
  -- ...
FROM patents p
LEFT JOIN patent_citation_analyses pca ON p.patent_id = pca.patent_id
LEFT JOIN patent_scores ps ON p.patent_id = ps.patent_id
GROUP BY p.patent_id;
```

### 10.3 Metadata Schema Overlay

```typescript
interface FieldMetadata {
  fieldName: string;
  displayName: string;
  dataType: 'number' | 'text' | 'date' | 'enum';
  source: 'db' | 'cache' | 'computed';
  cachePath?: string;
  dbColumn?: string;
  format?: (value: any) => string;
  filter?: FilterConfig;
  sortable: boolean;
}

// Registry of all queryable fields
const FIELD_REGISTRY: Record<string, FieldMetadata> = {
  patent_id: { source: 'db', dbColumn: 'patent_id', ... },
  llm_summary: { source: 'cache', cachePath: 'cache/llm-scores', ... },
  // ...
};
```

---

## Summary

The current architecture evolved organically with:
- **Strengths:** Flexible cache system, comprehensive scoring, good sector taxonomy
- **Weaknesses:** Scattered queries, hard-coded paths, no unified data layer

**Key Refactor Goals:**
1. Centralize all data access through unified service layer
2. Create metadata-driven field registry for UI/query generation
3. Add materialized views for common query patterns
4. Consolidate cache paths into configuration
5. Migrate EAV scores to columnar storage where appropriate
6. Add proper indexing strategy based on query patterns

This document provides context for designing the new data service architecture in the Claude Desktop project.
