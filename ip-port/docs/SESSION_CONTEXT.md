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
2. **Global scrollbar CSS** — `frontend/src/assets/grid-scrollbars.css` (imported in main.ts):
   - **Critical: `overflow: scroll !important`** (not `auto`) — forces scrollbars always visible on macOS
   - **16px scrollbar width/height** — overrides macOS overlay behavior via `::-webkit-scrollbar`
   - **Firefox: `scrollbar-width: auto`** (not `thin`) — keeps scrollbars visible
   - Applied to all pages: PortfolioPage, FocusAreaDetailPage, PatentFamilyExplorerPage
3. **PatentFamilyExplorerPage scroll container** — Added `.table-wrapper` + `.table-scroll-container` with:
   - Fixed height: `calc(100vh - 340px)`
   - `hide-pagination` on q-table, separate pagination bar outside scroll area
   - Sticky headers, q-table scroll overrides (`:deep(.q-table__container)` overflow visible)
   - Matching PortfolioPage scroll container pattern
4. **IPR/Prosecution cache fix** — `checkPatentIPR()` and `checkPatentProsecution()` in `patent-family-service.ts` now check BOTH cache locations:
   - `cache/ipr-scores/` (~10,745 files from scoring pipeline) + `cache/api/ptab/` (~455 from enrichment API)
   - `cache/prosecution-scores/` (~11,576 files from scoring pipeline) + `cache/api/file-wrapper/` (~454 from enrichment API)
5. **Enrichment UX simplified** — Split button with 3 options (Members, Current Page, All), auto-skips already-enriched, shows "(N new)" counts. Distinguished "None" (green) vs "—" (grey, not yet enriched) in columns.
6. **Enrichment batching** — Frontend now processes enrichment in batches of 500 to avoid backend 200-patent truncation limit. Accumulates IPR/prosecution counts across batches.
7. **Exploration state preserved on navigation** — Exploration ID stored in URL query param (`?exploration=xxx`). On mount, if present, auto-loads the exploration. Clicking "New" clears both state and URL.

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
