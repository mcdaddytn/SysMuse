# IP-Port System Overview

**Purpose:** Summary of the Patent Portfolio Workstation system for Claude Desktop refactor planning.

---

## 1. System Purpose

IP-Port is a **patent portfolio analysis and monetization workstation** designed to:

1. **Aggregate** patents from multiple sources (PatentsView API, USPTO bulk XML, PTAB)
2. **Classify** patents into technology sectors using CPC codes and keyword rules
3. **Enrich** patents with LLM-generated analysis (validity, claim breadth, market relevance)
4. **Score** patents using configurable multi-factor formulas
5. **Identify** high-value patents for licensing/litigation campaigns
6. **Export** ranked patent packages for third-party vendor analysis

---

## 2. Current System Statistics

| Metric | Count |
|--------|-------|
| **Total Patents** | 84,321 |
| **Patents with LLM Data** | 52,877 (63%) |
| **LLM Score Cache Files** | 34,155 |
| **Portfolios** | 24 |
| **Super-Sectors** | 12 |
| **Sectors** | 64 |
| **Sub-Sectors** | ~250+ (dynamically generated) |

### Portfolio Distribution

| Portfolio | Patents | Notes |
|-----------|---------|-------|
| broadcom-core | 29,474 | Primary portfolio under analysis |
| apple | 5,000 | Competitor |
| nvidia | 5,000 | Competitor |
| cisco | 5,000 | Competitor |
| intel | 5,000 | Competitor |
| ericsson | 5,000 | Competitor |
| mediatek | 4,000 | Competitor |
| marvell | 5,000 | Competitor |
| texas-instruments | 5,000 | Competitor |
| + 15 others | ~17K | Various competitors/affiliates |

### Super-Sector Distribution

| Super-Sector | Patents | % |
|--------------|---------|---|
| COMPUTING | 21,188 | 25.1% |
| WIRELESS | 15,489 | 18.4% |
| SEMICONDUCTOR | 13,654 | 16.2% |
| NETWORKING | 13,590 | 16.1% |
| SECURITY | 8,031 | 9.5% |
| VIDEO_STREAMING | 6,751 | 8.0% |
| IMAGING | 4,697 | 5.6% |
| UNCLASSIFIED | 559 | 0.7% |
| AI_ML | 362 | 0.4% |

---

## 3. Data Flow: Sources to Analysis

```
                    ┌─────────────────┐
                    │  PatentsView    │──┐
                    │  API            │  │
                    └─────────────────┘  │
                                         ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  USPTO Bulk     │  │  JSON Cache     │  │  PostgreSQL     │
│  XML Archives   │──│  (per-patent)   │──│  Database       │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                           │                      │
         ┌─────────────────┼──────────────────────┤
         ▼                 ▼                      ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  LLM Analysis   │  │  Citation       │  │  Sector/Sub-    │
│  (Claude API)   │  │  Classification │  │  Sector Rules   │
└─────────────────┘  └─────────────────┘  └─────────────────┘
         │                 │                      │
         └─────────────────┼──────────────────────┘
                           ▼
                    ┌─────────────────┐
                    │  Scoring Engine │
                    │  (V2/V3)        │
                    └─────────────────┘
                           │
                           ▼
                    ┌─────────────────┐
                    │  Vendor Export  │
                    │  Packages       │
                    └─────────────────┘
```

### Data Combination Points

1. **Patent Record Creation:**
   - Base data from PatentsView API (title, abstract, assignee, dates)
   - CPC codes extracted and stored
   - Affiliate matching via pattern rules

2. **Enrichment Layer:**
   - Forward/backward citations classified (competitor/affiliate/neutral)
   - Prosecution history analyzed (office actions, rejections)
   - IPR/PTAB risk assessed
   - Optional: XML extraction for full claims text

3. **LLM Analysis:**
   - Sector-specific question templates generate scores
   - Text summaries: prior art problem, technical solution
   - Numeric scores: eligibility (1-5), validity (1-5), claim breadth, etc.

4. **Scoring:**
   - V2 Enhanced: Weighted formula across quantitative + LLM metrics
   - V3 Consensus: Multi-role weighted aggregation
   - Snapshots persist scores for filtering/comparison

---

## 4. User-Facing Functionality

### 4.1 GUI Pages

| Page | Purpose | Key Actions |
|------|---------|-------------|
| **Patent Summary** | Browse/filter/sort all patents | Filter by sector, score range, enrichment flags; export CSV |
| **V2 Scoring** | Configure and run scoring | Adjust weights, run scoring, save snapshots |
| **V3 Scoring** | Multi-role consensus scoring | Configure role weights, compare perspectives |
| **Aggregates** | View sector/super-sector summaries | Group by taxonomy, see score distributions |
| **Sector Rankings** | Compare sectors by average score | Damages tier overlay |
| **Sector Management** | Edit sector rules and mappings | Add CPC/keyword rules, preview matches |
| **Focus Areas** | Group patents for analysis | Create groups, run LLM templates |
| **Prompt Templates** | Define LLM question sets | Structured (per-patent) or collective execution |
| **Patent Detail** | Deep-dive on single patent | View all scores, citations, prosecution, family |
| **Family Explorer** | Explore patent families | Expansion from seed, scoring candidates |
| **Job Queue** | Monitor batch operations | LLM scoring jobs, enrichment runs |
| **Admin** | System configuration | Portfolio selection, user management |

### 4.2 User Scoring Control

**V2 Enhanced Scoring:**
- 6 preset profiles (Executive, Litigation, Licensing, etc.)
- Adjustable weights for ~12 metrics
- Citation-aware weighting (competitor citations boosted 1.5×)
- Year multiplier for remaining patent life

**V3 Consensus Scoring:**
- Multiple "roles" with different V2 presets
- Weighted average across roles
- Rank comparison across perspectives

**Snapshot System:**
- Save current scoring configuration
- Mark snapshots as "active" for filtering
- Historical comparison

### 4.3 Enrichment Pipeline

**Batch Job Types:**
- `LLM_ANALYSIS` — Run scoring templates on patent batches
- `CITATION_ANALYSIS` — Classify forward citations by competitor/affiliate
- `PROSECUTION_HISTORY` — Fetch and analyze file wrapper
- `PTAB_CHECK` — Check for IPR/PGR proceedings
- `XML_EXTRACTION` — Extract full claims from bulk archives

**User Control:**
- Select tier (top 100, 500, 1000) or sector
- Choose enrichment types
- Monitor progress in Job Queue
- Re-run for stale data

---

## 5. Ad-Hoc Scripts (Claude Code)

The `scripts/` directory contains **164 TypeScript scripts** developed through Claude Code sessions for ad-hoc analysis. Key categories:

### 5.1 Sector Analysis & Refactoring

| Script | Purpose |
|--------|---------|
| `analyze-sector-distribution.ts` | Patent counts by sector |
| `analyze-sector-for-split.ts` | Identify oversized sectors needing breakout |
| `analyze-large-sector-cpc.ts` | CPC distribution within sectors |
| `breakout-*.ts` (20+ scripts) | Split sectors by CPC subgroup |
| `assign-sectors-v2.ts` | Batch reassignment with new rules |

**Example Workflow:**
1. Identify sector with 2000+ patents
2. Run `analyze-{sector}-detail.ts` to see CPC distribution
3. Run `breakout-{sector}.ts` to create sub-sectors
4. Update sector rules in DB
5. Reassign patents

### 5.2 LLM Scoring

| Script | Purpose |
|--------|---------|
| `run-sector-scoring.ts` | Score patents in a sector with templates |
| `batch-score-overnight.ts` | Large-scale scoring with rate limiting |
| `recompute-super-sector-scores.ts` | Recalculate after weight changes |
| `analyze-llm-scoring-quality.ts` | Quality check on LLM outputs |

### 5.3 Vendor Package Generation

| Script | Purpose |
|--------|---------|
| `export-vendor-package.ts` | Generate ranked CSV and supporting files |
| `generate-heatmap-batches.ts` | Create diversity-sampled batches |
| `import-heatmap-results.ts` | Import vendor assessments |
| `summarize-vendor-package.ts` | Generate package README |

### 5.4 Integration Opportunities

These scripts represent functionality that could be integrated into the GUI:

| Current Script Approach | Potential GUI Integration |
|------------------------|---------------------------|
| Manual sector breakout scripts | Sector Management: "Suggest Split" button |
| Ad-hoc CPC analysis | Sector Management: CPC distribution visualization |
| Batch scoring scripts | Job Queue: Scheduled scoring jobs |
| Vendor export scripts | Export page with template selection |
| Family exploration scripts | Family Explorer: "Auto-expand" mode |

---

## 6. Accomplishments

### 6.1 Core Platform
- Full-stack Vue 3 + Quasar frontend with PostgreSQL backend
- Prisma ORM with comprehensive schema (50+ models)
- Multi-portfolio support with 24 competitor portfolios loaded
- 84K+ patents indexed and searchable

### 6.2 Taxonomy System
- 12 super-sectors, 64 sectors with CPC-based rules
- Sub-sector generation for fine-grained LLM analysis
- Sector rule engine supporting CPC prefix, keyword, phrase, boolean
- Damages tier rating system for monetization prioritization

### 6.3 LLM Integration
- Sector-specific scoring templates with inheritance
- 63% of patents enriched with LLM analysis
- Structured questions with typed outputs (numeric, categorical, text)
- Collective templates for cross-patent strategy generation

### 6.4 Scoring System
- V2 Enhanced: Configurable weights, citation-aware, year multiplier
- V3 Consensus: Multi-role perspective aggregation
- Snapshot persistence for reproducibility
- Normalization across sparse LLM data

### 6.5 Vendor Pipeline
- Complete workflow from scoring → focus areas → templates → export
- Per-patent litigation assessments
- Collective strategy generation
- CSV/JSON export packages

---

## 7. Pending Tasks (Pre-Refactor)

### 7.1 Phase 3C Work (Rolled Back)

The following features were in development but identified as needing architectural refactor:

1. **Unified Snapshot System**
   - V2/V3/LLM scores all using same snapshot infrastructure
   - Cross-snapshot comparison views
   - Automatic staleness detection

2. **Scoring Normalization Overhaul**
   - Percentile-based normalization within sectors
   - Cross-sector comparability
   - Handling of sparse LLM coverage

3. **Structured Question Framework**
   - Template inheritance (portfolio → super-sector → sector → sub-sector)
   - Question versioning and migration
   - Answer type validation

4. **Taxonomy Improvements**
   - Dynamic sub-sector generation from CPC distribution
   - Target size constraints (50-500 patents per sub-sector)
   - Rule promotion from portfolio-specific to library

### 7.2 Identified Refactor Needs

| Area | Current State | Desired State |
|------|---------------|---------------|
| **Data Service Layer** | Queries scattered across routes/services | Unified DataService with metadata registry |
| **Cache Management** | 50+ hard-coded paths | Configurable cache paths |
| **EAV Performance** | PatentScore requires pivot queries | Materialized views or columnar storage |
| **Filter Builder** | Ad-hoc WHERE clause construction | Metadata-driven filter generation |
| **Column Registry** | Hard-coded column definitions | Dynamic column metadata |
| **Ad-hoc Scripts** | 164 standalone scripts | Integrated tools in GUI |

---

## 8. Flexibility Improvement Opportunities

### 8.1 Dynamic Field Registry

Current: Columns defined in Vue components
```vue
const columns = [
  { name: 'patent_id', field: 'patent_id', ... },
  { name: 'eligibility_score', field: 'eligibility_score', ... },
];
```

Desired: Metadata-driven from backend
```typescript
const fieldRegistry = await api.getFieldMetadata();
// Returns: source, dataType, filterable, sortable, displayFormat, etc.
```

### 8.2 Configurable Enrichment Pipeline

Current: Fixed enrichment types with hard-coded logic
Desired: Plugin architecture for enrichment sources
- Register new enrichment types via config
- Define output fields and cache locations
- Automatic integration with display/filter

### 8.3 Template-Driven Scoring

Current: V2/V3 scoring formulas in code
Desired: Formula templates in database
- Define metrics, normalizers, weights as data
- Version scoring configurations
- A/B test different approaches

### 8.4 GUI-Integrated Sector Tools

Current: Claude Code scripts for sector analysis
Desired: Built-in sector management tools
- CPC distribution visualization
- Auto-suggest sector splits
- Rule impact preview
- Batch reassignment with undo

---

## 9. Summary

### What Works Well
- Comprehensive patent data model
- Flexible scoring with presets
- LLM integration for qualitative analysis
- Vendor export pipeline

### What Needs Improvement
- Data access patterns (no unified layer)
- Hard-coded configuration throughout
- Performance for large result sets
- Ad-hoc functionality not integrated

### Refactor Goals
1. **Unified Data Service** — Single source of truth for all queries
2. **Metadata Registry** — Dynamic field/column definitions
3. **Materialized Views** — Pre-computed aggregates and joins
4. **Configuration Consolidation** — All paths and settings in one place
5. **Tool Integration** — Migrate useful scripts to GUI

This system overview, combined with the Data Architecture Context document and schema, provides the foundation for planning the refactored data service architecture.
