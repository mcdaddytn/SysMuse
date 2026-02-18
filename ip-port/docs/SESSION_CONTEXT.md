# Session Context — February 18, 2026

## Current State Summary

### Infrastructure Status

| Component | Status | Port |
|-----------|--------|------|
| API Server | `npm run dev` (from root) | 3001 |
| Frontend | `npm run dev` (from frontend/) | 3000 |
| PostgreSQL | Docker | 5432 |
| Elasticsearch | Docker | 9200/9300 |

### Active Development Queue

**Primary roadmap:** `DEVELOPMENT_QUEUE_V3.md` (extracted from `TAXONOMY_AND_LLM_ENHANCEMENT_PLAN.md`)

| Phase | Status | Summary |
|-------|--------|---------|
| Phase 0 | Not started | Quick wins & rename to "IP Port" |
| Phase 1 | Not started | VIDEO_STREAMING deep dive & multi-portfolio foundation |
| Phase 2 | Not started | Sector overlap detection |
| Phase 3 | Not started | Focus area pipeline — litigation opportunities |
| Phase 4 | Not started | Product layer & external integration |
| Phase 5 | **Partially complete** | Enrichment & scoring pipeline upgrade |
| Phase 6 | Not started | Taxonomy deepening |
| Phase 7 | Deferred | Data service layer & production readiness |

---

## What Was Completed (Feb 14-18)

### Batch LLM Scoring System (Phase 5 items — Feb 17-18)

Full 7-step implementation plan completed:

1. **Token/model tracking** — `processBatchResults()` now persists `llmModel` and `tokensUsed` to DB per patent score
2. **Cancel & refresh-all endpoints** — `DELETE /llm/batch-cancel/:batchId`, `POST /llm/batch-refresh-all`
3. **Frontend API layer** — `scoringTemplatesApi` extended with batch, snapshot, and comparison methods
4. **SectorManagementPage batch UI** — Batch-default scoring with model dropdown, batch job status panel with polling/process/cancel
5. **Score snapshots** — `POST /llm/snapshot`, `GET /llm/snapshots`, `GET /llm/snapshot/:id/compare` with LLM enum in Prisma
6. **Multi-model comparison** — `POST /llm/compare-models/:sectorName` with side-by-side results table
7. **JobQueuePage batch tab** — "LLM Batch Scoring" tab showing all batch jobs across sectors

**Key decisions:**
- **Sonnet 4 confirmed as default model** — comparable scores to Opus 4.6 at 1/6th the cost
- Batch API saves 50% vs realtime — overnight scoring of 1,857 VIDEO_STREAMING patents took ~3 min
- Haiku produces significantly different scores — not suitable as a direct replacement for sector scoring

### Bugs Found & Fixed (Feb 17-18)

1. **Sector progress showing 200%** — Duplicate `PatentSubSectorScore` rows from old realtime scoring (CUID `sub_sector_id`) vs batch scoring (sector name as `sub_sector_id`). Fixed with `DISTINCT ON (patent_id)` subquery.
2. **Snapshot creation unique constraint** — Same patent appeared in multiple score rows. Fixed with patentId deduplication (keep most recent by `updatedAt`).
3. **Snapshot comparison broken variable** — `currentScores.length` referenced after renaming to `allCurrentScores`. Fixed to `currentMap.size`.
4. **`isLlmBatchProcessable` wrong check** — Checked `!job.completedAt` instead of `!job.results.processed`. Fixed.
5. **Prisma LLM enum not recognized** — Required `npx prisma generate` after adding `LLM` to `ScoreType` enum.

### Earlier Work (Feb 14-15)

- Phase 1-4 of original dev queue: Portfolio page, filtering, aggregates, Patent Family Explorer V2
- Shared grid infrastructure (`useGridColumns` composable, `GenericColumnSelector`)
- Enrichment pipeline with dual-cache lookups and auto-enrich on exploration load
- See `FAMILY_EXPANSION_V2_ANALYSIS.md` and `FAMILY_EXPANSION_V2_IMPLEMENTATION_PLAN.md` for details

---

## Important Notes for Next Session

### Sub-Sector Templates Do NOT Exist for VIDEO_STREAMING

Despite multiple discussions about breaking out VIDEO_STREAMING into subsectors with custom LLM questions, **this work has not been done**. Current state:
- `config/scoring-templates/sectors/`: 6 video sector templates (video-broadcast, video-client-processing, video-codec, video-drm-conditional, video-server-cdn, video-storage) — each has 5 custom questions
- `config/scoring-templates/sub-sectors/`: 14 templates but NONE for video (only adc-dac, amplifiers, baseband-equalization, etc.)
- DB sub-sectors are just CPC codes, not custom breakdowns
- Detailed subsector proposals with CPC analysis exist in `TAXONOMY_AND_LLM_ENHANCEMENT_PLAN.md` Section 21

**Do NOT re-score large sectors without first creating sub-sector question breakdowns.** Budget should go toward tailored questions at subsector level.

### GUI Redesign Needed

Sector management and LLM batch scoring experience needs redesign:
- Scoring/batch functionality split across SectorManagementPage and JobQueuePage
- Model comparison results not persisted or easily retrievable
- Sub-sector creation and question authoring need a dedicated workflow
- User will submit new design requirements

### Scoring Template Hierarchy

```
portfolio-default.json (7 questions, applies to all patents)
    └── super-sectors/{name}.json (3-4 additional questions per super-sector)
           └── sectors/{name}.json (4-6 additional questions per sector)
                  └── sub-sectors/{id}.json (if exists — currently sparse, none for video)
```

---

## ONGOING: Chrome Scrollbar Visibility Problem

**Status**: UNRESOLVED — scrollbars work in Safari but NOT in Chrome.

**Working reference**: Commit `37bf802` ("Fixed scrolling patent summary", 2/14 2:03 PM)

The CSS is functionally identical to the working commit. Safari renders correctly, Chrome does not. See previous session context for full investigation notes and next steps. Key items to try:
1. Chrome DevTools — inspect computed styles for `::-webkit-scrollbar` rules
2. Try `scrollbar-gutter: stable both-edges`
3. Check if scoped `[data-v-xxx]::-webkit-scrollbar` treated differently in Chrome
4. Try reverting PortfolioPage.vue to exact `37bf802` version

---

## Key Files

| File | Purpose |
|------|---------|
| `docs/DEVELOPMENT_QUEUE_V3.md` | Active development queue (Phases 0-7) |
| `docs/TAXONOMY_AND_LLM_ENHANCEMENT_PLAN.md` | Master requirements document |
| `docs/scoring-and-enrichment-guide.md` | How-to for batch scoring, models, snapshots |
| `src/api/services/llm-scoring-service.ts` | Batch API, model comparison, scoring service |
| `src/api/routes/scoring-templates.routes.ts` | Scoring endpoints including batch, snapshot, comparison |
| `frontend/src/services/api.ts` | Frontend API client with batch/snapshot/comparison methods |
| `frontend/src/pages/SectorManagementPage.vue` | Sector scoring with batch UI, snapshots, model comparison |
| `frontend/src/pages/JobQueuePage.vue` | Job queue with LLM Batch Scoring tab |
| `frontend/src/pages/PatentFamilyExplorerPage.vue` | V2 explorer (~1650 lines) |
| `frontend/src/pages/PortfolioPage.vue` | Patent summary with flex filters |
| `frontend/src/pages/FocusAreaDetailPage.vue` | Focus area detail (~2750 lines) |
| `config/scoring-templates/` | Template hierarchy (portfolio → super-sector → sector → sub-sector) |
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
| Batch jobs | `cache/batch-jobs/` | ~8 | Batch API metadata |
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
```

---

## Doc Organization

- **Active docs:** `docs/` — current design docs and guides (Feb 2026+)
- **Archived docs:** `docs/archive/` — pre-February 2026 docs (still available for reference)
- **Master roadmap:** `docs/TAXONOMY_AND_LLM_ENHANCEMENT_PLAN.md`
- **Dev queue:** `docs/DEVELOPMENT_QUEUE_V3.md`

---

*Last Updated: 2026-02-18*
