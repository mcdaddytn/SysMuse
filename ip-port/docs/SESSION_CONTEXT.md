# Session Context — February 22, 2026

## Current State Summary

### Infrastructure Status

| Component | Status | Port |
|-----------|--------|------|
| API Server | `npm run dev` (from root) | 3001 |
| Frontend | `npm run dev` (from frontend/) | 3000 |
| PostgreSQL | Docker | 5432 |
| Elasticsearch | Docker | 9200/9300 |

### Active Development Queue

**Primary roadmap:** `DEVELOPMENT_QUEUE_V4.md` (reconciled from V3 + Feb 18-20 work)

| Phase | Status | Summary |
|-------|--------|---------|
| Phase 0 | **Complete** | Quick wins & rename to "IP Port" |
| Phase 1 | **Complete** | Multi-portfolio foundation, competitor imports, CPC plumbing |
| Phase 2 | **In progress** | Sector overlap detection — data ready, analysis needed |
| Phase 3 | Not started | Focus area pipeline — litigation opportunities |
| Phase 4 | Not started | Product layer & external integration |
| Phase 5 | **Mostly complete** | Enrichment & scoring pipeline upgrade |
| Phase 5b | **Complete** | Patent quarantine system + numeric patent ID |
| Phase 6 | Not started | Taxonomy deepening |
| Phase 7 | Deferred | Data service layer & production readiness |

---

## What Was Completed (Feb 22)

### Claims Always Included — `useClaims` Flag Removed

**Problem:** `useClaims` parameter existed throughout the system (API routes, frontend toggles, batch job metadata, shell scripts) with a default of `false`. This caused repeated regressions where LLM scoring ran without claims despite multiple attempts to fix the default.

**Fix:** Eliminated the flag entirely from all active code paths:
- `DEFAULT_CONTEXT_OPTIONS.includeClaims` changed from `'none'` to `'independent_only'`
- `CLAIMS_CONTEXT_OPTIONS` export removed (was identical to new default)
- `useClaims` removed from: `batch-jobs.routes.ts` (request body, DB insert, API response), `scoring-templates.routes.ts` (query params), `api.ts` (types), `JobQueuePage.vue` (toggle removed), `SectorManagementPage.vue` (toggle removed), `batch-score-overnight.ts` (CLI flag removed)
- `withClaims` on `PatentSubSectorScore` DB column kept as read-only historical indicator — always set to `true` going forward, useful for identifying old scores that need rescore

**Files changed:** `llm-scoring-service.ts`, `batch-jobs.routes.ts`, `scoring-templates.routes.ts`, `api.ts`, `JobQueuePage.vue`, `SectorManagementPage.vue`, `batch-score-overnight.ts`

### LLM Data Quality Gate — Quarantine Expansion

**Problem:** Patents missing abstracts or sector assignments were still scored by LLM with minimal context (just title + CPC), producing unreliable scores.

**Changes:**
- Auto-quarantine expanded with LLM readiness rules: `llm: "no-abstract"` and `llm: "no-sector"`
- Gap analysis (`analyzeGaps()`) excludes LLM-quarantined patents from LLM denominators
- Enrichment summary and sector enrichment endpoints use quarantine-adjusted LLM denominators
- Frontend shows remedy text for each quarantine reason
- `quarantineCounts` now includes `llm` count alongside `xml`

### Claims Gate — Soft Skip Instead of Hard Block

**Problem:** When submitting all 5 job types on a new portfolio (no XML extracted yet), the claims gate returned a 400 error blocking ALL job types — hydration, citation, XML, everything. User saw "localhost:3000 claims_gate" in a browser `alert()` popup.

**Fix:** Changed from hard block to soft skip:
- If no LLM-eligible patents have XML: removes LLM from the job list, proceeds with other types
- If LLM is the only type and all patents lack XML: returns 200 with `llmDeferred: true`
- Response includes `llmDeferred` and `llmDeferredCount` for frontend notification
- Frontend shows Quasar `Notify` toast instead of browser `alert()` for all errors
- Removed claims gate dialog, "Score Without Claims" button, and "Extract USPTO Data First" button
- Enrichment dialog (`doStartEnrichFromDialog`) also updated to use Notify

### Incremental LLM Cache Writes

**Problem:** V3 LLM analysis only wrote per-patent cache files (`cache/llm-scores/{id}.json`) at the very end via `saveResults()`. During job execution, `syncEnrichmentFlags()` found nothing, so sector enrichment showed 0% progress.

**Fix:** V3 analyzer (`services/llm-patent-analysis-v3.ts`) now writes per-patent cache files incrementally after each batch of 5 patents. Also added periodic flag sync (every 60s) while jobs are running.

### Periodic Enrichment Flag Sync While Jobs Run

**Problem:** `syncEnrichmentFlags()` only ran when jobs completed. Sector enrichment view didn't reflect LLM progress during long-running jobs.

**Fix:** Added 60-second periodic sync in `GET /api/batch-jobs` handler while any jobs are running. Invalidates enrichment cache and syncs flags from file cache to Postgres.

### Hydration Repair — All Portfolios Complete

Ran `scripts/hydrate-all.ts` across all 15 portfolios:
- **48,801 patents hydrated**, 800 not found on PatentsView
- Broadcom (29,474) completed in ~37 min at ~76ms/patent
- All portfolios now have abstract, filing_date, remaining_years, base_score populated

### Rescore Analysis — CSV Exports

Analyzed all 30,308 LLM-scored patents for context quality:

| Context Quality | Count | % |
|---|---|---|
| Full (abstract + claims) | 26,821 | 88.5% |
| Abstract only | 2,317 | 7.6% |
| Claims only (no abstract) | 1,049 | 3.5% |
| Minimal (title/sector/CPC only) | 121 | 0.4% |

CSV exports in `output/`:
- `rescore-summary-by-portfolio.csv`
- `rescore-needed-no-abstract.csv` (1,170 patents)
- `rescore-needed-no-claims.csv` (1,897 scores)

---

## Known Architecture Debt

### File-Polling for Enrichment Status

The LLM and prosecution pipelines write results to disk (`cache/llm-scores/`, `cache/prosecution-scores/`). A separate function (`syncEnrichmentFlags()`) periodically scans directory listings and updates Postgres `has_llm_data`/`has_prosecution_data` flags. This is indirect and fragile.

**Correct approach:** Enrichment pipelines should write directly to Postgres and the DB should be the single source of truth. File cache can exist for backward compatibility but shouldn't be the mechanism for tracking enrichment status.

**Current asymmetry:**
- LLM & Prosecution: file-first → poll → DB flag (async, indirect)
- XML: direct DB update (correct)
- IPR: file-only, no DB flag at all

**Impact:** Sector enrichment views lag behind actual progress. Mitigated by the 60s periodic sync but not eliminated.

### "V3" Naming

`services/llm-patent-analysis-v3.ts` and `output/llm-analysis-v3/` use "V3" in the name but this is the LLM enrichment pipeline, not version-specific. The naming is confusing — "V2" and "V3" are scoring versions that consume LLM data, not the enrichment pipeline itself.

---

## Cross-Portfolio Analysis (as of Feb 22)

### Portfolio Status

| Portfolio | Total | Hydrated | USPTO XML | LLM Scored | Quarantined |
|---|---|---|---|---|---|
| Broadcom | 29,474 | 29,329 | ~26,000 | ~17,500 | ~3,500 |
| Intel | 2,000+ | 2,000 | In progress | ~310 (running) | TBD |
| Sony | 2,000 | 1,800 | TBD | TBD | TBD |
| Apple | 2,000 | 2,000 | TBD | TBD | TBD |
| Roku | 1,207 | 1,207 | 1,174 | 1,000 | ~10 |
| LG Electronics | 1,000 | 1,000 | TBD | TBD | TBD |
| NVIDIA | ~750 | 749 | TBD | TBD | TBD |
| Cisco | 636 | 636 | TBD | TBD | TBD |
| Zoom | 585 | 585 | 532 | 585 | ~10 |
| Netflix | 385 | 385 | 381 | 385 | ~5 |
| Paramount | 310 | 310 | TBD | TBD | TBD |
| Hulu | 255 | 255 | 93 | 100 | ~2 |
| Spotify | ~200 | TBD | TBD | TBD | TBD |
| Qualcomm | ~200 | TBD | TBD | TBD | TBD |
| Samsung | ~200 | TBD | TBD | TBD | TBD |

---

## Important Notes for Next Session

### Claims Are Always On

There is no toggle, parameter, or flag to disable claims. `DEFAULT_CONTEXT_OPTIONS.includeClaims` is `'independent_only'`. If a patent lacks XML data, it's simply skipped by the claims gate (soft skip) and picked up on the next enrichment run.

### Sub-Sector Templates Do NOT Exist for VIDEO_STREAMING

**Do NOT re-score large sectors without first creating sub-sector question breakdowns.** See previous session context for details.

### Quarantine System — Operational with LLM Rules

- Original XML quarantine: pre-2005, design-patent, reissue-patent, recent-no-bulk, extraction-failed
- New LLM quarantine: no-abstract, no-sector
- Auto-quarantine: `POST /api/batch-jobs/auto-quarantine` with `dryRun` support
- Quarantine tab shows remedy text for each reason

### Enrichment Job Workflow

Submit all 5 types at once. They run in parallel:
1. **Hydration** — fetches patent metadata from PatentsView
2. **XML extraction** — extracts claims from USPTO bulk data
3. **LLM scoring** — skips patents without XML (soft skip), catch up later
4. **Prosecution history** — USPTO file wrapper data
5. **Patent families** — citation enrichment

LLM dedup: gap analysis checks `has_llm_data` flag + `patent_sub_sector_scores` table. Running general tier + sector-specific LLM simultaneously is safe — no double scoring.

### Chrome Scrollbar Problem — UNRESOLVED

Scrollbars work in Safari but NOT in Chrome. CSS is correct. See MEMORY.md.

---

## Key Files

| File | Purpose |
|------|---------|
| `docs/DEVELOPMENT_QUEUE_V4.md` | Active development queue |
| `src/api/services/llm-scoring-service.ts` | LLM scoring, context options (claims always on) |
| `src/api/routes/batch-jobs.routes.ts` | Batch jobs, auto-quarantine, gap analysis, claims gate |
| `src/api/routes/patents.routes.ts` | Enrichment summary, sector enrichment, quarantine CRUD |
| `services/llm-patent-analysis-v3.ts` | V3 LLM enrichment pipeline (incremental cache writes) |
| `frontend/src/pages/JobQueuePage.vue` | Job queue + Quarantine tab (no claims gate dialog) |
| `frontend/src/pages/SectorManagementPage.vue` | Sector scoring (no claims toggle) |
| `frontend/src/services/api.ts` | Frontend API types (no useClaims) |

---

## Cache & Data Locations

| Cache | Path | ~Count | Source |
|-------|------|--------|--------|
| LLM scores | `cache/llm-scores/` | ~31,450 | LLM enrichment pipeline |
| Prosecution scores | `cache/prosecution-scores/` | ~11,576 | Prosecution scoring |
| IPR scores | `cache/ipr-scores/` | ~10,745 | IPR scoring |
| PatentsView | `cache/api/patentsview/patent/` | ~49,000 | Hydration pipeline |
| Patent XMLs | `$USPTO_PATENT_GRANT_XML_DIR` | ~28,000 | USPTO bulk extraction |
| Batch jobs | PostgreSQL `batch_jobs` table | ~100+ | Batch API metadata |

---

*Last Updated: 2026-02-22*
