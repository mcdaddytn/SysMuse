# Patent Portfolio Analysis Platform - Context for Next Session

## Project Overview

This project provides **patent intelligence services** for analyzing IP portfolios, identifying licensing opportunities, and supporting litigation strategy. The current implementation focuses on analyzing Broadcom's streaming-related patents against major streaming competitors.

---

## NEW: Infrastructure Layer (Added 2026-01-15)

### Quick Start - Docker Services

```bash
# Start PostgreSQL and ElasticSearch
npm run docker:up

# Check ES health
npm run es:health

# Create ES index and import existing data
npm run es:create-index
npm run es:import

# Start interactive search CLI
npm run search
```

### New Files Created

| File | Purpose |
|------|---------|
| `docker-compose.yml` | PostgreSQL 16 + ElasticSearch 8.11 |
| `prisma/schema.prisma` | Full database schema for patent data |
| `services/elasticsearch-service.ts` | ES client with search, MLT, aggregations |
| `services/import-to-elasticsearch.ts` | Import existing JSON into ES |
| `services/search-cli.ts` | Interactive search term testing |

### New npm Scripts

| Script | Purpose |
|--------|---------|
| `npm run docker:up` | Start PostgreSQL + ElasticSearch |
| `npm run docker:down` | Stop Docker services |
| `npm run es:import` | Import all data to ElasticSearch |
| `npm run search` | Interactive search CLI |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:push` | Push schema to PostgreSQL |

### Search CLI Commands

```
search <query>     - Full-text search across titles/abstracts
similar <id>       - Find patents similar to a given patent
terms [tier]       - Extract significant terms
filter tier=1      - Filter results by tier
cpc Apple          - Show CPC distribution for competitor
```

---

---

## Current Capabilities (Data Services Layer)

### 1. Patent Data Ingestion
- **PatentsView API Integration**: Full access to USPTO patent data (1976-present)
- **Portfolio Download**: Bulk download of assignee portfolios with metadata
- **Citation Retrieval**: Forward and backward citation mapping via dedicated endpoints

### 2. Analysis Services

| Service | Description | Status |
|---------|-------------|--------|
| **Citation Overlap Analysis** | Finds patents cited BY competitor patents | ✅ Production |
| **CPC Technology Overlap** | Maps technology area overlap between portfolios | ✅ Production |
| **Patent Scoring** | Multi-factor scoring (citations, term, IPR history) | ✅ Production |
| **Priority Tiering** | Automated categorization into priority tiers | ✅ Production |
| **Batch Processing** | Incremental analysis with rate limiting | ✅ Production |

### 3. Data Outputs

| Output | Format | Description |
|--------|--------|-------------|
| Priority Patents | CSV/JSON | Ranked patents with competitor citation data |
| Technology Overlap | CSV/JSON | CPC-based technology area analysis |
| Competitor Exposure | JSON | Per-competitor citation statistics |
| Raw Analysis | JSON | Full citation and metadata for each patent |

---

## Current Data State (as of 2026-01-15)

### Broadcom Portfolio
- **15,276** streaming-related patents (filtered by CPC codes H04N, H04L, H04W, G06F, G11B, G06T)
- **1,500** patents analyzed for citation overlap (batches 0-1500)
- **302** patents with competitor citations identified
- **50** Tier 1 priority patents (10+ competitor citations)

### Competitor Portfolios Downloaded
| Competitor | Patents | Streaming-Filtered |
|------------|---------|-------------------|
| Apple | 36,227 | 18,685 |
| Microsoft | 28,881 | 20,201 |
| Google/YouTube | 29,708 | 17,904 |
| Comcast | 2,926 | 2,368 |
| Disney | 2,865 | 1,506 |
| Roku | 719 | 569 |
| Netflix | 497 | 434 |
| Amazon | 163 | 45 |

### Analysis Results Summary
| Metric | Value |
|--------|-------|
| Patents with competitor citations | 302 |
| Total competitor citations found | ~3,000 |
| Technology overlap CPC codes | 484 |
| Microsoft citations of Broadcom | 144 patents |
| Amazon citations of Broadcom | 77 patents |
| Google citations of Broadcom | 59 patents |

---

## Target Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | Quasar + Vue.js | Desktop-quality UI with Material Design |
| **API** | Express + TypeScript | REST API services |
| **AI/LLM** | LangChain | Claim analysis, document processing |
| **ORM** | Prisma | Type-safe database access |
| **Database** | PostgreSQL | Primary relational data store |
| **Search** | ElasticSearch | Full-text search across patent text |
| **Runtime** | Node.js | Server runtime |

### Proposed Service Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Quasar / Vue.js Frontend                     │
│         (Patent Explorer, Analysis Dashboard, Reports)          │
├─────────────────────────────────────────────────────────────────┤
│                    Express API (TypeScript)                     │
│              REST endpoints + WebSocket for jobs                │
├─────────────────────────────────────────────────────────────────┤
│                      Application Services                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │   Portfolio  │  │   Citation   │  │   LangChain          │   │
│  │   Manager    │  │   Analyzer   │  │   Claim Analysis     │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                    Prisma ORM (TypeScript)                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  PostgreSQL  │  │ ElasticSearch│  │   USPTO APIs         │   │
│  │  (Relations) │  │ (Text Search)│  │   (External)         │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Next Session: Prisma Schema Migration

The database schema below is provided as reference. In the next session, we will convert this to a Prisma schema (`prisma/schema.prisma`) with proper relations, indexes, and TypeScript type generation.

### Current TypeScript Clients (Reusable)

| Client | Purpose | File |
|--------|---------|------|
| `PatentsViewClient` | Patent search, citations, metadata | `clients/patentsview-client.ts` |
| `FileWrapperClient` | Prosecution history | `clients/odp-file-wrapper-client.ts` |
| `PTABClient` | IPR/PTAB trial data | `clients/odp-ptab-client.ts` |

### Suggested Database Schema

```sql
-- Core patent data
CREATE TABLE patents (
    patent_id VARCHAR(20) PRIMARY KEY,
    patent_title TEXT,
    patent_date DATE,
    filing_date DATE,
    expiration_date DATE,
    assignee_id INTEGER REFERENCES assignees(id),
    forward_citations INTEGER,
    abstract TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Assignees/Companies
CREATE TABLE assignees (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    normalized_name VARCHAR(100), -- e.g., "Microsoft" for all variants
    is_competitor BOOLEAN DEFAULT FALSE,
    portfolio_id INTEGER REFERENCES portfolios(id)
);

-- Portfolios (for analysis grouping)
CREATE TABLE portfolios (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL, -- e.g., "Broadcom Streaming", "Apple Video"
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Patent-Portfolio mapping (many-to-many)
CREATE TABLE portfolio_patents (
    portfolio_id INTEGER REFERENCES portfolios(id),
    patent_id VARCHAR(20) REFERENCES patents(patent_id),
    PRIMARY KEY (portfolio_id, patent_id)
);

-- CPC Classifications
CREATE TABLE patent_cpcs (
    patent_id VARCHAR(20) REFERENCES patents(patent_id),
    cpc_code VARCHAR(20),
    cpc_level VARCHAR(10), -- 'class', 'subclass', 'group'
    PRIMARY KEY (patent_id, cpc_code)
);

-- Citations
CREATE TABLE citations (
    citing_patent_id VARCHAR(20) REFERENCES patents(patent_id),
    cited_patent_id VARCHAR(20) REFERENCES patents(patent_id),
    citation_date DATE,
    PRIMARY KEY (citing_patent_id, cited_patent_id)
);

-- Analysis Results
CREATE TABLE analysis_runs (
    id SERIAL PRIMARY KEY,
    analysis_type VARCHAR(50), -- 'citation_overlap', 'cpc_overlap', etc.
    source_portfolio_id INTEGER REFERENCES portfolios(id),
    target_portfolio_id INTEGER REFERENCES portfolios(id),
    run_date TIMESTAMP DEFAULT NOW(),
    status VARCHAR(20),
    metadata JSONB
);

CREATE TABLE patent_scores (
    patent_id VARCHAR(20) REFERENCES patents(patent_id),
    analysis_run_id INTEGER REFERENCES analysis_runs(id),
    score_type VARCHAR(50), -- 'citation', 'term', 'competitor_overlap', 'combined'
    score DECIMAL(10,2),
    metadata JSONB,
    PRIMARY KEY (patent_id, analysis_run_id, score_type)
);

-- Priority Tiers
CREATE TABLE priority_tiers (
    patent_id VARCHAR(20) REFERENCES patents(patent_id),
    tier INTEGER, -- 1, 2, 3
    tier_criteria VARCHAR(100),
    competitor_citations INTEGER,
    competitors_citing TEXT[], -- Array of competitor names
    assigned_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_patents_assignee ON patents(assignee_id);
CREATE INDEX idx_patents_date ON patents(patent_date);
CREATE INDEX idx_citations_cited ON citations(cited_patent_id);
CREATE INDEX idx_patent_cpcs_code ON patent_cpcs(cpc_code);
CREATE INDEX idx_priority_tier ON priority_tiers(tier);
```

### GUI Feature Recommendations

**Dashboard**
- Portfolio overview with key metrics
- Competitor exposure heatmap
- Priority tier distribution charts

**Patent Explorer**
- Searchable/filterable patent list
- Detail view with citations, prosecution history
- Claim text viewer (requires bulk data integration)

**Analysis Tools**
- Run citation overlap analysis on-demand
- Configure competitor lists
- Set scoring weights
- Export results to CSV/Excel

**Reporting**
- Generate priority patent reports
- Competitor-specific analysis
- Technology area deep-dives

---

## ElasticSearch: Patent Text Search & Pattern Matching

ElasticSearch enables full-text search and pattern matching across patent abstracts, titles, claims, and other text fields. This supports discovery, prioritization, and competitive sub-category analysis.

### Indexed Document Structure

```json
{
  "patent_id": "9569605",
  "title": "Biometric authentication system and method",
  "abstract": "A method for authenticating a user using biometric data...",
  "claims_text": "1. A method comprising: receiving biometric input...",
  "grant_date": "2017-02-14",
  "assignee": "Broadcom Corporation",
  "cpc_codes": ["H04L63/0861", "G06F21/32"],
  "forward_citations": 134,
  "competitor_citations": 134,
  "competitors_citing": ["Apple", "Microsoft"],
  "tier": 1
}
```

### Search Use Cases

| Use Case | Query Type | Example |
|----------|------------|---------|
| **Technology Discovery** | Full-text | `"adaptive bitrate" OR "ABR streaming"` |
| **Standards Identification** | Phrase match | `"H.264" OR "HEVC" OR "AVC"` |
| **Claim Language Patterns** | Wildcard | `"method comprising*receiving*transmitting"` |
| **Competitive Sub-Categories** | Bool + Filter | DRM patents cited by Netflix |
| **Similar Patents** | More-like-this | Find patents similar to a known strong patent |

### Prioritization & Categorization Queries

**1. Find DRM/Content Protection Patents:**
```json
{
  "query": {
    "bool": {
      "should": [
        { "match": { "abstract": "digital rights management" }},
        { "match": { "abstract": "content protection" }},
        { "match": { "abstract": "encryption key" }},
        { "match": { "title": "DRM" }}
      ],
      "filter": { "term": { "tier": 1 }}
    }
  }
}
```

**2. Find Adaptive Streaming Patents:**
```json
{
  "query": {
    "bool": {
      "must": [
        { "multi_match": {
            "query": "adaptive bitrate streaming bandwidth",
            "fields": ["title^2", "abstract", "claims_text"]
        }}
      ],
      "filter": { "range": { "competitor_citations": { "gte": 5 }}}
    }
  }
}
```

**3. Standards-Essential Patent Candidates:**
```json
{
  "query": {
    "bool": {
      "should": [
        { "match_phrase": { "abstract": "H.264" }},
        { "match_phrase": { "abstract": "HEVC" }},
        { "match_phrase": { "abstract": "DASH" }},
        { "match_phrase": { "abstract": "HLS" }}
      ],
      "minimum_should_match": 1
    }
  }
}
```

### Competitive Sub-Category Analysis

Use ElasticSearch aggregations to discover technology clusters within competitor citations:

```json
{
  "size": 0,
  "query": { "term": { "competitors_citing": "Apple" }},
  "aggs": {
    "tech_categories": {
      "significant_terms": { "field": "cpc_codes.keyword", "size": 20 }
    },
    "common_terms": {
      "significant_text": { "field": "abstract", "size": 10 }
    }
  }
}
```

This reveals which technology areas Apple most heavily cites from Broadcom's portfolio.

### Integration with Analysis Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│               ElasticSearch Patent Index                         │
│  (Abstracts, Titles, Claims, CPC codes, Citation metadata)      │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        ▼                         ▼                         ▼
┌───────────────┐       ┌───────────────────┐     ┌─────────────────┐
│  Technology   │       │   Competitive     │     │   Claim Pattern │
│  Discovery    │       │   Sub-Categories  │     │   Matching      │
│               │       │                   │     │                 │
│ Find patents  │       │ Cluster patents   │     │ Find patents    │
│ by technology │       │ by competitor     │     │ with similar    │
│ keywords      │       │ citation patterns │     │ claim language  │
└───────────────┘       └───────────────────┘     └─────────────────┘
        │                         │                         │
        └─────────────────────────┼─────────────────────────┘
                                  ▼
                    ┌───────────────────────────┐
                    │   Targeted Analysis       │
                    │   - Licensing targets     │
                    │   - Litigation candidates │
                    │   - Technology reports    │
                    └───────────────────────────┘
```

### Data Indexing Strategy

1. **Phase 1**: Index existing patent metadata (ID, title, abstract, CPC, citation counts)
2. **Phase 2**: Add full claim text from USPTO bulk data
3. **Phase 3**: Enrich with prosecution history keywords (rejections, amendments)
4. **Sync**: Keep PostgreSQL as source of truth; sync to ES via change events

---

## Recommended Next Steps

### Immediate (Next Session)

1. **Continue Citation Overlap Analysis**
   - Queue batches 1500-2000, 2000-3000
   - Command: `npx tsx examples/citation-overlap-batch.ts 1500 2000`
   - Each 500-patent batch: ~25 minutes

2. **Review Database Schema**
   - Adapt schema above to your tech stack
   - Consider PostgreSQL + Prisma ORM for TypeScript integration

3. **Plan Data Migration**
   - Script to load current JSON/CSV into database
   - Map existing analysis results to schema

### Short-term

4. **API Service Layer**
   - Wrap current analysis scripts as REST endpoints
   - Add authentication/rate limiting
   - Consider Next.js API routes or Express

5. **Prosecution History Integration**
   - Add File Wrapper data to patent records
   - Show claim amendments, rejections
   - Assess patent strength signals

6. **Competitor-Specific Reports**
   - Create "Patents Microsoft Cites" view
   - Per-competitor licensing packet generation

### Medium-term

7. **Full Portfolio Coverage**
   - Complete all 15,276 patents (~10 more hours of batching)
   - Schedule as background jobs

8. **Claim Text Integration**
   - Source full claim text from USPTO bulk data
   - Enable claim-level search and analysis

9. **Machine Learning Enhancements**
   - Claim similarity scoring
   - Infringement likelihood prediction
   - Technology clustering

---

## File Reference

### Analysis Scripts
| Script | Purpose |
|--------|---------|
| `examples/citation-overlap-batch.ts` | Run citation overlap on patent range |
| `examples/citation-overlap-high-cite.ts` | Analyze top patents by citations |
| `examples/cpc-overlap-analysis.ts` | Technology area overlap |
| `examples/export-priority-csvs.ts` | Export tiers to CSV |
| `examples/merge-priority-subsets.ts` | Combine analysis results |

### Output Files (Current)
| File | Description |
|------|-------------|
| `output/priority-all-2026-01-15.csv` | 302 patents with competitor citations |
| `output/priority-tier1-2026-01-15.csv` | 50 highest priority patents |
| `output/priority-tier2-2026-01-15.csv` | 158 licensable patents |
| `output/priority-tier3-2026-01-15.csv` | 116 foundational patents |
| `output/cpc-overlap-summary-2026-01-15.csv` | Technology overlap by CPC |

### Configuration
| File | Purpose |
|------|---------|
| `.env` | API keys (PATENTSVIEW_API_KEY, USPTO_ODP_API_KEY) |
| `package.json` | npm scripts for running analyses |
| `tsconfig.json` | TypeScript configuration |

---

## Quick Start Commands

```bash
# Check current batch status
tail -f output/batch-*.log

# Start next batch
npx tsx examples/citation-overlap-batch.ts 1500 2000 > output/batch-1500-2000.log 2>&1 &

# Re-export priority CSVs after new batches
npx tsx examples/export-priority-csvs.ts

# Run CPC overlap analysis
npm run analyze:cpc

# View top priority patents
head -50 output/priority-all-2026-01-15.csv
```

---

---

## CSV Files for Analysis & Action

### File Descriptions

| File | Records | Description | Primary Use |
|------|---------|-------------|-------------|
| **priority-tier1-2026-01-15.csv** | 50 | Patents with 10+ competitor citations | Immediate licensing targets |
| **priority-tier2-2026-01-15.csv** | 158 | Patents with competitor cites AND 2+ years remaining term | Active licensing portfolio |
| **priority-tier3-2026-01-15.csv** | 116 | 100+ forward citations with competitor overlap | Technology leadership evidence |
| **priority-all-2026-01-15.csv** | 302 | All patents with any competitor citations | Complete analysis set |
| **cpc-overlap-summary-2026-01-15.csv** | 484 | Technology area overlap by CPC code | Market positioning analysis |

### CSV Column Reference

```
Patent ID          - USPTO patent number
Title              - Patent title
Grant Date         - Date patent was granted
Assignee           - Current patent owner (Broadcom entity)
Forward Citations  - Number of times cited by later patents
Years Remaining    - Estimated years until expiration
Competitor Cites   - Number of competitor patents citing this one
Competitors Citing - List of competitors (Microsoft; Apple; etc.)
Enhanced Score     - Combined priority score
```

---

## Recommended Analysis Workflow

### Parallel Track 1: Licensing Opportunities (Internal + Partners)

**Target: Tier 2 patents** (158 patents with citations AND remaining term)

| Step | Action | Owner | Tool/Platform |
|------|--------|-------|---------------|
| 1 | Filter Tier 2 by specific competitor | Internal | Excel pivot on CSV |
| 2 | Review claim scope for breadth | IP Attorneys | Manual review |
| 3 | Identify products potentially practicing claims | Internal | Product analysis |
| 4 | Prepare licensing demand letter candidates | IP Attorneys | Legal workflow |
| 5 | Prioritize by competitor revenue exposure | Internal | Market research |

**Licensing Priority Matrix:**
- **High**: 5+ years remaining, 10+ competitor cites, broad claims
- **Medium**: 2-5 years remaining, 5+ competitor cites
- **Lower**: <2 years remaining (limited negotiation window)

### Parallel Track 2: Litigation Deep-Dive (Claim Chart Development)

**Target: Tier 1 patents** (50 patents with highest competitor citation density)

| Step | Action | Owner | Tool/Platform |
|------|--------|-------|---------------|
| 1 | Select top 10-15 patents per target competitor | Internal | Excel analysis |
| 2 | Obtain full claim text | Internal | USPTO bulk data or PatFT |
| 3 | Generate initial claim charts | Partners | **RPX Insight**, **Patexia**, **LexisNexis PatentSight** |
| 4 | Map claims to competitor products | Partners + Internal | Product teardowns, documentation |
| 5 | Legal review of infringement theory | IP Attorneys | Claim construction analysis |
| 6 | Prosecution history review | IP Attorneys | File Wrapper API data |

**Third-Party Platform Recommendations:**

| Platform | Strength | Use Case |
|----------|----------|----------|
| **RPX Insight** | Claim chart automation, litigation analytics | Initial claim mapping at scale |
| **Patexia** | Expert network for technical analysis | Deep claim construction |
| **PatentSight (LexisNexis)** | Patent valuation, competitive intelligence | Portfolio valuation for licensing |
| **Unified Patents** | PTAB analytics, prior art | IPR risk assessment |
| **Darts-ip** | Global litigation data | International enforcement strategy |

### Parallel Track 3: Foundational Technology Evidence

**Target: Tier 3 patents** (116 high-citation foundational patents)

| Step | Action | Owner | Tool/Platform |
|------|--------|-------|---------------|
| 1 | Build citation trees showing technology influence | Internal | PatentsView API |
| 2 | Document technology pioneering for each patent | Internal | Technical summaries |
| 3 | Prepare for willfulness arguments | IP Attorneys | Evidence compilation |
| 4 | Identify standards contributions | Internal | Standards body research |

---

## Recommended Immediate Actions

### For IP Litigation Attorneys

1. **Review Tier 1 CSV** (`priority-tier1-2026-01-15.csv`)
   - Focus on patents with 20+ competitor citations
   - Assess claim breadth and prosecution history
   - Flag any patents with prior IPR challenges

2. **Competitor-Specific Analysis**
   - Filter `priority-all` CSV by "Competitors Citing" column
   - Create separate target lists for Microsoft (144 patents), Amazon (77), Google (59)
   - Prioritize by strategic value and relationship considerations

3. **Identify Quick Wins**
   - Patents with: high competitor cites + long remaining term + clean prosecution
   - These are lowest-risk for licensing demands

### For Internal Technical Team

1. **Product Mapping Sprint**
   - Select top 20 patents from Tier 1
   - Identify specific competitor products/services that may practice claims
   - Document feature-to-claim correlations

2. **Expand Citation Analysis**
   - Continue batching to cover full 15K portfolio
   - Command: `npx tsx examples/citation-overlap-batch.ts 1500 2000`
   - Target: Complete within 1 week

3. **Prepare Data for Partners**
   - Export Tier 1 + Tier 2 as single package
   - Include prosecution summaries from File Wrapper API
   - Format for claim chart platform ingestion

### For External Partner Engagement

1. **Claim Chart Development RFP**
   - Scope: Top 25 patents, 3 target competitors
   - Deliverable: Draft claim charts with product mappings
   - Timeline: 2-3 weeks

2. **Patent Valuation**
   - Engage PatentSight or similar for portfolio valuation
   - Focus on streaming/video subset
   - Use for licensing negotiation positioning

---

## Risk Considerations for Attorney Review

| Risk | Mitigation | Priority |
|------|------------|----------|
| **IPR Exposure** | Review PTAB history; avoid patents with prior challenges | High |
| **Claim Construction** | Early Markman hearing strategy for ambiguous terms | High |
| **Prosecution History Estoppel** | Review file wrappers for limiting amendments | Medium |
| **Expiration Timeline** | Prioritize patents with 5+ years for maximum leverage | Medium |
| **Standard-Essential Patents** | Assess FRAND obligations if any SEP declarations | Medium |

---

## Workflow Integration Points

```
┌─────────────────────────────────────────────────────────────────┐
│                    CURRENT: CSV Analysis                         │
│    (Excel, internal review, attorney prioritization)             │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
┌───────────────────────────────┐ ┌───────────────────────────────┐
│   EXTERNAL PARTNERS           │ │   INTERNAL PLATFORM           │
│   - Claim chart platforms     │ │   - Quasar/Vue.js GUI         │
│   - Patent valuation services │ │   - PostgreSQL + Prisma       │
│   - Technical experts         │ │   - LangChain claim analysis  │
└───────────────────────────────┘ └───────────────────────────────┘
                    │                           │
                    └─────────────┬─────────────┘
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OUTCOME: Enforcement Action                   │
│    (Licensing demand, litigation filing, cross-license)         │
└─────────────────────────────────────────────────────────────────┘
```

---

---

## Session Update: 2026-01-16

### Major Accomplishments

1. **Expanded to 250+ Priority Patents**
   - Ran batches through 4000 patents
   - 250 patents now in top priority list with 100% LLM coverage

2. **LLM Analysis v2 Implemented**
   - Created configurable prompts: `config/prompts/patent-analysis-v2-draft.json`
   - New metrics: technology_category, product_types[], likely_implementers[], detection_method
   - New composite scores: legal_viability_score, enforcement_potential_score, market_value_score
   - Test run completed on batch 3500-4000 (71 unique patents analyzed)

3. **Metrics Documentation**
   - Full reference guide: `docs/METRICS_REFERENCE.md`
   - Excel formulas for custom weight recalculation

4. **Competitor Expansion Strategy**
   - Gap analysis revealed 42% of patents are cybersecurity-related with NO cybersecurity competitors tracked
   - Planning document: `docs/COMPETITOR_EXPANSION_STRATEGY.md`
   - Recommended additions: Palo Alto Networks, CrowdStrike, Cisco, Salesforce, etc.

### Key Files Created/Modified

| File | Purpose |
|------|---------|
| `config/prompts/patent-analysis-v1.json` | Current LLM prompt (externalized) |
| `config/prompts/patent-analysis-v2-draft.json` | Expanded prompt for attorney review |
| `services/llm-patent-analysis-v2.ts` | V2 analysis service |
| `docs/METRICS_REFERENCE.md` | All metrics/formulas for Excel |
| `docs/EXPANDED_ANALYSIS_STRATEGY.md` | Two-track analysis methodology |
| `docs/COMPETITOR_EXPANSION_STRATEGY.md` | Plan for expanding competitor pool |
| `scripts/analyze-citing-companies.ts` | Script to analyze all citing companies |

### V2 Analysis Test Results (Batch 3500-4000)

| Technology Category | Patent Count | % |
|---------------------|--------------|---|
| Cybersecurity | 30 | 42% |
| Wireless Communications | 11 | 15% |
| Video Streaming/Processing | 7 | 10% |
| Networking | 5 | 7% |
| Cloud Computing | 4 | 6% |

Top v2 scoring patent: **8615270** (Bluetooth/Wi-Fi antenna sharing) - Overall: 77.4

### Session Update: 2026-01-17 - Competitor Expansion Complete

**Completed:**
- [x] Created configurable competitor list (`config/competitors.json`)
- [x] Created citation mining script (`scripts/mine-all-citations.ts`)
- [x] Ran mining on 200 top patents - found 6,845 citations from 605 companies
- [x] Added 12 new validated competitors (IBM, McAfee, Darktrace, Forcepoint, etc.)
- [x] Updated all citation-overlap scripts to use config

**Competitor Count:** 61 companies across 11 categories (up from 23)

**Key Finding:** Cisco is #1 citator (392 citations), IBM was major miss (226 citations)

---

### Session Update: 2026-01-17 (Evening) - Full Portfolio Analysis Complete

**Major Accomplishments:**

1. **Full Portfolio Citation Overlap Analysis**
   - Analyzed all 15,276 patents in portfolio
   - Found 1,023 patents with competitor citations
   - Total competitor citations: 4,773
   - Qualifying actionable patents: 538

2. **Downloaded 12 New Competitor Portfolios**
   - Cisco: 19,821 patents
   - Huawei: 25,373 patents
   - Red Hat: 3,487 patents
   - Citrix: 2,391 patents
   - Palantir: 1,580 patents
   - McAfee: 1,616 patents
   - Plus: Forcepoint, Darktrace, Dropbox, Sophos, FireEye
   - Samsung: Downloaded 148K patents but file too large to save

3. **Updated Multi-Score Analysis**
   - Fixed script to dynamically load all citation overlap files
   - Added 30+ new competitor patterns to normalizer
   - New competitors now appearing in exposure analysis:
     - Samsung: 31 citations (22 actionable)
     - Qualcomm: 24 citations (17 actionable)
     - Intel: 23 citations (13 actionable)
     - Cisco: 14 citations (13 actionable)

4. **Generated Updated Rankings**
   - `output/top-250-actionable-2026-01-17.csv`
   - `output/tier-litigation-2026-01-17.json`
   - `output/tier-licensing-2026-01-17.json`
   - `output/tier-strategic-2026-01-17.json`

**Top Litigation Candidates:**
| Rank | Patent | Score | Competitors |
|------|--------|-------|-------------|
| 1 | 10200706 | 96.0 | ByteDance |
| 2 | 9569605 | 95.1 | Apple (67 cites!) |
| 3 | 8954740 | 89.6 | Google, Apple, Amazon, Sony, Microsoft |

**Disk Usage:** 2.1 GB total in output/

---

### NEW DIRECTION: Avago Audio/Video Patent Analysis

**Context:** User interested in pursuing Avago A/V patents to find niche competitors (like Avid) not captured by large-company citation overlap.

**Avago A/V Corpus:**
- Total Avago patents: 2,910
- Audio/Video related: 445 patents

**Three-Pronged Approach (see `docs/AVAGO_AV_ANALYSIS_APPROACH.md`):**

1. **Internal Portfolio Search (ElasticSearch)**
   - Extract significant terms from Avago A/V abstracts
   - Use More-Like-This (MLT) to find related patents
   - ElasticSearch is running with 22,706 patents indexed

2. **USPTO API Competitor Discovery**
   - Search for niche A/V companies not in current list
   - Target companies: Avid, Dolby, Blackmagic, DTS, Harmonic, etc.
   - Use extracted terminology for PatentsView queries

3. **Product Web Search Preparation**
   - Map patent terminology to commercial product features
   - Generate targeted search queries

---

### Next Session Tasks

**Phase 1: ElasticSearch Term Extraction**
```bash
# Start ES services if not running
npm run docker:up

# Run term extraction from Avago A/V patents
npx tsx scripts/extract-av-terms.ts  # (to be created)
```

**Phase 2: Portfolio Clustering**
- Run MLT queries for key Avago patents
- Group by technology area
- Identify cross-portfolio connections

**Phase 3: Niche Competitor Discovery**
- Query PatentsView with extracted A/V terms
- Filter for non-Broadcom assignees in H04N, H04R, G10L CPC codes
- Identify professional A/V companies

**Phase 4: Product Search Generation**
- Map technical terms to commercial feature descriptions
- Create web search query templates

---

### Files Reference

**New Files This Session:**
| File | Purpose |
|------|---------|
| `docs/AVAGO_AV_ANALYSIS_APPROACH.md` | Detailed approach document |
| `config/assignee-variants.json` | USPTO assignee name mappings |
| `scripts/check-batch-status.sh` | Batch job monitoring script |
| `scripts/download-competitors-sequential.sh` | Sequential download script |

**Key Output Files (2026-01-17):**
| File | Description |
|------|-------------|
| `output/top-250-actionable-2026-01-17.csv` | Priority patent list |
| `output/multi-score-analysis-2026-01-17.json` | Full scoring data |
| `output/tier-litigation-2026-01-17.json` | Top 100 litigation candidates |
| `output/llm-analysis/combined/combined-rankings-2026-01-17.json` | With LLM scores |

**ElasticSearch Status:**
- Running: Yes (verified)
- Index: `patents`
- Documents: 22,706

---

### Session Update: 2026-01-17 (Late) - Avago A/V Analysis Complete

**All 4 Phases Completed:**

1. **Phase 1: Term Extraction** ✅
   - Found 923 Avago A/V patents (more than estimated 445)
   - Extracted 116 significant terms
   - **Key Discovery:** Portfolio is heavy on acoustic resonators (BAW/FBAR) not traditional A/V

2. **Phase 2: Portfolio Clustering** ✅
   - Ran MLT queries on seed patents
   - Found 273 similar patents in Broadcom portfolio
   - Found 62 similar in LSI portfolio

3. **Phase 3: Competitor Discovery** ✅
   - Discovered major BAW/RF competitors:
     - **Murata** - 73 patents (MAJOR target)
     - **Skyworks** - 21 patents
     - **Qorvo** - 17 patents
     - **Akoustis** - 7 patents
   - Texas Instruments, NXP, MediaTek identified as known A/V not tracked

4. **Phase 4: Product Search Generation** ✅
   - Generated 42 search queries for product research
   - Priority targets: Murata BAW filters, Skyworks RF modules

**Major Strategic Finding:**
Avago's "A/V" portfolio is actually concentrated in **acoustic resonator technology (BAW/FBAR)**:
- Used in RF filters for ALL 4G/5G smartphones
- MEMS microphones for voice devices
- $10+ billion market annually

**New Scripts Created:**
| Script | Purpose |
|--------|---------|
| `scripts/extract-av-terms.ts` | Phase 1 - ES term extraction |
| `scripts/cluster-av-patents.ts` | Phase 2 - MLT clustering |
| `scripts/discover-av-competitors.ts` | Phase 3 - USPTO competitor discovery |
| `scripts/generate-product-searches.ts` | Phase 4 - Product search queries |

**New Output Files:**
| File | Description |
|------|-------------|
| `output/avago-av/avago-av-key-terms-2026-01-17.json` | Extracted terms |
| `output/avago-av/avago-av-patents-2026-01-17.json` | 923 A/V patents |
| `output/avago-av/av-competitor-candidates-2026-01-17.json` | New competitors |
| `output/avago-av/av-product-search-queries-2026-01-17.json` | Product searches |

**New Documentation:**
- `docs/AVAGO_AV_ANALYSIS_RESULTS.md` - Full analysis results

---

### Next Session Tasks

**Immediate Priority:**
1. **Update competitors.json** - Add Murata, Skyworks, Qorvo, Akoustis, QXONIX
2. **Run citation overlap** on 923 Avago A/V patents against new competitors
3. **Deep-dive patent review** - Top BAW/FBAR patents for claim mapping

**Research Tasks:**
4. Execute product search queries (teardown reports, datasheets)
5. Market research on BAW filter market players
6. Identify specific infringing products

**Scripts to Run:**
```bash
# After updating competitors.json:
npx tsx examples/citation-overlap-batch.ts --portfolio avago-av

# View analysis results:
cat output/avago-av/av-competitor-candidates-2026-01-17.json | jq '.recommendations'
```

---

### Session Update: 2026-01-17 (Continuation) - Strategy Provenance & Citation Overlap

**Completed:**

1. **Strategy Provenance System** ✅
   - Designed and implemented `discoveryStrategies` schema in competitors.json
   - Three strategy types tracked:
     - `manual-initial` - Original industry knowledge
     - `citation-overlap-broadcom-streaming` - Citation mining from Broadcom portfolio
     - `term-extraction-avago-av` - ES term extraction from Avago A/V patents
   - Each competitor now has `discoveredBy` array linking to strategies
   - Config version bumped to 3.0

2. **New Competitor Category: rfAcoustic** ✅
   - Added 6 new RF/acoustic resonator competitors:
     - **Murata** (73 patents) - Major BAW/FBAR target
     - **Skyworks** (21 patents)
     - **Qorvo** (17 patents)
     - **QXONIX** (10 patents)
     - **Akoustis** (7 patents)
     - **RF360** (8 patents)
   - Added 5 additional semiconductor companies:
     - Texas Instruments, NXP, MediaTek, Analog Devices, Cirrus Logic

3. **Enhanced competitor-config.ts Service** ✅
   - New methods: `getDiscoveryStrategies()`, `getCompaniesByStrategy()`, `getStrategySummary()`
   - Full provenance tracking per competitor
   - **72 companies** across **12 categories** (101 patterns)

4. **Citation Overlap Script for Avago A/V** ✅
   - Created `scripts/citation-overlap-avago-av.ts`
   - First batch (0-25) completed: 7 patents with competitor citations (28% hit rate)
   - Background batch (25-125) running
   - Top citators so far: Samsung, Apple, Meta, Google, Intel

**Config Schema v3.0 Structure:**
```json
{
  "discoveryStrategies": {
    "strategy-id": {
      "name": "...",
      "type": "manual|citation-overlap|term-extraction",
      "parameters": { "extractedTerms": [...], "script": "..." }
    }
  },
  "categories": {
    "rfAcoustic": {
      "companies": [
        { "name": "Murata", "discoveredBy": ["term-extraction-avago-av"], "patentCount": 73 }
      ]
    }
  }
}
```

**New Scripts Created:**
| Script | Purpose |
|--------|---------|
| `scripts/citation-overlap-avago-av.ts` | Citation overlap for Avago A/V patents |

---

### Next Session Tasks

**Continue Citation Overlap:**
```bash
# Check batch progress
tail -f output/avago-av/batch-25-125.log

# Run next batch
npx tsx scripts/citation-overlap-avago-av.ts 125 225

# Merge results when done
npx tsx scripts/merge-avago-av-results.ts
```

**Strategy Expansion (Future):**
- To add a new strategy, create entry in `discoveryStrategies`
- Tag new competitors with the strategy ID
- Parameters capture: source portfolio, terms used, scripts run

---

### Session Update: 2026-01-17 (Latest) - Hybrid Clustering Strategy Complete

**Major Accomplishments:**

1. **Hybrid Clustering Strategy Implemented** ✅
   - Documented strategy: `docs/HYBRID_CLUSTERING_STRATEGY.md`
   - Created `scripts/hybrid-cluster-analysis.ts` - Agglomerative clustering with term affinity
   - Created `scripts/cluster-competitor-discovery.ts` - Per-cluster competitor discovery

2. **10 Patent Clusters Generated** ✅
   - Clustered 75 top litigation patents by term vectors
   - Used ElasticSearch termvectors API + TF-IDF weighting
   - Agglomerative clustering with cosine similarity

**Cluster Summary:**
| Rank | Cluster Name | Patents | Competitor Citations |
|------|--------------|---------|---------------------|
| 1 | Network/Communication: user/cloud | 43 | 349 |
| 2 | Video/Image: video/sink | 5 | 60 |
| 3 | Video/Image: imag/depth | 3 | 47 |
| 4 | Video/Image: event/live | 4 | 33 |
| 5 | Network/Communication: threat/attack | 6 | 28 |
| 6 | Wireless: random/fenc | 4 | 25 |
| 7 | Computing/Data: pii/breach | 3 | 24 |
| 8 | Wireless: scan/edr | 2 | 20 |
| 9 | AI/ML: learn/confid | 4 | 9 |
| 10 | Wireless: object/pose | 1 | 8 |

3. **Competitor Discovery on 3 Clusters** ✅
   - Cluster 1 (Cloud/Auth), Cluster 2 (Video/Codec), Cluster 5 (Security)
   - Discovered significant new competitors

4. **competitors.json Updated to v3.0** ✅
   - **15 categories** (up from 12)
   - **78 companies** (up from 72)
   - **6 discovery strategies** tracked

**New Categories Added:**
| Category | Description | Companies |
|----------|-------------|-----------|
| `videoCodec` | Video codec & A/V processing | Tencent, Dolby, Beijing Dajia (Kuaishou) |
| `financial` | Financial services with cloud/security patents | Bank of America, Capital One |
| `consumerElectronics` | Consumer electronics | LG Electronics |

**New Strategies Added:**
| Strategy ID | Cluster | Patent Count |
|-------------|---------|--------------|
| `hybrid-cluster-1-cloud-auth` | Cloud/Authentication | 43 |
| `hybrid-cluster-2-video-codec` | Video/Codec | 5 |
| `hybrid-cluster-5-security` | Threat Detection | 6 |

**Key New Competitors:**
| Company | Discovery Source | Patent Count | Notes |
|---------|------------------|--------------|-------|
| Tencent | Cluster 2 + 5 | 39 | Video codec + security |
| Dolby Laboratories | Cluster 2 | 12 | Audio/video codec, macroblock |
| Beijing Dajia (Kuaishou) | Cluster 2 | 11 | Video codec |
| Bank of America | Cluster 1 + 5 | 34 | Cloud auth + security |
| Capital One | Cluster 1 | 16 | Cloud authentication |
| LG Electronics | Cluster 1 + 2 | 41 | Video codec + cloud |
| Dell Products | Cluster 1 + 5 | 59 | Cloud + security (added to Dell EMC) |

**New Scripts Created:**
| Script | Purpose |
|--------|---------|
| `scripts/hybrid-cluster-analysis.ts` | Term vector clustering of top patents |
| `scripts/cluster-competitor-discovery.ts` | Per-cluster competitor discovery |

**New Output Files:**
| File | Description |
|------|-------------|
| `output/clusters/cluster-definitions-2026-01-17.json` | 10 cluster definitions with patents |
| `output/clusters/cluster-strategies-2026-01-17.json` | Strategy metadata for each cluster |
| `output/clusters/cluster-ranked-for-discovery-2026-01-17.json` | Clusters ranked by citation count |
| `output/clusters/cluster-1-competitors-2026-01-17.json` | Cluster 1 discovery results |
| `output/clusters/cluster-2-competitors-2026-01-17.json` | Cluster 2 discovery results |
| `output/clusters/cluster-5-competitors-2026-01-17.json` | Cluster 5 discovery results |

**New Documentation:**
- `docs/HYBRID_CLUSTERING_STRATEGY.md` - Full hybrid approach documentation

---

---

### Session Update: 2026-01-17 (Continuation) - All Cluster Discovery Complete

**Major Accomplishments:**

1. **Completed All 10 Cluster Discovery** ✅
   - Ran competitor discovery on remaining 7 clusters (3, 4, 6, 7, 8, 9, 10)
   - All cluster discovery results saved to `output/clusters/`

2. **Updated competitors.json to v4.0** ✅
   - **16 categories** (added automotive)
   - **13 discovery strategies** (added 7 new cluster strategies)
   - **90 companies** (up from 78)

3. **Downloaded 3 New Competitor Portfolios** ✅
   - Tencent: 13,720 patents (6,362 streaming)
   - Dolby: 3,301 patents (1,131 streaming)
   - LG: 58,057 patents (22,681 streaming)

**New Competitors Added (from clusters 3, 4, 6, 7, 8, 9, 10):**

| Company | Category | Patents | Cluster Source |
|---------|----------|---------|----------------|
| Snap Inc | social | 22 | 6, 7, 10 |
| OPPO | telecom | 12 | 6 |
| Xiaomi | telecom | 11 | 6 |
| ZTE | telecom | 10 | 6 |
| NEC | telecom | 12 | 7, 9 |
| Realtek | semiconductor | 14 | 8 (Bluetooth/BLE) |
| Mastercard | financial | 15 | 7 |
| PayPal | financial | 8 | 4, 8 |
| Toyota | automotive | 15 | 3, 10 |
| Hyundai | automotive | 11 | 10 |
| Kia | automotive | 11 | 10 |
| Honda | automotive | 7 | 10 |

**New Category: Automotive**
- Toyota, Hyundai, Kia, Honda - discovered via image depth mapping and motion tracking clusters

**Cluster Discovery Summary:**

| Cluster | Name | New Competitors Found |
|---------|------|----------------------|
| 3 | Video/Image: imag/depth | Canon (27), Toyota (15), TSMC (14) |
| 4 | Video/Image: event/live | Aurora Ops (10), DeepMind (9) |
| 6 | Wireless: random/fenc | Snap (14), OPPO (12), Xiaomi (11), ZTE (10) |
| 7 | Computing/Data: pii/breach | Mastercard (15), Prudential (13), NEC (12) |
| 8 | Wireless: scan/edr | Realtek (14), Cypress (8), Silicon Labs (6) |
| 9 | AI/ML: learn/confid | Adobe (9), NEC (9) - mostly tracked competitors |
| 10 | Wireless: object/pose | Toyota (15), Hyundai (11), Kia (11), Honda (7) |

**New Output Files:**
| File | Description |
|------|-------------|
| `output/clusters/cluster-3-competitors-2026-01-17.json` | Image/depth cluster |
| `output/clusters/cluster-4-competitors-2026-01-17.json` | Event/live cluster |
| `output/clusters/cluster-6-competitors-2026-01-17.json` | Wireless/geo cluster |
| `output/clusters/cluster-7-competitors-2026-01-17.json` | PII/breach cluster |
| `output/clusters/cluster-8-competitors-2026-01-17.json` | Bluetooth/BLE cluster |
| `output/clusters/cluster-9-competitors-2026-01-17.json` | AI/ML cluster |
| `output/clusters/cluster-10-competitors-2026-01-17.json` | Motion/pose cluster |
| `output/competitors/tencent-*.json` | Tencent portfolio (13,720 patents) |
| `output/competitors/dolby-*.json` | Dolby portfolio (3,301 patents) |
| `output/competitors/lg-*.json` | LG portfolio (58,057 patents) |

**Total Competitor Portfolios Downloaded: 23**

---

### Next Session Tasks

**Run Citation Overlap Analysis:**
```bash
# Run citation overlap on newly downloaded competitors
npx tsx examples/citation-overlap-batch.ts --competitor Tencent
npx tsx examples/citation-overlap-batch.ts --competitor Dolby
npx tsx examples/citation-overlap-batch.ts --competitor LG
```

**Consider:**
- Run citation overlap on new mobile/telecom competitors (OPPO, Xiaomi, ZTE)
- Deep-dive analysis on Realtek for Bluetooth/WiFi overlap
- Product mapping for video codec patents (Tencent, Dolby)
- Automotive sector analysis (Toyota, Hyundai, Kia) for imaging/ADAS

**Optional Downloads:**
- Snap Inc (social media/AR)
- OPPO, Xiaomi (mobile devices)
- Realtek (direct semiconductor competitor)

---

---

### Session Update: 2026-01-17 (Continuation) - Analysis & Strategic Review

**All Batch Jobs Completed Successfully:**
- Avago A/V citation overlap: Batches 0-25 and 25-125 completed
- All 10 cluster competitor discovery jobs completed
- No running jobs found

**Current Infrastructure Status:**
- Docker: PostgreSQL 16 + ElasticSearch 8.11 running (healthy)
- ElasticSearch: 22,706 patents indexed (56.7 MB)
- Competitor config: v4.0 with 90 companies, 16 categories, 13 discovery strategies

---

## STRATEGIC REVIEW: Answering Key Questions

### 1. Have Recent Efforts Surfaced New Competitors Effectively?

**YES - Significant expansion achieved:**

| Phase | Competitors | Categories | Source |
|-------|-------------|------------|--------|
| Initial Manual | ~23 | 8 | Industry knowledge |
| Citation Overlap (Broadcom) | +12 | +2 | Patent citation mining |
| Term Extraction (Avago A/V) | +6 | +1 (rfAcoustic) | ES term extraction |
| Hybrid Clustering (10 clusters) | +49 | +3 | Combined approach |
| **Total** | **90** | **16** | **13 strategies** |

**Key New Competitors Surfaced:**
- **RF/Acoustic**: Murata (73 patents), Skyworks, Qorvo, Akoustis - major BAW/FBAR targets
- **Video Codec**: Tencent (39), Dolby (12), Kuaishou (11) - video compression
- **Automotive**: Toyota, Hyundai, Kia, Honda - depth mapping/ADAS
- **Financial**: Bank of America (34), Capital One, Mastercard - cloud/security
- **Telecom**: OPPO, Xiaomi, ZTE, NEC - mobile devices

**Multi-Strategy Validation:**
- 10 companies discovered by multiple strategies (higher confidence)
- Samsung: manual + citation-overlap (validates approach)
- Dell EMC: manual + cluster-1 + cluster-5 (cross-technology validation)

### 2. Is Search Term Extraction Sufficient? Semantic Search Gap Analysis

**CURRENT CAPABILITIES:**

| Feature | Status | Notes |
|---------|--------|-------|
| English stemming | ✅ | `english_stemmer` configured |
| English stopwords | ✅ | `_english_` stopword list |
| Fuzzy matching | ✅ | `fuzziness: 'AUTO'` in multi_match |
| More-Like-This | ✅ | MLT queries for similarity |
| Significant terms | ✅ | `significant_text` aggregation |
| Term vectors | ✅ | Enabled for abstract field |
| **Vector embeddings** | ❌ | NOT implemented |
| **Semantic similarity** | ❌ | NOT implemented |

**GAPS IDENTIFIED:**

1. **No True Semantic Search**: Current ES uses lexical matching with stemming - finds "compress" when searching "compression" but NOT "data reduction" or "encoding efficiency"

2. **Domain-Specific Stopwords Missing**: Current stopwords are English generic. Patent-specific terms like "method", "apparatus", "comprising", "plurality" should be filtered from term extraction

3. **Limited Synonym Handling**: Different inventors use different terminology for same concepts (e.g., "BAW" vs "bulk acoustic wave" vs "piezoelectric resonator")

**RECOMMENDATIONS:**

```
Priority 1: Add patent-specific stopwords to term extraction
- Create config/patent-stopwords.json with domain terms
- Integrate into extract-av-terms.ts and cluster scripts

Priority 2: Implement semantic search
- Option A: ES dense_vector with sentence-transformers (self-hosted)
- Option B: External embedding service (OpenAI, Cohere)
- Option C: Hybrid BM25 + dense retrieval

Priority 3: Synonym expansion
- Create technology-specific synonym mappings
- Integrate with ES analyzer or query-time expansion
```

### 3. Current PostgreSQL & ElasticSearch Usage vs. Recommendations

**CURRENT STATE:**

| Component | Current Usage | Data |
|-----------|--------------|------|
| **PostgreSQL** | Schema defined, not populated | Prisma schema ready |
| **ElasticSearch** | Active, well-utilized | 22,706 patents indexed |
| **JSON files** | Primary data store | Output files, competitors.json |

**ES CURRENT CAPABILITIES:**
- Full-text search (title, abstract)
- Filtering (tier, competitor, CPC)
- Aggregations (CPC distribution, term extraction)
- MLT similarity queries
- Patent analyzer with stemming

**GAPS FOR GUI/HUMAN INTERVENTION:**

| Need | Current | Recommendation |
|------|---------|----------------|
| User weight preferences | JSON export | PostgreSQL `user_weights` table |
| Curated search terms | Manual JSON | PostgreSQL `search_terms` with `is_user_curated` flag |
| Sector/cluster naming | Auto-generated | PostgreSQL `sectors` table with user editing |
| Patent notes/priority | Not persisted | PostgreSQL `patent_notes` table |
| Analysis run history | JSON files | PostgreSQL `analysis_runs` (schema exists) |
| Real-time search | ES CLI | ES + API layer for GUI |

**RECOMMENDED DATA ARCHITECTURE:**

```
┌─────────────────────────────────────────────────────────────────┐
│                     PostgreSQL (Source of Truth)                 │
│  - Patents, Citations, Competitors, Analysis Results             │
│  - User Preferences: weights, notes, priorities, curated terms  │
│  - Sectors: emergent clusters + user-defined categorization      │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ Sync
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     ElasticSearch (Search Index)                 │
│  - Full-text search on abstract/title/claims                     │
│  - Vector embeddings for semantic similarity (future)            │
│  - Aggregations for term extraction and analytics                │
└─────────────────────────────────────────────────────────────────┘
```

### 4. Expand LLM Questioning for Product-Focused Metrics

**CURRENT LLM METRICS (v1):**
- eligibility_score (101 analysis)
- validity_score (prior art)
- claim_breadth
- enforcement_clarity
- design_around_difficulty
- confidence

**V2 DRAFT ADDS (Pending Attorney Review):**
- technology_category
- product_types[]
- likely_implementers[]
- detection_method
- market_relevance_score
- trend_alignment_score
- investigation_priority_score
- evidence_accessibility_score

**ADDITIONAL METRICS RECOMMENDED:**

```json
{
  "revenue_exposure_estimate": "Qualitative revenue exposure (low/medium/high)",
  "product_evidence_links": ["URLs to products potentially practicing"],
  "standards_relevance": "Standard body affiliation if any",
  "cross_license_value": "Defensive portfolio value (1-5)",
  "geographic_enforcement": "US/EU/Asia enforcement viability"
}
```

### 5. Spreadsheet Export with Multiple Scores & Configurable Weights

**PROPOSED WEIGHT CONFIGURATION SYSTEM:**

Create `config/scoring-weights.json`:
```json
{
  "version": "1.0",
  "profiles": {
    "litigation_focused": {
      "description": "Emphasis on enforcement and validity",
      "weights": {
        "competitor_citations": 0.20,
        "eligibility_score": 0.25,
        "validity_score": 0.20,
        "enforcement_clarity": 0.20,
        "years_remaining": 0.15
      }
    },
    "licensing_focused": {
      "description": "Emphasis on breadth and market presence",
      "weights": {
        "competitor_citations": 0.30,
        "claim_breadth": 0.25,
        "market_relevance": 0.20,
        "years_remaining": 0.15,
        "forward_citations": 0.10
      }
    },
    "product_discovery": {
      "description": "Finding infringement opportunities",
      "weights": {
        "market_relevance": 0.30,
        "evidence_accessibility": 0.25,
        "enforcement_clarity": 0.20,
        "trend_alignment": 0.15,
        "investigation_priority": 0.10
      }
    }
  }
}
```

**CSV EXPORT ENHANCEMENT:**

Add columns:
- `discovery_strategy` - Which strategy surfaced this patent
- `sector` - Emergent technology sector from clustering
- `weight_profile_litigation` - Score with litigation weights
- `weight_profile_licensing` - Score with licensing weights
- `weight_profile_product` - Score with product discovery weights

### 6. Emergent Sectors & Custom Categorization

**CURRENT CLUSTERS (as emergent sectors):**

| Cluster | Sector Name | Patents | Key Terms |
|---------|-------------|---------|-----------|
| 1 | Cloud Authentication | 43 | user, cloud, authent, encrypt |
| 2 | Video Codec | 5 | video, sink, transcod, macroblock |
| 3 | Image Depth Mapping | 3 | imag, depth, map, captur |
| 4 | Live Event Streaming | 4 | event, live, messag, notif |
| 5 | Security/Threat | 6 | threat, attack, secur, alert |
| 6 | Wireless Geofencing | 4 | geo, fenc, random, iot |
| 7 | Data Privacy (PII) | 3 | pii, breach, exposur, identifi |
| 8 | Bluetooth/BLE | 2 | scan, edr, ble, bluetooth |
| 9 | AI/ML | 4 | learn, confid, classifi, train |
| 10 | Motion/Pose Tracking | 1 | object, pose, motion, pursuit |

**PROPOSED SECTOR MANAGEMENT:**

1. **Auto-generated sectors** from clustering (as above)
2. **USPTO-based sectors** from CPC codes (H04N, H04L, G06F, etc.)
3. **User-curated sectors** with human naming and patent assignment
4. Store in PostgreSQL with ability to merge/split/rename

---

## NEXT STEPS - PRIORITIZED

### Immediate (This Session / Next)

1. **Continue Avago A/V Citation Overlap**
   ```bash
   npx tsx scripts/citation-overlap-avago-av.ts 125 225
   npx tsx scripts/citation-overlap-avago-av.ts 225 325
   ```

2. **Create Patent-Specific Stopwords**
   - `config/patent-stopwords.json`

3. **Create Scoring Weights Config**
   - `config/scoring-weights.json`

### Short-term

4. **Enhance CSV Export with Sectors**
   - Add discovery_strategy column
   - Add sector column from cluster assignment
   - Add multiple weighted scores

5. **Populate PostgreSQL**
   - Import patents from JSON to database
   - Enable user weight preferences storage

6. **Run LLM v2 on Expanded Patent Set**
   - Test on 100 patents with new metrics
   - Collect product_types, market_relevance data

### Medium-term

7. **Implement Semantic Search**
   - Evaluate sentence-transformers for patent domain
   - Add dense_vector field to ES index

8. **Build API Layer**
   - REST endpoints for patent search
   - Endpoints for weight preference CRUD
   - Sector management endpoints

9. **GUI Foundation**
   - Quasar/Vue.js scaffold
   - Patent search interface
   - Weight slider controls

---

## Quick Reference Commands

```bash
# Check ES status
curl -s http://localhost:9200/_cluster/health | jq

# Search patents
npm run search

# Run term extraction
npx tsx scripts/extract-av-terms.ts

# Continue Avago A/V citation overlap
npx tsx scripts/citation-overlap-avago-av.ts 125 225

# Check cluster results
cat output/clusters/cluster-ranked-for-discovery-2026-01-17.json | jq '.rankedClusters[].name'

# View competitor config summary
cat config/competitors.json | jq '{version, categories: [.categories | keys[]], company_count: [.categories[].companies[]] | length}'
```

---

---

### Session Update: 2026-01-17 (Night) - Short-term Goals Completed

**Completed Tasks:**

1. **Term Extraction Scripts Updated**
   - Created `services/stopwords-service.ts` with 110+ patent-specific stopwords
   - 33 technical terms preserved (video, encryption, baw, etc.)
   - Updated `hybrid-cluster-analysis.ts` and `extract-av-terms.ts` to use shared service
   - Test: "method" -> FILTERED, "video" -> KEPT, "baw" -> KEPT

2. **Enhanced CSV Export Created**
   - `scripts/export-enhanced-csv.ts` outputs 10,276 patents
   - Columns: rank, patent_id, discovery_strategy, sector, sector_terms, all LLM scores
   - 6 pre-calculated weighted scores: default, litigation, licensing, product_discovery, defensive, quick_wins
   - Output: `output/patents-enhanced-2026-01-17.csv`

3. **PostgreSQL User Preferences Seeded**
   - Schema updated with: UserWeightProfile, UserSector, UserPatentNote, DiscoveryStrategy
   - Prisma db push successful - all tables created
   - Seed file: `config/user-preferences-seed.json`
   - Seeded: 6 weight profiles, 12 sectors, 5 search terms, 3 discovery strategies
   - Workflow: Edit JSON -> Run `npx tsx scripts/seed-user-preferences.ts`

4. **Citation Overlap Mining Continued**
   - Batch 125-225: Completed - 33% hit rate, strong BAW/FBAR results
   - Key findings: Murata (6), Skyworks (12), Samsung (11), Akoustis (3)
   - Batch 225-325: Running in background

**New Files Created:**
| File | Purpose |
|------|---------|
| `services/stopwords-service.ts` | Shared stopwords filtering |
| `config/patent-stopwords.json` | Patent-specific stopwords config |
| `config/scoring-weights.json` | Weight profiles for scoring |
| `config/user-preferences-seed.json` | User preferences seed data |
| `scripts/export-enhanced-csv.ts` | Enhanced CSV export |
| `scripts/seed-user-preferences.ts` | PostgreSQL seeding |

**PostgreSQL Tables Now Active:**
```sql
-- Query with: docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio -c "..."
SELECT name, is_default FROM user_weight_profiles;  -- 6 rows
SELECT name, sector_type FROM user_sectors;         -- 12 rows
SELECT term, category FROM search_terms;            -- 5 rows
SELECT strategy_id, name FROM discovery_strategies; -- 3 rows
```

---

### Next Session Tasks

**Immediate:**
1. Check batch 225-325 completion: `tail -20 output/avago-av/batch-225-325.log`
2. Continue batches: 325-425, 425-525, etc. (923 total Avago A/V patents)
3. Run LLM v2 analysis on high-priority patents

**Short-term:**
4. Create script to load patents into PostgreSQL
5. Create script to sync PostgreSQL <-> ElasticSearch
6. Export enhanced CSV with all LLM scores

**Medium-term:**
7. Implement semantic search (sentence-transformers)
8. Build API layer (Express.js)
9. Create GUI foundation (Quasar/Vue.js)

---

---

### Session Update: 2026-01-17 (Late Night) - Mining Expansion

**Avago A/V Citation Overlap Mining Progress:**

| Batch | Patents | With Citations | Total Citations | Status |
|-------|---------|----------------|-----------------|--------|
| 0-25 | 25 | 7 (28%) | 14 | Done |
| 25-125 | 100 | 20 (20%) | 82 | Done |
| 125-225 | 100 | 35 (35%) | 272 | Done |
| 225-325 | 100 | 44 (44%) | 160 | Done |
| 325-425 | 100 | 11 (11%) | 47 | Done |
| 425-525 | 100 | 8 (8%) | 39 | Done |
| 525-625 | 100 | 4 (4%) | 18 | Done |
| 625-725 | 100 | - | - | Running |
| 725-825 | 100 | - | - | Running |
| 825-923 | 98 | - | - | Running |
| **Total** | **923** | **129+ (21%)** | **632+** | **70% done** |

**Key Competitors Found (Avago A/V Mining):**
- Skyworks: 26 citations (BAW/FBAR)
- Samsung: 22 citations (RF, mobile)
- Murata: 12 citations (piezoelectric)
- Intel: 8 citations
- Akoustis: 6 citations (pure-play BAW)
- Qorvo: 4 citations (RF front-end)

**New Documentation Created:**
- `docs/DATABASE_STRATEGY.md` - PostgreSQL vs ElasticSearch architecture
- `docs/PROMISING_SECTORS_ANALYSIS.md` - Sector rankings and expansion plan

**Promising Sectors Identified:**

| Priority | Sector | Patents | Signals |
|----------|--------|---------|---------|
| Tier 1 | RF/Acoustic (BAW/FBAR) | 100+ | Strong competitor concentration |
| Tier 1 | Cloud Authentication | 43 | 349 competitor citations |
| Tier 2 | Video Codec | 154 | ByteDance, Tencent, Dolby |
| Tier 2 | Image Depth/ADAS | 3 | 15.7 citations/patent ratio |
| Tier 2 | Security/Threat | 6 | CrowdStrike, Palo Alto targets |

**To check batch completion:**
```bash
for log in output/avago-av/batch-*-*.log; do
  grep -q "Analysis Complete" "$log" && echo "$(basename $log): DONE" || echo "$(basename $log): RUNNING"
done
```

---

### Session Update: 2026-01-17 (Current) - Avago A/V Complete, Excel Workbook Guide

**Major Accomplishments:**

1. **Avago A/V Citation Overlap - COMPLETE** ✅
   - All 923 patents analyzed (10 batches)
   - 148 patents (16%) have competitor citations
   - 660 total competitor citations
   - Results exported to `output/avago-av/avago-av-priority-2026-01-17.csv`

2. **Top Competitors (Avago A/V - RF/Acoustic Sector):**

| Rank | Competitor | Citations | Notes |
|------|------------|-----------|-------|
| 1 | Murata | 140 | Major BAW/FBAR target |
| 2 | Skyworks | 117 | RF front-end modules |
| 3 | Samsung | 81 | Mobile RF |
| 4 | ByteDance | 45 | Video codec |
| 5 | Qorvo | 38 | BAW filters |
| 6 | Qualcomm | 32 | RF/baseband |
| 7 | Akoustis | 24 | XBAW technology |
| 8 | Intel | 21 | SerDes, RF |
| 9 | Texas Instruments | 17 | Analog |
| 10 | Apple | 17 | Consumer devices |

3. **Top Patent (Avago A/V):**
   - **9093979** - "Laterally-coupled acoustic resonators" - 123 competitor citations (all from Murata!)

4. **Excel Workbook Guide Created** ✅
   - New file: `docs/EXCEL_WORKBOOK_GUIDE.md`
   - Three-workbook system for user weight manipulation
   - Formula templates for normalized scoring
   - Multiple weight profile support

5. **New Export Scripts:**
   - `scripts/export-raw-metrics-csv.ts` - Raw data for Excel formulas
   - `scripts/export-avago-av-csv.ts` - Avago A/V results export

---

## Database Architecture Decisions (User Confirmed)

| Question | Decision |
|----------|----------|
| Store abstracts in PostgreSQL? | **YES** - for completeness |
| Import claims text for search? | **DEFER** - large data volume |
| Real-time vs batch sync? | **Either OK for now** |
| Multiple user preferences? | **YES** - support multiple users |

---

## Next Promising Sectors (Prioritized)

**Already Complete:**
- ✅ RF/Acoustic (BAW/FBAR) - Avago A/V analysis done

**Ready for Mining:**

| Priority | Sector | Cluster | Patents | Competitor Citations | Key Targets |
|----------|--------|---------|---------|---------------------|-------------|
| **Tier 1** | Video Codec | 2 | 5 | 60 | ByteDance, Tencent, Dolby |
| **Tier 1** | Cloud Auth | 1 | 43 | 349 | BofA, Capital One, fintech |
| **Tier 2** | Security/Threat | 5 | 6 | 28 | CrowdStrike, Palo Alto |
| **Tier 2** | Image Depth/ADAS | 3 | 3 | 47 | Toyota, Hyundai, Mobileye |
| **Tier 3** | Bluetooth/BLE | 8 | 2 | 20 | Realtek, Nordic, Silicon Labs |

**Recommended Next Actions:**

1. **Video Codec Deep-Dive:**
   - ByteDance has 45 Avago A/V citations (video codec patents)
   - Tencent portfolio already downloaded (13,720 patents)
   - Run citation overlap on video codec cluster patents

2. **Expand Video Codec Patents:**
   - Current cluster only has 5 patents
   - Use ES search for H04N, "macroblock", "codec", "transcod"
   - Build larger set for dedicated citation analysis

3. **Security Sector:**
   - Add EDR vendors: CrowdStrike, SentinelOne, Cybereason
   - Run citation overlap on cluster 5 patents

---

## Quick Commands

```bash
# Export Avago A/V results (already done)
npx tsx scripts/export-avago-av-csv.ts

# Export raw metrics for Excel
npx tsx scripts/export-raw-metrics-csv.ts

# Export enhanced CSV with calculated scores
npx tsx scripts/export-enhanced-csv.ts

# Run video codec sector search
npm run search
# Then: search "video codec transcod macroblock"

# Check ES health
curl -s http://localhost:9200/_cluster/health | jq
```

---

## Files Reference (New This Session)

| File | Purpose |
|------|---------|
| `docs/EXCEL_WORKBOOK_GUIDE.md` | Complete Excel setup instructions |
| `scripts/export-raw-metrics-csv.ts` | Export for Excel formula use |
| `scripts/export-avago-av-csv.ts` | Avago A/V results export |
| `output/avago-av/avago-av-priority-2026-01-17.csv` | Prioritized Avago A/V patents |
| `output/avago-av/avago-av-summary-2026-01-17.json` | Summary statistics |
| `output/avago-av/avago-av-merged-results-2026-01-17.json` | Merged batch results |

---

### Session Update: 2026-01-17 (Follow-up) - Data Export Fixed, Sector Analysis Complete

**Issues Diagnosed and Fixed:**

1. **CSV Export Data Sparseness - RESOLVED** ✅
   - **Root cause**: Export script looked for `data.patents` but combined-rankings uses `data.records`
   - **Fixed**: `scripts/export-raw-metrics-csv.ts` now correctly loads from all sources
   - Data now merged from: multi-score-analysis + combined-rankings (LLM) + sector-analysis

2. **Sector Data Integration - COMPLETE** ✅
   - New `loadSectorAnalysis()` function reads all 10 sector analysis files
   - 76 patents now have sector assignments from sector analysis
   - Fallback chain: sector-analysis → cluster-definitions → "General"

**All 10 Sector Analyses Complete:**

| Sector | Patents | Citations | Hit Rate | Top Competitor |
|--------|---------|-----------|----------|----------------|
| Cloud/Auth | 43 | 1,345 | 100% | Cisco (308) |
| Security | 6 | 103 | 100% | Pure Storage (29) |
| Event/Live | 4 | 94 | 100% | Splunk (29) |
| Video Codec | 6 | 85 | 100% | ByteDance (45) |
| AI/ML | 4 | 56 | 100% | HPE (38) |
| Image/Depth | 3 | 53 | 100% | Google (45) |
| Wireless/IoT | 4 | 46 | 100% | NBCUniversal (10) |
| Bluetooth/EDR | 2 | 43 | 100% | Apple (17) |
| PII/Breach | 3 | 30 | 100% | Microsoft (13) |
| Object/Pose | 1 | 10 | 100% | Amazon (8) |
| **TOTAL** | **76** | **1,865** | **100%** | |

**Current Data Coverage:**

| Source | Patents | LLM Scores | Sector | Competitors |
|--------|---------|------------|--------|-------------|
| multi-score-analysis | 10,276 | No | No | Yes |
| combined-rankings | 250 | Yes (222) | No | Yes |
| sector analysis | 76 | No | Yes | Yes |
| **Merged CSV** | **10,276** | **222** | **76** | **10,276** |

**LLM Analysis Status:**

- **V1 prompts** used for all 222 LLM-analyzed patents (6 scores)
- **V2 prompts** (`patent-analysis-v2-draft.json`) were drafted but NOT run broadly
- V2 adds 8 new fields including technology_category, product_types[], market_relevance_score

**Excel Macro System:**

- VBA module: `excel/PatentAnalysisMacros.bas` - checked in and working
- Imports CSV, creates UserWeights sheet, generates 4 scoring worksheets
- Dynamic formula updates when weights changed

**Data Files Updated:**

| File | Description |
|------|-------------|
| `output/patents-raw-metrics-2026-01-17.csv` | Fixed export with all data merged |
| `scripts/export-raw-metrics-csv.ts` | Updated to merge all data sources |
| `output/sectors/*.json` | 10 sector analysis files with citation data |

---

### Pending Enhancement Opportunities

**1. LLM Question Expansion:**
- Run V2 prompts on expanded patent set (adds product_types, market_relevance)
- Consider sector-specific LLM questions for deeper analysis

**2. Prosecution History/IPR Integration:**
- File Wrapper API client exists (`clients/odp-file-wrapper-client.ts`)
- PTAB client exists (`clients/odp-ptab-client.ts`)
- Not yet integrated into patent analysis pipeline

**3. Backfill Opportunities:**
- Run LLM analysis on remaining ~10K patents (currently 222/10,276)
- Expand sector analysis beyond 76 litigation-tier patents
- Consider Avago A/V patents (148 with citations) for LLM analysis

**4. Sector-Specific Analysis:**
- Each sector has different competitor landscape
- Consider sector-specific weight profiles for Excel
- Potential for sector-specific LLM question sets

---

### Session Update: 2026-01-17 (V3 Enhancement) - Scripts Created, Analysis Running

**New Scripts Created:**

| Script | Purpose | Data Source |
|--------|---------|-------------|
| `scripts/run-llm-analysis-v3.ts` | Enhanced LLM with 8 cross-sector signals | Anthropic Claude |
| `scripts/check-ipr-risk.ts` | IPR/PTAB risk assessment | USPTO PTAB API |
| `scripts/check-prosecution-history.ts` | Prosecution quality metrics | USPTO File Wrapper API |
| `services/llm-patent-analysis-v3.ts` | V3 LLM service with new schema | - |
| `config/prompts/patent-analysis-v3.json` | Enhanced prompt definition | - |

**V3 LLM New Fields:**

| Field | Values | Purpose |
|-------|--------|---------|
| implementation_type | hardware, software, firmware, hybrid | 101 risk indicator |
| standards_relevance | none, related, likely_essential, declared_essential | SEP value |
| standards_bodies | [3GPP, IEEE, ETSI, ITU, MPEG, etc.] | Standards mapping |
| market_segment | consumer, enterprise, infrastructure, etc. | Licensing strategy |
| implementation_complexity | simple, moderate, complex, highly_complex | Design-around |
| claim_type_primary | method, system, apparatus, device | Enforcement approach |
| geographic_scope | us_centric, global, regional | International value |
| lifecycle_stage | emerging, growth, mature, declining | Future value |

**Export Script Updated:**

CSV now includes 44 columns:
- Core: patent_id, title, dates, citations, competitors, sector
- LLM v1/v3: 11 score columns (1-5 scale)
- V3 signals: 10 cross-sector columns
- IPR risk: 4 columns (score, category, petitions, petitioners)
- Prosecution: 5 columns (score, category, OAs, RCEs, time)
- Text: 4 columns (summary, problem, products, implementers)

**Background Analysis Running:**

V3 LLM analysis on all 76 sector patents is running:
- Estimated completion: ~2 hours
- Output: `output/llm-analysis-v3/combined-v3-2026-01-17.json`
- Check progress: `tail -f` on output file or check batch files

**To run after V3 completes (requires USPTO_ODP_API_KEY):**
```bash
npx tsx scripts/check-ipr-risk.ts --all-sectors
npx tsx scripts/check-prosecution-history.ts --all-sectors
npx tsx scripts/export-raw-metrics-csv.ts
```

---

## NEXT SESSION: Resume Here

### V3 LLM Analysis Status (Started 2026-01-17)

**Check if complete:**
```bash
ls -la output/llm-analysis-v3/combined-v3-2026-01-17.json
ls output/llm-analysis-v3/batches/ | wc -l  # Should be ~16 batches when done
```

**If NOT complete, resume:**
```bash
npx tsx scripts/run-llm-analysis-v3.ts --all-sectors
```

**If complete, run remaining steps:**
```bash
# 1. IPR risk check (requires USPTO_ODP_API_KEY)
npx tsx scripts/check-ipr-risk.ts --all-sectors

# 2. Prosecution history (requires USPTO_ODP_API_KEY)
npx tsx scripts/check-prosecution-history.ts --all-sectors

# 3. Re-export with all data
npx tsx scripts/export-raw-metrics-csv.ts

# 4. Import into Excel (copy CSV to Excel folder, run ImportAllData macro)
```

### Current Data State

| Data Source | Patents | Status |
|-------------|---------|--------|
| multi-score-analysis | 10,276 | ✅ Complete |
| Sector analysis | 76 | ✅ Complete |
| LLM v1 analysis | 222 | ✅ Complete |
| LLM v3 analysis | 76 | 🔄 Running (started this session) |
| IPR risk | 0 | ⏸️ Pending (run after V3) |
| Prosecution history | 0 | ⏸️ Pending (run after V3) |

### Files Created This Session

```
config/prompts/patent-analysis-v3.json     # Enhanced LLM prompt (8 new fields)
services/llm-patent-analysis-v3.ts         # V3 LLM service
scripts/run-llm-analysis-v3.ts             # V3 runner script
scripts/check-ipr-risk.ts                  # IPR/PTAB check script
scripts/check-prosecution-history.ts       # Prosecution history script
scripts/export-raw-metrics-csv.ts          # Updated with 44 columns
```

### CSV Export Ready (44 columns)

Export script updated to merge all data sources:
- Core patent data (10 cols)
- LLM scores 1-5 (11 cols)
- V3 cross-sector signals (10 cols)
- IPR risk (4 cols)
- Prosecution history (5 cols)
- Text outputs (4 cols)

### Key Decisions Made

1. **V3 prompts** add 8 cross-sector signals (implementation_type, standards_relevance, etc.)
2. **IPR/Prosecution** run only on sector patents (76) - API-based, not LLM
3. **Sector-specific LLM** deferred to later phase
4. **Claims analysis** deferred - will pass to partner vendors

---

### Session Update: 2026-01-17 (Late Session) - Unified Top 250 & Enrichment Pipeline

**Major Accomplishments:**

1. **Unified Top 250 Scoring System** ✅
   - Created unified scoring with 3 profiles: aggressive, moderate, conservative
   - All profiles weighted equally for final score
   - Incorporates: citation data, LLM scores, IPR risk, prosecution quality, sectors

2. **Top 250 Comparison**
   - 77% overlap with previous litigation tier rankings
   - 23 patents new to top 100, 23 dropped
   - Methodology validated as consistent

3. **CPC-Based Sector Assignment** ✅
   - 22,706 patents now have sector assignments
   - 76 term-based (high precision), 20,757 CPC-based, 1,873 general

4. **MLT Sector Expansion** ✅
   - 8 additional patents got term-based sectors via similarity

5. **First 76 Patents Fully Enriched** ✅
   - All have: V3 LLM, IPR (0 history - all clean), Prosecution (all clean)

**Current Enrichment Jobs Running (174 patents):**
- IPR Risk Check: Running (~3 hours for 174 patents)
- Prosecution History: Running (~6 hours for 174 patents)
- LLM V3 Analysis: Needs script fix (currently re-running on sectors)

**Data Coverage Status:**

| Data Source | Patents | Status |
|-------------|---------|--------|
| multi-score-analysis | 10,276 | ✅ Complete |
| Unified Top 250 | 250 | ✅ Complete |
| CPC Sector assignments | 22,706 | ✅ Complete |
| V3 LLM analysis | 76 | ✅ Complete (need 174 more) |
| IPR risk | 76 + 174 running | 🔄 Running |
| Prosecution history | 76 + 174 running | 🔄 Running |

---

## ROADMAP: Top 250 Vendor Handoff

### Phase 1: Complete Top 250 Data (Current Session)

**Goal:** Fill out all available data on top 250 patents for vendor handoff.

| Step | Description | Status | ETA |
|------|-------------|--------|-----|
| 1 | Calculate unified top 250 | ✅ Complete | Done |
| 2 | Run IPR on remaining 174 | 🔄 Running | ~3 hrs |
| 3 | Run prosecution on remaining 174 | 🔄 Running | ~6 hrs |
| 4 | Fix & run LLM V3 on remaining 174 | ⏸️ Pending | ~4 hrs |
| 5 | Recalculate unified scores | ⏸️ Pending | 5 min |
| 6 | Export comprehensive CSV | ⏸️ Pending | 5 min |

**Deliverables:**
- `output/unified-top250-FINAL.csv` - All data for vendor partners
- `output/unified-top250-FINAL.json` - Full JSON with all metrics

### Phase 2: Expanded Sector Analysis (Future)

**Goal:** Extend deep analysis beyond top 250 to promising sectors.

| Step | Description | Patents | Priority |
|------|-------------|---------|----------|
| 1 | Video Codec sector expansion | ~150 patents | High |
| 2 | Cloud/Auth sector expansion | ~200 patents | High |
| 3 | RF/Acoustic (Avago A/V) sector | 148 with citations | High |
| 4 | Security/Threat sector | ~100 patents | Medium |
| 5 | Bluetooth/Wireless sector | ~100 patents | Medium |

**Note:** Avago A/V patents (148 with citations) should be integrated into sector analysis rather than treated separately. Consider subsectors if needed, but prefer grouping sectors to have significant patent counts.

### Phase 3: Platform Development (Parallel)

**Goal:** While running expanded analysis, build platform infrastructure.

| Component | Description | Priority |
|-----------|-------------|----------|
| PostgreSQL data import | Load top 250 into database | High |
| API endpoints | REST API for patent queries | Medium |
| Search enhancement | Semantic search capabilities | Medium |
| GUI foundation | Quasar/Vue.js scaffold | Lower |

---

## Quick Reference Commands

```bash
# Check enrichment job progress
tail -20 output/ipr/enrichment-ipr-2026-01-17.log
tail -20 output/prosecution/enrichment-pros-2026-01-17.log
tail -20 output/llm-analysis-v3/enrichment-llm-2026-01-17.log

# Recalculate unified top 250 after enrichment completes
npx tsx scripts/calculate-unified-top250.ts

# Check current top 250 status
cat output/unified-top250-2026-01-17.json | jq '.statistics'

# Export final CSV
npx tsx scripts/export-raw-metrics-csv.ts
```

---

## New Files Created This Session

| File | Purpose |
|------|---------|
| `scripts/calculate-unified-top250.ts` | Unified scoring across all profiles |
| `scripts/assign-cpc-sectors.ts` | CPC-based sector assignment |
| `scripts/expand-sectors-mlt.ts` | MLT-based sector expansion |
| `scripts/run-top250-enrichment.ts` | Enrichment job runner |
| `output/unified-top250-2026-01-17.json` | Top 250 with unified scores |
| `output/unified-top250-2026-01-17.csv` | CSV export of top 250 |
| `output/sectors/all-patents-sectors-2026-01-17.json` | All sector assignments |
| `output/patents-with-sectors-2026-01-17.csv` | Sector CSV for all patents |
| `output/top250-needs-llm-2026-01-17.json` | Patents needing LLM analysis |
| `output/top250-needs-ipr-2026-01-17.json` | Patents needing IPR check |
| `output/top250-needs-pros-2026-01-17.json` | Patents needing prosecution check |

---

### Session Update: 2026-01-17 (Continuation) - Top 250 Enrichment Complete + Video Codec Queued

**Major Accomplishments:**

1. **All Top 250 Enrichment Jobs Complete** ✅
   - LLM V3 Analysis: 174/174 patents analyzed
   - Prosecution History: 250/250 patents (242 with data, 8 no File Wrapper data)
   - IPR Risk Check: 174/174 patents (all clean - no IPR history found)

2. **Unified Top 250 Re-exported** ✅
   - Recalculated with complete enrichment data
   - Files: `unified-top250-2026-01-17.csv` and `.json`

3. **Video Codec Sector Expansion Started** 🔄
   - Created `scripts/expand-video-codec-sector.ts`
   - Searches ES for 200 video codec patents (CPC filtered: H04N, G06T)
   - Running citation overlap analysis in background
   - Early findings: Patent 10200706 has 39 ByteDance citations!

**Data Coverage (Top 250):**

| Data Type | Coverage | Notes |
|-----------|----------|-------|
| LLM v1/v3 | 174/250 (70%) | 76 patents need enrichment |
| IPR Risk | 174/250 (70%) | All clean - no IPR history |
| Prosecution | 250/250 (100%) | 242 with data |

**Prosecution Quality Distribution:**

| Score | Count | Category |
|-------|-------|----------|
| 1 | 30 | Very Difficult |
| 2 | 47 | Difficult |
| 3 | 50 | Moderate |
| 4 | 90 | Smooth |
| 5 | 33 | Clean |

**Video Codec Analysis (Running):**
- 200 patents identified via ES (video codec, transcoding, HEVC, H.264, macroblock)
- Early competitor hits: ByteDance (45), Qualcomm, Huawei, Meta, Apple
- Output: `output/sectors/video-codec-expanded/`

**New Files Created:**

| File | Purpose |
|------|---------|
| `scripts/expand-video-codec-sector.ts` | Video codec sector expansion + citation overlap |
| `output/sectors/video-codec-expanded/` | Video codec analysis output directory |
| `output/unified-top250-2026-01-17.csv` | Updated with complete enrichment |
| `output/patents-raw-metrics-2026-01-17.csv` | Full 10K patent export |

---

## NEXT SESSION: Resume Here

### Check Video Codec Job Status

```bash
# Check if still running
ps aux | grep "expand-video-codec" | grep -v grep

# View progress
tail -30 output/sectors/video-codec-expanded/analysis-run.log

# View results when complete
cat output/sectors/video-codec-expanded/video-codec-analysis-2026-01-17.json | jq '.summary'
```

### If Video Codec Complete, Next Steps

1. **Review Video Codec Results**
   ```bash
   cat output/sectors/video-codec-expanded/video-codec-analysis-*.json | jq '.topCompetitors[0:10]'
   ```

2. **Queue Additional Sector Expansions** (Priority Order)
   - Cloud/Auth sector (43 patents, 349 competitor citations)
   - Security/Threat sector (6 patents, 28 citations)
   - Image/Depth sector (3 patents, 47 citations)

3. **Run LLM V3 on Remaining 76 Top 250 Patents**
   ```bash
   npx tsx scripts/run-llm-analysis-v3.ts output/top250-needs-llm-2026-01-17.json
   ```

4. **Consider IPR Check on Remaining 76 Patents**
   ```bash
   npx tsx scripts/check-ipr-risk.ts output/top250-needs-ipr-2026-01-17.json
   ```

### Export Commands

```bash
# Re-export unified top 250 (after more enrichment)
npx tsx scripts/calculate-unified-top250.ts

# Export full raw metrics CSV
npx tsx scripts/export-raw-metrics-csv.ts

# Export video codec results
cat output/sectors/video-codec-expanded/video-codec-analysis-*.json | jq -r '.results[] | [.patent_id, .title, .competitor_citations, (.competitors_citing | join(";"))] | @csv' > output/video-codec-priority.csv
```

---

### Session Update: 2026-01-17 (Final) - V2 Scoring & Excel Updates

**Major Issue Identified:** Expired patents (0 years remaining) were ranking high in Top 250 because additive scoring only penalized them ~10-15%, not enough to drop them out of rankings.

**Solution Implemented: V2 Scoring Methodology**

1. **Hard Filters Added:**
   - Minimum 3 years remaining (excludes expired/expiring patents)
   - Minimum eligibility score of 2 (if LLM data exists)

2. **Multiplicative Year Factor:**
   ```
   FinalScore = BaseScore × YearMultiplier

   Years    Multiplier   Effect
   15+      1.00         Full score
   10       0.81         -19% penalty
   7        0.70         -30% penalty
   5        0.55         -45% penalty
   3        0.40         -60% penalty
   ```

3. **Non-Linear Year Normalization:**
   - Old: `years / 15` (linear)
   - New: `(years / 15)^1.5` (exponential, heavier low-year penalty)

**V2 Results:**

| Metric | V1 Top 250 | V2 Top 250 |
|--------|------------|------------|
| Expired (0 yrs) | 20 | 0 |
| < 3 years | 31 | 0 |
| Min years | 0 | 3.1 |
| Avg years | ~8 | 12.2 |
| Patents changed | - | 39 |

**Excel VBA Macro Updated:**
- Fixed column mappings for 44-column CSV (enforcement=O, design_around=P)
- Added IPR risk score (col AF) and prosecution quality (col AJ) to scoring
- Expanded from 8 to 10 weighted metrics
- Updated UserWeights sheet layout (rows 4-13 for metrics, rows 20-22 for relative weights)

**Video Codec Analysis Complete:**
- 200 patents analyzed for citation overlap
- Top competitor: ByteDance (39+ citations on patent 10200706)
- Results in `output/sectors/video-codec-expanded/`

**Files Created This Session:**

| File | Purpose |
|------|---------|
| `scripts/calculate-unified-top250-v2.ts` | V2 scoring with filters & year multiplier |
| `output/unified-top250-v2-2026-01-17.json` | V2 Top 250 results |
| `output/unified-top250-v2-2026-01-17.csv` | V2 CSV for Excel |
| `scripts/expand-video-codec-sector.ts` | Video codec sector expansion |
| `output/sectors/video-codec-expanded/` | Video codec analysis results |

---

## NEXT SESSION: Resume Here

### Priority 1: Use V2 Scoring as Default

```bash
# V2 is ready - generates filtered top 250 without expired patents
npx tsx scripts/calculate-unified-top250-v2.ts

# To run without filters (for comparison)
npx tsx scripts/calculate-unified-top250-v2.ts --no-filter
```

### Priority 2: Run Enrichment on V2 Top 250

The V2 top 250 has 100 patents needing IPR check and 250 needing LLM enrichment:

```bash
# Check what needs enrichment
cat output/top250-v2-needs-ipr-2026-01-17.json | jq 'length'
cat output/top250-v2-needs-llm-2026-01-17.json | jq 'length'

# Run IPR check on missing patents
npx tsx scripts/check-ipr-risk.ts output/top250-v2-needs-ipr-2026-01-17.json

# Run LLM V3 on missing patents
npx tsx scripts/run-llm-analysis-v3.ts output/top250-v2-needs-llm-2026-01-17.json
```

### Priority 3: Review Video Codec Results

```bash
# View top competitors
cat output/sectors/video-codec-expanded/video-codec-analysis-2026-01-17.json | jq '.topCompetitors[0:15]'

# View patents with most competitor citations
cat output/sectors/video-codec-expanded/video-codec-analysis-2026-01-17.json | jq '.results | sort_by(-.competitor_citations) | .[0:10] | .[] | {patent_id, competitor_citations, competitors_citing}'
```

### Priority 4: Export for Excel Testing

```bash
# Generate fresh CSV with all data
npx tsx scripts/export-raw-metrics-csv.ts

# The VBA macro is updated - import into Excel .xlsm file
# Run ImportAllData macro to populate worksheets
```

### Considerations for Future Scoring Enhancements

1. **Full Multiplicative Sub-Categories:**
   ```
   FinalScore = DamagesScore × SuccessScore × RiskScore
   ```
   Where each sub-category aggregates related metrics

2. **Damages Estimation via LLM:**
   - Add questions about market size, revenue, unit sales
   - Sector-specific damage multipliers

3. **Sector-Specific Weights:**
   - RF/Hardware: Lower 101 risk weight
   - Software/Cloud: Higher 101 risk weight

---

## Quick Reference Commands

```bash
# Start Docker services
npm run docker:up

# Check ES health
npm run es:health

# Run V2 top 250 calculation
npx tsx scripts/calculate-unified-top250-v2.ts

# Export raw metrics CSV
npx tsx scripts/export-raw-metrics-csv.ts

# Check video codec results
cat output/sectors/video-codec-expanded/video-codec-analysis-*.json | jq '.summary'

# Monitor any running jobs
ps aux | grep tsx | grep -v grep
```

---

---

### Session Update: 2026-01-17 (Continuation) - V2 Enrichment Complete + VBA V2 Update

**Major Accomplishments:**

1. **V2 Top 250 Fully Enriched** ✅
   - LLM v3: 250/250 (100%)
   - IPR Risk: 250/250 (100%) - all clean, no IPR history
   - Prosecution: 224/250 (90%)

2. **VBA Macro Updated to V2 Scoring** ✅
   - Version 2.0 with multiplicative year factor
   - Year multiplier formula: `0.3 + 0.7 × (years/15)^0.8`
   - 9 weighted metrics (years applied multiplicatively, not additively)
   - New columns: YearMult, BaseScore in scoring sheets

3. **CSV Export Updated** ✅
   - Full 10,276 patents with all available metrics
   - IPR data now for 250 patents (merged results)
   - Ready for Excel import

**V2 Scoring Methodology (Final):**

| Feature | V1 (Old) | V2 (Current) |
|---------|----------|--------------|
| Year normalization | `years/15` | `(years/15)^1.5` |
| Year impact | Additive (~10% weight) | Multiplicative (0.3-1.0) |
| Hard filters | None | Min 3 years, min elig 2 |
| Metrics in sum | 10 (incl years) | 9 (years separate) |

**V2 Year Multiplier Table:**
```
Years    Multiplier   Penalty
15+      1.00         0%
10       0.81         -19%
7        0.70         -30%
5        0.55         -45%
3        0.40         -60%
```

**Top 5 V2 Patents (Final):**

| Rank | Patent | Score | Competitors |
|------|--------|-------|-------------|
| 1 | 9569605 | 50.3% | Apple (67 cites) |
| 2 | 10200706 | 46.0% | ByteDance (20 cites) |
| 3 | 11516311 | 42.5% | Amazon, Comcast |
| 4 | 11425134 | 42.4% | Microsoft |
| 5 | 11882300 | 41.1% | Video codec |

**Files Updated:**

| File | Changes |
|------|---------|
| `excel/PatentAnalysisMacros.bas` | V2.0 - multiplicative year factor |
| `output/patents-raw-metrics-2026-01-17.csv` | Fresh export with 250 IPR |
| `output/unified-top250-v2-2026-01-17.json` | Full V2 enrichment |
| `output/ipr/ipr-risk-check-2026-01-17.json` | Merged 250 IPR results |

---

## NEXT SESSION: Resume Here

### Excel Import Ready

```bash
# Files ready for Excel:
output/patents-raw-metrics-2026-01-17.csv  # Full 10K patents (44 cols)
output/unified-top250-v2-2026-01-17.csv    # V2 top 250 only

# VBA macro updated:
excel/PatentAnalysisMacros.bas              # Version 2.0 (V2 scoring)
```

### To Import into Excel:
1. Open new workbook
2. Import VBA module from `excel/PatentAnalysisMacros.bas`
3. Run `ImportAllData()` macro
4. Adjust weights in UserWeights sheet
5. View rankings in Score_Combined sheet

### Development Queue (Next Tasks):

1. **Sector Expansion** - Expand analysis to additional sectors
   - Cloud/Auth sector (43 patents, 349 citations)
   - Security/Threat sector (6 patents, 28 citations)

2. **Product Mapping** - LLM questions for market/damages estimation
   - Add revenue exposure estimates
   - Add product evidence links

3. **Platform Development** - API and GUI foundation
   - PostgreSQL data import
   - REST API endpoints
   - Quasar/Vue.js scaffold

---

---

### Session Update: 2026-01-17 (Design Phase) - Parallel Paths Established

**Strategic Direction Established:**

The project is moving toward a three-factor scoring model and GUI development:

1. **V3 Scoring Methodology** - Separate metrics into:
   - **Damages Score** - What's the patent worth? (sector damages, citations, market)
   - **Success Score** - Will we win? (eligibility, validity, prosecution)
   - **Risk Factor** - What reduces yield? (IPR risk, design-around, enforcement)

2. **Formula:** `PatentValue = DamagesScore × SuccessScore × RiskFactor`

**New Design Documents Created:**

| Document | Purpose |
|----------|---------|
| `docs/SCORING_METHODOLOGY_V3_DESIGN.md` | Three-factor model design |
| `docs/GUI_DESIGN_SPEC.md` | Full GUI wireframes and specs |

**Parallel Development Paths:**

| Path | Priority | Description |
|------|----------|-------------|
| **LLM Questions** | High | Add damages/market estimation questions |
| **Scoring Refactor** | High | Implement V3 three-factor model |
| **Sector Expansion** | Medium | Continue analysis on major sectors |
| **GUI Foundation** | Medium | Quasar/Vue.js scaffold + API |

---

## PARALLEL PATHS: Next Session Options

### Path A: LLM Question Expansion
*Enhance market/damages estimation*

```bash
# Review current LLM prompts
cat config/prompts/patent-analysis-v3.json

# Draft V4 prompt with damages questions
# New fields: market_size_estimate, licensing_rate_estimate, product_examples
```

Key additions:
- Sector damages indicators
- Revenue exposure estimates
- Product evidence links
- Comparable settlements

### Path B: V3 Scoring Implementation
*Implement three-factor multiplicative scoring*

```bash
# Create V3 scoring script
# scripts/calculate-unified-top250-v3.ts

# Create sector damages config
# config/sector-damages.json
```

### Path C: Sector Expansion
*Continue current analysis on new sectors*

```bash
# Cloud/Auth sector (349 citations)
npx tsx scripts/expand-sector.ts cloud-auth

# Security/Threat sector (28 citations)
npx tsx scripts/expand-sector.ts security
```

### Path D: GUI Foundation
*Start platform development*

1. Review `docs/GUI_DESIGN_SPEC.md`
2. Set up Quasar project scaffold
3. Create API endpoints (Express.js)
4. Import data to PostgreSQL

---

## Design Documents for Review

### 1. Scoring Methodology V3
`docs/SCORING_METHODOLOGY_V3_DESIGN.md`

- Three-factor model (Damages × Success × Risk)
- Sector damages rating scale (1-4)
- New LLM questions for market estimation
- Migration path from V2

### 2. GUI Design Spec
`docs/GUI_DESIGN_SPEC.md`

- Dashboard with portfolio overview
- Patent grid view with filtering
- Sector view with damage estimates
- Patent detail view with three-factor breakdown
- Configuration panels (weights, sectors, terms, competitors)
- Analysis jobs panel

**Open Questions in Docs:**
- Sector granularity for damages
- Dark mode support
- Multi-user profiles
- Saved filter configurations

---

## Quick Reference: Current State

| Component | Status |
|-----------|--------|
| V2 Top 250 | ✅ Complete (100% enriched) |
| VBA Macro | ✅ V2.0 (multiplicative years) |
| Video Codec | ✅ 200 patents analyzed |
| V3 Design | ✅ Document created |
| GUI Spec | ✅ Document created |
| Sector Damages | ⏸️ Config file needed |
| V4 LLM Prompt | ⏸️ Needs drafting |
| API Endpoints | ⏸️ Not started |
| GUI Scaffold | ⏸️ Not started |

---

*Document updated: 2026-01-17 (design phase)*
*V2 Scoring: COMPLETE*
*V3 Design: DOCUMENTED (pending implementation)*
*GUI Spec: INITIAL DRAFT (pending review)*
*Parallel paths: LLM questions, V3 scoring, sector expansion, GUI*

---

### Session Update: 2026-01-18 - V2 Sectors + V3 LLM Expansion + GUI Design

**Major Accomplishments:**

1. **V2 Sector Breakout Complete** ✅
   - Created `config/sector-breakout-v2.json` with 41 CPC-based + 8 term-based sectors
   - Ran `scripts/assign-sectors-v2.ts` on all 22,706 patents
   - **54 unique sectors** (up from ~15 broad sectors)
   - Output: `output/sectors/all-patents-sectors-v2-2026-01-18.json`

   **Sector Damages Distribution:**
   | Tier | Patents | Key Sectors |
   |------|---------|-------------|
   | Very High | 713 | video-codec (352), rf-acoustic (317), video-drm (44) |
   | High | 7,127 | semiconductor, network-switching, computing-os-security |
   | Medium | 10,791 | computing-runtime, wireless-transmission |
   | Low | 4,075 | general, computing-ui |

2. **V3 LLM Analysis - Top 250 Gaps** ✅
   - 144 patents analyzed
   - Cost: ~$1.32, Time: ~17 min
   - Output: `output/llm-analysis-v3/combined-v3-2026-01-18.json`

3. **V3 LLM Analysis - Bubble Zone (251-400)** 🔄 RUNNING
   - 130 patents (ranks 251-400 lacking V3 data)
   - Progress: ~55/130 at session end
   - Cost: ~$1.18, Time: ~16 min
   - Log: `output/llm-analysis-v3/bubble-zone-2026-01-18.log`

4. **GUI Design Spec Updated** ✅ (`docs/GUI_DESIGN_SPEC.md`)
   - Real-time weight sliders with impact preview
   - Multi-user voting mechanism (attorney consensus)
   - ElasticSearch integration with ad-hoc patent sets
   - Set operations (union, intersection, difference)
   - LLM context builder with chat refinement
   - Patent detail tabs (prosecution, IPR, full patent)
   - Patlytics product selection view
   - Phase-prioritized feature roadmap

5. **Sector-Specific LLM Planning Doc** ✅ (`docs/SECTOR_SPECIFIC_LLM_PLANNING.md`)
   - Product-focused analysis pipeline for vendor integration
   - Sector-specific prompt templates (video-codec, cloud-auth, rf-acoustic)
   - Within-sector ranking methodology
   - Litigation grouping score concept
   - Diminishing returns analysis

**Cost/Time Analysis (V3 LLM):**

| Job | Patents | Time | Cost | Rate |
|-----|---------|------|------|------|
| Top 250 gaps | 144 | ~17 min | ~$1.32 | ~8.5 patents/min |
| Bubble zone | 130 | ~16 min | ~$1.18 | ~8.5 patents/min |
| **Total top 400** | **274** | **~33 min** | **~$2.50** | - |

**Bubble-Up Analysis Insight:**
- Top 250: 144 patents needed LLM (58% gap)
- Bubble zone (251-400): 130 patents needed LLM (87% gap!)
- Deeper zone (401-600): 186 needed (93% gap)
- **Recommendation:** Stop broad V3 at top 400, switch to sector-specific

**New Files Created:**

| File | Purpose |
|------|---------|
| `config/sector-breakout-v2.json` | Detailed CPC → sector mappings |
| `scripts/assign-sectors-v2.ts` | V2 sector assignment script |
| `output/sectors/all-patents-sectors-v2-2026-01-18.json` | 22,706 patents with V2 sectors |
| `output/patents-with-sectors-v2-2026-01-18.csv` | CSV export |
| `output/bubble-zone-needs-llm-2026-01-18.json` | 130 patents for bubble zone |
| `output/top250-v3-needs-llm-2026-01-18.json` | 144 patents (now analyzed) |
| `docs/SECTOR_SPECIFIC_LLM_PLANNING.md` | Product-focused LLM strategy |

---

## NEXT SESSION: Resume Here

### Priority 1: Check Bubble Zone Job Completion

```bash
# Check if still running
ps aux | grep "tsx.*run-llm" | grep -v grep

# View final progress
tail -30 output/llm-analysis-v3/bubble-zone-2026-01-18.log

# Check combined output
ls -la output/llm-analysis-v3/combined-v3-2026-01-18.json
```

### Priority 2: Recalculate Unified Top 250 with V3 Data

```bash
# Recalculate with complete V3 LLM coverage
npx tsx scripts/calculate-unified-top250-v3.ts

# Compare old vs new top 250 for bubble-up analysis
# Look for patents that moved significantly
```

### Priority 3: Bubble-Up Pattern Analysis

After recalculation, analyze:
- Which patents from 251-400 rose into top 250?
- Which top 250 patents dropped out?
- What V3 metrics drove the changes?

### Priority 4: Sector-Specific LLM Testing (video-codec first)

**Note:** Consider using Opus model for higher quality sector-specific analysis.

```bash
# Create sector-specific prompt for video-codec
# Target: 18 video-codec patents in current top 250 + expansion

# Model flexibility needed:
# - Standard V3: Claude Sonnet (cost-effective for bulk)
# - Sector-specific: Claude Opus (higher quality for priority sectors)
```

**Top Sectors for Sector-Specific Analysis:**

| Priority | Sector | Top 250 Count | Damages Tier | Next Step |
|----------|--------|---------------|--------------|-----------|
| 1 | **video-codec** | 18 | Very High | Create sector prompt, test on top 18 |
| 2 | **cloud-auth** | 35 | High | Create sector prompt |
| 3 | **network-switching** | 22 | High | Create sector prompt |
| 4 | **network-threat-protection** | 12 | High | Create sector prompt |
| 5 | **rf-acoustic** | 1 (but 317 total) | Very High | Specialized prompt |

### Priority 5: Export Updated CSV

```bash
# After recalculation, export fresh CSV with V2 sectors
npx tsx scripts/export-raw-metrics-csv.ts
```

---

## Development Queue (Prioritized)

### Immediate (This Week)

| Item | Status | Notes |
|------|--------|-------|
| Bubble zone job completion | Check first | Should be done |
| Recalculate top 250 with V3 | Ready | Run after bubble zone |
| Bubble-up analysis | Ready | Compare old/new top 250 |
| Export updated CSV | Ready | After recalculation |

### Short-Term (Next Week)

| Item | Status | Notes |
|------|--------|-------|
| Sector-specific prompt: video-codec | Ready to develop | Test Opus model |
| Sector-specific prompt: cloud-auth | Queued | After video-codec |
| Product identification pipeline | Design complete | Leverage citation data |
| Mixed model support in LLM service | To implement | Sonnet for bulk, Opus for sector |

### Medium-Term

| Item | Status | Notes |
|------|--------|-------|
| PostgreSQL data import | Queued | Load patents + sectors |
| API layer (Express) | Queued | REST endpoints |
| GUI scaffold (Quasar/Vue) | Design complete | Start after API |
| Patlytics integration prep | Planning | Product selection workflow |

### Longer-Term

| Item | Status | Notes |
|------|--------|-------|
| Within-sector rankings | Designed | After sector-specific LLM |
| Litigation grouping | Conceptual | Patents that work together |
| Venn/concentric visualization | Future | User has existing code |
| Claim chart vendor integration | Planning | Token-based cost tracking |

---

## Quick Reference Commands

```bash
# Start Docker services
npm run docker:up

# Check ES health
npm run es:health

# Check job status
ps aux | grep tsx | grep -v grep
tail -20 output/llm-analysis-v3/bubble-zone-2026-01-18.log

# Recalculate unified top 250
npx tsx scripts/calculate-unified-top250-v3.ts

# Run V2 sector assignment
npx tsx scripts/assign-sectors-v2.ts

# Export raw metrics CSV
npx tsx scripts/export-raw-metrics-csv.ts

# Run V3 LLM on specific patents
npx tsx scripts/run-llm-analysis-v3.ts <patent-list.json>
```

---

## Key Design Documents

| Document | Status | Description |
|----------|--------|-------------|
| `docs/GUI_DESIGN_SPEC.md` | **Updated 2026-01-18** | Full GUI wireframes, ES search, multi-user |
| `docs/SCORING_METHODOLOGY_V3_DESIGN.md` | Draft | Three-factor model |
| `docs/SECTOR_BREAKOUT_PROPOSALS_V2.md` | **Implemented** | ~47 sector breakouts |
| `docs/SECTOR_SPECIFIC_LLM_PLANNING.md` | **New** | Product-focused LLM strategy |

---

## Model Strategy Note

For sector-specific analysis, consider mixed model approach:

| Use Case | Model | Rationale |
|----------|-------|-----------|
| Bulk V3 analysis (top 400+) | Claude Sonnet | Cost-effective, ~$1/100 patents |
| Sector-specific deep analysis | Claude Opus | Higher quality, product focus |
| Ad-hoc attorney queries | Claude Sonnet | Quick turnaround |
| Litigation grouping analysis | Claude Opus | Nuanced legal analysis |

**Implementation:** Add `--model opus` flag to `run-llm-analysis-v3.ts` for model selection.

---

*Session ended: 2026-01-18*
*Bubble zone job running at 55/130 (~42%) - check completion next session*

---

### Session Update: 2026-01-18 (Continuation) - Web Search Integration & Recalibration Design

**Major Accomplishments:**

1. **Bubble Zone Job Complete** ✅
   - All 130 patents analyzed
   - Combined with prior V3 data: 380 patents total with V3 LLM analysis
   - Fixed export scripts to merge all combined-v3 files

2. **Top 250 Recalculated with Complete Data** ✅
   - 100% LLM v3 coverage (250/250)
   - 99% IPR risk data (248/250)
   - 89% prosecution data (222/250)
   - Output: `output/unified-top250-v2-2026-01-18.csv`

3. **Web Search Integration Designed** ✅
   - Created `docs/WEB_SEARCH_RECALIBRATION_DESIGN.md`
   - WebSearch tool confirmed working (demonstrated with video-codec sector)
   - Pipeline: Patent → Sector LLM → Web Search → Products → Recalibration

4. **Sector-Specific Facets Configuration Created** ✅
   - Created `config/sector-facets.json`
   - 14 sectors with custom facets
   - Facet types: licensing_friction, standards_relevance, hardware_boost, etc.
   - Formula: `SectorScore = BaseScore × DamagesTier × FacetMultiplier`

**Web Search Capability Confirmed:**
- WebSearch tool available in Claude Code
- Demonstrated on video-codec sector:
  - Market size: $2.5B (15% CAGR)
  - Key players: AMD MA35D, NETINT, Bitmovin, AWS Elemental
  - Insight: 61% of mid-size platforms cite licensing fees as barrier

**Scripts Updated:**
| Script | Change |
|--------|--------|
| `scripts/export-raw-metrics-csv.ts` | Merges ALL combined-v3 files |
| `scripts/calculate-unified-top250-v2.ts` | Merges ALL combined-v3 files |

**New Files Created:**
| File | Purpose |
|------|---------|
| `docs/WEB_SEARCH_RECALIBRATION_DESIGN.md` | Full web search integration architecture |
| `config/sector-facets.json` | Sector-specific scoring adjustments |

**Current Data State:**
| Data | Count | Coverage |
|------|-------|----------|
| Total patents | 10,276 | 100% |
| V3 LLM analysis | 380 | 3.7% |
| Top 250 V3 | 250 | 100% |
| IPR risk (top 250) | 248 | 99% |
| Prosecution (top 250) | 222 | 89% |

**Top 5 Patents (V2 Scoring):**
| Rank | Patent | Score | Key Competitor |
|------|--------|-------|----------------|
| 1 | 9569605 | 50.3% | Apple (67 cites) |
| 2 | 10200706 | 46.0% | ByteDance (20 cites) |
| 3 | 11516311 | 42.5% | Amazon, Comcast |
| 4 | 11425134 | 42.4% | Microsoft |
| 5 | 11882300 | 41.1% | Video codec (no cites) |

---

## Portfolio Workstation Integration Notes

This project is positioned to merge into a larger portfolio workstation effort:

1. **Web Search → Product Discovery**: Ready for implementation
2. **Sector Facets**: Configurable scoring adjustments per sector
3. **Recalibration Pipeline**: Feedback loop for damages/risk tuning
4. **GUI Design**: Spec complete (`docs/GUI_DESIGN_SPEC.md`)
5. **Vendor Integration**: Patlytics, claim chart partners

---

## Next Session Tasks

### Priority 1: Implement Product Discovery Script

```bash
# Create script to discover products per sector
npx tsx scripts/discover-sector-products.ts video-codec
```

### Priority 2: Test Opus for Sector-Specific Analysis

```bash
# Test higher-quality sector-specific prompts
npx tsx scripts/run-sector-llm.ts --sector video-codec --model opus
```

### Priority 3: Recalibration Workflow

1. Run market data collection for top sectors
2. Compare against current damages tiers
3. Generate recalibration recommendations

### Quick Commands

```bash
# Export top 250 for Excel
cat output/unified-top250-v2-2026-01-18.csv

# Full raw metrics export
npx tsx scripts/export-raw-metrics-csv.ts

# Start Docker services
npm run docker:up

# Check ES health
npm run es:health
```

---

*Session: 2026-01-18*
*Status: Web search design complete, sector facets configured*
*Next: Implement product discovery, test Opus model*

---

### Session Update: 2026-01-18 (Continuation) - Sector-Specific Analysis Implemented

**Major Accomplishments:**

1. **Product Discovery Script Created** ✅
   - `scripts/discover-sector-products.ts`
   - Uses LLM to identify specific products per patent
   - Aggregates by company for vendor handoff
   - Tested on video-codec: Found 27 products from 13 companies (3 patents)

2. **Sector-Specific LLM Service Created** ✅
   - `services/llm-sector-analysis.ts`
   - **Opus model selection** for high-quality analysis
   - Sector-specific prompts with domain expertise
   - Product-focused output for licensing negotiations

3. **Sector Prompts Configured** ✅
   - `video-codec`: HEVC, AV1, streaming focus
   - `cloud-auth`: OAuth, SSO, enterprise IAM
   - `rf-acoustic`: BAW/FBAR, 5G, RF filters
   - `network-threat-protection`: EDR, SIEM, firewalls

4. **Video-Codec Analysis Running** 🔄
   - 20 patents with Opus model
   - Progress: `tail -f output/sector-analysis/video-codec/run-2026-01-18.log`
   - Expected duration: ~15 minutes

**New Scripts Created:**
| Script | Purpose |
|--------|---------|
| `scripts/discover-sector-products.ts` | Web search → Product discovery |
| `scripts/run-sector-analysis.ts` | Sector-specific LLM runner |
| `services/llm-sector-analysis.ts` | Opus/Sonnet model service |

**Test Results (video-codec, 3 patents, Opus):**
- Products found: 22
- Unique companies: 12
- Top companies: NVIDIA (3), AWS (3), Samsung (3), Apple (2)
- Average eligibility score: 5.0
- Average confidence: 4.0

**Sample Product Identification (Patent 10200706):**
| Product | Company | Relevance |
|---------|---------|-----------|
| NVIDIA T4 Tensor Core GPU | NVIDIA | Pipelined NVDEC hardware decoder |
| Apple TV 4K (3rd gen) | Apple | A15 Bionic with hardware decoder |
| AWS Elemental MediaConvert | AWS | Cloud transcoding with pipelined decode |
| Samsung QN90C Neo QLED TV | Samsung | Neural processor with AV1/HEVC decode |
| AMD Alveo U30 | AMD | Dedicated transcoding card |

---

## Commands for Monitoring

```bash
# Check video-codec analysis progress
tail -f output/sector-analysis/video-codec/run-2026-01-18.log

# View completed results
cat output/sector-analysis/video-codec/video-codec-analysis-2026-01-18.json | jq '.analyses | length'

# Run on other sectors
npx tsx scripts/run-sector-analysis.ts cloud-auth --model opus --limit 10
npx tsx scripts/run-sector-analysis.ts rf-acoustic --model opus --limit 10

# List available sectors
npx tsx scripts/run-sector-analysis.ts --list
```

---

### Session Update: 2026-01-18 (Late) - Sector Analyses Complete + Excel Import Fix

**Major Accomplishments:**

1. **Sector Analyses Completed** ✅
   - **video-codec**: 20 patents → 152 products, 25 companies (COMPLETE)
   - **cloud-auth**: 20 patents → 158 products, 39 companies (COMPLETE)
   - **network-threat-protection**: 9 patents → 70 products, 32 companies (COMPLETE)
   - **rf-acoustic**: 1 patent → 8 products (limited data in top250) (COMPLETE)
   - **network-switching**: 15 patents → RUNNING

2. **Excel Import Convention Standardized** ✅
   - Created `scripts/export-top250-for-excel.ts`
   - Exports to `excel/TOP250-YYYY-MM-DD.csv` with consistent naming
   - Also creates `excel/TOP250-LATEST.csv` fallback
   - Updated `excel/PatentAnalysisMacros.bas` with new `ImportTop250()` function
   - VBA auto-detects today's date-based file

3. **Fixed LLM V3 Data Loading** ✅
   - Export scripts now merge ALL combined-v3 files (380 total analyses)
   - Previously only loaded most recent file (130 analyses)

4. **Fixed Sector Patent Lookup** ✅
   - Script now looks up patents from detailed sector assignment files
   - Maps `output/sectors/all-patents-sectors-v2-*.json` which has granular sectors
   - Enriches with multi-score data for full patent records

**Sector Analysis Results Summary:**

| Sector | Patents | Products | Companies | Avg Eligibility | Avg Confidence |
|--------|---------|----------|-----------|-----------------|----------------|
| video-codec | 20 | 152 | 25 | 4.6 | 3.9 |
| cloud-auth | 20 | 158 | 39 | 3.9 | 3.5 |
| network-threat-protection | 9 | 70 | 32 | 4.3 | 3.9 |
| rf-acoustic | 1 | 8 | 4 | 4.0 | 4.0 |

**Top Companies by Sector:**

- **video-codec**: NVIDIA (10), Samsung (9), AWS (8), Apple (8), Google (7)
- **cloud-auth**: Microsoft (13), Google (9), Okta (7), AWS (7), Ping Identity (6)
- **network-threat-protection**: Palo Alto Networks (8), Microsoft (8), CrowdStrike (6), Fortinet (4)
- **rf-acoustic**: Qualcomm (2), Qorvo (2), Skyworks (2), Murata (2)

**New/Modified Scripts:**
| Script | Purpose |
|--------|---------|
| `scripts/export-top250-for-excel.ts` | Standardized Excel export |
| `scripts/run-sector-analysis.ts` | Updated to use sector assignment files |
| `excel/PatentAnalysisMacros.bas` | New ImportTop250() function |

**Output Files Created:**
| File | Description |
|------|-------------|
| `output/sector-analysis/video-codec/video-codec-analysis-2026-01-18.json` | Full analysis |
| `output/sector-analysis/cloud-auth/cloud-auth-analysis-2026-01-18.json` | Full analysis |
| `output/sector-analysis/network-threat-protection/network-threat-protection-analysis-2026-01-18.json` | Full analysis |
| `output/sector-analysis/rf-acoustic/rf-acoustic-analysis-2026-01-18.json` | Full analysis |
| `excel/TOP250-2026-01-18.csv` | Excel-ready export |

**Key Insight: Sector Name Schema Differences**

The unified-top250 files use **broader sector names** (e.g., "network-security" with 96 patents), while the sector assignment files (`output/sectors/all-patents-sectors-v2-*.json`) have **granular sectors** (e.g., "network-switching" with 1,071 patents). The sector analysis script now handles this by:
1. First checking unified-top250 for the requested sector
2. If not found, looking up patent IDs from the detailed sector assignment file
3. Enriching those patents with data from multi-score analysis

---

## Quick Commands

```bash
# Export top 250 for Excel (new standardized format)
npx tsx scripts/export-top250-for-excel.ts

# Run sector analysis
npx tsx scripts/run-sector-analysis.ts <sector> --model opus --limit 15

# List available sectors
npx tsx scripts/run-sector-analysis.ts --list

# Check analysis progress
tail -f output/sector-analysis/<sector>/run-2026-01-18.log

# View analysis results
cat output/sector-analysis/<sector>/<sector>-analysis-2026-01-18.json | jq '.summary'
```

---

### Session Update: 2026-01-18 (Continuation) - V3 Stakeholder Voting Model Complete

**Major Accomplishments:**

1. **V3 Stakeholder Voting Profiles Implemented** ✅
   - Created scoring framework where different stakeholders (attorneys, executives) can weight patents differently
   - All profiles must hit **93-99% citation coverage** as baseline actionability requirement
   - Framework ready for sector-specific signals in future

2. **6 Stakeholder Profiles Calibrated** ✅
   All profiles pass goalposts (93-99% citation coverage, 6-14 avg years):

   | Profile | Citation % | Avg Years | Description |
   |---------|-----------|-----------|-------------|
   | IP Litigator (Aggressive) | 98% | 8.2 | High risk tolerance, infringement-focused |
   | IP Litigator (Balanced) | 97% | 8.2 | Standard IP litigation approach |
   | IP Litigator (Conservative) | 94% | 8.6 | Strong validity, lower risk |
   | Licensing Specialist | 98% | 7.5 | Portfolio value, market signals |
   | Corporate/M&A | 96% | 7.4 | Strategic alignment, deal signals |
   | Executive/Portfolio | 94% | 8.3 | Balanced view across all factors |

3. **Hybrid Multiplicative/Additive Scoring Model** ✅
   - **Overall Score = Factor1 × Factor2 × Factor3 × Factor4**
   - Each factor is additive: `FactorX = weight1*metric1 + weight2*metric2 + floor`
   - Multiplicative combination ensures weakness in any area significantly reduces score
   - Prevents single strong factor from dominating (e.g., high citations but weak legal)

4. **Key Scoring Innovations**
   - **Tiered Continuous Normalization**: Citations normalized with tiers (0→0.005, 1-3→0.15-0.50, etc.)
   - **Stepped Year Treatment**: 10+ yrs = 1.0, 5-7 yrs = 0.60, 3-4 yrs = 0.25
   - **Low Floor for Zero Citations**: Patents with 0 competitor citations get near-zero market evidence score
   - **Quality Factor**: Combines eligibility + validity scores for legal strength

5. **V3 Export Script Created** ✅
   - New script: `scripts/calculate-and-export-v3.ts`
   - Exports 3 files:
     - `excel/TOP250-YYYY-MM-DD.csv` - Top 250 with all profile scores + consensus
     - `output/all-patents-scored-v3-YYYY-MM-DD.csv` - All patents raw data
     - `output/unified-top250-v3-YYYY-MM-DD.json` - Full JSON with details
   - Also creates `excel/TOP250-LATEST.csv` fallback

**Key Patent Insight: 9569605 (67 Apple Citations)**
- Despite 67 competitor citations (highest in portfolio), ranks lower in Conservative profile
- Reason: Software method patent with eligibility_score=3, validity_score=3
- The multiplicative model correctly penalizes weak legal factors
- Ranks #2-3 in Aggressive profile but #5 in Conservative - model working as intended

**New/Modified Files:**
| File | Purpose |
|------|---------|
| `scripts/scoring-test-harness.ts` | V1 harness - initial testing |
| `scripts/scoring-test-harness-v2.ts` | V2 harness - attorney configs |
| `scripts/scoring-test-harness-v3.ts` | V3 harness - final stakeholder profiles |
| `scripts/calculate-and-export-v3.ts` | V3 export script for Excel/raw data |

**V3 Export Results (Top 10 by Consensus):**
```
 1. 9609499 Consensus: 24.3 CC:10 Yrs:8.2 (Comcast)
 2. 9569605 Consensus: 21.1 CC:67 Yrs:8.1 (Apple)
 3. 9961618 Consensus: 20.9 CC:8 Yrs:9.3 (Apple)
 4. 10200706 Consensus: 19.8 CC:20 Yrs:10.1 (ByteDance)
 5. 9907015 Consensus: 19.6 CC:5 Yrs:9.1 (Microsoft, Apple)
 6. 9667370 Consensus: 17.7 CC:3 Yrs:8.4 (Amazon, Apple)
 7. 10206084 Consensus: 16.9 CC:2 Yrs:10.1 (Amazon, Apple)
 8. 9503860 Consensus: 16.8 CC:8 Yrs:7.9 (Amazon)
 9. 9781602 Consensus: 16.5 CC:5 Yrs:8.7 (Amazon, Google)
10. 9294662 Consensus: 16.1 CC:22 Yrs:7.2 (Google)
```

---

## NEXT SESSION: Resume Here

### Pending Tasks (Prioritized)

1. **Abstract Prompts to Config Files** (HIGH)
   - Create `sector-prompts/` directory structure
   - Move LLM prompts from inline code to YAML/JSON config files
   - Enable per-sector prompt customization
   - Support prompt versioning for A/B testing

2. **Citation Overlap Report** (HIGH)
   - Create report showing patents grouped by common citators
   - Purpose: Identify "patent families" for litigation packaging
   - Output: Which patents are cited together by same competitor patents
   - Helps identify which of our patents to assert together

3. **Continue Sector Analysis** (MEDIUM)
   - network-switching was running, verify completion
   - Consider additional sectors: drm-content-protection, adaptive-streaming

### Quick Commands

```bash
# Export V3 stakeholder scores
npx tsx scripts/calculate-and-export-v3.ts

# Run scoring test harness
npx tsx scripts/scoring-test-harness-v3.ts

# Export for Excel (legacy, now use V3)
npx tsx scripts/export-top250-for-excel.ts

# Run sector analysis
npx tsx scripts/run-sector-analysis.ts <sector> --model opus --limit 15
```

---

*Session: 2026-01-18 (continuation)*
*Status: V3 stakeholder voting model complete, exports working*
*Next: Abstract prompts to config, citation overlap report*

---

### Session Update: 2026-01-18 (Continuation) - Excel V3.1 + Co-Citation Report

**Major Accomplishments:**

1. **Excel VBA Macro Updated to V3.1** ✅
   - 6 stakeholder profiles with adjustable weights
   - **Macro-based calculation** (not formulas) - fixes #VALUE! errors
   - **`RecalculateAll()`** macro - recalculates and re-sorts after weight changes
   - Auto-detects `TOP250-YYYY-MM-DD.csv` by today's date
   - Removed `Attribute VB_Name` line that caused compile issues

2. **Co-Citation Report Created** ✅
   - New script: `scripts/generate-cocitation-report.ts`
   - Groups patents by common citators for litigation packaging
   - Found **37 clusters** from **97 patents**
   - **412 competitor patents** cite 2+ Broadcom patents
   - Output: `output/cocitation-clusters-2026-01-18.json`, `excel/COCITATION-CLUSTERS-2026-01-18.csv`

**High-Value Litigation Bundles (all patents in top 250):**

| Cluster | Patents | Target | Theme |
|---------|---------|--------|-------|
| #3 | 5 | Microsoft | Malware/ransomware detection |
| #8 | 3 | Amazon | Access control policies |
| #9 | 3 | Amazon | Content/backup handling |
| #10 | 3 | Microsoft | Network security |

**Example Cluster #3 (Microsoft Ransomware Bundle):**
- Patents: 10262137, 8484737, 9189629, 9679134, 9838405
- All 5 in top 250
- 6 Microsoft patents cite multiple in cluster (ransomware detection, malware remediation)

**Company Summary (across all clusters):**
- Microsoft: 14 clusters, 75 citator patents
- Amazon: 8 clusters, 143 citator patents
- Apple: 5 clusters, 54 citator patents
- Google: 5 clusters, 43 citator patents

**New/Modified Files:**

| File | Purpose |
|------|---------|
| `excel/PatentAnalysisMacros.bas` | V3.1 - macro-based scoring with RecalculateAll |
| `scripts/generate-cocitation-report.ts` | Co-citation cluster analysis |
| `output/cocitation-clusters-2026-01-18.json` | Full cluster data |
| `excel/COCITATION-CLUSTERS-2026-01-18.csv` | Cluster summary for Excel |

---

## NEXT SESSION: Resume Here

### Pending Tasks (Prioritized)

1. **Abstract Prompts to Config Files** (HIGH)
   - Create `sector-prompts/` directory structure
   - Move LLM prompts from inline code to YAML configs
   - Enable per-sector prompt customization
   - Support future GUI editing of prompts

2. **Sector-Specific Scoring** (MEDIUM)
   - Develop within-sector scores using sector-specific metrics
   - Potentially normalize across sectors
   - Could factor into overall top 250 ranking

3. **Continue Sector Analysis** (MEDIUM)
   - Additional sectors: drm-content-protection, adaptive-streaming

### Quick Commands

```bash
# Export V3 stakeholder scores (for Excel)
npx tsx scripts/calculate-and-export-v3.ts

# Generate co-citation report
npx tsx scripts/generate-cocitation-report.ts --min-overlap 2

# Run sector analysis
npx tsx scripts/run-sector-analysis.ts <sector> --model opus --limit 15
```

### Excel Workflow

1. Run: `npx tsx scripts/calculate-and-export-v3.ts`
2. Open Excel workbook in `excel/` folder
3. Import module from `PatentAnalysisMacros.bas`
4. Run macro: `ImportTop250()`
5. Adjust weights in `UserWeights` sheet
6. Run macro: `RecalculateAll()` to update scores and re-sort

---

*Session: 2026-01-18*
*Status: Excel V3.1 with RecalculateAll, Co-citation report complete*
*Next: Prompt abstraction to config files, sector-specific scoring*
