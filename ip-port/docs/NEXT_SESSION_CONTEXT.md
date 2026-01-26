# Patent Portfolio Analysis - Session Context (2026-01-25, Session 7)

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

#### P-0c: Portfolio Grid Expansion ✓ COMPLETE
- **Frontend types** (`frontend/src/types/index.ts`): Added `affiliate_citations`, `neutral_citations`, `competitor_count`, `competitor_names`, `has_citation_data` to Patent interface. Added `ScoringProfile`, `V3ScoredPatent`, `SectorRanking` types.
- **API service** (`frontend/src/services/api.ts`): Added V3 scoring methods (`getV3Scores`, `getProfiles`, `getSectorRankings`, `reloadScores`). Updated `PatentPreview` with citation fields.
- **Store** (`frontend/src/stores/patents.ts`): Added `affiliate_citations`, `neutral_citations`, `competitor_count` columns. Made `competitor_citations` and `competitor_count` visible by default.
- **PortfolioPage.vue**: Added Primary Sector filter dropdown, "Has Competitor Cites" toggle, color-coded competitor_citations cell, competitor_count cell with tooltip showing competitor names, query param handling for sector drill-down, CSV export.
- **Backend**: Added `GET /api/patents/primary-sectors` endpoint (42 sectors). Added `primarySectors` array filter support.

#### P-0d: Sector Rankings Page ✓ COMPLETE
- Rewrote `SectorRankingsPage.vue` from stub to full page
- Profile selector dropdown with 6 profiles, sort by damages/avg score/max score/patent count
- Expandable sector cards: name, super-sector chip, damages badge (color-coded), patent count, avg/max scores
- Top patents table per sector (rank, patent ID, title, assignee, score, years left)
- Drill-down button → navigates to portfolio page filtered by sector

#### P-0e: CSV Export (basic) ✓ COMPLETE
- Export button on portfolio grid downloads visible columns as CSV
- Filename includes current date

#### V3 Scoring Page — NOT YET DONE (Session 5)
- Completed in Session 6 — see below

### Session 6

#### V3 Scoring Page ✓ COMPLETE
- Rewrote `V3ScoringPage.vue` from stub to full functional page
- Profile selector dropdown (6 profiles with descriptions)
- Weight visualization panel (horizontal bars, color-coded: blue=quantitative, purple=LLM)
- Scored patent rankings table (paginated, server-side, 100/page)
- Expandable score breakdown per patent: normalized metrics, contribution points, formula display
- LLM indicator column (psychology icon when LLM scores available)
- LLM score badges in expanded view (1-5 scale, color-coded)
- Sector filter dropdown, Min Score filter
- Competitor names chips in expanded view
- CSV export with profile name in filename
- Reload button (clears server caches)
- LLM coverage badge in header (shows X/28913 patents with LLM data)

#### LLM Scores Wired into Scoring Engine ✓ COMPLETE
- `scoring-service.ts` — Added `LlmScores` interface and `loadAllLlmScores()` function
- Loads LLM scores from 3 sources (priority order):
  1. `output/llm-analysis-v3/combined-v3-*.json` (V3 analysis runs)
  2. `output/llm-analysis-v2/`, `output/llm-analysis/`, `output/vmware-llm-analysis/` (V2/V1)
  3. `cache/llm-scores/*.json` (per-patent cache, overrides combined files)
- `buildMetrics()` now includes LLM scores when available
- `clearScoringCache()` clears LLM cache too
- `getLlmStats()` — returns coverage statistics
- V3 API response includes `has_llm_scores`, `llm_scores` per patent, `llm_coverage` summary
- New endpoint: `GET /api/scores/stats` — LLM coverage and profile count

#### LLM Import Script ✓ COMPLETE
- Created `scripts/import-llm-scores.ts`
- Imports from multiple JSON formats: combined-v3, multi-score-analysis, arrays, objects
- Saves per-patent JSON to `cache/llm-scores/`
- Supports `--dry-run`, `--force`, `--all` (directory import)
- Run: `npx tsx scripts/import-llm-scores.ts <file-or-dir> [--dry-run] [--force] [--all]`

#### LLM Top Patents Job ✓ COMPLETE
- Created `scripts/run-llm-top-patents.ts`
- Scores all patents, selects top N without existing LLM data
- Loads patent details from local cache (no API calls for details)
- Runs V3 LLM analysis via Anthropic API
- Saves results to both `cache/llm-scores/` and `output/llm-analysis-v3/`
- Supports `--count N`, `--sector X`, `--batch-size N`, `--dry-run`, `--force`
- Run: `npx tsx scripts/run-llm-top-patents.ts --count 100 --dry-run`

#### Citation Enrichment Script ✓ COMPLETE
- Created `scripts/enrich-citations.ts`
- Fetches 1-generation parent citations (backward citations) for top-ranked patents
- Saves to `cache/patent-families/parents/<patent_id>.json`
- Optionally fetches parent patent details to `cache/patent-families/parent-details/`
- Supports `--count N`, `--patent-ids`, `--skip-existing`, `--no-details`, `--dry-run`
- Run: `npx tsx scripts/enrich-citations.ts --count 500 --skip-existing`

### Session 7 (Current)

#### LLM Import Script Enhanced — CSV + Nested Metrics ✓ COMPLETE
- Extended `scripts/import-llm-scores.ts` with CSV file support and nested `metrics` object handling
- Added `parseCsvToObjects()` and `parseCsvLine()` for RFC-compliant CSV parsing
- Added `getScoreField()` helper resolving scores from `item.field` or `item.metrics.field`
- Directory scanning now picks up both `.json` and `.csv` files with `--all`

#### LLM Scores Imported from Export ✓ COMPLETE
- Imported **2,669 patents** with all 5 LLM scores from `all-patents-scored-v3-2026-01-21.csv`
- Source: Previous V3 analysis export (17,040 patents total, 2,669 with LLM data)
- Saved to `cache/llm-scores/` — one JSON file per patent

#### Patent Partitioning Verified ✓ CONFIRMED
- Citation enrichment writes ONLY to `cache/patent-families/` — does NOT touch DB or ES index
- Scoring service loads ONLY from `output/streaming-candidates-*.json` — isolated from family cache
- `excludePatterns` in `competitors.json` covers all 20 Broadcom entities
- Parent patents discovered via enrichment will never be treated as portfolio patents

#### Overnight Jobs Queued — RUNNING
1. **LLM Analysis Pass 1**: `run-llm-top-patents.ts --count 5000` (~4 hours)
   - 1,000 batches of 5 patents each via Anthropic API (Claude Sonnet)
   - Saves to `cache/llm-scores/` + `output/llm-analysis-v3/batches/`
2. **LLM Analysis Pass 2**: `run-llm-top-patents.ts --count 3000` (~2.5 hours, after pass 1)
3. **Citation Enrichment**: `enrich-citations.ts --count 2000 --skip-existing` (~2 hours, parallel)
   - Backward citations for top 2,000 patents → `cache/patent-families/parents/`
   - Parent patent details → `cache/patent-families/parent-details/`

**Expected by morning:**
- LLM scores: 2,669 (imported) + 5,000 (pass 1) + 3,000 (pass 2) = **~10,669 patents** (~37% coverage)
- Patent family data: **2,000 patents** with backward citation trees

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
| `GET /api/patents/affiliates` | List affiliates with counts |
| `GET /api/patents/super-sectors` | List super-sectors with counts |
| `GET /api/patents/primary-sectors` | List 42 primary sectors with counts |
| `GET /api/patents/assignees` | List raw assignees with counts |
| `GET /api/scores/v2` | v2 scoring (legacy 3-weight) |
| `GET /api/scores/v3` | V3 scored rankings (profile, page, limit, sector, minScore) |
| `GET /api/scores/profiles` | List 6 scoring profiles with weights |
| `GET /api/scores/sectors` | Sector rankings with damages tiers (profile, topN) |
| `POST /api/scores/reload` | Clear scoring caches (includes LLM scores) |
| `GET /api/scores/stats` | LLM coverage statistics + profile count |
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
| `PortfolioPage.vue` | `/` | Complete (citations, filters, CSV export, query param drill-down) |
| `PatentDetailPage.vue` | `/patent/:id` | Complete (+ abstract display) |
| `V2ScoringPage.vue` | `/v2-scoring` | Complete |
| `V3ScoringPage.vue` | `/v3-scoring` | Complete (profile selector, weight viz, rankings, score breakdown, LLM indicators) |
| `SectorRankingsPage.vue` | `/sectors` | Complete (profile selector, expandable sectors, top patents) |
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
### ~~P-0c: Portfolio Grid Expansion~~ ✓ COMPLETE (Session 5)
### ~~P-0d: Sector Ranking View~~ ✓ COMPLETE (Session 5)
### ~~P-0e: CSV Export~~ ✓ COMPLETE (basic, Session 5)

### ~~V3 Scoring Page~~ ✓ COMPLETE (Session 6)

### LLM Data Import ✓ COMPLETE (Session 7)
- 2,669 patents imported from CSV export into `cache/llm-scores/`
- Import script enhanced with CSV support and nested metrics handling

### Overnight Jobs ✓ QUEUED (Session 7)
- **LLM Pass 1**: 5,000 patents (~4 hr) — RUNNING
- **LLM Pass 2**: 3,000 patents (~2.5 hr) — queued after pass 1
- **Citation Enrichment**: 2,000 patents (~2 hr) — RUNNING in parallel
- After completion: `POST /api/scores/reload` to refresh scoring engine
- Check results: `ls cache/llm-scores/ | wc -l` (expect ~10,669)
- Check families: `ls cache/patent-families/parents/ | wc -l` (expect ~2,000)

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

*Last Updated: 2026-01-25 (Session 7 — LLM scores imported from CSV export (2,669), overnight jobs queued: LLM 8,000 patents + citation enrichment 2,000 patents)*
