# Patent Portfolio Analysis - Session Context (2026-01-25, Session 3)

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
| Abstracts Indexed | ~0 (only 1 patent cache file exists) |
| Status | Fully populated from streaming-candidates |
| Fuzziness | Disabled for KEYWORD/KEYWORD_AND types; AUTO for others |

### Citation Batch Progress

| Batch | Range | Status |
|-------|-------|--------|
| Queue 1-4 | 0-5670 | Complete |
| Gap Fill | 813-1669 | Complete |
| Overnight 1-12 | 5670-17670 | Complete |
| Final batch (part 1) | 17670-26610 | Complete |
| **Final batch (part 2)** | **26610-28913** | **Running (~1050/2303 at session end)** |

**Cache Statistics:**
- API entries: ~53,224+
- Size: ~1,825 MB

---

## Changes Completed This Session (Session 3)

### Session 2 (Prior)

#### Part A: Elasticsearch Populated with Full Portfolio
- 28,913 patents indexed, search returns results
- `services/import-to-elasticsearch.ts` with `--candidates` flag

#### Part B: Abstracts Exposed Where Available
- `loadAbstract()` reads from `cache/api/patentsview/patent/<id>.json`
- Patent detail page, preview tooltip, batch preview all return abstract when cached

#### Part C: Search Preview + UX Improvements
- Search fields parameter (title/abstract/both), explicit Search button

### Session 3 (Current)

#### Fix 1: Draft Groups Tab Redirect (DONE)
- `PortfolioPage.vue` — Navigation now includes `query: { tab: 'groups' }`
- `FocusAreasPage.vue` — Imports `useRoute`, initializes `activeTab` from `route.query.tab`

#### Fix 2: Formalize Button Styling (DONE)
- Both Formalize buttons changed from `icon="check" color="positive"` to `icon="gavel" color="primary"`

#### Fix 3: AND/OR Keyword Toggle (DONE)
- Added `operator` ref (AND/OR) with `q-btn-toggle` in KeywordExtractionPanel
- `combinedExpression` uses selected operator
- "Add as Search Term" emits `KEYWORD_AND` or `KEYWORD` based on toggle

#### Fix 4: KEYWORD_AND Term Type (DONE)
- Added `KEYWORD_AND` to Prisma `SearchTermType` enum + pushed schema
- Added to `termTypeOptions` dropdown in FocusAreaDetailPage
- Backend handles via default case (pass-through)

#### Fix 5: Focus Ratio Display (DONE)
- Added "Focus Ratio" chip (focus area hits / portfolio hits) to both:
  - `KeywordExtractionPanel.vue` hit preview
  - `FocusAreaDetailPage.vue` Add Search Term dialog hit preview
- Color-coded: green (>5%), orange (>1%), red (<=1%) — higher is better
- Shows 2 decimal places (e.g., `0.10%`)
- Added tooltips on Portfolio and Focus Area hit chips explaining what they measure

#### Fix 6: Fuzziness Disabled for Keyword Searches (DONE)
- `elasticsearch-service.ts` — `search()` now accepts optional `fuzziness` parameter (default `'AUTO'`)
- `focus-areas.routes.ts` — Sets `fuzziness: '0'` for KEYWORD and KEYWORD_AND types
- All 3 ES search calls in preview endpoint pass the fuzziness setting
- Other search types (Phrase, Boolean, Wildcard, Proximity) keep `fuzziness: 'AUTO'`
- English stemmer still active (monitor→monitoring OK, but appliances≠applications now)

#### Fix 7: Debug Logging for Focus Area Hits (DONE)
- Added 4 `console.log` statements to search-preview endpoint
- Confirmed focus area hit counts work correctly — small counts (0-1) are expected with 3-patent focus areas
- Logs show DB patent IDs, ES patent IDs, and intersection count

#### Citation Batch Restarted
- Running: `npm run analyze:cached -- --start 26610 --limit 2303`
- Progress at ~1050/2303 when session ended

#### Design Doc Updates
- `FOCUS_AREA_SYSTEM_DESIGN.md` — Added "Search Term Selectivity" future enhancement section

---

## Known Issues / Next Session TODO

### COMPLETED (Session 3)
- [x] ~~Draft Groups tab redirect~~ — DONE
- [x] ~~Formalize button styling~~ — DONE
- [x] ~~AND/OR keyword toggle~~ — DONE
- [x] ~~Focus Area hit count investigation~~ — DONE (working correctly, small counts expected with small focus areas)
- [x] ~~KEYWORD_AND term type~~ — DONE
- [x] ~~Focus Ratio display~~ — DONE
- [x] ~~Fuzziness disabled for keyword searches~~ — DONE

### 1. Abstract Cache Coverage (HIGH PRIORITY)
**Problem:** Only 1 patent abstract is cached. Most patents show "Abstract not cached." Abstracts are critical for search quality and analysis.

**Current state:**
- `cache/api/patentsview/patent/` — 1 file
- `streaming-candidates-*.json` — no abstracts (title, date, assignee, CPC, scores only)
- ES index has abstracts only where cache file existed at import time (~0)

**Strategy (decided):**
- **Option A (preferred long-term):** Batch-fetch individual patent records from PatentsView API, caching full records to `cache/api/patentsview/patent/{id}.json`. Use batch queries (up to 100 IDs per request) to minimize API calls (~290 requests for 28,913 patents). This builds a rich cache that can be expanded with additional fields later. Evaluate all available PatentsView fields to get maximum data per request — avoid rate limit waste by being thorough about what we download.
- **Option B (expedient patch):** Re-download portfolio pages with `patent_abstract` added to the field list in `download-full-portfolio.ts` (currently only fetches title, date, assignee, citations). ~79 page requests. Fast but produces a different cache structure than Option A.
- **Decision:** Evaluate after current citation batch completes. Option A is the right architecture going forward. Option B may be useful as an interim fix.

**After caching:** Re-run `npx tsx services/import-to-elasticsearch.ts --recreate --candidates` to populate ES abstracts.

### 2. CPC Code Description Tooltips (MEDIUM PRIORITY)
**Problem:** CPC codes appear throughout the UI (patent detail, portfolio grid, focus area patents) with no human-readable descriptions. Users need mouseover tooltips showing what each code means.

**Current state:**
- `config/cpc-descriptions.json` exists with ~100 codes mapped
- This is insufficient — individual patents can have dozens of CPC codes, many beyond the current mapping
- The CPC classification hierarchy has thousands of codes (class → subclass → group → subgroup)

**Needed:**
1. **Systematic CPC mapping:** Download the complete CPC classification scheme from USPTO or WIPO. The hierarchy is: Section (e.g., H) → Class (H04) → Subclass (H04L) → Group (H04L47) → Subgroup (H04L47/781). Need at least class and subclass level descriptions.
2. **Keep mapping updated:** CPC codes are revised periodically. Need a script to fetch/refresh the mapping from an authoritative source (USPTO bulk data or CPC scheme XML).
3. **Frontend integration:** Add `q-tooltip` on every CPC code chip/badge across all pages.
4. **Files to update:** PatentDetailPage.vue, PortfolioPage.vue, FocusAreaDetailPage.vue, any component showing CPC codes.

### 3. Incremental ES Indexing (MEDIUM PRIORITY)
**Problem:** Patents are only indexed via bulk CLI command. New patents added via the UI are not auto-indexed in Elasticsearch.
**Fix needed:** Add ES indexing calls in patent import/download workflows.

### 4. Search Term Selectivity Tracking (LOW PRIORITY — future)
**Documented in:** `docs/FOCUS_AREA_SYSTEM_DESIGN.md` under "Search Term Selectivity"
- Persist selectivity ratio as saved attribute on SearchTerm records
- Combine selectivity across search terms for collective efficacy scoring
- Track selectivity over time as portfolio changes

---

## Citation Cache Progress

### Current Status

| Batch | Range | Status |
|-------|-------|--------|
| Queue 1-4 | 0-5670 | Complete |
| Gap Fill | 813-1669 | Complete |
| Overnight 1-12 | 5670-17670 | Complete |
| Final batch (part 1) | 17670-26610 | Complete |
| **Final batch (part 2)** | **26610-28913** | **In progress (~1050/2303 at session end)** |
| **Total Coverage** | **~27,660 / 28,913** | **~96%** |

**Cache Statistics:**
- API entries: ~53,224+
- Size: ~1,825 MB

### On Completion
When the final batch finishes (~1,250 remaining):
- Citation coverage will be 100% (28,913 / 28,913)
- Next priority: abstract caching (see TODO #1 above)

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
| `FocusAreasPage.vue` | `/focus-areas` | Complete (+ tab query param, formalize button fix) |
| `FocusAreaDetailPage.vue` | `/focus-areas/:id` | Complete (+ KEYWORD_AND, Focus Ratio, fuzziness fix) |

**Components:**
| Component | Description |
|-----------|-------------|
| `PatentPreviewTooltip.vue` | Hover preview (+ abstract) |
| `KeywordExtractionPanel.vue` | Keyword extraction + AND/OR toggle, Focus Ratio, fuzziness-free search |
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

### 1. Abstract Cache (HIGH — blocks search quality)
- [ ] Verify citation batch completed (should be done by next session)
- [ ] Evaluate PatentsView API fields available for batch download (maximize data per request)
- [ ] Write batch abstract fetch script (Option A: 100 IDs per request, ~290 calls)
- [ ] Run abstract batch
- [ ] Re-import to ES with abstracts: `npx tsx services/import-to-elasticsearch.ts --recreate --candidates`

### 2. CPC Code Descriptions (MEDIUM — UX quality)
- [ ] Download complete CPC classification scheme (USPTO/WIPO source)
- [ ] Build/update `config/cpc-descriptions.json` with full hierarchy
- [ ] Create script to refresh CPC mapping from authoritative source
- [ ] Add `q-tooltip` with descriptions on all CPC code displays across UI

### 3. Incremental ES Indexing (MEDIUM)
- [ ] Add ES indexing to patent import workflows
- [ ] Consider on-demand indexing when patents are added

### 4. Additional Features (LOW)
- Export CSV from portfolio grid
- Focus Area filter in portfolio grid
- LLM suggestion endpoint for focus groups
- Facet definition UI

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

*Last Updated: 2026-01-25 (Session 3)*
