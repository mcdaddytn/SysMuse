# Session Context — February 19, 2026

## Current State Summary

### Infrastructure Status

| Component | Status | Port |
|-----------|--------|------|
| API Server | `npm run dev` (from root) | 3001 |
| Frontend | `npm run dev` (from frontend/) | 3000 |
| PostgreSQL | Docker | 5432 |
| Elasticsearch | Docker | 9200/9300 |

### Active Development Queue

**Primary roadmap:** `DEVELOPMENT_QUEUE_V4.md` (reconciled from V3 + Feb 18-19 work)

| Phase | Status | Summary |
|-------|--------|---------|
| Phase 0 | **Complete** | Quick wins & rename to "IP Port" |
| Phase 1 | **Complete** | Multi-portfolio foundation, competitor imports, CPC plumbing |
| Phase 2 | **In progress** | Sector overlap detection — data ready, analysis needed |
| Phase 3 | Not started | Focus area pipeline — litigation opportunities |
| Phase 4 | Not started | Product layer & external integration |
| Phase 5 | **Mostly complete** | Enrichment & scoring pipeline upgrade |
| Phase 6 | Not started | Taxonomy deepening |
| Phase 7 | Deferred | Data service layer & production readiness |

---

## What Was Completed (Feb 19)

### CPC Inventive Designation Pipeline (Phase A1-A3 from plan)

Full CPC data plumbing from XML to DB to sector assignment:

1. **`enrichPatentCpcFromXml()`** in `patent-xml-parser-service.ts` — parses XML, upserts `PatentCpc` with `isInventive`, updates `Patent.primaryCpc` using inventive-aware logic
2. **`enrichPatentCpcBatch()`** — batch wrapper with progress callback
3. **Hooked into XML extraction** — `extract-patent-xmls-batch.ts` runs CPC enrichment automatically after XML extraction
4. **Backfill endpoint** — `POST /api/batch-jobs/sync-cpc-designations` for patents with XML but no inventive CPC data
5. **Sub-sector service updated** — `findBestSubSector()` now reads inventive CPCs from DB with fallback to legacy JSON

### CPC Assignment Strategy System (Phase A2)

New file: `src/api/services/cpc-assignment-strategy.ts`

4 pluggable strategies for determining primary CPC:
- `first-inventive` — deterministic default, prefers main inventive CPC
- `cluster-fit` — aligns with well-populated existing sectors
- `discovery` — identifies gaps in taxonomy
- `portfolio-overlap` — competitive analysis based on CPC frequency in target portfolio

Wired into `sector-assignment-service.ts`:
- `reassignPortfolioPatents()` accepts `cpcStrategy` param
- `assignSector()` weights inventive CPCs (1.0) higher than additional (0.5)

### Frontend Scoring UI (Phase B2)

In `JobQueuePage.vue`:
- **Model selector** — Sonnet 4 (default), Opus 4, Haiku 3.5
- **Batch mode toggle** — batch (50% off, ~24h) vs realtime (full price, immediate)
- **Auto-snapshots** — auto-created when ≥50 patent LLM batch completes, show/hide toggle

### Import Dialog

- Added configurable import limit dialog (replaced hardcoded 100)
- Default: 1,000 patents; dropdown options up to 10,000

### Aggregate View Presets

- 4 built-in presets: Sector Overview, Sector Detail, Competitor Landscape, Tech Categories
- Custom preset save/load/manage to localStorage
- Last-used preset restored on mount

### Netflix Scoring Status

- **Pre-claims snapshot**: `cmltknetn0001n19ns60yahj2` (385 patents, default weights)
- **With-claims scoring COMPLETE**: 22 batch jobs, 384/385 succeeded (1 error in `computing-systems`)
- All results processed — ready for post-claims snapshot comparison
- TODO: Take post-claims snapshot and compare

---

## What Was Completed (Feb 17-18)

### Batch LLM Scoring System (Phase 5 items)

Full 7-step implementation:

1. Token/model tracking — `processBatchResults()` persists `llmModel` and `tokensUsed` to DB per patent score
2. Cancel & refresh-all endpoints
3. Frontend API layer — `scoringTemplatesApi` extended
4. SectorManagementPage batch UI
5. Score snapshots — create, list, compare with LLM enum
6. Multi-model comparison — side-by-side results table
7. JobQueuePage batch tab

### Portfolio Import Pipeline (Feb 18)

- Company → Affiliates → PatentsView search → Import → Auto-hydrate → Auto-assign sectors → Extract XMLs → Score
- Netflix (385), Hulu (100), Zoom (585), Chelsio (38) imported

### Patent XML Extraction

- TypeScript port in `patent-xml-extractor-service.ts` with readline streaming
- Batch extraction script with CPC enrichment hook
- Admin UI integration

---

## Cross-Portfolio Analysis (as of Feb 19)

### Enrichment Coverage

| Portfolio | Total | XML | LLM Scored | Sectors |
|---|---|---|---|---|
| broadcom-core | 29,474 | 22% | 59% | 100% |
| zoom | 585 | 83% | **0%** | 100% |
| netflix | 385 | 73% | 100% | 100% |
| hulu | 100 | 93% | 100% | 100% |
| chelsio | 38 | 0% | 100% | 100%* |

*Chelsio uses non-standard taxonomy names — needs reassignment.

### CPC Inventive Data

| Portfolio | Patents w/ CPC | Inventive CPCs | Total CPCs |
|---|---|---|---|
| broadcom-core | 29,419 | 57,991 | 173,406 |
| zoom | 570 | 1,738 | 4,247 |
| netflix | 385 | **0** | 3,642 |
| hulu | 96 | **0** | 778 |
| chelsio | 38 | **0** | 172 |

Netflix/Hulu/Chelsio CPCs came from PatentsView (no inventive designation). Need CPC backfill from XML.

### VIDEO_STREAMING Overlap

| Portfolio | VIDEO_STREAMING Patents |
|---|---|
| broadcom-core | 1,857 |
| netflix | 229 |
| hulu | 77 |
| zoom | 56 |

---

## What Was Completed (Feb 19 — Session 2)

### Infrastructure Improvements

1. **Removed 500 batch size cap** — auto-splits into multiple jobs in same group when patents > 500
2. **Moved job tracking to PostgreSQL** — `batch_jobs` table replaces `logs/batch-jobs.json`; survives server restarts, `reconcileJobsOnStartup()` handles stale PIDs
3. **Super-sectors fully DB-driven** — new `useSuperSectors.ts` composable loads from `GET /api/sectors/super-sectors`, replaced 4 hardcoded `sectorColors` objects + hardcoded `superSectorOptions` across frontend
4. **Live job progress tracking** — backend parses `Progress: X/Y` from log files during polling, updates `completedPatents` and recalculates ETA in real-time; frontend shows progress bar + completion percentage for running jobs
5. **Fixed Chelsio taxonomy** — hydration service was storing display names from config; fixed to use DB-backed `getPrimarySectorAsync()`/`getSuperSectorAsync()`; reassigned 13 patents
6. **Backend config reads eliminated** — `patents.routes.ts` now uses DB-cached `loadSuperSectorLookup()` instead of reading `super-sectors.json`; `sector-assignment-service.ts` fallback changed from hardcoded `'COMPUTING'` to `'UNCLASSIFIED'`

### Key New/Modified Files

| File | Change |
|------|--------|
| `frontend/src/composables/useSuperSectors.ts` | **New** — shared composable for DB-driven super-sector data |
| `prisma/schema.prisma` | Added `BatchJob` model |
| `src/api/routes/batch-jobs.routes.ts` | Full rewrite: DB-backed jobs, log progress parsing, auto-split |
| `src/api/routes/patents.routes.ts` | DB-cached super-sector lookup, removed config reads |
| `src/api/services/sector-assignment-service.ts` | `UNCLASSIFIED` fallback instead of `COMPUTING` |
| `src/api/services/patent-hydration-service.ts` | Fixed to use async DB-backed sector functions |

---

## Immediate Action Items

1. **Run CPC backfill** for Netflix/Hulu (have XMLs but 0 inventive CPCs)
2. **Take post-claims Netflix snapshot** and compare with pre-claims
3. **Score Zoom** — 585 patents, 0% LLM coverage
4. **Investigate 1 Netflix error** in `computing-systems` sector

---

## Important Notes for Next Session

### Sub-Sector Templates Do NOT Exist for VIDEO_STREAMING

Despite multiple discussions about breaking out VIDEO_STREAMING into subsectors with custom LLM questions, **this work has not been done**. Current state:
- `config/scoring-templates/sectors/`: 6 video sector templates (video-broadcast, video-client-processing, video-codec, video-drm-conditional, video-server-cdn, video-storage) — each has 5 custom questions
- `config/scoring-templates/sub-sectors/`: 14 templates but NONE for video (only adc-dac, amplifiers, baseband-equalization, etc.)
- DB sub-sectors are just CPC codes, not custom breakdowns
- Detailed subsector proposals with CPC analysis exist in `TAXONOMY_AND_LLM_ENHANCEMENT_PLAN.md` Section 21

**Do NOT re-score large sectors without first creating sub-sector question breakdowns.**

### GUI Redesign Needed

Sector management and LLM batch scoring experience needs redesign:
- Scoring/batch functionality split across SectorManagementPage and JobQueuePage
- Model comparison results not persisted or easily retrievable
- Sub-sector creation and question authoring need a dedicated workflow
- User will submit new design requirements

### Chrome Scrollbar Problem — UNRESOLVED

Scrollbars work in Safari but NOT in Chrome. CSS is correct (verified via diff). See MEMORY.md for investigation notes.

### Scoring Template Hierarchy

```
portfolio-default.json (7 questions, applies to all patents)
    └── super-sectors/{name}.json (3-4 additional questions per super-sector)
           └── sectors/{name}.json (4-6 additional questions per sector)
                  └── sub-sectors/{id}.json (if exists — currently sparse, none for video)
```

---

## Key Files

| File | Purpose |
|------|---------|
| `docs/DEVELOPMENT_QUEUE_V4.md` | Active development queue (Phases 0-7) |
| `docs/TAXONOMY_AND_LLM_ENHANCEMENT_PLAN.md` | Master requirements document |
| `docs/scoring-and-enrichment-guide.md` | How-to for batch scoring, models, snapshots |
| `src/api/services/patent-xml-parser-service.ts` | XML parsing + CPC enrichment |
| `src/api/services/cpc-assignment-strategy.ts` | 4 CPC assignment strategies |
| `src/api/services/sector-assignment-service.ts` | Sector assignment with inventive CPC weighting |
| `src/api/services/sub-sector-service.ts` | Sub-sector assignment with DB CPC support |
| `src/api/services/llm-scoring-service.ts` | Batch API, model comparison, scoring service |
| `src/api/routes/batch-jobs.routes.ts` | Batch job endpoints, CPC backfill, auto-snapshots |
| `src/api/routes/scoring-templates.routes.ts` | Scoring endpoints |
| `frontend/src/services/api.ts` | Frontend API client |
| `frontend/src/pages/JobQueuePage.vue` | Job queue with LLM Batch Scoring tab |
| `frontend/src/pages/AggregatesPage.vue` | Aggregates with preset system |
| `frontend/src/pages/SectorManagementPage.vue` | Sector scoring with batch UI |
| `frontend/src/pages/AdminPage.vue` | Portfolio/company/affiliate management |
| `config/scoring-templates/` | Template hierarchy |
| `cache/batch-jobs/` | Batch job metadata JSON files |

---

## Cache & Data Locations

| Cache | Path | ~Count | Source |
|-------|------|--------|--------|
| Prosecution scores | `cache/prosecution-scores/` | 11,576 | Prosecution scoring pipeline |
| IPR scores | `cache/ipr-scores/` | 10,745 | IPR scoring pipeline |
| File wrapper | `cache/api/file-wrapper/` | 454 | enrichWithDetails API |
| PTAB | `cache/api/ptab/` | 455 | enrichWithDetails API |
| LLM scores | `cache/llm-scores/` | ~17,529 | LLM scoring pipeline |
| Batch jobs | `cache/batch-jobs/` | ~30+ | Batch API metadata |
| Batch results | `cache/batch-results/` | varies | Batch API result files |

---

## Commands Reference

```bash
# Start API server (from project root)
npm run dev

# Start frontend (from frontend directory)
cd frontend && npm run dev

# Start Docker services
docker-compose up -d postgres elasticsearch

# Prisma operations
npx prisma generate    # Regenerate client after schema changes
npx prisma migrate dev # Run pending migrations

# CPC backfill for existing XMLs
curl -X POST http://localhost:3001/api/batch-jobs/sync-cpc-designations
```

---

## Doc Organization

- **Active docs:** `docs/` — current design docs and guides (Feb 2026+)
- **Archived docs:** `docs/archive/` — pre-February 2026 docs
- **Master roadmap:** `docs/TAXONOMY_AND_LLM_ENHANCEMENT_PLAN.md`
- **Dev queue:** `docs/DEVELOPMENT_QUEUE_V4.md`

---

*Last Updated: 2026-02-19*
