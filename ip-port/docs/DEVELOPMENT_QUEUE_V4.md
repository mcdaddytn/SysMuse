# Development Queue V4 — Litigation Opportunity Platform

*Reconciled from V3 + work completed Feb 18-20, 2026*
*Last Updated: 2026-02-20*

## Overview

Phases organized around **proof of concept with litigation analysis** as the priority. Each phase validates the approach before investing in the next. Pivots expected based on findings.

**POC Scope:** VIDEO_STREAMING sector — ~1,857 sector-scored patents. Competitors: Netflix (385), Hulu (100), Zoom (585).

**Master requirements document:** `TAXONOMY_AND_LLM_ENHANCEMENT_PLAN.md` (Sections 1-13 contain detailed requirements for each capability area).

---

## Phase 0: Quick Wins & Rename (1-2 days)
**Goal:** Visible progress, remove friction.
**Status:** COMPLETE

- [ ] Rename "Patent Workstation" to "IP Port" in toolbar and browser title
- [ ] Add new portfolio-level LLM questions (Product Mapping Probability, Evidence of Use Detectability, Licensing Revenue Potential, Tech Component Classification)
- [ ] **Do NOT incorporate new questions into composite score yet** — run on a small batch (50-100 patents in VIDEO_STREAMING), evaluate quality, then decide on weight integration
- [ ] Update `portfolio-default.json` template with new questions at weight 0 (scored but not counted) for testing

---

## Phase 1: VIDEO_STREAMING Deep Dive & Multi-Portfolio Foundation
**Goal:** Demonstrate end-to-end litigation analysis in VIDEO_STREAMING.
**Status:** COMPLETE (Feb 18-19)

- [x] Add `Portfolio` model to Prisma schema (name, type, affiliates)
- [x] Migrate Broadcom affiliates from static JSON to database
- [x] Build Admin page with Portfolio and Affiliate management
- [x] LLM-assisted affiliate discovery for competitors
- [x] PatentsView assignee search with pagination and deduplication
- [x] Import competitor patents — Netflix (385), Hulu (100), Zoom (585), Chelsio (38)
- [x] Auto-hydrate + auto-assign sectors on import
- [x] Archive current LLM scores before re-scoring (snapshot system)

**Additions beyond V3 plan (Feb 18-19):**
- [x] Import dialog with configurable patent limits (100-10,000)
- [x] Batch XML extraction pipeline with CPC enrichment hook
- [x] CPC inventive designation plumbing (XML → PatentCpc.isInventive → DB)
- [x] CPC backfill endpoint for existing XMLs (`POST /api/batch-jobs/sync-cpc-designations`)
- [x] Flexible CPC assignment strategy system (4 strategies: first-inventive, cluster-fit, discovery, portfolio-overlap)
- [x] Sector assignment now weights inventive CPCs higher (1.0 vs 0.5 for additional)
- [x] Sub-sector service updated to use DB-backed inventive CPCs
- [x] Netflix with-claims scoring complete (384/385 succeeded)

---

## Phase 2: Sector Overlap Detection — VIDEO_STREAMING Focus (3-5 days)
**Goal:** Find the battleground subsectors within VIDEO_STREAMING.
**Status:** IN PROGRESS — data foundation ready, analysis needed

### Current Cross-Portfolio State

| Portfolio | VIDEO_STREAMING | SECURITY | NETWORKING | COMPUTING | Total |
|---|---|---|---|---|---|
| broadcom-core | 1,857 | 4,382 | 6,200 | 8,040 | 29,474 |
| netflix | 229 | 60 | 50 | 38 | 385 |
| zoom | 56 | 55 | 337 | 87 | 585 |
| hulu | 77 | 0 | 5 | 14 | 100 |
| chelsio | 0 | 0 | 28* | 1 | 38 |

*Chelsio uses different taxonomy names — needs reassignment with standard taxonomy.

### Key Overlap Sectors (hotspots)

| Sector | Broadcom | Netflix | Hulu | Zoom |
|---|---|---|---|---|
| video-server-cdn | — | 153 | 53 | — |
| network-auth-access | 1,809 | 27 | — | 28 |
| network-switching | 2,837 | 21 | — | 160 |
| video-codec | — | 27 | 16 | — |
| computing-runtime | 3,868 | 23 | — | 19 |
| streaming-multimedia | — | 5 | — | 102 |

### Remaining Work
- [ ] Run Zoom through LLM scoring (585 patents, 0% scored)
- [ ] Run CPC backfill for Netflix/Hulu/Chelsio (0 inventive CPCs populated)
- [ ] Compute sector overlap matrix within VIDEO_STREAMING subsectors
- [ ] Identify density hotspots — subsectors with high patent count from both portfolios
- [ ] Citation overlap analysis — cross-citations between our VIDEO_STREAMING patents and competitors'
- [ ] Family expansion comparison — parallel family activity in same subsectors
- [ ] Build overlap visualization in Sector Rankings or a new Competitive Landscape view

**POC Target:** Identify 2-3 VIDEO_STREAMING subsectors (e.g., adaptive-bitrate, DRM, codec-optimization) with strong overlap and rich data for litigation analysis.

---

## Phase 3: Focus Area Pipeline — Litigation Opportunities (3-5 days)
**Goal:** Turn VIDEO_STREAMING overlap hotspots into actionable analysis.
**Status:** NOT STARTED

- [ ] Auto-create focus groups from overlap hotspots (our top patents + competitor nearby patents)
- [ ] Build litigation-oriented prompt templates (Competitive Landscape Synthesis, Design-Around Assessment, 3rd Party Screening)
- [ ] Run custom LLM analysis on focus areas using Opus Batch for highest quality
- [ ] Produce ranked litigation opportunity list with confidence levels
- [ ] Export format for attorney review (CSV + markdown initially; PDF/DOCX later)

**POC Target:** Produce 2-3 VIDEO_STREAMING litigation opportunity assessments. If compelling, validate top candidates with Patlytics (up to 150 free credits available).

---

## Phase 4: Product Layer & External Integration (5-7 days)
**Goal:** Add products to the analysis.
**Status:** NOT STARTED

- [ ] Add `Product` model to Prisma schema
- [ ] Build product import from .xlsx/.csv (Patlytics exports)
- [ ] PDF document analysis: extract tech specs and components from product datasheets
- [ ] LLM tech stack inference: product → components → patent claim mapping
- [ ] Incorporate product data from public sources (iFixit teardowns, FCC filings, published specs)
- [ ] Link products to patents and companies in the system
- [ ] Enhance focus area LLM templates with product data context

**POC Target:** Import product data for 1-2 validated VIDEO_STREAMING litigation targets; demonstrate patent-product mapping within the system.

---

## Phase 5: Enrichment & Scoring Pipeline Upgrade
**Goal:** Scale the analysis capability.
**Status:** MOSTLY COMPLETE

### Completed (Feb 17-19)
- [x] Anthropic Batch API integration for overnight scoring (50% cost, async processing)
- [x] Model selection in scoring service (Sonnet 4, Haiku 4.5, Opus 4.6 available)
- [x] Multi-model comparison tool (side-by-side scoring with cost analysis)
- [x] Score snapshots for LLM scoring (create, list, compare to current)
- [x] Batch job management GUI (SectorManagementPage + JobQueuePage batch tabs)
- [x] Batch job status polling, cancel, process results
- [x] Token/model tracking persisted to DB per patent score
- [x] Sonnet 4 confirmed as default model (comparable to Opus at 1/6th cost)
- [x] Frontend model selector + batch/realtime toggle in Start Jobs dialog
- [x] Auto-snapshots on large (≥50 patent) LLM batch completion
- [x] CPC inventive designation pipeline (XML → DB → sector assignment)
- [x] 4 pluggable CPC assignment strategies
- [x] Named presets for Aggregate View (4 built-in + custom save/load)
- [x] Patent XML extraction with CPC enrichment hook

### Completed (Feb 20) — Patent Quarantine System
- [x] `isQuarantined` boolean + `quarantine` JSON + `patentIdNumeric` Int fields in Patent schema
- [x] Auto-quarantine detection: design (77), reissue (15), pre-2005 (3,418), recent-no-bulk (69) = 3,579 total
- [x] Quarantine-aware enrichment denominators — XML tiers now show 100% when all eligible work done
- [x] Full CRUD: auto-quarantine, manual quarantine/unquarantine, bulk operations, quarantine-summary
- [x] Frontend: Quarantine tab in JobQueuePage, filter in FlexFilterBuilder, badge in grids, banner in PatentDetailPage
- [x] `patentIdNumeric` populated for all 31,789 patents (for future sorting/matching)
- [x] GIN index on quarantine JSON, btree index on patentIdNumeric

### Remaining
- [ ] Top-N scoring with renormalization for lower patents (avoid full-portfolio reruns)
- [ ] Persistent cost tracking per scoring run (aggregate cost summaries)
- [ ] Data archiving before bulk re-scoring (revert capability)
- [ ] Re-scoring detection when templates change
- [ ] Subsector templates for VIDEO_STREAMING sectors with litigation-oriented questions
- [ ] Gradually extend to other super-sectors based on POC learnings
- [ ] Job Queue display improvements — portfolio info, model/mode, better naming
- [ ] Update job time estimates for batch API mode

### Key Notes
- **Do NOT re-score large sectors without first creating sub-sector question breakdowns** — budget should go toward tailored questions at subsector level, not repeated broad sector scoring
- VIDEO_STREAMING sub-sector templates with custom LLM questions do NOT yet exist
- See `TAXONOMY_AND_LLM_ENHANCEMENT_PLAN.md` Section 21 for VIDEO_STREAMING subsector CPC analysis and proposals

---

## Phase 6: Taxonomy Deepening (5-7 days)
**Goal:** Improve classification granularity across the portfolio.
**Status:** NOT STARTED

- [ ] LLM-assisted subsector classification of full portfolio
- [ ] Misfit sector reorganization (rf-acoustic, audio, power-management, etc.)
- [ ] Multiple taxonomy support (CPC-derived, product-based, competitor-based, custom)
- [ ] Multi-model ensemble testing on sample sets
- [ ] Competitor-informed LLM questions at sector/subsector level
- [ ] Expand competitor analysis to WIRELESS sector (Samsung, Qualcomm) once taxonomy is deeper
- [ ] Fix Chelsio taxonomy (uses non-standard names like "SDN & Network Infrastructure")

---

## Phase 7: Data Service Layer & Production Readiness (deferred)
**Goal:** Prepare for scale and server deployment. Timeline TBD based on POC results.
**Status:** NOT STARTED

- [ ] Unified data service layer (`PatentDataService`, `PortfolioService`, `ProductService`)
- [ ] Migrate patent master data from JSON to PostgreSQL
- [ ] Redis caching for hot paths
- [ ] Import/export pipeline for external systems
- [ ] Monitoring, logging, error handling
- [ ] Claude Code skills document for ad-hoc analysis
- [ ] Database replication and backup automation

---

## Phase Validation Checkpoints

| After Phase | Validate | Pivot If |
|---|---|---|
| 0 | Do new LLM questions produce meaningful answers on VIDEO_STREAMING sample? | Questions need refactoring before broader rollout |
| 1 | Can we import Netflix/Amazon patents and see them in VIDEO_STREAMING sectors? | Multi-portfolio model is wrong — simplify |
| 2 | Do VIDEO_STREAMING overlap hotspots correlate with known litigation areas? | Sector taxonomy too coarse — deepen subsectors first |
| 3 | Do LLM assessments produce actionable litigation intelligence for attorneys? | LLM questions need refactoring — iterate templates |
| 3 | Are Patlytics results worth the $25/patent? (test with free credits) | External vendor data too sparse — focus on LLM-only analysis |
| 4 | Does product data meaningfully improve litigation confidence? | Product data too sparse — focus on patent-only analysis |
| 5 | Does tiered scoring improve cost/quality ratio? | Single model sufficient — simplify pipeline |

---

## GUI Redesign Needed

The sector management and LLM batch scoring experience needs redesign:
- Scoring/batch functionality is split across SectorManagementPage and JobQueuePage — confusing UX
- Model comparison results are not persisted or easily retrievable
- Sub-sector creation and question authoring need a dedicated workflow
- User will submit new sector design requirements to be merged into this queue

---

## Nice-to-Have Improvements (Backlog)

- **CSV Export for Job Queue:** Client-side CSV generation from existing `batchJobsData` — export job ID, target, coverage type, status, progress, duration, rate. Use Blob + download link pattern.
- **Accept All Button for Affiliate/Competitor Candidates:** In AdminPage's affiliate discovery and competitor candidate dialogs, add an "Accept All" button that adds all suggested candidates in one click (alongside existing individual accept buttons).
- **Scrollable Candidate Lists:** Add `max-height: 60vh; overflow-y: auto` to affiliate/competitor candidate dialog list containers to prevent dialog overflow when many candidates are returned.

---

## Immediate Action Items (as of Feb 20)

1. **Run CPC backfill** — `POST /api/batch-jobs/sync-cpc-designations` for Netflix/Hulu/Chelsio patents with XMLs
2. **Take post-claims Netflix snapshot** — compare with pre-claims snapshot `cmltknetn0001n19ns60yahj2`
3. **Score Zoom** — 585 patents, 0% LLM coverage, good XML coverage (83%)
4. **Investigate 1 Netflix error** — `computing-systems` sector, 1 of 5 failed
5. **Phase 2 overlap analysis** — compute sector overlap matrix, identify density hotspots
6. ~~Reassign Chelsio~~ — DONE (Feb 19)
7. ~~Patent quarantine system~~ — DONE (Feb 20, 3,579 patents quarantined)

---

## Related Documents

| Document | Relevance |
|---|---|
| `TAXONOMY_AND_LLM_ENHANCEMENT_PLAN.md` | Master requirements (Sections 1-13), resolved questions, VIDEO_STREAMING subsector proposals |
| `scoring-and-enrichment-guide.md` | How-to for batch scoring, model selection, snapshots |
| `DESIGN_NOTES_SCORING.md` | V2/V3 score gap investigation, snapshot overwrite problem |
| `SCORING_FORMULA_REFERENCE.md` | Current scoring formula reference |
| `SUBSECTOR_SCORING_PLAN.md` | Subsector scoring data model and template inheritance |
| `SECTOR_REFACTORING_RECOMMENDATIONS.md` | Statistical analysis of which sectors need splitting |
| `NON_PORTFOLIO_AND_MULTI_PORTFOLIO_PLAN.md` | Multi-portfolio access groundwork |
| `SECTOR_BREAKOUT_PROPOSALS_V2.md` | Proposals for splitting large sectors |
| `MIGRATION_GUIDE.md` | Database migration procedures |
| `DEVELOPMENT_QUEUE_V3.md` | Previous version of this document |

*Pre-Feb-2026 docs archived to `docs/archive/`*
