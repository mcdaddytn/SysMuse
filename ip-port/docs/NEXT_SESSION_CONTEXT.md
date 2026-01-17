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

*Document updated: 2026-01-17 evening*
*Next session: Execute Avago A/V analysis using ElasticSearch term extraction*
*Reference: docs/AVAGO_AV_ANALYSIS_APPROACH.md*
