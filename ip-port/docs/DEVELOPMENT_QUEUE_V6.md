# Development Queue V6 — Litigation Analysis Platform

*Reconciled from V5 + litigation target execution, family expansion, and vendor handoff planning*
*Last Updated: 2026-02-23*

## Overview

**POC Status:** VIDEO_STREAMING — litigation pipeline fully operational. 41 patents in focus area hierarchy, 21 in Tier 1, with VVC continuation family and ABR streaming thicket identified. Ready for vendor handoff.

**What changed in V6:** Family expansion proved its value (VVC 4-patent continuation family became the #1 asset). ABR streaming family expansion revealed 9 additional high-value patents already in portfolio but not in original shortlist. Two vendor integration paths defined. Prosecution enrichment prioritized as highest-ROI feature for next cycle.

**Master requirements document:** `TAXONOMY_AND_LLM_ENHANCEMENT_PLAN.md` (Sections 1-13)

---

## What's Changed Since V5

### Completed (Feb 23 — Litigation Execution)

**Portfolio Ownership Correction:**
- [x] Discovered 3 competitor patents contaminating Tier 1 (12301876=Qualcomm, 9900608=Hulu, 11973996=Netflix)
- [x] Root cause: scoring pipeline scored ALL patents regardless of portfolio, ranking queries never filtered by portfolio
- [x] All focus areas corrected to Broadcom-only patents
- [x] Portfolio filter (`JOIN portfolio_patents WHERE portfolio = 'broadcom-core'`) required on all ranking queries

**Family Expansion — VVC Continuation Family:**
- [x] V2 exploration from 3 seeds (10148907 HDR, 10798394 VVC, 9282328 SAO)
- [x] Discovered 3 VVC continuation siblings: 11595673 (2023, score 74.38), 11882300 (2024, 67.69), 12289460 (2025, 74.38)
- [x] Continuations score HIGHER than seed (74.38 vs 63.38) — tighter claims easier to map
- [x] 12289460 has 19.2yr remaining life — longest in portfolio, enforcement through 2044
- [x] All 3 added to Tier 1, Codec SEP sub-FA, and parent FA

**Family Expansion — ABR Streaming Cluster:**
- [x] V2 exploration from 3 streaming seeds (9406252, 9351010, 9705948)
- [x] Found 9 related ABR patents already in broadcom-core but not in original shortlist
- [x] Top 4 score 6/10 litigation with 7/10 detectability (same as original Tier 1)
- [x] 10326805 (distributed ABR proxy), 9319289 (ABR server-side), 9413806 (ABR proxy), 9241204 (multi-ABR segments) promoted to Tier 1
- [x] CDN sub-FA expanded from 10 → 18 patents

**Updated Collective Analysis (v3 — 17→21 patents):**
- [x] VVC family strategy: lead with 12289460 (newest, most specific claims), use siblings as fallback
- [x] 4-patent VVC family creates claim redundancy — extremely difficult to design around
- [x] YouTube/Google highest vulnerability (7 patents), Netflix (6), Amazon (5), Apple (5)
- [x] Three-pronged strategy: VVC family → YouTube via FRAND, HDR → Netflix/Apple via direct, ABR thicket → Netflix/Amazon via direct

**Focus Area Current State:**
- Parent: "Broadcom Video Litigation Targets" — 41 patents
- Sub: "Codec Standards (HEVC/VVC) — SEP Candidates" — 14 patents
- Sub: "Codec — Competitor-Cited Patents" — 5 patents
- Sub: "CDN & Adaptive Streaming" — 18 patents
- Sub: "Broadcast & Client Processing" — 5 patents
- Sub: "Tier 1 — Vendor Handoff Candidates" — 21 patents

---

## Phase 1: Vendor Integration & Handoff (PRIORITY — NEXT)

### Vendor 1: Patent-to-Product Heat Map Platform

**What it does:** Takes individual patents, finds potentially infringing products, produces infringement heat maps. Can take competitor companies or recommend them. Recommends up to 20 products per patent.

**Handoff plan:**
1. [ ] Export Tier 1 patents (21) as batch submission — patent numbers, titles, claim text
2. [ ] Submit competitor list: Netflix, YouTube/Google, Apple, Amazon, Samsung, Qualcomm, Intel
3. [ ] For each patent, narrow to 3-5 most likely competitors from our litigation assessment
4. [ ] Receive heat map results — infringing products with confidence scores
5. [ ] **Import product data back** into our system for further analysis
6. [ ] Build `Product` model integration:
   - Product name, manufacturer, product category
   - Patent-product mapping with confidence score
   - Link to vendor evidence/analysis
7. [ ] Enhance focus area templates with product context from vendor results

**Prioritized patent batches for Vendor 1:**

| Batch | Patents | Competitors to Specify | Rationale |
|-------|---------|----------------------|-----------|
| 1. HDR pair | 10148907, 10574936 | Netflix, Apple, Samsung, YouTube | Highest detectability, premium streaming |
| 2. ABR top 4 | 10326805, 9319289, 9413806, 9406252 | Netflix, Amazon/AWS, YouTube, Apple | CDN/streaming infrastructure |
| 3. VVC family | 12289460, 11595673, 10798394 | YouTube/Google, Qualcomm, Intel, Samsung | SEP/FRAND licensing |
| 4. Remaining T1 | 9282328, 9705948, 9351010, 9241204 + others | Broad — let vendor recommend | Discovery |

### Vendor 2: Claim Charts & Portfolio Analysis

**What it does:** Produces claim charts, can do portfolio analysis by assignee.

**Testing approach:**
- [ ] **Small assignee test:** Run portfolio analysis on **Roku** (1,200 patents, 473 in video-server-cdn, significant overlap with Broadcom CDN patents) — large enough to be meaningful, small enough to test vendor quality without burning budget
- [ ] Alternative test: **Netflix** (385 patents, 153 in video-server-cdn) — even smaller, direct litigation target
- [ ] **Claim chart test:** Run claim charts for top 3 HDR + ABR patents against specific Netflix/YouTube products
  - 10148907 vs Netflix HDR encoding pipeline
  - 10326805 vs Netflix Open Connect CDN
  - 9319289 vs YouTube adaptive streaming

**What to evaluate from Vendor 2:**
- Quality of claim element mapping
- Depth of product analysis
- Speed of turnaround
- Whether portfolio analysis reveals patents/products we missed

### Export Format for Both Vendors

Per-patent data package to include:
- Patent ID, title, abstract, grant date, remaining life
- Claims text (from bulk XML extraction)
- LLM composite score + per-question breakdown
- Litigation assessment (from focus area prompt template): detectability, claim mapping, standards, targets, risks, strategy
- Competitor citation list + density
- Prosecution history summary (aggregate — detail pending Phase 2)
- IPR status
- Family members (from V2 exploration)
- Recommended assertion strategy + rationale from collective analysis

---

## Phase 2: Claim-Level Prosecution Enrichment (HIGH PRIORITY)

**Goal:** Extract detailed prosecution history to predict litigation challenges.
**Status:** DESIGNED — See `DESIGN_CLAIM_LEVEL_PROSECUTION_ANALYSIS.md`
**Priority:** HIGH — this is the enrichment step with highest ROI for litigation quality

### Why This Is the Highest-ROI Feature

Current prosecution data is aggregate only (rejection counts, quality score 1-5). For litigation targeting we need:
- Which claims were rejected and on what grounds (101/102/103)
- What prior art the examiner cited (predicts invalidity challenges)
- How claims were narrowed during prosecution (estoppel risk)
- Whether family members faced similar challenges (pattern detection)

For the VVC continuation family specifically: understanding how each continuation's claims were refined during prosecution reveals whether the tighter claims we're seeing in scores (74.38 vs 63.38) are because they were narrowed to overcome rejections (estoppel risk) or because they were written more precisely from the start (strong position).

### Implementation Steps

1. [ ] **Extend FileWrapperClient** — download actual office action documents from USPTO ODP API
   - Target document types: CTNF (non-final), CTFR (final), N417 (allowance), A.AP/AREF (responses), RCEX
   - Store raw text in `cache/prosecution-documents/`
   - Rate limit: respect USPTO ODP throttling

2. [ ] **Build LLM prosecution analyzer** (`prosecution-analyzer-service.ts`)
   - Process each office action through LLM to extract structured data
   - Per office action: rejected claims, statutory basis, cited prior art, examiner reasoning
   - Per response: amendments, narrowed claims, arguments made, estoppel risk rating
   - Output: `OfficeActionAnalysis` + `ApplicantResponseAnalysis` interfaces (per design doc)

3. [ ] **Create ProsecutionTimeline DB model**
   - Prisma model with JSON fields for structured events
   - Derived fields: citedPriorArt, narrowedClaims, estoppelArguments, survivedBases
   - `@@unique([patentId])` — one timeline per patent

4. [ ] **Batch enrichment integration**
   - Job queue integration for portfolio-scale processing
   - Start with Tier 1 (21 patents, ~$1 LLM cost)
   - Scale to full VIDEO_STREAMING (~1,857 patents, ~$50-90)

5. [ ] **Expose as prompt template variables**
   - `<<patent.prosecution_rejections>>`, `<<patent.prosecution_cited_art>>`
   - `<<patent.prosecution_narrowed_claims>>`, `<<patent.prosecution_estoppel_risk>>`
   - `<<patent.prosecution_survived>>` — challenges overcome (positive signal)

6. [ ] **Cross-family prosecution comparison**
   - VVC family: compare prosecution across 10798394, 11595673, 11882300, 12289460
   - Detect patterns: same prior art cited? same bases rejected? claims narrowed similarly?

7. [ ] **PatentDetailPage prosecution timeline tab**
   - Visual timeline of office actions and responses
   - Cited prior art with links
   - Estoppel risk flags

**Estimated effort:** 5-7 days
**LLM cost:** ~$1 for Tier 1 (21 patents), ~$50-90 for full VIDEO_STREAMING

---

## Phase 3: Scale Litigation Analysis to Other Areas (NEXT CYCLE)

### 3A: Additional VIDEO_STREAMING Analysis

**Remaining video sectors to analyze for litigation:**
- [ ] video-client-processing (394 Broadcom patents) — device-side decode, display, rendering
- [ ] video-broadcast (229 Broadcom patents) — linear TV, ATSC, DVB
- [ ] video-storage (212 Broadcom patents) — DVR, cloud storage, media management
- [ ] video-drm-conditional (121 Broadcom patents) — content protection, CAS, DRM
- [ ] display-control (68 Broadcom patents) — display technology

**Approach:** For each sector:
1. Filter broadcom-core patents with score > 40 and remaining life > 5yr
2. Cross-reference with competitor citations
3. Create focus area with top 20-30 patents
4. Run per-patent litigation assessment
5. Run collective analysis
6. Family expansion on top 3-5

### 3B: WIRELESS Super-Sector

- [ ] WIRELESS scoring in progress (5,381 patents, ~20% complete as of last check)
- [ ] Once scoring complete: apply same litigation pipeline
- [ ] Likely different competitor landscape (Qualcomm, Intel, Samsung, MediaTek, Ericsson)
- [ ] WIRELESS litigation opportunities may be larger due to 5G SEP potential

### 3C: Expand to NETWORKING, COMPUTING

- [ ] These super-sectors have not been scored yet
- [ ] Need taxonomy review first — sector structure may not be optimized for litigation
- [ ] Queue after WIRELESS analysis validates the pipeline at scale

---

## Phase 4: Sub-Sector Taxonomy Refactor (UPCOMING — MAJOR)

### What We Learned About Good Sub-Sectors

From the litigation exercise, key findings about sub-sector design:

1. **Technology function matters more than CPC grouping alone.** The ABR streaming family (9 patents) spans multiple CPC subclasses (H04L65/*, H04N21/*, G06Q30/*) but shares a clear technology function: adaptive bitrate delivery. A good sub-sector groups by function, not just CPC prefix.

2. **Detectability should be a sub-sector attribute.** CDN/streaming patents (7/10 detect) vs codec internal patents (3/10 detect) have fundamentally different litigation value. Sub-sectors should carry a `detectability_profile` that informs scoring weights.

3. **Standards alignment is a natural grouping axis.** VVC patents, HEVC patents, DASH/HLS patents, HDR10 patents — each standard creates a natural technology cluster with shared competitors, shared litigation strategy, and shared licensing dynamics.

4. **Continuation families cluster within sub-sectors.** The VVC affine merge family (4 patents) all belong in the same sub-sector. Sub-sector assignment should detect family clusters and keep them together.

5. **Scoring template questions should be sub-sector specific.** Generic questions like `streaming_protocol` (from super-sector level) score 0 for codec patents. Sub-sector-level questions like `hevc_sao_relevance` would provide much better signal.

### Proposed Video Sub-Sectors (informed by litigation analysis)

**video-server-cdn (456 patents) — Break into:**
| Sub-sector | Rationale | Detectability | Key Patents Found |
|-----------|-----------|---------------|-------------------|
| `abr-streaming` | ABR adaptation, HLS/DASH, CMAF | HIGH (7/10) | 9319289, 9413806, 10326805, 9406252, 9705948 |
| `cdn-proxy-caching` | CDN architecture, proxy, edge | HIGH (7/10) | 10075741, 9894125, 9042368 |
| `media-transcoding` | Server-side transcoding, format conversion | MEDIUM (5/10) | 9351010, 8897377, 9113227 |
| `broadcast-delivery` | Multicast, ATSC 3.0, linear delivery | MEDIUM (5/10) | 9241204, 9215080, 10523572 |

**video-codec (377 patents) — Break into:**
| Sub-sector | Rationale | Standards | Key Patents Found |
|-----------|-----------|-----------|-------------------|
| `hevc-h265` | HEVC-specific: SAO, motion comp, prediction | HEVC H.265 | 9282328, 10757440 |
| `vvc-h266` | VVC-specific: affine merge, arithmetic coding | VVC H.266 | 10798394, 11595673, 11882300, 12289460, 10798394 |
| `entropy-coding` | CABAC, CAVLC, arithmetic coding (cross-standard) | Multiple | 11284079, 11949871 |
| `codec-general` | Motion estimation, rate control, general compression | Multiple | 8660178 |

**video-client-processing (394 patents) — Break into:**
| Sub-sector | Rationale | Detectability |
|-----------|-----------|---------------|
| `hdr-processing` | HDR/SDR conversion, luminance, tone mapping | HIGH (7/10) |
| `decoder-pipeline` | Hardware/software decode chains | LOW (3/10) |
| `display-rendering` | Compositor, frame buffer, multi-display | LOW (3/10) |
| `player-ui` | Playback controls, interactive overlay | MEDIUM (5/10) |

### Implementation Plan for Sub-Sector Refactor

1. [ ] Design sub-sector schema changes (upcoming refactor — separate design doc)
2. [ ] Implement sub-sector rules using CPC + keyword + LLM hybrid classification
3. [ ] Map existing patents to new sub-sectors
4. [ ] Create sub-sector scoring templates with targeted questions:
   - `abr-streaming`: `abr_algorithm_relevance`, `stream_switching_innovation`, `bandwidth_adaptation_method`
   - `vvc-h266`: `vvc_tool_specificity`, `standards_contribution_level`, `implementation_complexity`
   - `hdr-processing`: `hdr_format_coverage`, `display_compatibility`, `perceptual_quality_impact`
5. [ ] Score sub-sectors with targeted questions (LLM cost for initial sectors)
6. [ ] Validate sub-sector splits improve litigation candidate identification

### Other Taxonomy Needs for Refactor

- [ ] Sub-sector detectability profile (attribute on sub-sector, used by scoring templates)
- [ ] Family-aware sub-sector assignment (keep continuation families together)
- [ ] Multiple taxonomy support (different lens: technology function vs standard vs product layer)
- [ ] Remap sub-sectors — current DB sub-sectors are just CPC codes, not meaningful technology groups
- [ ] Storage refactoring: rename `PatentSubSectorScore` toward taxonomy-agnostic EAV

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
- [ ] Persistent cost tracking per scoring run

---

## Phase 6: Sector Overlap Detection

**Status:** Data foundation ready. Competitor portfolios classified.

### Remaining
- [ ] Run CPC backfill for Netflix/Hulu/Chelsio (inventive CPCs)
- [ ] Score Zoom (585 patents, 0% LLM scored)
- [ ] Formal overlap matrix visualization in GUI
- [ ] Citation cross-reference analysis (which competitors cite our patents in which sectors)

---

## Phase 7: Product Layer & External Integration

**Status:** PARTIALLY STARTED — vendor handoff designed, product model not yet in schema

- [ ] Add `Product` model to Prisma schema (informed by Vendor 1 heat map results)
- [ ] Import product data from vendor heat maps
- [ ] PDF document analysis: extract tech specs from product datasheets
- [ ] LLM tech stack inference: product → components → patent claim mapping
- [ ] Incorporate product data from public sources (iFixit teardowns, FCC filings)
- [ ] Enhance focus area LLM templates with product context

---

## Phase 8: Data Service Layer & Production Readiness (deferred)
**Status:** NOT STARTED — awaiting POC validation

---

## Strategy Insights (Updated Feb 23)

### Proven Analysis Pipeline

1. **Score** → sector-weighted LLM scoring with claims (4,270 VIDEO_STREAMING complete)
2. **Rank** → filter by portfolio + composite score + competitor citations + remaining life
3. **Focus** → create focus area hierarchy organized by litigation theme
4. **Assess** → PER_PATENT structured template (10 dimensions) on focus area
5. **Synthesize** → COLLECTIVE free-form template for cross-patent strategy
6. **Expand** → V2 family expansion, sibling discovery, continuation identification
7. **Iterate** → add discoveries to focus areas, re-run assessment, update strategy
8. **Handoff** → export to vendors for claim charts, product heat maps, evidence-of-use

### Family Expansion Findings

**VVC Continuation Family (crown jewel):**
- 4 patents: 10798394 → 11595673 → 11882300 → 12289460 (2020-2025)
- Continuations score HIGHER than original (74.38 vs 63.38 LLM score, 5/10 vs 4/10 litigation)
- Progressively narrower claims = easier to map to specific VVC implementations
- 19.2yr remaining life on newest = enforcement through 2044
- 4-patent redundancy = extremely difficult to design around all variants

**ABR Streaming Thicket:**
- 9 related patents covering: proxy, distributed proxy, server-side adaptation, multicast, caching, source redistribution, segment streaming, prioritization, gateway conversion
- 7 high-detectability patents (7/10) — externally observable from stream analysis
- Already in portfolio but not in original shortlist — family expansion found them
- Combined with 3 original seeds = 12 ABR patents total

**What worked / didn't in family expansion:**
- **Sibling expansion** was the most productive strategy — directly found continuations and related patents
- **Direction expansion** (gen 1-2) found mostly external/competitor patents — useful for competitive intelligence, less for portfolio strengthening
- **Scoring dimensions**: `portfolioAffiliate` and `taxonomicOverlap` were main drivers; `commonPriorArt` and `commonForwardCites` scored 0 for most candidates (enrichment data gap)
- **Key gap**: Many discovered patents had no enrichment data, limiting scoring accuracy

### Key Metrics

| Metric | CDN/Streaming | Codec Internal | HDR |
|--------|---------------|----------------|-----|
| Detectability | 7/10 | 3/10 | 7/10 |
| Litigation Strategy | Direct infringement | SEP/FRAND | Direct infringement |
| Claim Mapping | Observable from stream analysis | Requires internal access | Observable from quality testing |
| Primary Targets | Netflix, YouTube, Amazon | YouTube, Qualcomm, Intel | Netflix, Apple, Samsung |
| Best Use | Lead assertion | Licensing leverage | Premium market targeting |

---

## Immediate Action Items (as of Feb 23)

### Vendor Handoff (This Week)
1. **Vendor 1:** Prepare Tier 1 export (21 patents) with competitor lists, submit in 4 batches (HDR, ABR, VVC, remaining)
2. **Vendor 2:** Run Roku portfolio analysis as platform test; run 3 claim charts (10148907 vs Netflix HDR, 10326805 vs Netflix CDN, 9319289 vs YouTube ABR)

### High Priority (Next Sprint)
3. **Prosecution enrichment** — implement Phase 2 steps 1-4 (FileWrapperClient extension, LLM analyzer, DB model, batch integration)
4. **VVC family prosecution comparison** — cross-reference prosecution across 4 VVC continuations once enrichment is live

### Next Cycle
5. **Scale to remaining video sectors** — video-client-processing, video-broadcast, video-drm
6. **WIRELESS super-sector** — complete scoring, run litigation pipeline
7. **Sub-sector refactor** — design doc for ABR/codec/HDR sub-sectors with targeted questions

### Queued
8. Score Zoom portfolio (585 patents)
9. CPC backfill for smaller competitor portfolios
10. Formal overlap visualization in GUI
11. Product model + vendor result import
12. Expand litigation analysis to NETWORKING, COMPUTING super-sectors

---

## Related Documents

| Document | Relevance |
|---|---|
| `LITIGATION_TARGET_EXECUTION_PLAN.md` | 9-step execution plan + family expansion results + v3 strategy |
| `DESIGN_CLAIM_LEVEL_PROSECUTION_ANALYSIS.md` | Design for claim-level prosecution enrichment |
| `TAXONOMY_AND_LLM_ENHANCEMENT_PLAN.md` | Master requirements (Sections 1-13) |
| `SECTOR_BREAKOUT_PROPOSALS_V2.md` | Sub-sector splitting proposals |
| `SUBSECTOR_SCORING_PLAN.md` | Sub-sector scoring data model and template inheritance |
| `FAMILY_EXPANSION_V2_ANALYSIS.md` | V2 family expansion design and analysis |
| `scoring-and-enrichment-guide.md` | How-to for batch scoring, model selection, snapshots |
| `DEVELOPMENT_QUEUE_V5.md` | Previous version of this document |
