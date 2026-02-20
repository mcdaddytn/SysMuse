# Session Context — February 20, 2026

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

## What Was Completed (Feb 20)

### Patent Quarantine System

Full quarantine tracking for patents that can't be fully enriched (design, reissue, pre-2005, recent, extraction failures). Eliminates false "99%" enrichment tiers.

**Schema changes:**
- `isQuarantined` (Boolean) — fast filter across all grids
- `quarantine` (JSON) — per-coverage-type reasons, e.g. `{ "xml": "design-patent" }`
- `patentIdNumeric` (Int) — numeric patent ID for sorting/matching (populated for all 31,789 patents)
- GIN index on quarantine JSON, btree index on patentIdNumeric

**Backend:**
- `patent-data-service.ts` — filter, buildWhereClause, mapDTO, getAllFilterOptions all quarantine-aware
- `batch-jobs.routes.ts` — `analyzeGaps()` uses quarantine instead of hardcoded `isXmlEligible()`; `POST /api/batch-jobs/auto-quarantine` with dry run support
- `patents.routes.ts` — enrichment-summary and sector-enrichment use quarantine-driven XML denominators; CRUD endpoints: quarantine-summary, quarantine/unquarantine (single + bulk); export includes quarantine columns

**Frontend:**
- `FlexFilterBuilder.vue` — isQuarantined boolean filter + count in summary
- `patents.ts` store — quarantine + numeric ID columns
- `PortfolioPage.vue` + `FocusAreaDetailPage.vue` — orange quarantine badge cell template
- `PatentDetailPage.vue` — quarantine banner with unquarantine action
- `JobQueuePage.vue` — new Quarantine tab (auto-detect, dry run, grouped tables, bulk unquarantine); XML enrichment badges show quarantine counts; responds to portfolio selector
- `api.ts` — `quarantineApi` module + `autoQuarantine` on `batchJobsApi`

**Applied auto-quarantine:**

| Reason | Count |
|--------|-------|
| pre-2005 | 3,418 |
| design-patent | 77 |
| recent-no-bulk | 69 |
| reissue-patent | 15 |
| **Total quarantined** | **3,579** |
| **Active (not quarantined)** | **28,210** |

---

## What Was Completed (Feb 19 — Sessions 1 & 2)

### CPC Inventive Designation Pipeline
- `enrichPatentCpcFromXml()` + batch wrapper + XML extraction hook
- Backfill endpoint: `POST /api/batch-jobs/sync-cpc-designations`
- 4 pluggable CPC assignment strategies (`cpc-assignment-strategy.ts`)
- Sector assignment weights inventive CPCs (1.0) higher than additional (0.5)

### Frontend Scoring UI
- Model selector, batch mode toggle, auto-snapshots in JobQueuePage
- Import dialog with configurable limits (up to 10,000)
- Aggregate view presets (4 built-in + custom save/load)

### Infrastructure Improvements
- Removed 500 batch size cap — auto-splits into multiple jobs
- Job tracking moved to PostgreSQL (`batch_jobs` table)
- Super-sectors fully DB-driven (`useSuperSectors.ts` composable)
- Live job progress tracking with ETA
- Fixed Chelsio taxonomy, backend config reads eliminated

### Netflix Scoring
- Pre-claims snapshot: `cmltknetn0001n19ns60yahj2` (385 patents)
- With-claims scoring COMPLETE: 384/385 succeeded

---

## What Was Completed (Feb 17-18)

- Batch LLM scoring system (7-step implementation)
- Portfolio import pipeline (Netflix 385, Hulu 100, Zoom 585, Chelsio 38)
- Patent XML extraction TypeScript port with readline streaming

---

## Cross-Portfolio Analysis (as of Feb 20)

### Enrichment Coverage

| Portfolio | Total | XML | LLM Scored | Quarantined | Sectors |
|---|---|---|---|---|---|
| broadcom-core | 29,474 | 22% | 59% | ~3,500 | 100% |
| zoom | 585 | 83% | **0%** | ~10 | 100% |
| netflix | 385 | 73% | 100% | ~5 | 100% |
| hulu | 100 | 93% | 100% | ~2 | 100% |
| chelsio | 38 | 0% | 100% | 0 | 100% |

*Quarantine counts are approximate per-portfolio; 3,579 total across all portfolios.*

### CPC Inventive Data

| Portfolio | Patents w/ CPC | Inventive CPCs | Total CPCs |
|---|---|---|---|
| broadcom-core | 29,419 | 57,991 | 173,406 |
| zoom | 570 | 1,738 | 4,247 |
| netflix | 385 | **0** | 3,642 |
| hulu | 96 | **0** | 778 |
| chelsio | 38 | **0** | 172 |

Netflix/Hulu/Chelsio CPCs came from PatentsView (no inventive designation). Need CPC backfill from XML.

---

## Immediate Action Items

1. **Run CPC backfill** for Netflix/Hulu (have XMLs but 0 inventive CPCs)
2. **Take post-claims Netflix snapshot** and compare with pre-claims
3. **Score Zoom** — 585 patents, 0% LLM coverage
4. **Investigate 1 Netflix error** in `computing-systems` sector
5. **Phase 2 work** — sector overlap analysis, competitive landscape view

---

## Important Notes for Next Session

### Sub-Sector Templates Do NOT Exist for VIDEO_STREAMING

Despite multiple discussions about breaking out VIDEO_STREAMING into subsectors with custom LLM questions, **this work has not been done**. Current state:
- `config/scoring-templates/sectors/`: 6 video sector templates — each has 5 custom questions
- `config/scoring-templates/sub-sectors/`: 14 templates but NONE for video
- DB sub-sectors are just CPC codes, not custom breakdowns
- Detailed subsector proposals in `TAXONOMY_AND_LLM_ENHANCEMENT_PLAN.md` Section 21

**Do NOT re-score large sectors without first creating sub-sector question breakdowns.**

### Quarantine System — Operational

- 3,579 patents quarantined (auto-detected)
- Enrichment tiers now show 100% when all eligible work is done
- Quarantine tab in JobQueuePage for visibility and management
- Quarantined patents still fully accessible — can be viewed, scored, added to focus areas

### GUI Redesign Needed

Sector management and LLM batch scoring experience needs redesign:
- Scoring/batch functionality split across SectorManagementPage and JobQueuePage
- Model comparison results not persisted or easily retrievable
- Sub-sector creation and question authoring need a dedicated workflow

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
| `src/api/services/patent-data-service.ts` | Patent queries, filters, DTO mapping |
| `src/api/services/patent-xml-parser-service.ts` | XML parsing + CPC enrichment |
| `src/api/services/cpc-assignment-strategy.ts` | 4 CPC assignment strategies |
| `src/api/services/sector-assignment-service.ts` | Sector assignment with inventive CPC weighting |
| `src/api/services/llm-scoring-service.ts` | Batch API, model comparison, scoring service |
| `src/api/routes/batch-jobs.routes.ts` | Batch job endpoints, auto-quarantine, gap analysis |
| `src/api/routes/patents.routes.ts` | Patent CRUD, enrichment-summary, quarantine endpoints |
| `frontend/src/services/api.ts` | Frontend API client (quarantineApi, batchJobsApi, etc.) |
| `frontend/src/pages/JobQueuePage.vue` | Job queue + Quarantine tab |
| `frontend/src/pages/PortfolioPage.vue` | Main patent grid with quarantine badge |
| `frontend/src/pages/PatentDetailPage.vue` | Patent detail with quarantine banner |
| `frontend/src/stores/patents.ts` | Column definitions (quarantine + numeric ID) |
| `frontend/src/components/filters/FlexFilterBuilder.vue` | Filters including isQuarantined |
| `config/scoring-templates/` | Template hierarchy |

---

## Cache & Data Locations

| Cache | Path | ~Count | Source |
|-------|------|--------|--------|
| Prosecution scores | `cache/prosecution-scores/` | 11,576 | Prosecution scoring pipeline |
| IPR scores | `cache/ipr-scores/` | 10,745 | IPR scoring pipeline |
| File wrapper | `cache/api/file-wrapper/` | 454 | enrichWithDetails API |
| PTAB | `cache/api/ptab/` | 455 | enrichWithDetails API |
| LLM scores | `cache/llm-scores/` | ~17,529 | LLM scoring pipeline |
| Batch jobs | PostgreSQL `batch_jobs` table | ~30+ | Batch API metadata |
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

# Schema changes
./scripts/db.sh push && ./scripts/db.sh generate

# Auto-quarantine (dry run)
curl -X POST http://localhost:3001/api/batch-jobs/auto-quarantine -H 'Content-Type: application/json' -d '{"dryRun": true}'

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

*Last Updated: 2026-02-20*
