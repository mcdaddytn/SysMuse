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

*Document updated: 2026-01-17 (late night)*
*Config version: 4.0 with all cluster strategies*
*Categories: 16 | Companies: 90 | Strategies: 13*
*ElasticSearch: 22,706 patents indexed*
*PostgreSQL: User preferences seeded (6 profiles, 12 sectors)*
*Avago A/V Mining: 70% complete (625/923 patents)*
