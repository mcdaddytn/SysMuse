# Patent Portfolio Analysis - Session Context (2026-01-26, Session 12)

## Current State Summary

### Portfolio Data

| Metric | Value |
|--------|-------|
| **Unique Patents** | **28,913** |
| Active Patents | 24,668 (85.3%) |
| Active (3+ years) | 21,870 |
| Expired Patents | 4,245 |
| Date Range | 1982-06-29 to 2025-09-30 |
| Status | Complete + Deduplicated |

### Enrichment Coverage (as of Session 12)

| Data Source | Count | Coverage (3yr+ active) | Selection |
|-------------|-------|----------------------|-----------|
| **LLM full V3 analysis** | **5,000** | 23% | All 26 fields (text + scores + classification) |
| **LLM scores only** | **2,669** | 12% | 5 numeric scores (older pipeline) |
| **LLM total** | **7,669** | 35% | Combined |
| **IPR risk scores** | **5,000** | 23% | Top by forward citations (target reached) |
| **Prosecution scores** | **2,475** | 11% | Top by forward citations (still growing) |
| **Citation classification** | 28,913 | 100% | All patents |
| **Forward citations** | 28,014 | 97% | All patents |
| **Backward citations (parents)** | 2,000 | 9% | From patent families pipeline |
| **Parent details** | 11,706 | — | Enriched parent patent info |

### Background Jobs Status
- **LLM analysis**: 7,669 cached; 5,000 now have full V3 fields (all 26 fields restored from combined output)
- **IPR enrichment**: **5,000 done** (target reached)
- **Prosecution enrichment**: 2,475 done (target was 5,000)

### Elasticsearch Index

| Metric | Value |
|--------|-------|
| **Documents Indexed** | **28,913** |
| Index Size | 42 MB |
| Abstracts Indexed | **28,869 (99.8%)** |

---

## Changes Completed This Session (Session 12)

### LLM Data Pipeline Fix — Recovered 14 Dropped Fields

**Root Cause**: `saveLlmScore()` in `run-llm-top-patents.ts` and the `LlmScoreRecord` interface in `import-llm-scores.ts` were cherry-picking only 12 of 26 V3 fields when writing to `cache/llm-scores/`. The LLM prompt generates all 26 fields, and they were present in batch/combined output files, but got stripped at the cache-write layer.

**Dropped fields included**: `prior_art_problem`, `technical_solution` (the 2 key attorney text fields), plus `claim_clarity_score`, `evidence_accessibility_score`, `market_relevance_score`, `trend_alignment_score`, `investigation_priority_score`, `product_types`, `likely_implementers`, `detection_method`, `standards_bodies`, `implementation_complexity`, `claim_type_primary`, `geographic_scope`, `lifecycle_stage`.

#### Fixes Applied

1. **`scripts/run-llm-top-patents.ts`** — `saveLlmScore()` now spreads full analysis object instead of cherry-picking fields
2. **`scripts/import-llm-scores.ts`** — `LlmScoreRecord` interface expanded to all V3 fields; `extractPatentRecords()` preserves all score, string, array, and computed fields
3. **Re-import**: Ran `import-llm-scores.ts` with `--force` on `combined-v3-2026-01-26.json` — 5,000 patents now have all 26+ fields in cache
4. **Backend** (`src/api/routes/patents.routes.ts`):
   - `FullLlmData` interface expanded to all V3 fields
   - `Patent` interface now includes: `llm_prior_art_problem`, `llm_technical_solution`, `claim_clarity_score`, `evidence_accessibility_score`, `trend_alignment_score`, `investigation_priority_score`, `legal_viability_score`, `enforcement_potential_score`, `market_value_score`, plus enum fields (`llm_detection_method`, `llm_implementation_complexity`, `llm_claim_type_primary`, `llm_geographic_scope`, `llm_lifecycle_stage`)
   - Patent list enrichment maps all new fields
   - LLM detail endpoint (`GET /api/patents/:id/llm`) automatically returns all fields (spreads cache data)
5. **Frontend types** (`frontend/src/types/index.ts`): Patent interface expanded with all recovered fields
6. **Frontend store** (`frontend/src/stores/patents.ts`):
   - Scores group: Added `claim_clarity_score`, `evidence_accessibility_score`, `trend_alignment_score`, `investigation_priority_score`, `legal_viability_score`, `enforcement_potential_score`, `market_value_score`
   - LLM Text group: Added `llm_prior_art_problem`, `llm_technical_solution`, `llm_detection_method`, `llm_implementation_complexity`, `llm_claim_type_primary`, `llm_geographic_scope`, `llm_lifecycle_stage`
7. **Frontend PatentDetailPage.vue**:
   - LLM tab: Added Prior Art Problem and Technical Solution text sections alongside AI Summary
   - Quality Scores card: Added Claim Clarity, Evidence Accessibility, Trend Alignment, Investigation Priority
   - Classification card: Added Detection Method, Implementation Complexity, Claim Type, Geographic Scope, Lifecycle Stage, Product Types (chips), Likely Implementers (chips), Standards Bodies (chips)
8. **Frontend PortfolioPage.vue**: Cell templates for all new score columns (1-5 badge) and text columns (truncation + tooltip), composite scores (0-100 badge)

### LLM Question Taxonomy Documentation

Updated `docs/LLM_PATENT_ANALYSIS.md` with comprehensive:
- 5-tier question taxonomy (Attorney Core → Enforcement → Market → Cross-Sector → Sector-Specific)
- All 26 V3 fields inventoried with types and descriptions
- Computed sub-score formulas
- Complete data pipeline documentation (services, scripts, cache structure, data flow)
- Design notes for future question tiering, batching optimization, and UI queuing
- Current coverage breakdown (5,000 full V3 + 2,669 scores-only)

---

## Changes Completed Session 11 (Previous)

### GUI Enhancements — LLM Data Integration

#### 1. LLM Data in Patent List API (patents.routes.ts)
- Patent list endpoint (`GET /api/patents`) now enriches every patent with LLM data from `cache/llm-scores/`
- New fields in response: `has_llm_data`, `llm_summary`, `llm_technology_category`, `llm_implementation_type`, `llm_standards_relevance`, `llm_market_segment`, `eligibility_score`, `validity_score`, `claim_breadth`, `enforcement_clarity`, `design_around_difficulty`, `llm_confidence`, `market_relevance_score`
- Full LLM cache loaded into memory with 5-minute TTL (7,669 patents)

#### 2. LLM Detail Endpoint (NEW)
- **`GET /api/patents/:id/llm`** — Returns full LLM analysis from cache including summary, all scores, classification fields
- Used by the LLM Analysis tab in patent detail page
- Returns `{ cached: false }` when no LLM data exists

#### 3. LLM Analysis Tab — Full Implementation (PatentDetailPage.vue)
- Replaced placeholder with actual data display
- **AI Summary** card — Shows `summary` text
- **Quality Scores** card — All 5 LLM scores + confidence with color-coded badges (green >=4, yellow >=3, red <3)
- **Classification** card — Technology category, implementation type, standards relevance, market segment, market relevance score
- **Source info** footer — Shows data source and import date
- "Not yet available" state for patents without LLM data
- **Test patents**: 10003303 (full data with summary), 8429630 (scores only, older format)

#### 4. Backward Citations Endpoint (NEW)
- **`GET /api/patents/:id/backward-citations`** — Returns parent patents from `cache/patent-families/parents/` and `cache/patent-families/parent-details/`
- Enriches parent patents with: title, assignee, patent_date, affiliate, in_portfolio flag
- 2,000 patents have parent data, 11,706 parent details available

#### 5. Citations Tab — Forward + Backward Citations (PatentDetailPage.vue)
- **Forward Citations** section (existing, enhanced): Now labeled with arrow icon and "(patents that cite this patent)" subtitle
- **Backward Citations** section (NEW): Shows parent patents with:
  - In-portfolio parents are clickable links (deep-purple color)
  - External parents have Google Patents link button
  - Shows patent title, assignee/affiliate, date
- **Citation Breakdown** card updated: Now includes backward citation count alongside forward breakdown
- Backward citations loaded lazily when Citations tab is opened
- **Test patent**: 10749870 — 169 forward citations + 8 backward parents (mostly in portfolio)

#### 6. CPC Code Tooltips (PatentDetailPage.vue)
- CPC code chips in patent detail overview now show description on mouseover
- **`GET /api/patents/cpc-descriptions`** endpoint — Serves CPC code descriptions from `config/cpc-descriptions.json`
- Supports `?codes=G06F21,H04L63` query param for specific codes
- Progressive prefix matching: if exact code not found, tries shorter prefixes (e.g., `G06F21/10` → `G06F21` → `G06F`)
- Descriptions loaded on patent page mount
- 150+ CPC codes mapped

#### 7. Column Group Reorganization (stores/patents.ts, types/index.ts)
- **Old groups**: Core Info, Entity & Sector, Citations & Scores, Attorney Questions, LLM Analysis, Focus Area
- **New groups**: Core Info, Entity & Sector, **Citations**, **Scores**, **LLM Text**, Focus Area
- **Citations group**: Forward citations, competitor/affiliate/neutral citations, competitor count (factual data)
- **Scores group**: Base score, v2, v3, consensus, AND all LLM numeric scores (eligibility, validity, claim_breadth, enforcement_clarity, design_around_difficulty, market_relevance, confidence)
- **LLM Text group**: Summary, technology category, implementation type, standards relevance, market segment
- Removed non-existent columns: `prior_art_problem`, `technical_solution`, `attorney_summary` (these fields were never generated by the LLM pipeline)
- Fixed field name mappings: `design_around` → `design_around_difficulty`, `market_relevance` → `market_relevance_score`

#### 8. Portfolio Grid LLM Score Cell Templates (PortfolioPage.vue)
- All LLM score columns (eligibility, validity, claim_breadth, enforcement_clarity, design_around_difficulty, confidence, market_relevance) show color-coded badges
- LLM summary column has truncation with tooltip
- Shows `--` placeholder for patents without LLM data

#### 9. Cache Reload Enhancement (scores.routes.ts)
- `POST /api/scores/reload` now clears ALL caches: scoring service, patent list, LLM data, CPC descriptions
- Exported `clearPatentsCache()` from patents.routes.ts

### Key Finding: "Prior Art Problem" and "Technical Solution" Fields
- These columns were defined in the UI but **no LLM analysis pipeline ever generated these fields**
- The LLM analysis generates: eligibility_score, validity_score, claim_breadth, enforcement_clarity, design_around_difficulty, confidence, summary, technology_category, implementation_type, standards_relevance, market_segment
- The `summary` field is the closest analog — it describes the patent's technology
- To add prior_art_problem and technical_solution, we would need to update the LLM analysis prompt and re-run analysis
- Columns removed from UI; logged as design consideration for future LLM prompt enhancement

---

## GUI Development Status

### Backend API Server (Port 3001)

```bash
npm run api:dev
```

**Endpoints:**
| Endpoint | Description |
|----------|-------------|
| `GET /api/patents` | List with filters/pagination (enriched with citation + **LLM data**) |
| `GET /api/patents/:id` | Full patent details (+ abstract + LLM data from cache) |
| `GET /api/patents/:id/preview` | Lightweight preview (+ abstract + citation data) |
| `POST /api/patents/batch-preview` | Batch preview (+ abstracts + citation data) |
| `GET /api/patents/:id/citations` | Forward citations + classification breakdown + in_portfolio flag |
| `GET /api/patents/:id/backward-citations` | **NEW** Parent patents from cache + in_portfolio flag |
| `GET /api/patents/:id/prosecution` | Prosecution history from cache |
| `GET /api/patents/:id/ptab` | PTAB/IPR data from cache |
| `GET /api/patents/:id/llm` | **NEW** Full LLM analysis (scores + text + classification) |
| `GET /api/patents/cpc-descriptions` | **NEW** CPC code descriptions (optional `?codes=` filter) |
| `GET /api/patents/affiliates` | List affiliates with counts |
| `GET /api/patents/super-sectors` | List super-sectors with counts |
| `GET /api/patents/primary-sectors` | List 42 primary sectors with counts |
| `GET /api/patents/assignees` | List raw assignees with counts |
| `GET /api/scores/v2` | v2 scoring (includes affiliate + competitor_citations) |
| `GET /api/scores/v3` | V3 scored rankings (profile, page, limit, sector, minScore) |
| `GET /api/scores/profiles` | List 6 scoring profiles with weights |
| `GET /api/scores/sectors` | Sector rankings with damages tiers (profile, topN) |
| `POST /api/scores/reload` | **Updated** Clear ALL caches (scoring + patent + LLM + CPC) |
| `GET /api/scores/stats` | LLM/IPR/prosecution coverage statistics |
| `GET/POST /api/focus-areas` | Focus area CRUD |
| `POST /api/focus-areas/extract-keywords` | Keyword extraction |
| `POST /api/focus-areas/search-preview` | Search term hit preview |
| `GET/POST /api/focus-groups` | Focus group CRUD |
| `POST /api/focus-groups/:id/formalize` | Convert to focus area |

### Frontend App (Port 3000)

```bash
cd frontend && npm run dev
```

**Pages:**
| Page | Route | Status |
|------|-------|--------|
| `PortfolioPage.vue` | `/` | **Updated** — LLM scores + text columns, reorganized column groups |
| `PatentDetailPage.vue` | `/patent/:id` | **Updated** — LLM tab, backward citations, CPC tooltips |
| `V2ScoringPage.vue` | `/v2-scoring` | Complete |
| `V3ScoringPage.vue` | `/v3-scoring` | Complete |
| `SectorRankingsPage.vue` | `/sectors` | Complete |
| `FocusAreasPage.vue` | `/focus-areas` | Complete |
| `FocusAreaDetailPage.vue` | `/focus-areas/:id` | Complete |

---

## Known Issues / Next Session TODO

### Immediate (Session 13)
- [ ] Investigate stalled LLM 2,000 patent job (count unchanged at 7,669 from session 10)
- [ ] Backfill 2,669 older patents with full V3 analysis (they only have 5 numeric scores, no text fields)
- [ ] Resume prosecution enrichment to reach 5,000 target (currently 2,475)
- [ ] Confirm batches 3-4 vendor submission status
- [ ] Generate batches 5-10 with affiliate diversity cap (max 40% VMware per top-ranked batch)

### Medium Priority
- [ ] Incremental ES Indexing
- [ ] Search Term Selectivity Tracking
- [x] ~~LLM prompt enhancement: Add `prior_art_problem` and `technical_solution` fields to analysis prompt~~ — DONE (fields were always in V3 prompt, fixed cache pipeline in Session 12)
- [ ] Dynamic columns based on sector (sector-specific scoring facets)
- [ ] Integrate sector-specific LLM analysis (`services/llm-sector-analysis.ts`) into cache pipeline
- [ ] Add `claim_clarity_score`, `evidence_accessibility_score`, `trend_alignment_score`, `investigation_priority_score` to V3 scoring profile weights

### Design Backlog
- [ ] **Bulk LLM Analysis Queuing**: Request or queue LLM analysis from UI when not present. Multi-select patents and trigger batch LLM analysis. Design needed: queue management, progress tracking, cost estimation
- [ ] Citation tab: "Request Data" button to queue uncached patents for citation fetching
- [ ] Vendor Data tab integration (Patlytics batch results)
- [ ] Batch allocation tracking in the GUI

---

## Quick Start for Next Session

```bash
# 1. Start infrastructure
docker compose up -d

# 2. Verify ES data
npx tsx services/elasticsearch-service.ts stats
# Should show: Documents: 28913

# 3. Check enrichment completion
echo "LLM: $(ls cache/llm-scores/*.json | wc -l)"
echo "IPR: $(ls cache/ipr-scores/*.json | wc -l)"
echo "Prosecution: $(ls cache/prosecution-scores/*.json | wc -l)"

# 4. Start backend + frontend
npm run api:dev
cd frontend && npm run dev

# 5. Reload scores (picks up new enrichment data)
curl -X POST http://localhost:3001/api/scores/reload

# 6. Open browser
open http://localhost:3000
```

### Test Patents for New Features
| Feature | Patent ID | What to see |
|---------|-----------|-------------|
| **Prior Art + Technical Solution** | 10003303 | Full attorney text fields in LLM tab + grid columns |
| **All V3 scores** | 10003303 | Claim Clarity, Evidence Access, Trend Alignment, Investigation Priority |
| **Product types + Implementers** | 10003303 | Chips in LLM detail (RF amplifiers, semiconductor companies) |
| **Composite sub-scores** | 10003303 | Legal Viability (66), Enforcement Potential, Market Value |
| LLM tab (scores only, no text) | 8429630 | Numeric scores only — older pipeline, no text fields |
| Backward citations | 10749870 | 8 parents, most in portfolio |
| Forward citations (rich) | 10749870 | 169 fwd citations, breakdown |
| CPC tooltips | Any | Hover CPC chips for descriptions |
| LLM columns in grid | Enable in Column Selector > Scores / LLM Text | All score badges, text columns |
| Prosecution (smooth) | 10042628 | Score 4/5, 2 OA, timeline |
| PTAB with IPR history | 7203959 | 2 Zscaler petitions |

---

## Design Documents

| Document | Purpose |
|----------|---------|
| `docs/FOCUS_AREA_SYSTEM_DESIGN.md` | Focus Group/Area lifecycle, search scope, word count grid, LLM jobs, sector design |
| `docs/PATENT_FAMILIES_DESIGN.md` | Patent families, generational citation trees, citation counting dimensions, assignee classification |
| `docs/FACET_SYSTEM_DESIGN.md` | Facet terminology, scoring as facets, focus area-specific facets |
| `docs/GUI_DESIGN.md` | GUI architecture, portfolio grid, scoring views, sector rankings |
| `docs/DEVELOPMENT_QUEUE.md` | Consolidated prioritized roadmap with dependencies |
| `docs/CITATION_CATEGORIZATION_PROBLEM.md` | Self-citation inflation analysis |
| `docs/DESIGN_CONSIDERATIONS.md` | Vendor integration, batch strategies |

---

*Last Updated: 2026-01-26 (Session 12 — Fixed LLM data pipeline: 14 of 26 V3 fields were being dropped during cache write. Root cause: saveLlmScore() and import-llm-scores.ts cherry-picked fields instead of preserving full analysis. Fixed both scripts, re-imported 5,000 patents from combined-v3 output. Recovered attorney text fields (prior_art_problem, technical_solution) and 12 additional scores/classification fields. Updated backend API, frontend types/store/pages to expose all recovered fields. Comprehensive LLM question taxonomy documented in docs/LLM_PATENT_ANALYSIS.md with 5-tier structure and future batching/queuing design.)*
