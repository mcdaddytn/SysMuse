# Development Queue V3 — Litigation Opportunity Platform

*Extracted from TAXONOMY_AND_LLM_ENHANCEMENT_PLAN.md Section 14*
*Last Updated: 2026-02-18*

## Overview

Phases organized around **proof of concept with litigation analysis** as the priority. Each phase validates the approach before investing in the next. Pivots expected based on findings.

**POC Scope:** VIDEO_STREAMING sector — ~1,857 sector-scored patents. Competitors: Netflix, Amazon.

**Master requirements document:** `TAXONOMY_AND_LLM_ENHANCEMENT_PLAN.md` (Sections 1-13 contain detailed requirements for each capability area).

---

## Phase 0: Quick Wins & Rename (1-2 days)
**Goal:** Visible progress, remove friction.
**Status:** NOT STARTED

- [ ] Rename "Patent Workstation" to "IP Port" in toolbar and browser title
- [ ] Add new portfolio-level LLM questions (Product Mapping Probability, Evidence of Use Detectability, Licensing Revenue Potential, Tech Component Classification)
- [ ] **Do NOT incorporate new questions into composite score yet** — run on a small batch (50-100 patents in VIDEO_STREAMING), evaluate quality, then decide on weight integration
- [ ] Update `portfolio-default.json` template with new questions at weight 0 (scored but not counted) for testing

---

## Phase 1: VIDEO_STREAMING Deep Dive & Multi-Portfolio Foundation (3-5 days)
**Goal:** Demonstrate end-to-end litigation analysis in VIDEO_STREAMING.
**Status:** NOT STARTED

- [ ] Add `Portfolio` model to Prisma schema (name, type, affiliates)
- [ ] Migrate Broadcom affiliates from static JSON to database
- [ ] Build Admin page skeleton with Portfolio and Affiliate management
- [ ] LLM-assisted affiliate discovery for VIDEO_STREAMING competitors (Netflix, Amazon, etc.)
- [ ] PatentsView assignee search: find patent counts per affiliate pattern
- [ ] Import top 50-100 competitor patents in VIDEO_STREAMING sectors (Netflix, Amazon first)
- [ ] Archive current LLM scores before any re-scoring runs

**POC Target:** Import competitor patents for Netflix and Amazon in VIDEO_STREAMING; see them alongside our patents in the sector view.

---

## Phase 2: Sector Overlap Detection — VIDEO_STREAMING Focus (3-5 days)
**Goal:** Find the battleground subsectors within VIDEO_STREAMING.
**Status:** NOT STARTED

- [ ] Run competitor patents through sector classification (Haiku/Flash, cheap)
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

## Phase 5: Enrichment & Scoring Pipeline Upgrade (5-7 days)
**Goal:** Scale the analysis capability.
**Status:** PARTIALLY COMPLETE

### Completed (Feb 17-18)
- [x] Anthropic Batch API integration for overnight scoring (50% cost, async processing)
- [x] Model selection in scoring service (Sonnet 4, Haiku 4.5, Opus 4.6 available)
- [x] Multi-model comparison tool (side-by-side scoring with cost analysis)
- [x] Score snapshots for LLM scoring (create, list, compare to current)
- [x] Batch job management GUI (SectorManagementPage + JobQueuePage batch tabs)
- [x] Batch job status polling, cancel, process results
- [x] Token/model tracking persisted to DB per patent score
- [x] Sonnet 4 confirmed as default model (comparable to Opus at 1/6th cost)

### Remaining
- [ ] Top-N scoring with renormalization for lower patents (avoid full-portfolio reruns)
- [ ] Persistent cost tracking per scoring run (aggregate cost summaries)
- [ ] Data archiving before bulk re-scoring (revert capability)
- [ ] Re-scoring detection when templates change
- [ ] Subsector templates for VIDEO_STREAMING sectors with litigation-oriented questions
- [ ] Gradually extend to other super-sectors based on POC learnings

### Key Notes
- **Do NOT re-score large sectors without first creating sub-sector question breakdowns** — budget should go toward tailored questions at subsector level, not repeated broad sector scoring
- VIDEO_STREAMING sub-sector templates with custom LLM questions do NOT yet exist despite discussion — sectors have 5 custom questions each but no subsector-level breakouts
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
| `MIGRATION_GUIDE.md` | Database migration procedures |

*Pre-Feb-2026 docs archived to `docs/archive/`*
