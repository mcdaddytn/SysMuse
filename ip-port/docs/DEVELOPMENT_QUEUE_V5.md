# Development Queue V5 — Litigation Analysis Platform

*Reconciled from V4 + litigation target analysis work completed Feb 23, 2026*
*Last Updated: 2026-02-23*

## Overview

Phases organized around **proof of concept with litigation analysis** as the priority. V5 reflects significant progress: the litigation pipeline is now operational with scored patents, focus areas, prompt templates, and family expansion ready. The next frontier is **deeper enrichment** (claim-level prosecution, family context) and **scaling the analysis** across more sectors and competitors.

**POC Status:** VIDEO_STREAMING sector — 4,270 patents fully LLM-scored with claims. 16 competitor portfolios imported (~15K patents, all sector-classified). 9 Tier-1 litigation candidates identified, assessed, and strategy-analyzed.

**Master requirements document:** `TAXONOMY_AND_LLM_ENHANCEMENT_PLAN.md` (Sections 1-13)

---

## What's Changed Since V4

### Completed (Feb 20-23)

**LLM Pipeline Unification:**
- [x] Old pipeline (`llm-patent-analysis-v3.ts`, 26 hardcoded questions) fully removed
- [x] All scoring through `llm-scoring-service.ts` with template system + claims extraction
- [x] `scripts/run-sector-scoring.ts` as CLI wrapper
- [x] Text-type questions added: `patent_summary`, `prior_art_problem`, `technical_solution` (weight 0)
- [x] VIDEO_STREAMING: 4,270/4,270 scored (100% complete with claims)
- [x] WIRELESS: 5,381 patents scoring in progress

**Competitor Portfolio Expansion:**
- [x] 16 competitor portfolios imported (Apple 5K, Intel 2K, Qualcomm 2K, Samsung 2K, Sony 2K, Cisco 2K, Roku 1.2K, Netflix 385, etc.)
- [x] All competitor portfolios sector-classified via `reassignPortfolioPatents`
- [x] 2,789 competitor patents in VIDEO_STREAMING sectors

**Scoring Template Refinement:**
- [x] `claim_breadth` question updated in `portfolio-default.json` — now references actual claim language with 4 specific evaluation criteria
- [x] `video-streaming.json` super-sector template fully rewritten for litigation weighting:
  - claim_breadth 0.15→0.20, design_around_difficulty 0.20→0.25, implementation_clarity 0.15→0.20
  - technical_novelty 0.20→0.10, unique_value 0.10→0.05
  - streaming_protocol 0.15→0.08, codec_compression 0.15→0.08
- [x] Recompute scores endpoint: `POST /scoring-templates/llm/recompute-scores/:sectorName`
- [x] Frontend "Recompute Scores" button on SectorScoresPage
- [x] 6,009 of 6,352 VIDEO_STREAMING scores recomputed with new weights

**Litigation Target Analysis (Steps 1-7 of execution plan):**
- [x] Top patents ranked across 7 video sectors using reweighted scores + competitor citations
- [x] Two-tier candidate identification: T1 (score+citations+active), T2 (top score+active)
- [x] Focus area hierarchy created:
  - Parent: "Broadcom Video Litigation Targets" (30 patents)
  - Sub: "Codec Standards (HEVC/VVC) — SEP Candidates" (10 patents)
  - Sub: "Codec — Competitor-Cited Patents" (5 patents)
  - Sub: "CDN & Adaptive Streaming" (10 patents)
  - Sub: "Broadcast & Client Processing" (5 patents)
  - Sub: "Tier 1 — Vendor Handoff Candidates" (9 patents)
- [x] Per-patent litigation assessment prompt template (STRUCTURED, PER_PATENT) — 30 patents assessed on 10 dimensions (detectability, claim mapping, standards alignment, target products, risks, strategy)
- [x] Cross-patent collective strategy analysis (FREE_FORM, COLLECTIVE) — technology clusters, claim chains, competitor vulnerability matrix, portfolio gaps

**Job Queue Advanced Settings:**
- [x] Rescore/rerun existing scores option
- [x] Model selector (default Sonnet 4)
- [x] Portfolio selector on Sector Scores page
- [x] All settings saved with job

---

## Phase 2: Sector Overlap Detection (MOSTLY COMPLETE)
**Status:** Data foundation ready. Competitor portfolios classified. Analysis tooling operational.

### Remaining
- [ ] Run CPC backfill for Netflix/Hulu/Chelsio (inventive CPCs)
- [ ] Score Zoom (585 patents, 0% LLM scored)
- [ ] Formal overlap matrix visualization in GUI
- [ ] Citation cross-reference analysis (which competitors cite our patents in which sectors)

---

## Phase 3: Focus Area Pipeline — Litigation Opportunities (IN PROGRESS)
**Status:** Pipeline operational. First litigation analysis complete on VIDEO_STREAMING.

### Completed
- [x] Focus area hierarchy with parent/child structure
- [x] Multi-step prompt template workflow: PER_PATENT assessment → COLLECTIVE synthesis
- [x] Litigation assessment template (10 structured questions per patent)
- [x] Cross-patent strategy template (clusters, claim chains, vulnerability matrix)
- [x] 9 Tier-1 candidates identified with recommended assertion strategies

### In Progress
- [ ] **Family expansion on Tier-1 patents** — V2 expansion on top 3 (12301876, 9900608, 10148907)
- [ ] Family-aware prompt templates incorporating sibling/cousin context
- [ ] Prosecution data cross-referencing across family members

### Remaining
- [ ] Scale to additional focus areas (Tier 2 codec SEPs, non-video super-sectors)
- [ ] Export format for vendor handoff (patent data packages)
- [ ] Patlytics integration testing (up to 150 free credits available)

---

## Phase 3A: Claim-Level Prosecution Analysis (NEW — PRIORITY)
**Goal:** Extract detailed prosecution history to predict litigation challenges.
**Status:** DESIGNED — See `DESIGN_CLAIM_LEVEL_PROSECUTION_ANALYSIS.md`
**Priority:** HIGH — this is the enrichment step with highest ROI for litigation quality

### Why Priority
Current prosecution data is aggregate only (rejection counts, quality score 1-5). For litigation targeting we need:
- Which claims were rejected and on what grounds (101/102/103)
- What prior art the examiner cited (predicts invalidity challenges)
- How claims were narrowed during prosecution (estoppel risk)
- Whether family members faced similar challenges (pattern detection)

### Implementation Steps
1. [ ] Extend `FileWrapperClient` to download actual office action documents from USPTO ODP
2. [ ] Build LLM-powered prosecution document analyzer (`prosecution-analyzer-service.ts`)
3. [ ] Create `ProsecutionTimeline` database model with structured event storage
4. [ ] Batch enrichment job queue integration
5. [ ] Expose as prompt template variables (`<<patent.prosecution_rejections>>`, etc.)
6. [ ] Cross-family prosecution comparison (sibling/cousin patterns)
7. [ ] PatentDetailPage prosecution timeline tab

**Estimated effort:** 5-7 days
**LLM cost:** ~$0.50 for Tier 1 (9 patents), ~$50-90 for full VIDEO_STREAMING

---

## Phase 4: Product Layer & External Integration (5-7 days)
**Status:** NOT STARTED

- [ ] Add `Product` model to Prisma schema
- [ ] PDF document analysis: extract tech specs from product datasheets
- [ ] LLM tech stack inference: product → components → patent claim mapping
- [ ] Incorporate product data from public sources (iFixit teardowns, FCC filings)
- [ ] Enhance focus area LLM templates with product context

---

## Phase 5: Enrichment & Scoring Pipeline
**Status:** MOSTLY COMPLETE

### Completed (Feb 17-23)
- [x] Anthropic Batch API integration (50% cost, async)
- [x] Model selection (Sonnet 4, Haiku 4.5, Opus 4.6)
- [x] Multi-model comparison tool
- [x] Score snapshots (create, list, compare)
- [x] Batch job management GUI
- [x] Token/model tracking per patent score
- [x] Patent quarantine system (3,579 quarantined)
- [x] Recompute scores endpoint (weight-only, no LLM)
- [x] Template sync from config files
- [x] VIDEO_STREAMING fully scored with claims (4,270 patents)
- [x] WIRELESS scoring in progress (5,381 patents)

### Remaining
- [ ] Anthropic Batch API mode in job queue GUI (50% discount, 24h turnaround)
- [ ] Concurrency and batch size settings per job
- [ ] Error logs accessible in GUI (no more silent failures)
- [ ] Score invalidation when templates change (detect stale scores)
- [ ] Sub-sector scoring templates for VIDEO_STREAMING
- [ ] Persistent cost tracking per scoring run
- [ ] Re-scoring detection when templates change

---

## Phase 6: Taxonomy Deepening
**Status:** PARTIALLY STARTED — video sectors broken out, sub-sectors proposed

### Completed
- [x] VIDEO_STREAMING broken into 7 sectors (from original 3)
- [x] Sub-sector CPC groupings generated for video sectors
- [x] Sector breakout proposals documented (SECTOR_BREAKOUT_PROPOSALS_V2.md)

### Remaining
- [ ] Sub-sector scoring templates with targeted questions (per SUBSECTOR_SCORING_PLAN.md)
- [ ] video-codec sub-sectors: hevc-h265, vvc-h266, legacy-avc-mpeg, codec-general
- [ ] video-server-cdn sub-sectors: cdn-edge-caching, adaptive-streaming, media-server-transcoding
- [ ] LLM-assisted sub-sector classification
- [ ] Multiple taxonomy support
- [ ] Expand to WIRELESS, NETWORKING, COMPUTING super-sectors

---

## Phase 7: Data Service Layer & Production Readiness (deferred)
**Status:** NOT STARTED — awaiting POC validation

---

## Strategy Insights (from Litigation Analysis — Feb 23)

### Multi-Step Prompt Template Pattern
The proven workflow for litigation analysis:
1. **PER_PATENT**: Ask structured questions about each patent (detectability, claim mapping, standards, targets, risks)
2. **COLLECTIVE**: Synthesize all per-patent results into strategy (clusters, claim chains, vulnerability matrix, gaps)
3. **Future**: Per-competitor deep-dives, family-aware re-assessment, claim-level analysis

### Family Expansion Value for Litigation
Four specific ways family expansion enhances analysis:
1. **Reinforcement**: Siblings covering same technology from different angles thicken claim chains
2. **Design-around intelligence**: Cousins achieving same function via different method reveal competitor escape routes
3. **Prosecution prediction**: Relatives' rejection/amendment patterns preview our patent's litigation challenges
4. **Infringement probability**: Alternative implementations in related patents raise or lower likelihood of product infringement

### Template Inheritance & Weight Strategy
- Portfolio-default: broad questions (14 total), litigation-neutral weights
- Super-sector (VIDEO_STREAMING): overrides weights for litigation focus (claim_breadth 0.20, design_around 0.25, implementation_clarity 0.20)
- Sector: can add sector-specific questions (not yet authored for video sub-sectors)
- Recompute (no LLM cost) when weights change; rescore (LLM cost) when questions change

### Key Metrics for Litigation Scoring
Detectability is the primary differentiator:
- CDN/streaming patents score 7/10 (externally observable from stream analysis)
- Codec internal patents score 3/10 (require internal product access)
- Standards-essential patents strong but FRAND-capped
- Competitor citations validate real-world relevance but lag on newer patents

---

## Immediate Action Items (as of Feb 23)

### In Progress
1. **Family expansion on Tier-1 patents** — V2 expansion starting with 12301876, 9900608, 10148907

### Next Up
2. **Claim-level prosecution analysis** — implement Phase 3A per design doc
3. **Family-aware prompt template** — re-assess Tier 1 incorporating family context
4. **Sub-sector breakout for video-codec** — 1,181 patents need targeted questions

### Queued
5. Score Zoom portfolio (585 patents)
6. Run CPC backfill for smaller competitor portfolios
7. Formal overlap visualization in GUI
8. Vendor export format for Tier-1 handoff
9. Scale litigation analysis to WIRELESS super-sector

---

## Related Documents

| Document | Relevance |
|---|---|
| `LITIGATION_TARGET_EXECUTION_PLAN.md` | 9-step execution plan for VIDEO_STREAMING litigation targeting |
| `DESIGN_CLAIM_LEVEL_PROSECUTION_ANALYSIS.md` | **NEW** — Design for claim-level prosecution enrichment |
| `TAXONOMY_AND_LLM_ENHANCEMENT_PLAN.md` | Master requirements (Sections 1-13) |
| `SECTOR_BREAKOUT_PROPOSALS_V2.md` | Sub-sector splitting proposals |
| `SUBSECTOR_SCORING_PLAN.md` | Sub-sector scoring data model and template inheritance |
| `FAMILY_EXPANSION_V2_ANALYSIS.md` | V2 family expansion design and analysis |
| `scoring-and-enrichment-guide.md` | How-to for batch scoring, model selection, snapshots |
| `DEVELOPMENT_QUEUE_V4.md` | Previous version of this document |
