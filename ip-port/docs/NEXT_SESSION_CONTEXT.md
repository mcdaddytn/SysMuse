# Patent Portfolio Analysis Platform - Context for Next Session

## Project Overview

This project provides **patent intelligence services** for analyzing IP portfolios, identifying licensing opportunities, and supporting litigation strategy. The current implementation focuses on analyzing Broadcom's streaming-related patents against major streaming competitors.

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

## Architecture for GUI/Database Integration

### Proposed Service Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Web GUI (React/Next.js)                    │
├─────────────────────────────────────────────────────────────────┤
│                         API Layer (REST/GraphQL)                │
├─────────────────────────────────────────────────────────────────┤
│                      Application Services                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │   Portfolio  │  │   Citation   │  │   Priority/Scoring   │   │
│  │   Manager    │  │   Analyzer   │  │      Engine          │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                      Data Access Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  PostgreSQL  │  │   External   │  │   File/Blob          │   │
│  │  Database    │  │   APIs       │  │   Storage            │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

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

## Tech Stack Compatibility

Current implementation is **TypeScript/Node.js** and designed to integrate with:

- **Frontend**: React, Next.js, Vue
- **Backend**: Express, Fastify, Next.js API routes
- **Database**: PostgreSQL (recommended), MySQL, MongoDB
- **ORM**: Prisma, TypeORM, Drizzle
- **Deployment**: Vercel, AWS, GCP, Docker

The API clients (`clients/*.ts`) are framework-agnostic and can be imported directly into any Node.js backend.

---

*Document created: 2026-01-15*
*For questions or context, refer to: docs/SESSION_STATUS_2026-01-15.md*
