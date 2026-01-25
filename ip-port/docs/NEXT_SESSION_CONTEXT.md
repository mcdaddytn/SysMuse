# Patent Portfolio Analysis - Session Context (2026-01-25, Session 2)

## Current State Summary

### Portfolio Data

| Metric | Value |
|--------|-------|
| **Unique Patents** | **28,913** |
| Active Patents | 24,668 (85.3%) |
| Expired Patents | 4,245 |
| Date Range | 1982-06-29 to 2025-09-30 |
| Status | Complete + Deduplicated |

### Elasticsearch Index

| Metric | Value |
|--------|-------|
| **Documents Indexed** | **28,913** |
| Index Size | 10.15 MB |
| Abstracts Indexed | 0 (cache only has 1 patent file so far) |
| Status | Fully populated from streaming-candidates |

---

## Changes Completed This Session

### Part A: Elasticsearch Populated with Full Portfolio
- **File:** `services/import-to-elasticsearch.ts`
- Added `importStreamingCandidates()` function that reads `output/streaming-candidates-*.json`
- Maps `patent_title` -> `title`, loads abstracts from `cache/api/patentsview/patent/<id>.json`
- Added `--candidates` CLI flag
- **Run:** `npx tsx services/import-to-elasticsearch.ts --recreate --candidates`
- **Result:** 28,913 patents indexed, search returns results (e.g., "container security" = 1,252 hits)

### Part B: Abstracts Exposed Where Available
- **File:** `src/api/routes/patents.routes.ts`
  - Added `loadAbstract(patentId)` helper reading from `cache/api/patentsview/patent/<id>.json`
  - `GET /api/patents/:id` returns abstract from cache
  - `GET /api/patents/:id/preview` returns abstract in preview
  - `POST /api/patents/batch-preview` returns abstract per patent
- **File:** `frontend/src/types/index.ts` - Added `abstract?: string | null` to `Patent`
- **File:** `frontend/src/services/api.ts` - Added `abstract?: string | null` to `PatentPreview`
- **File:** `frontend/src/pages/PatentDetailPage.vue`
  - Full (non-truncated) title display
  - Abstract card in Overview tab ("Abstract not cached" fallback)
- **File:** `frontend/src/components/PatentPreviewTooltip.vue`
  - 2-line truncated abstract shown in hover tooltip

### Part C: Search Preview Fixed + UX Improvements
- **File:** `src/api/routes/focus-areas.routes.ts`
  - Added `searchFields` parameter to `/search-preview` (`'title'` | `'abstract'` | `'both'`)
  - Maps to `fields` array passed to `esService.search()`
- **File:** `frontend/src/services/api.ts`
  - Added `searchFields` to `searchApi.previewSearchTerm()`
- **File:** `frontend/src/pages/FocusAreaDetailPage.vue`
  - Removed auto-trigger watch on expression/termType
  - Added Search Fields dropdown (Title + Abstract / Title Only / Abstract Only)
  - Added explicit Search button (+ Enter key support)
  - Hit Preview always visible ("Click Search to preview hits" placeholder)
- **File:** `frontend/src/components/KeywordExtractionPanel.vue`
  - Removed auto-trigger watch on combinedExpression
  - Added Search Fields dropdown + "Preview Hits" button
  - Hit Preview section always visible below selected terms

---

## Known Issues / Next Session TODO

### 1. Incremental ES Indexing (Architecture Gap)
**Problem:** Patents are only indexed via bulk CLI command (`npx tsx services/import-to-elasticsearch.ts --candidates`). When patents are incrementally added to the system (e.g., new portfolio downloads, individual patent additions), they are NOT auto-indexed in Elasticsearch.
**Fix needed:** Add ES indexing calls in:
- Patent import/download workflows
- Optionally in `POST /api/focus-areas/:id/patents` (or keep manual via CLI)
- Consider an `esService.indexPatent()` call whenever a new patent appears in the candidates file
- **Priority:** Medium - needed for ongoing operation

### 2. Draft Groups Redirect Default Tab
**Problem:** After creating a Focus Group from PortfolioPage, the app navigates to `/focus-areas` which defaults to the "Focus Areas" tab. The new draft group is in the "Draft Groups" tab, so the user doesn't see it.
**Fix:** In `FocusAreasPage.vue`, either:
- Accept a query param (e.g., `?tab=groups`) and set `activeTab` accordingly
- Or in `PortfolioPage.vue`, navigate to `/focus-areas?tab=groups` after creation
- **File:** `frontend/src/pages/FocusAreasPage.vue` line 13: `const activeTab = ref<'areas' | 'groups'>('areas');`
- **Priority:** High - basic UX issue

### 3. Formalize Button Styling
**Problem:** The "Formalize" button on Draft Groups appears green with a checkmark even before the group has been formalized, implying it's already done.
**Fix:** Change the button to a neutral style (e.g., outline, no check icon). After formalization, the group is removed from the list anyway so the post-formalization state doesn't need a button change.
- **File:** `frontend/src/pages/FocusAreasPage.vue` - find the Formalize button in the draft groups list
- **Priority:** High - confusing UX

### 4. Focus Area Hit Count Shows 0
**Problem:** Hit Preview shows portfolio count but Focus Area count is always 0.
**Root cause analysis:** The backend queries `prisma.focusAreaPatent.findMany()` to get patents in the focus area, then intersects with ES search results. This can legitimately be 0 if:
- The focus area has few patents and none match the search term
- The user is viewing from a Focus Group context (draft groups store patents in `focusGroup.patentIds` JSON array, NOT in `focusAreaPatent` table)
**Fix:** Verify which scenario applies. If viewing formalized focus areas, the count should work when the focus area's patents match the search. If viewing draft groups, need to also support loading patent IDs from `focusGroup.patentIds`.
- **File:** `src/api/routes/focus-areas.routes.ts` lines 810-838
- **Priority:** Medium - investigate actual scenario

### 5. Keyword Extraction: AND vs OR Logic
**Problem:** `KeywordExtractionPanel.vue` combines selected keywords with ` OR ` only. Users expect AND logic (like Google search where all terms must match).
**Fix options:**
- Add an operator toggle (AND / OR) next to the selected terms
- Change `combinedExpression` to use configurable join: `Array.from(selectedTerms.value).join(operator)`
- Consider making AND the default (more intuitive for narrowing results)
- The BOOLEAN term type already supports AND expressions, so the backend is ready
- **File:** `frontend/src/components/KeywordExtractionPanel.vue` line ~41: `combinedExpression` computed
- **Priority:** High - affects search utility

### 6. Abstract Cache Coverage
**Problem:** Only 1 patent abstract is cached (`cache/api/patentsview/patent/10000000.json`). Most patents show "Abstract not cached."
**Fix:** Need to populate the patent abstract cache. Options:
- Batch download abstracts from PatentsView API for all 28,913 patents
- Download on-demand when a patent detail page is viewed
- The portfolio-query cache files (`cache/api/patentsview/portfolio-query/`) may contain abstracts - check if those can be used as an alternative source
- **Priority:** Medium - abstracts are valuable for search but system works without them

---

## Citation Cache Progress

### Current Status

| Batch | Range | Status |
|-------|-------|--------|
| Queue 1-4 | 0-5670 | Complete |
| Gap Fill | 813-1669 | Complete |
| Overnight 1-12 | 5670-17670 | Complete |
| **Total Cached** | **0-17670** | **61% of portfolio** |

**Cache Statistics:**
- API entries: ~35,342
- Size: ~910 MB

### Next Batch to Queue (Final)
```bash
# Queue final batch - will complete 100% portfolio coverage
# Will process remaining 11,243 patents (~10 hours)
./scripts/final-citation-batches.sh
```

---

## GUI Development Status

### Backend API Server (Port 3001)

```bash
npm run api:dev
```

**Endpoints:**
| Endpoint | Description |
|----------|-------------|
| `GET /api/patents` | List with filters/pagination |
| `GET /api/patents/:id` | Full patent details (+ abstract from cache) |
| `GET /api/patents/:id/preview` | Lightweight preview (+ abstract) |
| `POST /api/patents/batch-preview` | Batch preview (+ abstracts) |
| `GET /api/scores/v2` | v2 scoring |
| `GET/POST /api/focus-areas` | Focus area CRUD |
| `POST /api/focus-areas/extract-keywords` | Keyword extraction |
| `POST /api/focus-areas/search-preview` | Search term hit preview (+ searchFields param) |
| `GET/POST /api/focus-groups` | Focus group CRUD |
| `POST /api/focus-groups/:id/formalize` | Convert to focus area |

### Frontend App (Port 3000)

```bash
cd frontend && npm run dev
```

**Pages:**
| Page | Route | Status |
|------|-------|--------|
| `PortfolioPage.vue` | `/` | Complete (+ focus group creation) |
| `PatentDetailPage.vue` | `/patent/:id` | Complete (+ abstract display) |
| `V2ScoringPage.vue` | `/v2-scoring` | Complete |
| `FocusAreasPage.vue` | `/focus-areas` | Complete (needs tab redirect fix) |
| `FocusAreaDetailPage.vue` | `/focus-areas/:id` | Complete (+ search button, field select) |

**Components:**
| Component | Description |
|-----------|-------------|
| `PatentPreviewTooltip.vue` | Hover preview (+ abstract) |
| `KeywordExtractionPanel.vue` | Keyword extraction + explicit search (needs AND/OR toggle) |
| `ColumnSelector.vue` | Column visibility |

---

## Quick Start for Next Session

```bash
# 1. Start Elasticsearch (if not running)
docker compose up -d

# 2. Verify ES has data
npx tsx services/elasticsearch-service.ts stats
# Should show: Documents: 28913, Size: ~10 MB

# 3. If ES empty, re-import
npx tsx services/import-to-elasticsearch.ts --recreate --candidates

# 4. Start backend API
npm run api:dev

# 5. Start frontend (new terminal)
cd frontend && npm run dev

# 6. Open browser
open http://localhost:3000
open http://localhost:3000/focus-areas
```

---

## Next Session Priorities

### 1. Fix UX Issues (from this session's findings)
- [ ] **Draft Groups tab redirect** - Navigate to Draft Groups tab after creating a focus group
- [ ] **Formalize button styling** - Remove green/check from un-formalized groups
- [ ] **AND/OR keyword toggle** - Add operator selection in KeywordExtractionPanel
- [ ] **Focus Area hit count** - Investigate/fix 0-count issue

### 2. Incremental ES Indexing
- [ ] Add ES indexing to patent import workflows
- [ ] Consider on-demand indexing when patents are added

### 3. Abstract Cache Expansion
- [ ] Batch-download abstracts from PatentsView API
- [ ] Or extract from existing portfolio-query cache files

### 4. Additional Features
- Export CSV from portfolio grid
- Focus Area filter in portfolio grid
- LLM suggestion endpoint for focus groups
- Facet definition UI

### 5. Data Tasks
- Queue final citation batch: 17670-28913 (~11,243 patents)
- Complete full portfolio citation analysis (100% coverage)

---

## Database Schema

**PostgreSQL on localhost:5432**

Tables: `api_request_cache`, `llm_response_cache`, `users`, `focus_groups`, `focus_areas`, `focus_area_patents`, `search_terms`, `facet_definitions`, `facet_values`

---

## Design Documents

| Document | Purpose |
|----------|---------|
| `docs/FOCUS_AREA_SYSTEM_DESIGN.md` | Focus Group/Area lifecycle |
| `docs/FACET_SYSTEM_DESIGN.md` | Facet terminology |
| `docs/GUI_DESIGN.md` | GUI architecture |

---

*Last Updated: 2026-01-25 (Session 2)*
