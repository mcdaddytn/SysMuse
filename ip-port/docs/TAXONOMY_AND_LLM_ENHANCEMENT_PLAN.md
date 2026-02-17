# Taxonomy & LLM Enhancement Plan

*Date: 2026-02-17*
*Status: Requirements Gathering*

## Overview

This document captures analysis and forward-looking requirements for enhancing the IP Portfolio system's LLM scoring capabilities, taxonomy depth, and product/litigation inference. It incorporates findings from model pricing research, current system analysis, and strategic direction for competitor portfolio analysis.

Additional requirements will be added as initiatives are further defined. This feeds into a phased implementation plan.

---

## 1. Current System Baseline

### Model Configuration
- **Model**: `claude-sonnet-4-20250514` (Claude Sonnet 4)
- **SDK**: `@anthropic-ai/sdk` direct (not LangChain)
- **Max tokens**: 4,096 per call
- **Concurrency**: 4 parallel calls, 500ms between batches
- **Rate limit**: 1,000ms between calls (`LLM_RATE_LIMIT_MS`)
- **Cost**: ~$3.00/M input, $15.00/M output tokens

### Scoring Template Hierarchy
```
portfolio-default.json (7 questions, applies to all patents)
    └── super-sectors/{name}.json (3-4 additional questions per super-sector)
           └── sectors/{name}.json (4-6 additional questions per sector)
                  └── sub-sectors/{id}.json (if exists — currently underutilized)
```

After merging, each patent typically receives **14-17 questions** per scoring call.

### Portfolio-Level Questions (universal)
| fieldName | Weight | Focus |
|-----------|--------|-------|
| `technical_novelty` | 0.20 | Prior art departure |
| `design_around_difficulty` | 0.20 | Competitor avoidance difficulty |
| `claim_breadth` | 0.15 | Coverage breadth |
| `market_relevance` | 0.15 | Market alignment |
| `implementation_clarity` | 0.15 | Infringement detectability |
| `standards_relevance` | 0.15 | Standards essentiality |
| `unique_value` | 0.10 | Hidden/dark-horse value |

### Current Taxonomy Scale
- **8 super-sectors**, **55 sectors**, **15+ sub-sector templates** (sparse)
- **28,424 sector-scored patents** across the taxonomy
- Largest sectors: computing-runtime (3,563), network-switching (2,755), network-auth-access (1,694)
- Smallest sectors: semiconductor-legacy (0), magnetics-inductors (18), wireless-security (28)
- AI_ML has only 1 sector with 69 patents — significant gap

### Known Gaps
- **No product/licensing inference**: All questions analyze the patent document itself, not the market landscape
- **No competitor mapping**: System doesn't ask "who might infringe?" despite LLM world knowledge
- **Portfolio-only view**: No multi-portfolio or competitor portfolio analysis
- **V2/V3 score gaps**: 11,538 patents lack V2/V3 scores (see `DESIGN_NOTES_SCORING.md`)
- **Flat enrichment pipeline**: No tiered model support — same model for all patents regardless of priority

---

## 2. LLM Model Options & Cost Analysis

### Cost Multipliers vs Current (Sonnet 4 = 1.0x baseline)

Blended cost assumes ~4:1 input:output token ratio typical for structured patent scoring.

| Tier | Model | Cost vs Sonnet 4 | Context | Reasoning | Best Use |
|------|-------|-------------------|---------|-----------|----------|
| **Premium** | Opus 4.6 | 1.67x | 200K | Best available | Litigation-critical deep analysis |
| **Premium Batch** | Opus 4.6 Batch API | **0.55x** | 200K | Best available | Overnight bulk scoring — cheaper than Sonnet realtime |
| **Standard** | Sonnet 4/4.5 | 1.0x | 200K/1M | High | General sector scoring (current) |
| **Economy** | Haiku 4.5 | 0.33x | 200K | Medium | Pre-filtering, classification, triage |
| **Economy** | o3 (OpenAI) | 0.13x | 200K | Very High | Deep reasoning at very low cost (hidden thinking token costs) |
| **Large Context** | GPT-4.1 | 0.67x | **1M** | High | Full prosecution history analysis |
| **Large Context** | Gemini 2.5 Pro | 0.63x | **1M** | Very High | Large document analysis |
| **Bulk** | Gemini 2.0 Flash | 0.03x | 1M | Medium | Mass pre-screening, classification |
| **Bulk** | DeepSeek V3 | 0.04x | 128K | High | Cheap bulk analysis (needs JSON prompt tuning) |

### Key Pricing Insights
- **Opus Batch is the sweet spot** for quality scoring: 0.55x Sonnet cost with flagship reasoning
- **Haiku 4.5 or Gemini Flash** for taxonomy classification: 25-33x cheaper than Sonnet
- **1M context models** (GPT-4.1, Gemini 2.5 Pro) enable feeding full patent families or prosecution histories in one call
- **Anthropic prompt caching**: Up to 90% reduction on repeated system prompt / template context across batch calls

### Tiered Model Strategy (Recommended)
```
Tier 1 — Triage (Haiku 4.5 or Gemini Flash, ~$0.003/patent)
   All patents: basic classification, subsector assignment, product category tagging
   Kill bottom 60% for detailed analysis

Tier 2 — Standard Scoring (Sonnet 4 or Opus Batch, ~$0.02-0.05/patent)
   Top 40% (~12k patents): Full sector scoring with merged template questions
   Current system behavior

Tier 3 — Deep Analysis (Opus 4.6 Batch, ~$0.05-0.10/patent)
   Top 2,000-3,000: Multi-part design-around, product mapping,
   evidence-of-use, competitor landscape questions
```

**Estimated cost for full tiered run**: ~$500-700 total (vs current ~$300 for Sonnet-only sector scoring)

---

## 3. Product & Litigation Inference — The Blind Spot

### Problem Statement
The system excels at analyzing patent documents technically but does not leverage LLM world knowledge about:
- Which companies make what products
- Product teardown information
- Standards body participation records
- Historical licensing and litigation patterns
- Technology stack composition

This creates a gap between "this is a strong patent" and "this patent has licensing/litigation value against specific targets."

### Tech Stack Intermediary Concept

Rather than asking "does Product X infringe Patent Y?" (which requires specific product knowledge), introduce an intermediate mapping layer:

```
Patent Claims → Technology Components → Tech Stacks → Products/Companies
```

**Example:**
```
Patent: "Method for adaptive beamforming using antenna array" (claims)
   ↓
Tech Components: [phased array antenna, beamforming algorithm, MIMO processing]
   ↓
Tech Stacks: [5G NR base station radio unit, WiFi 6E access point, satellite ground terminal]
   ↓
Products/Companies: [Ericsson RAN, Cisco Catalyst AP, Qualcomm modem chips]
```

The LLM can infer tech component mappings from patent claims with high confidence. Tech stack membership is general knowledge. Product-to-tech-stack mapping leverages the LLM's training data on publicly available product specifications, teardowns, and standards participation.

### New Question Categories

#### Portfolio-Level Additions (apply to all patents)
| Question | Suggested Weight | What It Captures |
|----------|-----------------|------------------|
| **Product Mapping Probability** | 0.12 | "Estimate probability claims read on commercially available products. Name likely product categories and companies." |
| **Licensing Revenue Potential** | 0.10 | "Is this high-volume consumer, infrastructure, or niche? Rate commercial significance." |
| **Evidence of Use Detectability** | 0.15 | "Can infringement be detected without internal product access? From behavior, specs, standards compliance, or teardown?" |
| **Tech Component Classification** | 0.08 | "What fundamental technology components does this patent address? Map to known technology building blocks." |

#### Super-Sector Level Additions
| Super-Sector | Question | Rationale |
|---|---|---|
| WIRELESS | Handset vs Infrastructure Revenue Target | Different licensing models, volumes, per-unit values |
| WIRELESS | Undeclared Standards-Essential Overlap | 3GPP/IEEE spec analysis for hidden SEP value |
| SEMICONDUCTOR | Foundry vs Fabless Target | TSMC/Samsung vs Qualcomm/Nvidia/Apple |
| NETWORKING | Cloud Provider Exposure | AWS/Azure/GCP architecture overlap |
| SECURITY | Enterprise vs Consumer Security Target | CrowdStrike/Palo Alto vs Norton/consumer |
| VIDEO_STREAMING | OTT vs Infrastructure Target | Netflix/Disney vs Akamai/CDN vendors |

#### Sector/Sub-Sector Level Questions
These should be highly specific — see Section 5 for taxonomy deepening where subsector-level questions are most valuable.

### Design-Around Difficulty Refactoring

Currently a single 1-10 question at portfolio level. Should be decomposed into a multi-part assessment, ideally at sector level where technology-specific context matters:

| Sub-Component | Level | What It Captures |
|---|---|---|
| Fundamental vs Implementation | Sector | Is this a fundamental approach or a specific implementation? |
| Alternative Path Count | Sector | How many viable technical alternatives exist? |
| Performance Penalty of Alternatives | Sector | What cost/size/performance penalty for designing around? |
| Standards Lock-in | Super-sector | Is the approach mandated by a standard? |
| Time-to-Design-Around | Sector | Even if possible, how long? (injunction leverage) |

**Model recommendation:** Use Opus 4.6 Batch for the decomposed design-around on top-N patents per sector. This is exactly the kind of nuanced multi-factor judgment where Opus excels.

---

## 4. Taxonomy Audit — Misfit Sectors & Reorganization

### Identified Issues

#### Misfits / Mismatches
| Sector | Current Super-Sector | Issue | Possible Action |
|---|---|---|---|
| `rf-acoustic` (384) | WIRELESS | Acoustic resonators are semiconductor components (BAW/FBAR/SAW), not wireless protocols. Targets Murata, Skyworks, Qorvo — different litigation profile. | Move to SEMICONDUCTOR or create RF_COMPONENTS super-sector |
| `radar-sensing` (121) | WIRELESS | Radar/sensing overlaps automotive (Continental, Bosch), not telecom. Different targets. | Evaluate: keep or move to new SENSING super-sector |
| `audio` (142) | SEMICONDUCTOR | Audio processing is signal processing, not semiconductor fabrication. Targets Dolby, Harman, Sonos. | Move to MEDIA or create separate super-sector |
| `power-management` (217) | COMPUTING | Power management is circuit design, not computing. Targets TI, Infineon, Analog Devices. | Move to SEMICONDUCTOR |
| `fintech-business` (143) | COMPUTING | Business methods/fintech have totally different litigation landscape than computing hardware. | Consider standalone super-sector or merge strategy |
| `streaming-multimedia` (35) | NETWORKING | Too small and overlaps with VIDEO_STREAMING. | Merge into VIDEO_STREAMING or network-protocols |

#### Super-Sectors Needing Expansion
| Super-Sector | Issue | Recommendation |
|---|---|---|
| AI_ML (1 sector, 69 patents) | Vastly under-represented. Many AI patents likely miscategorized in COMPUTING or NETWORKING. | Re-classify with LLM; expand to 3-4 sectors (model-architecture, training-infra, inference-deployment, ai-applications) |
| STORAGE (exists in taxonomy docs but has 0 sectors in DB) | Missing entirely from active taxonomy | Create with sectors from computing-runtime overflow + video-storage |

#### Large Sectors Needing Subsector Splits
Based on analysis in `SECTOR_REFACTORING_RECOMMENDATIONS.md` and `SECTOR_BREAKOUT_PROPOSALS_V2.md`:

| Sector | Size | Proposed Subsectors | Why |
|---|---|---|---|
| computing-runtime | 3,563 | virtualization, distributed-systems, process-scheduling, memory-management | Too broad; different targets per subsector |
| network-switching | 2,755 | routing-protocols, switch-fabric, sdn-nfv, qos-traffic-mgmt | SDN targets (VMware, Cisco) vs traditional routing |
| wireless-transmission | 1,297 | mimo-beamforming, carrier-aggregation, power-control, modulation-coding | Different target profiles per tech area |
| network-auth-access | 1,694 | authentication-protocols, access-control-policy, firewall-gateway, identity-management | Identity mgmt targets (Okta, Ping) vs firewall targets (Palo Alto) |
| analog-circuits | 1,414 | pll-clock, adc-dac, power-amplifier, voltage-regulators | PA targets (Skyworks) vs PLL targets (TI, Analog Devices) |

### LLM-Assisted Taxonomy Mapping

Use a cheap model (Haiku or Gemini Flash, ~$30 for 29k patents) to:

1. **Classify into proposed subsectors** based on title + abstract + CPC codes
2. **Flag misfits**: patents that don't fit well into their current sector
3. **Suggest custom groupings** beyond CPC: technology component clusters, application area clusters
4. **Generate descriptive labels** for subsectors that are meaningful to non-patent-experts

This creates a taxonomy that goes beyond CPC code aggregation — incorporating technology function, market application, and competitive landscape groupings.

---

## 5. Competitor Portfolio Analysis Initiative

### Vision
Analyze competitor patent portfolios to understand where they are "playing" in the same technology spaces. Large competitors (Qualcomm, Intel, Samsung, etc.) file patents strategically to:
- Build defensive positions against licensing claims
- Create cross-licensing leverage
- Signal their technology investment areas

By comparing our sector/subsector taxonomy coverage with competitor filing patterns, we can:
- Identify sectors where competitors are **building defenses** (suggests they know they're exposed)
- Find sectors where competitors have **thin coverage** (suggests weaker defensive position)
- Detect **overlapping family expansion** patterns between our portfolio and competitor portfolios

### Requirements (to be expanded)
- Multi-portfolio support (see `NON_PORTFOLIO_AND_MULTI_PORTFOLIO_PLAN.md` for groundwork)
- Competitor portfolio import from PatentsView or other sources
- Sector-level overlap analysis: "How many competitor patents map to each of our sectors?"
- Family expansion comparison: competitor families expanding into our technology spaces
- Additional requirements TBD by user

### Competitor-Informed Taxonomy
When competitors are identified per sector, the taxonomy and LLM questions can be further refined:
- Subsectors can be organized around **competitive clusters** (who competes with whom)
- LLM questions can reference specific known competitors: "Given that [Qualcomm, Samsung, Intel] are active in this space, how does this patent's claim scope relate to known product implementations?"
- Design-around analysis becomes more pointed when we know who would need to design around

---

## 6. Enrichment Pipeline Enhancements

### Current Limitations
- Single model for all scoring (Sonnet 4)
- No priority-based ordering (can't run top-N first)
- Enrichment pipeline doesn't link to sector scores for prioritization
- No batch API support
- No model selection per tier

### Required Enhancements
1. **Model selection per scoring tier**: Config-driven (`LLM_MODEL_TRIAGE`, `LLM_MODEL_SECTOR`, `LLM_MODEL_DEEP`)
2. **Priority ordering**: Score top-N patents first based on:
   - V2/V3 base scores (overall priority)
   - Sector composite scores (within-sector priority)
   - Preliminary triage scores (for unscored patents)
3. **Batch API integration**: Queue jobs for Anthropic Batch API (50% cost reduction, 24h SLA)
4. **Progress tracking**: Track which patents have been scored at which tier, with which model, when
5. **Cost tracking**: Persistent token usage and cost per scoring run, per model, per tier
6. **Re-scoring support**: When templates change, identify which patents need re-scoring and prioritize

### Batch Processing Design
```
Overnight batch flow:
  1. Select patents needing scoring (new, template-changed, priority-upgraded)
  2. Group by tier: triage / standard / deep
  3. Submit to Batch API with appropriate model per tier
  4. Process results when complete (poll or webhook)
  5. Update scores, log costs, flag anomalies
```

---

## 7. Multi-Model Testing (Phase 4)

### Ensemble Scoring Concept
Run the same questions through 2-3 models on a sample set. Compare:
- Score distributions (does model A consistently score higher?)
- Score correlations (do models agree on relative rankings?)
- Reasoning quality (does one model cite more specific evidence?)
- Divergence cases (where models disagree significantly → human review)

### Proposed Test Matrix
| Sample | Models | Questions | Purpose |
|---|---|---|---|
| 100 patents (top-scored) | Sonnet 4, Opus 4.6, o3 | Full sector template | Quality comparison at the top |
| 100 patents (mid-range) | Sonnet 4, Opus 4.6, Haiku 4.5 | Full sector template | Determine where Haiku quality drops off |
| 100 patents (bottom) | Haiku 4.5, Gemini Flash | Triage questions only | Validate cheap model for pre-filtering |
| 50 patents (design-around focus) | Opus 4.6, Sonnet 4, o3 | Decomposed design-around | Test reasoning depth on nuanced judgment |

### Integration Considerations
- OpenAI models (o3, GPT-4.1) require separate SDK integration
- Gemini models require Google AI SDK
- DeepSeek requires custom JSON prompting and response parsing
- All models should go through a common scoring interface that normalizes input/output

---

## 8. Implementation Phases (Preliminary)

### Phase 1: Foundation & Quick Wins
- [ ] Add new portfolio-level questions (Product Mapping, Evidence of Use, Tech Components, Licensing Revenue)
- [ ] Switch overnight scoring to Opus 4.6 Batch API
- [ ] Run LLM taxonomy classification on full portfolio (Haiku/Flash) to propose subsectors
- [ ] Audit misfit sectors; produce recommended reorganization

### Phase 2: Taxonomy Deepening
- [ ] Create subsector templates for top 5 largest sectors
- [ ] Define subsector-specific questions (design-around decomposition, product inference)
- [ ] Implement subsector assignment pipeline (cheap model classification)
- [ ] Build descriptive labels and documentation for all subsectors
- [ ] Re-score affected patents with new subsector templates

### Phase 3: Enrichment Pipeline Upgrade
- [ ] Add multi-model support to scoring service (model selection per tier)
- [ ] Implement priority-based scoring ordering (V2 score, sector score, triage score)
- [ ] Integrate Anthropic Batch API for overnight runs
- [ ] Add persistent cost tracking per scoring run
- [ ] Build re-scoring detection (template changed → patents needing update)

### Phase 4: Multi-Model & Competitor Analysis
- [ ] Multi-model ensemble testing on sample sets
- [ ] Competitor portfolio import and sector overlap analysis
- [ ] Competitor-informed taxonomy refinement
- [ ] Tech stack intermediary layer implementation
- [ ] Cross-portfolio family expansion comparison

### Phase 5: Advanced Inference
- [ ] Product mapping database (tech components → tech stacks → products → companies)
- [ ] Litigation opportunity scoring (combining design-around + product mapping + evidence detectability)
- [ ] Competitive landscape dashboards per sector
- [ ] Custom taxonomy creation tools (beyond CPC codes)

---

## 9. Related Documents

| Document | Relevance |
|---|---|
| `DESIGN_NOTES_SCORING.md` | V2/V3 score gap investigation, snapshot overwrite problem |
| `SECTOR_REFACTORING_RECOMMENDATIONS.md` | Statistical analysis of which sectors need splitting |
| `SECTOR_BREAKOUT_PROPOSALS_V2.md` | Detailed CPC-based breakout proposals |
| `SUBSECTOR_SCORING_PLAN.md` | Original subsector scoring data model and template inheritance design |
| `COMPETITOR_EXPANSION_STRATEGY.md` | Competitor pool gap analysis and expansion recommendations |
| `NON_PORTFOLIO_AND_MULTI_PORTFOLIO_PLAN.md` | Multi-portfolio access groundwork |
| `SECTOR_SPECIFIC_LLM_QUESTIONS.md` | Original sector-specific question design |
| `SCORING_METHODOLOGY_V3_DESIGN.md` | V3 scoring formula and methodology |
| `SCORING_FORMULA_REFERENCE.md` | Current scoring formula reference |

---

## 10. Open Questions

1. **Competitor portfolio scope**: Which competitors first? How many patents per competitor portfolio?
2. **Subsector granularity target**: How many subsectors per sector is useful vs. noise? 3-5 per large sector?
3. **Re-scoring budget**: When templates change, do we re-score all affected patents or just top-N?
4. **Multi-model integration priority**: Which non-Anthropic model to integrate first for testing? (o3 is most interesting for reasoning quality)
5. **Tech stack database**: Build from LLM inference, or seed from external data sources?
6. **Taxonomy governance**: Who decides when to split/merge sectors? Automated thresholds or manual?
