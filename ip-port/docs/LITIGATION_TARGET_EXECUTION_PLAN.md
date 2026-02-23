# Broadcom Video & Streaming Litigation Target Analysis — Execution Plan

**Date:** 2026-02-23
**Goal:** Identify ~30-50 high-value Broadcom patents for litigation targeting across VIDEO_STREAMING sectors, then hand off to 3rd-party vendors for claim charting and evidence-of-use.

---

## Current State Summary

| Asset | Status |
|-------|--------|
| Broadcom VIDEO_STREAMING patents | 6,352 patent-sector scores across 7 sectors |
| Competitor portfolios | All 16 classified into sectors — 2,789 competitor patents in video sectors |
| Claims extraction | Complete for VIDEO_STREAMING (most scored with claims) |
| Competitor citation data | 29,345 patents analyzed |
| Sub-sector templates | None for video (14 exist for semiconductor/networking only) |
| Focus Areas | 4 legacy entries — feature available but unused for video |

### Score Distribution by Sector

| Sector | Scored | Avg | Max | Top Competitor |
|--------|--------|-----|-----|----------------|
| video-server-cdn | 2,011 | 37.3 | 71.1 | Roku (473) |
| video-client-processing | 1,235 | 33.2 | 64.7 | Roku (190) |
| video-codec | 1,181 | 54.7 | 79.4 | LG Electronics (120) |
| video-broadcast | 598 | 34.4 | 64.5 | Intel (50) |
| display-control | 522 | 36.3 | 56.9 | Samsung (187) |
| video-storage | 470 | 26.4 | 58.0 | Sony (35) |
| video-drm-conditional | 335 | 30.8 | 49.5 | Roku (44) |

**Score bias:** video-codec averages 54.7 vs. others at 26-37. The codec-specific questions (codec_compression, streaming_protocol) inflate codec scores. Reweighting for litigation criteria will normalize this.

### Early Signal: High-Value Candidates

Patents scoring 60+ with competitor citations and 3+ years remaining:

| Patent | Title | Sector | LLM Score | Comp Cites | Density | Years Left |
|--------|-------|--------|-----------|-----------|---------|------------|
| 9282328 | SAO video coding | video-codec | 75.8 | 5 | 1.000 | 6.9 |
| 10798394 | Affine merge VVC | video-codec | 74.5 | 5 | 1.000 | 13.3 |
| 9406252 | Adaptive multi-standard coder | video-server-cdn | 68.6 | 5 | 0.833 | 5.7 |
| 10200706 | Pipelined video decoder | video-codec | 66.2 | 20 | 1.000 | 11.9 |
| 10165285 | Video coding tree sub-block | video-codec | 63.1 | 3 | 1.000 | 5.8 |

These are starting signals, not the final list. The reweighting in Step 2 will reshuffle rankings significantly.

---

## Execution Steps

### Step 1: Update `claim_breadth` Question Text

**Where:** Sector Management page → Templates → portfolio-default
**Or:** Edit `config/scoring-templates/portfolio-default.json` then POST `/api/scoring-templates/sync`

Update the `claim_breadth` question from the current generic text:

> "Rate the breadth of the patent claims. Consider: How broadly do the claims cover the invention? Could they capture variations and alternative implementations?"

To this claims-grounded version:

> "Rate the breadth of the patent claims based on the actual claim language provided. Consider: (1) How many independent claims exist? (2) How broad are the independent claims — do they use functional language, means-plus-function, or specific structural terms? (3) Do dependent claims cover meaningful alternative implementations? (4) Could the claims capture a competitor's implementation that achieves similar functionality through different means?"

Also update the reasoning prompt to:

> "Analyze the specific claim language. Identify the broadest independent claim and explain what scope it covers."

**Why:** Now that claims text is passed to the LLM during scoring (withClaims=true for most VIDEO_STREAMING patents), this question should reference the actual claim language rather than asking the LLM to speculate from the abstract.

**Impact:** This changes the question for ALL sectors (portfolio-default level). Sectors that are re-scored will get the improved question. Existing scores won't change until re-scored.

---

### Step 2: Reweight VIDEO_STREAMING Template for Litigation

**Where:** Edit `config/scoring-templates/super-sectors/video-streaming.json` then POST `/api/scoring-templates/sync`

**Current weights** (super-sector additions, on top of portfolio-default):

| Question | Current Weight |
|----------|---------------|
| streaming_protocol | 0.15 |
| codec_compression | 0.15 |
| delivery_scalability | 0.10 |
| user_experience | 0.10 |

**Proposed changes** — demote narrow streaming questions, since they inflate codec scores:

| Question | Current | New | Rationale |
|----------|---------|-----|-----------|
| streaming_protocol | 0.15 | 0.08 | Narrow — move heavy weight to sector level |
| codec_compression | 0.15 | 0.08 | Same — codec-specific sectors should have this weight |
| delivery_scalability | 0.10 | 0.05 | Narrow |
| user_experience | 0.10 | 0.04 | Least actionable for litigation |

Additionally, consider **overriding portfolio-default weights** at the super-sector level to shift toward litigation criteria:

| Question (from portfolio-default) | Default Weight | Override | Rationale |
|-----------------------------------|---------------|----------|-----------|
| technical_novelty | 0.20 | 0.10 | Less critical for litigation targeting |
| claim_breadth | 0.15 | 0.20 | Grounded in actual claims now |
| design_around_difficulty | 0.20 | 0.25 | Hard to design around = strong position |
| implementation_clarity | 0.15 | 0.20 | Detectable = provable infringement |
| standards_relevance | 0.15 | 0.15 | SEP = FRAND licensing leverage (keep) |
| market_relevance | 0.15 | 0.12 | Relevant for damages but secondary |
| unique_value | 0.10 | 0.05 | Less actionable |

**After editing:** Run sync endpoint, then use the new **"Recompute Scores" button** on the Sector Scores page for each video sector. This recalculates composite scores from stored metrics using the new weights — no LLM calls needed, instant results.

**Expected effect:** Non-codec sectors (CDN, DRM, broadcast) should rise in relative scoring. Patents with high design_around_difficulty and implementation_clarity will jump in ranking. Codec patents with high streaming_protocol scores but low claim_breadth will drop.

---

### Step 3: Recompute All Video Sector Scores

**Where:** Sector Scores page → Select VIDEO_STREAMING → Click into each sector → "Recompute Scores" button

Do this for all 7 sectors:
1. video-server-cdn (2,011 scores)
2. video-client-processing (1,235 scores)
3. video-codec (1,181 scores)
4. video-broadcast (598 scores)
5. display-control (522 scores)
6. video-storage (470 scores)
7. video-drm-conditional (335 scores)

**Result:** 6,352 composite scores recalculated instantly. Rankings will shift based on new weights.

---

### Step 4: Review Reweighted Rankings

**Where:** Sector Scores page → Select Broadcom portfolio → Each video sector

For each sector, examine the new top 20-30 patents. Look for:

- **High LLM score + high competitor citations** → strongest litigation candidates
- **High standards_relevance score** → SEP licensing candidates
- **High competitor_density (>0.8)** → widely cited by competitors
- **remaining_years > 5** → sufficient patent life for ROI
- **with_claims = true** → scored with actual claim language (more reliable)

Cross-reference using the scored patents table's enriched columns:
- `competitorCount` / `competitorNames` — which competitors cite this patent
- `designAroundDifficulty` / `claimBreadth` / `implementationClarity` — the litigation-critical metrics
- `remainingYears` — patent life

**Decision point:** At this stage, decide if the reweighted scores produce a good enough differentiation, or if sub-sector breakout (Step 5) is needed to sharpen signal in dense sectors.

---

### Step 5: (Optional) Break Out Dense Sectors into Sub-Sectors

**When:** If video-server-cdn (2,011 patents) or video-codec (1,181 patents) still have too many patents scoring similarly after reweighting.

**Where:** Sector Management page → Select sector → Sub-Sectors tab

**Process per sector:**

1. **Generate sub-sectors** — click "Generate Sub-Sectors" which uses CPC grouping analysis
2. **Review and name** — rename auto-generated CPC groups into meaningful technology themes:
   - **video-server-cdn** → `cdn-edge-caching`, `adaptive-streaming`, `media-server-transcoding`, `set-top-box-gateway`
   - **video-codec** → `hevc-h265`, `vvc-h266`, `legacy-avc-mpeg`, `codec-general`
   - **video-client-processing** → `decoder-pipeline`, `display-rendering`, `player-ui`
3. **Apply sub-sectors** — saves to DB and assigns patents
4. **Create sub-sector templates** with targeted questions:
   - e.g., `hevc-h265`: add `hevc_tile_slice_relevance`, `hevc_prediction_innovation`
   - e.g., `cdn-edge-caching`: add `cdn_architecture_relevance`, `edge_compute_innovation`
5. **Score sub-sectors** via Job Queue → New Job → LLM Scoring for the sub-sector

**Cost note:** Re-scoring at sub-sector level requires LLM calls (~$0.027/patent with Sonnet 4, ~$0.014 with Batch API). For 2,011 CDN patents that's ~$27-54. Only do this if the reweighted sector scores aren't differentiating enough.

---

### Step 6: Build Focus Areas by Litigation Theme

**Where:** Focus Areas page → Create New

1. **Create parent Focus Area:** "Broadcom Video Litigation Targets"
   - Scope: VIDEO_STREAMING
   - Add the top 50-100 patents from Steps 4-5 (across all video sectors)

2. **Create sub-focus-areas by theme:**

   | Focus Area | Theme | Target Sectors |
   |-----------|-------|----------------|
   | Codec Standards (HEVC/VVC) | SEP candidates, standards-essential | video-codec |
   | CDN & Adaptive Streaming | Server-side infringement | video-server-cdn |
   | DRM & Conditional Access | Content protection | video-drm-conditional |
   | Video Processing Pipeline | Client-side decode/display | video-client-processing, display-control |
   | Broadcast & Storage | Linear TV, DVR, time-shifting | video-broadcast, video-storage |

3. **Use Search Terms** on each focus area for discovery:
   - Codec: "CABAC", "HEVC", "CAVLC", "motion estimation", "VVC", "affine merge"
   - CDN: "adaptive bitrate", "CDN edge", "manifest", "transcoding", "HLS", "DASH"
   - DRM: "conditional access", "DRM", "key management", "watermark"
   - Processing: "decoder pipeline", "frame buffer", "compositor", "GPU decode"

4. **Extract Keywords** to find common technical themes across patents in each focus area

---

### Step 7: Patent Family Expansion on Top Candidates

**Where:** Patent Family Explorer page

For the top 20-30 highest-value patents:

1. **Multi-seed V2 exploration** — add 5-10 patent IDs as seeds
2. **Use "patent-focused" preset** with membership threshold = 60
3. **Expand 1-2 generations** forward (continuations/divisionals) AND backward (parent patents)
4. **Look for competitor siblings** — siblings sharing a common parent reveal competitors actively filing in the same technology space
5. **Enrich with litigation data** — IPR and prosecution history via auto-enrich
6. **Add strong family members** to relevant focus areas from Step 6

**Key insight:** Continuation patents often have narrower, more easily mapped claims. Divisional patents may cover different embodiments of the same technology. Both are useful for building claim chart portfolios.

---

### Step 8: Run Prompt Templates for Deep Analysis

**Where:** Focus Area detail page → Prompt Templates tab

#### Stage 1: Per-Patent Litigation Assessment

Create a FREE_FORM template (PER_PATENT mode) on each sub-focus-area:

```
Analyze this patent for litigation potential against video streaming products:

Patent: <<patent.patent_title>>
Patent ID: <<patent.patent_id>>
Abstract: <<patent.abstract>>
Claims: [from claims extraction]

1. INFRINGEMENT DETECTABILITY: How easily could infringement be detected in a
   commercial product? What observable features would indicate use?
2. CLAIM MAPPING: Which independent claims are most likely to read on
   competitor implementations? What claim elements are strongest/weakest?
3. STANDARDS ALIGNMENT: Is this patent likely essential to any video standard
   (HEVC, VVC, DASH, HLS, CMAF)? Which standard sections?
4. TARGET PRODUCTS: What specific competitor products or services likely
   implement this technology? (e.g., "Apple FaceTime video codec", "Netflix
   adaptive streaming")
5. LITIGATION RISK: Any prior IPR challenges or prosecution weaknesses that
   could undermine enforcement?

Return JSON with fields: detectability_score (1-10), claim_mapping_summary,
standards_list, target_products[], litigation_risk_factors[],
overall_litigation_score (1-10)
```

Execute → poll status → review results.

#### Stage 2: Cross-Patent Pattern Analysis

After Stage 1 completes, create a COLLECTIVE template:

```
Given these patent litigation assessments for <<focusArea.name>>:
<<focusArea.patentData>>

Identify:
1. TECHNOLOGY CLUSTERS: Groups of patents that cover the same technology from
   different angles
2. CLAIM CHAIN STRATEGY: Which patents should be asserted together for
   maximum coverage?
3. STRONGEST CANDIDATES: Top 10 patents ranked by litigation potential, with
   reasoning
4. COMPETITOR VULNERABILITY: Which competitors are most exposed across
   multiple patents?
```

---

### Step 9: Final Shortlist & Export

**Where:** Focus Areas page → Export

1. **Narrow to ~30-50 patents** across all sub-focus-areas based on:
   - Overall litigation score from Stage 1 prompt templates
   - LLM composite score (reweighted)
   - Competitor citation count and density
   - Patent remaining life (>5 years preferred)
   - Family strength (from Step 7)

2. **Per-patent data package:**
   - LLM composite score + per-question scores and reasoning
   - Stage 1 litigation assessment (from focus area prompt cache)
   - Competitor citation list
   - Prosecution history summary (from cache/prosecution-scores/)
   - IPR status (from cache/ipr-scores/)
   - Remaining patent life
   - Family members

3. **Group by litigation theme** (from sub-focus-areas)

4. **Export** using Sector Scores page CSV export or Focus Area export

---

## Key Competitors by Sector (for targeting context)

| Sector | Primary Targets | Notes |
|--------|----------------|-------|
| video-codec | LG (120), Sony (71), Qualcomm (60), Apple (58) | SEP-heavy; HEVC/VVC licensing pools |
| video-server-cdn | Roku (473), Netflix (153), Hulu (123) | Streaming service operators |
| video-client-processing | Roku (190), Spotify (66), Sony (60) | Device/app implementers |
| display-control | Samsung (187), Apple (111) | Display technology in devices |
| video-broadcast | Intel (50), Sony (45), Zoom (18) | Linear TV, broadcast infrastructure |
| video-drm-conditional | Roku (44), Spotify (12), Hulu (10) | Content protection systems |
| video-storage | Sony (35), Spotify (10) | DVR, cloud storage |

---

## Estimated Effort

| Step | Time | Cost | Notes |
|------|------|------|-------|
| 1. Update claim_breadth | 5 min | $0 | Config edit + sync |
| 2. Reweight template | 15 min | $0 | Config edit + sync |
| 3. Recompute scores | 2 min | $0 | 7 button clicks, instant |
| 4. Review rankings | 1-2 hrs | $0 | Manual analysis per sector |
| 5. Sub-sector breakout | 2-3 hrs | $27-54 if rescoring | Optional — only if needed |
| 6. Focus areas | 30 min | $0 | Create + add patents + search terms |
| 7. Family expansion | 1-2 hrs | ~$5 enrichment | Per top patent family |
| 8. Prompt templates | 30 min setup | ~$5-15 LLM | Per-patent + collective analysis |
| 9. Export & review | 1 hr | $0 | Final curation |

**Total: ~1-2 days of user time, ~$40-75 in LLM costs**

Steps 1-4 can be completed in a single session (~2 hours). Steps 5-9 can follow over subsequent sessions as findings sharpen the targeting.
