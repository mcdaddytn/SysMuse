# Patent Portfolio Analysis - Session Context (2026-01-26, Session 14)

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

### Enrichment Coverage (as of Session 14)

| Data Source | Count | Coverage (3yr+ active) | Change |
|-------------|-------|----------------------|--------|
| **LLM total** | **8,269** | 38% | +500 (batch complete) |
| **IPR risk scores** | **5,000** | 23% | Target reached |
| **Prosecution scores** | **4,052** | 19% | +1,575 from Session 13 |
| **Citation classification** | 28,913 | 100% | — |
| **Forward citations** | 28,014 | 97% | — |
| **Backward citations (parents)** | **4,852** | 22% | +2,773 from Session 13 |

### Background Jobs Status (Session 13 — Complete)
- **LLM analysis**: 8,269 cached (500 batch from Session 13 **complete**)
- **IPR enrichment**: **5,000 done** (target reached)
- **Prosecution enrichment**: 4,052 done (progressing, was 2,477)
- **Patent family enrichment**: 4,852 parents cached (progressing, was 2,079)

### Elasticsearch Index

| Metric | Value |
|--------|-------|
| **Documents Indexed** | **28,913** |
| Index Size | ~25 MB |
| Abstracts Indexed | **28,869 (99.8%)** |
| **Sector Fields** | **NEW — primary_sector + super_sector indexed** |
| Super-Sector Distribution | Virtualization 6,946 / SDN 5,627 / Semiconductor 3,748 / Computing 3,498 / Wireless 3,323 / Security 3,182 / Video 1,584 / Imaging 718 / Audio 193 / AI 94 |

---

## Changes Completed This Session (Session 14)

### Search Scope for Focus Areas — Full Stack Implementation

Implemented search scope as a first-class concept on focus areas, enabling sector-constrained search term evaluation with meaningful selectivity ratios.

#### Elasticsearch — Sector Fields Added

**Index Mapping** (`services/elasticsearch-service.ts`):
- Added `primary_sector` and `super_sector` as keyword fields in `PatentDocument` interface and index mapping
- Added filter support: `primary_sector`, `super_sector` (single or array), `patent_ids` (for focus area intersection)
- All filters work natively in ES bool queries

**Import Script** (`services/import-to-elasticsearch.ts`):
- Added `sector-mapper` import for `getPrimarySector()` and `getSuperSector()`
- Each patent now indexed with computed `primary_sector` and `super_sector` from CPC codes
- Re-indexed full portfolio: 28,913 patents with sector data

#### Database Schema — Search Scope Fields

**Prisma Schema** (`prisma/schema.prisma`):
- Added `SearchScopeType` enum: `PORTFOLIO`, `SECTOR`, `SUPER_SECTOR`, `COMPOUND`, `PATENT_FAMILY`
- Added `searchScopeType` and `searchScopeConfig` (JSON) to `FocusArea` model
- Added `hitCountScope` to `SearchTerm` model
- Migration applied via `prisma db push`

#### Backend API — Scoped Search Preview

**Focus Area Routes** (`src/api/routes/focus-areas.routes.ts`):

New endpoint:
- `GET /api/focus-areas/scope-options` — Returns available sectors and super-sectors with patent counts from ES aggregation

Updated endpoints:
- `POST /api/focus-areas/search-preview` — Now supports full scope filtering:
  - `scopes.sectors[]` — Filter by one or more primary sectors
  - `scopes.superSectors[]` — Filter by one or more super-sectors
  - `scopes.focusAreaId` — Intersect with focus area patents (uses ES `ids` filter, no more 10,000-hit memory scan)
  - Returns `hitCounts.scope` (hits in scope) and `scopeTotal` (total patents in scope)
  - Sample hits now drawn from scoped results when scope is active
- `POST /api/focus-areas` — Accepts `searchScopeType` and `searchScopeConfig`
- `PUT /api/focus-areas/:id` — Accepts `searchScopeType` and `searchScopeConfig`

Route ordering fix: `/scope-options` moved before `/:id` to prevent Express parameterized route capture.

#### Frontend — Scope Selector UI

**API Types** (`frontend/src/services/api.ts`):
- Added `SearchScopeType`, `SearchScopeConfig`, `ScopeOption`, `ScopeOptions` types
- Updated `FocusArea` interface with `searchScopeType` and `searchScopeConfig`
- Updated `SearchTerm` with `hitCountScope`
- Updated `SearchPreviewResult` with `hitCounts.scope` and `scopeTotal`
- Updated `searchApi.previewSearchTerm()` to accept `sectors[]` and `superSectors[]`
- Added `searchApi.getScopeOptions()` method

**Focus Area Detail Page** (`frontend/src/pages/FocusAreaDetailPage.vue`):
- **Scope chip** in header metadata: Shows active scope (e.g., "Scope: Security"), clickable to configure
- **Scope configuration dialog**: Select scope type (Portfolio / Super-Sector / Sector), toggle sectors/super-sectors from ES aggregation with patent counts
- **Scope-aware search preview**: Search terms evaluated against scope, showing Portfolio / Scope / Focus Area hit counts
- **Selectivity ratio uses scope**: Focus ratio now computes `focusArea / scope` when scope is active (instead of `focusArea / portfolio`)
- **Scoped sample hits**: Preview shows hits from within scope when active

**Verified Results** (manual testing):
- "authentication" KEYWORD: Portfolio 648 / Security scope 495 (out of 3,182) — 15.6% of security patents
- "authentication token" KEYWORD_AND: Portfolio 752 / (network-auth-access + network-crypto) scope 333 (out of 1,087) — 30.6%
- Scope options endpoint returns all ~40 sectors and ~10 super-sectors with counts

### Design Documentation — Focus Area Reconciliation and Extended Families

#### FOCUS_AREA_SYSTEM_DESIGN.md — New Section: "Focus Area as Reconciliation Point"
- Focus area as reconciliation between grouping methods (explicit selection, search scope, search terms, patent family, category overlay)
- Focused vs adjacent patents: focused = selected/matched, adjacent = in scope but not focused
- Patent set operations: DIFF, INTERSECT, UNION, COMPLEMENT with API design
- Workflow for reconciling patent sets across different qualifiers
- Search scope as semantic context (selectivity signal, adjacent pool, cross-scope portability, family constraint)

#### PATENT_FAMILIES_DESIGN.md — New Section: "Extended Family Model"
- Diatomic family concept: three-generation unit (parents → self → children) analogous to two bonded nuclei
- Extended family (cousins, 2nd cousins) via lateral expansion from siblings
- Generational preference: favor newer patents for selection, retain older/expired as connectors
- Category-constrained expansion using sectors, focus groups, CPC codes, boolean combinations
- Recursive focus area scoping (focus areas as search scopes for new focus areas)
- Cross-category family example: financial transactions + wireless + security convergence
- Family-to-focus-area conversion with scope overlay

---

## Changes Completed Session 13 (Previous)

### Background Enrichment Jobs Queued

Kicked off three long-running enrichment jobs to fill in portfolio data:
1. **LLM V3 Analysis**: 500 additional patents (top-ranked without LLM data) — **COMPLETE**
2. **Prosecution History**: 2,525 remaining patents to reach 5,000 target — **4,052 done (progressing)**
3. **Patent Family Parents**: ~3,000 additional backward citations — **4,852 done (progressing)**

### Citation-Aware Scoring — Implemented

Implemented weighted citation scoring across the full stack:
- `adjusted_forward_citations`: competitor×1.5, neutral×1.0, affiliate×0.25
- `competitor_density`: competitor/(competitor+neutral) ratio
- All 6 scoring profiles updated
- VMware self-citation inflation addressed (16.5% → weighted down)

### Design Documentation — Three New Sections in DESIGN_CONSIDERATIONS.md
1. Competitor Classification — Formal Criteria
2. Citation-Aware Scoring Design
3. Conditional Facets — Sector-Specific LLM Questions via Facet System

---

## GUI Development Status

### Backend API Server (Port 3001)

```bash
npm run api:dev
```

**Endpoints:**
| Endpoint | Description |
|----------|-------------|
| `GET /api/patents` | List with filters/pagination (enriched with citation + LLM data) |
| `GET /api/patents/:id` | Full patent details (+ abstract + LLM data from cache) |
| `GET /api/patents/:id/preview` | Lightweight preview (+ abstract + citation data) |
| `POST /api/patents/batch-preview` | Batch preview (+ abstracts + citation data) |
| `GET /api/patents/:id/citations` | Forward citations + classification breakdown + in_portfolio flag |
| `GET /api/patents/:id/backward-citations` | Parent patents from cache + in_portfolio flag |
| `GET /api/patents/:id/prosecution` | Prosecution history from cache |
| `GET /api/patents/:id/ptab` | PTAB/IPR data from cache |
| `GET /api/patents/:id/llm` | Full LLM analysis (scores + text + classification) |
| `GET /api/patents/cpc-descriptions` | CPC code descriptions (optional `?codes=` filter) |
| `GET /api/patents/affiliates` | List affiliates with counts |
| `GET /api/patents/super-sectors` | List super-sectors with counts |
| `GET /api/patents/primary-sectors` | List 42 primary sectors with counts |
| `GET /api/patents/assignees` | List raw assignees with counts |
| `GET /api/scores/v2` | v2 scoring (includes affiliate + competitor_citations) |
| `GET /api/scores/v3` | V3 scored rankings (profile, page, limit, sector, minScore) |
| `GET /api/scores/profiles` | List 6 scoring profiles with weights |
| `GET /api/scores/sectors` | Sector rankings with damages tiers (profile, topN) |
| `POST /api/scores/reload` | Clear ALL caches (scoring + patent + LLM + CPC) |
| `GET /api/scores/stats` | LLM/IPR/prosecution coverage statistics |
| `GET/POST /api/focus-areas` | Focus area CRUD |
| `GET /api/focus-areas/scope-options` | **NEW** Available sectors/super-sectors with patent counts |
| `POST /api/focus-areas/search-preview` | **Updated** Search term hit preview with scope filtering |
| `POST /api/focus-areas/extract-keywords` | Keyword extraction |
| `GET/POST /api/focus-groups` | Focus group CRUD |
| `POST /api/focus-groups/:id/formalize` | Convert to focus area |

### Frontend App (Port 3000)

```bash
cd frontend && npm run dev
```

**Pages:**
| Page | Route | Status |
|------|-------|--------|
| `PortfolioPage.vue` | `/` | Complete — LLM scores + text columns |
| `PatentDetailPage.vue` | `/patent/:id` | Complete — LLM tab, backward citations, CPC tooltips |
| `V2ScoringPage.vue` | `/v2-scoring` | Complete |
| `V3ScoringPage.vue` | `/v3-scoring` | Complete |
| `SectorRankingsPage.vue` | `/sectors` | Complete |
| `FocusAreasPage.vue` | `/focus-areas` | Complete |
| `FocusAreaDetailPage.vue` | `/focus-areas/:id` | **Updated** — Scope selector, scoped search preview |

---

## Known Issues / Next Session TODO

### Immediate (Session 15)
- [ ] Check prosecution and patent family enrichment completion (may be done by now)
- [ ] Backfill 2,669 older patents with full V3 analysis (they only have 5 numeric scores, no text fields)
- [ ] **Patent set operations** — Implement DIFF/INTERSECT/UNION between focus area, search results, and family sets (design complete in FOCUS_AREA_SYSTEM_DESIGN.md)
- [ ] **Search term selectivity tracking** — Persist hit counts (portfolio, scope, focusArea) on SearchTerm records
- [ ] Confirm batches 3-4 vendor submission status
- [ ] Generate batches 5-10 with affiliate diversity cap

### Medium Priority
- [ ] **Patent family builder** — Basic construction from cached backward citation data (see PATENT_FAMILIES_DESIGN.md extended family section)
- [ ] **Dynamic columns based on sector** — conditional facet visibility (designed Session 13)
- [ ] Integrate sector-specific LLM analysis into cache pipeline
- [ ] **Formalize competitor promotion in GUI** — auto-suggest + manual promote
- [ ] Add remaining LLM scores to V3 scoring profile weights

### Design Backlog
- [ ] **Patent family expansion UI** — Category-constrained expansion with diatomic family visualization
- [ ] **Focus area set operations UI** — Diff/merge/union dialogs with preview
- [ ] **Bulk LLM Analysis Queuing** — Request from UI, queue management, cost estimation
- [ ] Vendor Data tab integration (Patlytics batch results)
- [ ] **Sector-specific LLM pipeline** — Decoupled second-pass for sector questions
- [ ] **Competitor confidence levels** — Continuous 0-1 scoring

---

## Quick Start for Next Session

```bash
# 1. Start infrastructure
docker compose up -d

# 2. Verify ES data (should include sector fields)
npx tsx services/elasticsearch-service.ts stats
# Should show: Documents: 28913

# 3. Check enrichment completion
echo "LLM: $(ls cache/llm-scores/*.json | wc -l)"
echo "IPR: $(ls cache/ipr-scores/*.json | wc -l)"
echo "Prosecution: $(ls cache/prosecution-scores/*.json | wc -l)"
echo "Patent Family Parents: $(ls cache/patent-families/parents/*.json | wc -l)"

# 4. Start backend + frontend
npm run api:dev
cd frontend && npm run dev

# 5. Reload scores (picks up new enrichment data)
curl -X POST http://localhost:3001/api/scores/reload

# 6. Open browser
open http://localhost:3000
```

### Test Features
| Feature | How to Test |
|---------|-------------|
| **Search scope** | Open any Focus Area → click "Scope: Portfolio" chip → select super-sector/sectors → save → search terms now filtered |
| **Scoped preview** | Focus Area → Search Terms tab → Add Term → type query → click Search → see Portfolio/Scope/Focus Area counts |
| **Scope options** | `curl http://localhost:3001/api/focus-areas/scope-options` — returns sectors with counts |

---

## Design Documents

| Document | Purpose |
|----------|---------|
| `docs/FOCUS_AREA_SYSTEM_DESIGN.md` | Focus Area lifecycle, search scope, reconciliation point, set operations, word count grid, LLM jobs |
| `docs/PATENT_FAMILIES_DESIGN.md` | Patent families, diatomic family, extended family with category-constrained expansion, citation counting |
| `docs/FACET_SYSTEM_DESIGN.md` | Facet terminology, scoring as facets, focus area-specific facets |
| `docs/GUI_DESIGN.md` | GUI architecture, portfolio grid, scoring views, sector rankings |
| `docs/DEVELOPMENT_QUEUE.md` | Consolidated prioritized roadmap with dependencies |
| `docs/CITATION_CATEGORIZATION_PROBLEM.md` | Self-citation inflation analysis |
| `docs/DESIGN_CONSIDERATIONS.md` | Vendor integration, batch strategies, citation-aware scoring, conditional facets |

---

*Last Updated: 2026-01-26 (Session 14 — Implemented search scope for focus areas: added primary_sector/super_sector to ES index (28,913 patents re-indexed), SearchScopeType enum and fields in Prisma schema, scoped search preview with sector filtering (native ES filters), scope-options endpoint, scope selector UI in FocusAreaDetailPage with scope-aware selectivity ratios. Added design sections: Focus Area as Reconciliation Point (set operations, focused vs adjacent patents) in FOCUS_AREA_SYSTEM_DESIGN.md; Extended Family Model (diatomic family, category-constrained expansion) in PATENT_FAMILIES_DESIGN.md.)*
