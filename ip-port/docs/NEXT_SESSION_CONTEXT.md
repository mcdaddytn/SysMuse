# Patent Portfolio Analysis - Session Context (2026-01-25, Session 5)

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
| Index Size | 41 MB |
| Abstracts Indexed | **28,869 (99.8%)** |
| Status | Fully populated with abstracts from patent cache |
| Fuzziness | Disabled for KEYWORD/KEYWORD_AND types; AUTO for others |

### Citation Batch Progress

| Batch | Range | Status |
|-------|-------|--------|
| Queue 1-4 | 0-5670 | Complete |
| Gap Fill | 813-1669 | Complete |
| Overnight 1-12 | 5670-17670 | Complete |
| Final batch (part 1) | 17670-26610 | Complete |
| Final batch (part 2) | 26610-28913 | **~97% (28,014 / 28,913 files cached)** |

**Cache Statistics:**
- Forward citation files: 28,014
- Citing patent detail files: 28,013
- Cache size: ~2.5 GB
- Remaining: ~900 patents still need citation fetching

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

### Session 4

#### Design Document Synthesis (DONE)
Synthesized detailed design considerations for focus area workflow, search scopes, patent families, citation counting, sector management, LLM jobs, and word count extraction into design documents and development queue.

#### Abstract Batch Fetch COMPLETE (I-1 DONE)
- **28,913 / 28,913 patent records cached (100%)**
- **28,669 with abstracts (99.8%)**
- ES re-imported with abstracts: 41 MB index, full-text search includes abstracts

### Session 5 (Current)

#### P-0a: Citation Classification Pipeline ✓ COMPLETE
- Created `scripts/classify-citations.ts` — three-way classification from citing-patent-details cache
- Classification order: affiliate (via `excludePatterns`) → competitor (via `CompetitorMatcher`) → neutral
- **28,913 patents processed**, 313,256 total citations:
  - Competitor: 120,432 (38.4%), Affiliate: 35,090 (11.2%), Neutral: 157,734 (50.4%)
- Output: per-patent files in `cache/citation-classification/` + summary in `output/citation-classification-2026-01-26.json`
- **100% validation match** against existing citation-overlap output (26,957 patents, 0 mismatches)
- Run: `npx tsx scripts/classify-citations.ts` (supports `--dry-run`, `--force`, `--validate`)

#### P-0b: Scoring Engine ✓ COMPLETE
- Created `src/api/services/scoring-service.ts` — V3 scoring with 6 configurable profiles
- Profiles: executive (default), aggressive, moderate, conservative, licensing, quick_wins
- Formula: `score = Σ(normalized × adjusted_weight) × yearMultiplier × 100`
- Missing LLM metrics (~95% of patents) have weights redistributed proportionally
- Updated `src/api/routes/scores.routes.ts` with V3 endpoints
- Updated `src/api/routes/patents.routes.ts` — enriched with citation classification data
- Test results: Executive avg=16.84, max=85.37, 388 patents ≥50

#### P-0c: Portfolio Grid Expansion — IN PROGRESS
- Frontend types, store columns, and cell templates being expanded for all spreadsheet fields

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

### ~~1. Abstract Cache Coverage~~ — COMPLETED (Session 4)
- **28,913 / 28,913 patent records cached** with abstracts (99.8% have abstract text)
- ES re-imported with abstracts — 41 MB index, full-text search now includes abstracts
- Script: `npx tsx scripts/batch-fetch-patents.ts`
- Re-import: `npx tsx services/import-to-elasticsearch.ts --recreate --candidates`

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
| Final batch (part 2) | 26610-28913 | ~97% complete |
| **Total Coverage** | **28,014 / 28,913** | **~96.9%** |

**Cache Statistics:**
- Forward citation files: 28,014
- Citing patent detail files: 28,013
- Cache size: ~2.5 GB
- No background jobs currently running

### Remaining Work
- ~900 patents still need citation fetching
- API bandwidth is now available — can proceed with abstract caching (see TODO #1)
- Remaining citation gaps can be filled incrementally or as part of patent family construction

---

## GUI Development Status

### Backend API Server (Port 3001)

```bash
npm run api:dev
```

**Endpoints:**
| Endpoint | Description |
|----------|-------------|
| `GET /api/patents` | List with filters/pagination (enriched with citation classification) |
| `GET /api/patents/:id` | Full patent details (+ abstract from cache) |
| `GET /api/patents/:id/preview` | Lightweight preview (+ abstract + citation data) |
| `POST /api/patents/batch-preview` | Batch preview (+ abstracts + citation data) |
| `GET /api/patents/:id/citations` | Forward citations + classification breakdown |
| `GET /api/scores/v2` | v2 scoring (legacy 3-weight) |
| `GET /api/scores/v3` | V3 scored rankings (profile, page, limit, sector, minScore) |
| `GET /api/scores/profiles` | List 6 scoring profiles with weights |
| `GET /api/scores/sectors` | Sector rankings with damages tiers (profile, topN) |
| `POST /api/scores/reload` | Clear scoring caches |
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

**Full roadmap**: See `docs/DEVELOPMENT_QUEUE.md` for the complete prioritized development queue with dependencies.

### ~~P-0a: Citation Classification~~ ✓ COMPLETE (Session 5)
### ~~P-0b: Scoring Engine~~ ✓ COMPLETE (Session 5)

### P-0c: Portfolio Grid Expansion — IN PROGRESS
- [ ] Frontend columns for all citation metrics (competitor, affiliate, neutral, competitor count)
- [ ] V3 score column with profile selector
- [ ] Primary sector filter, sector drill-down
- [ ] Column visibility defaults updated

### P-0d: Sector Ranking View
- [ ] Rewrite SectorRankingsPage from stub to functional
- [ ] Profile selector, sector cards, top patents per sector

### P-0e: CSV Export
- [ ] Export button on portfolio grid
- [ ] Respects current filters and sort

### P-1: Focus Area & Search Scope (after P-0)
- [ ] Search scope detection and selector
- [ ] Search term testing fix
- [ ] Word count extraction grid

---

## Database Schema

**PostgreSQL on localhost:5432**

Tables: `api_request_cache`, `llm_response_cache`, `users`, `focus_groups`, `focus_areas`, `focus_area_patents`, `search_terms`, `facet_definitions`, `facet_values`

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

---

*Last Updated: 2026-01-25 (Session 5 — P-0a, P-0b complete; P-0c in progress)*
