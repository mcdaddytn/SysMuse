# Session Context — February 15, 2026

## Current State Summary

### Infrastructure Status

| Component | Status | Port |
|-----------|--------|------|
| API Server | `npm run dev` | 3001 |
| Frontend | `npm run dev` (in frontend/) | 3000 |
| PostgreSQL | Docker | 5432 |
| Elasticsearch | Docker | 9200/9300 |

---

## Completed Phases

### Phase 1 — Portfolio Page & Infrastructure (Feb 14)
- Server command fix (`npm run dev` in both root and frontend)
- Portfolio page scroll layout (sticky headers, frozen columns, always-visible scrollbars)
- Prompt templates structured questions fix
- Competitors column
- CPC tooltips composable (`useCpcDescriptions.ts`)

### Phase 2 — Filtering Enhancements (Feb 14)
- FlexFilterBuilder component with dynamic filter types
- Backend filters: competitorNames, cpcCodes, subSectors, hasLlmData, score ranges, etc.
- Filter options API endpoints
- PortfolioPage integration (replaced fixed filter bar)

### Phase 3 — Aggregates Page (Feb 14)
- Backend `POST /api/patents/aggregate` endpoint with group-by and aggregation ops
- AggregatesPage.vue with group-by selector, aggregation builder, results table, CSV export

### Phase 4 — Patent Family Explorer V2 Frontend (Feb 14-15)
Full plan: `/Users/gmac/.claude/plans/purring-watching-llama.md`

**Core implementation:**
- V2 types + `patentFamilyV2Api` API client in `frontend/src/services/api.ts`
- Full rewrite of `PatentFamilyExplorerPage.vue` (~1650 lines)
- Seeds input, 9 weighted scoring sliders with presets, thresholds, expansion controls
- Zone tab selector (All/Members/Candidates/Excluded), results grid, save/focus-area dialogs

**Stage 1 — Saved Explorations + Enrichment:**
- Load/resume saved explorations list
- Enrichment with IPR & prosecution data

**Stage 2 — Flexible Column Display:**
- 27 columns across 5 groups (core, family, scoring, dimensions, litigation)
- Column selector dialog, localStorage-persisted visibility
- Scoring weights collapsed by default

**Stage 3 — Selection Model:**
- Checkbox selection, auto-select members after create/expand/rescore
- Create Focus Area from selected patents

**Stage 4 — Shared Grid Infrastructure:**
- `useGridColumns` composable: `frontend/src/composables/useGridColumns.ts`
- `GenericColumnSelector`: `frontend/src/components/grid/GenericColumnSelector.vue`
- Refactored `ColumnSelector.vue` to thin wrapper
- Extended `ColumnGroup` type in `types/index.ts`

---

## Bug Fixes Applied (Feb 15)

1. **Column badge removed** — Floating count badge on Columns button was blocking text
2. **Scrollbar CSS** — Each page has its own inline scoped scrollbar CSS (DO NOT use global CSS file):
   - **Critical: `overflow: scroll !important`** (not `auto`) — forces scrollbars always visible on macOS
   - **16px scrollbar width/height + `-webkit-appearance: none`** — overrides macOS overlay in Chrome and Safari
   - **Firefox: `scrollbar-width: auto`** (not `thin`) — keeps scrollbars visible
   - Removed `grid-scrollbars.css` global import from main.ts (it conflicted with scoped `:deep(.q-table__middle) { overflow: visible }`)
   - Applied inline to: PortfolioPage, PatentFamilyExplorerPage, FocusAreaDetailPage
3. **PatentFamilyExplorerPage scroll container** — Added `.table-wrapper` + `.table-scroll-container` with:
   - Fixed height: `calc(100vh - 340px)`
   - `hide-pagination` on q-table, separate pagination bar outside scroll area
   - Sticky headers, frozen checkbox + status columns (sticky left)
   - q-table scroll overrides (`:deep(.q-table__container)` overflow visible)
4. **IPR/Prosecution cache fix** — `checkPatentIPR()` and `checkPatentProsecution()` in `patent-family-service.ts` now check BOTH cache locations:
   - `cache/ipr-scores/` (~10,745 files) + `cache/api/ptab/` (~455)
   - `cache/prosecution-scores/` (~11,576 files) + `cache/api/file-wrapper/` (~454)
5. **Enrichment UX simplified** — Split button with 3 options (Members, Current Page, All). "Current Page" now uses actual paginated page (e.g., 50 patents), not entire zone.
6. **Enrichment batching** — Frontend batches in groups of 500 to avoid backend 200-patent truncation limit.
7. **Exploration state preserved on navigation** — Exploration ID in URL query param. On back-navigation, auto-loads.
8. **Auto-enrichment on load** — `autoEnrich()` runs silently with `cacheOnly: true` when creating or loading an exploration. Only reads from local file cache (no API calls), fast for any number of patents.
9. **"Open" button** — Renamed from "New", repositioned next to title badges.
10. **Prosecution column display** — Shows badge with "N OA" (office action count), color-coded (orange if rejections, green if clean), with tooltip showing status + details.

---

## ONGOING: Chrome Scrollbar Visibility Problem

**Status**: UNRESOLVED — scrollbars work in Safari but NOT in Chrome.

**Working reference**: Commit `37bf802` ("Fixed scrolling patent summary", 2/14 2:03 PM) — scrollbars were confirmed working in Chrome after this commit.

**What we know**:
- The CSS in the current codebase is functionally identical to commit `37bf802` (verified via diff)
- Safari renders the custom `::-webkit-scrollbar` styles correctly — scrollbars always visible
- Chrome does NOT render them — shows macOS overlay behavior (vertical only while scrolling, no horizontal)
- Quasar CSS (`quasar.css`) does not have conflicting scrollbar rules on `.q-table__middle`
- No other CSS files in the project affect scrollbars
- The global `grid-scrollbars.css` was removed (it conflicted with scoped `:deep(.q-table__middle)` rules)
- Vite HMR confirmed serving the correct CSS with scrollbar rules

**CSS pattern that should work** (from commit `37bf802`, scoped in each page):
```css
.table-scroll-container {
  overflow: scroll !important;
}
.table-scroll-container::-webkit-scrollbar {
  width: 16px;
  height: 16px;
  -webkit-appearance: none;  /* added later for Chrome */
}
.table-scroll-container::-webkit-scrollbar-track {
  background: #e8e8e8;
}
.table-scroll-container::-webkit-scrollbar-thumb {
  background: #999;
  border: 3px solid #e8e8e8;
  border-radius: 8px;
}
.table-scroll-container {
  scrollbar-width: auto;
  scrollbar-color: #999 #e8e8e8;
}
```

**Things to investigate next**:
1. Chrome version / flags — check `chrome://flags` for overlay scrollbar settings
2. Chrome DevTools — inspect `.table-scroll-container` element, check Computed styles for `overflow` and whether `::-webkit-scrollbar` rules appear in the Styles pane
3. Try adding `scrollbar-gutter: stable both-edges` as an alternative approach
4. Try `overflow: overlay` (deprecated but Chrome may respond to it)
5. Check if Chrome is treating scoped `[data-v-xxx]::-webkit-scrollbar` differently than unscoped — try moving scrollbar CSS to `<style>` (unscoped) section
6. Compare Chrome version to when it was working (Feb 14)
7. Check if `min-height: 0; min-width: 0;` on `.table-scroll-container` (added after 37bf802) somehow affects Chrome's scrollbar rendering
8. Try reverting PortfolioPage.vue to exact `37bf802` version with `git checkout 37bf802 -- ip-port/frontend/src/pages/PortfolioPage.vue` and test in Chrome

---

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/services/api.ts` | V2 types, `patentFamilyV2Api` client (~1815 lines) |
| `frontend/src/pages/PatentFamilyExplorerPage.vue` | V2 explorer page (~1650 lines) |
| `frontend/src/pages/PortfolioPage.vue` | Patent summary with flex filters |
| `frontend/src/pages/FocusAreaDetailPage.vue` | Focus area detail (~2750 lines) |
| `frontend/src/composables/useGridColumns.ts` | Reusable column visibility composable |
| `frontend/src/components/grid/GenericColumnSelector.vue` | Props-driven column selector dialog |
| `frontend/src/components/grid/ColumnSelector.vue` | Thin wrapper for patents store |
| `frontend/src/components/filters/FlexFilterBuilder.vue` | Dynamic filter builder |
| `frontend/src/assets/grid-scrollbars.css` | Global always-visible scrollbar styles |
| `frontend/src/types/index.ts` | ColumnGroup, GridColumnMeta, GridColumnGroup types |
| `src/api/services/patent-family-service.ts` | Backend enrichment with dual-cache lookups |
| `src/api/routes/patent-families.routes.ts` | V2 endpoints + enrichment routes |
| `src/api/services/family-expansion-v2-service.ts` | V2 expansion service |
| `src/api/services/family-expansion-scorer.ts` | 9-dimension scoring with presets |

---

## Known Issues / Future Work

### From User Feedback (not yet addressed)
1. **Multi-seed scoring** — How to handle multiple seeds' sectors in scoring (averaging, union, etc.). Needs design discussion.
2. **Flexible filtering on grids** — Need filters for relationship type (child, sibling, cousin) in family explorer. FocusAreaDetailPage has old static filtering.
3. **Affiliate admin** — Admin UI for managing multi-assignee affiliates.
4. **Rate limiting (429)** — PatentsView API throttling during sibling expansion. May need request batching/queuing.

### Technical Debt
- FocusAreaDetailPage could benefit from `useGridColumns` composable
- Consider extracting scroll container pattern into shared component
- Filter presets (save/load filter configurations) — Phase 2.6 remaining

---

## Architecture Notes

### Scoring System
- 9 weighted dimensions + depthDecayRate
- Three zones: member (>= membershipThreshold), candidate (>= expansionThreshold), excluded (< expansionThreshold)
- Debounced rescore (300ms) via deep watch on weights + thresholds
- DEFAULT_WEIGHTS defined in PatentFamilyExplorerPage.vue

### Cache Locations (backend)
| Cache | Path | ~Count | Source |
|-------|------|--------|--------|
| Prosecution scores | `cache/prosecution-scores/` | 11,576 | Prosecution scoring pipeline |
| IPR scores | `cache/ipr-scores/` | 10,745 | IPR scoring pipeline |
| File wrapper | `cache/api/file-wrapper/` | 454 | enrichWithDetails API |
| PTAB | `cache/api/ptab/` | 455 | enrichWithDetails API |

### State Management
- PatentFamilyExplorerPage: local `ref()` + `computed()` (no Pinia)
- PortfolioPage / FocusAreaDetailPage: `usePatentsStore` (Pinia)
- Column visibility: localStorage via `useGridColumns` composable

---

## Commands Reference

```bash
# Start server (from project root)
npm run dev

# Start frontend (from frontend directory)
cd frontend && npm run dev

# Start Docker services
docker-compose up -d postgres elasticsearch
```

---

*Last Updated: 2026-02-15*
