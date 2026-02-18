# Taxonomy & LLM Enhancement Plan

*Date: 2026-02-17*
*Status: Requirements Gathering*

## Overview

This document captures the strategic roadmap for evolving IP Port from a single-portfolio patent scoring tool into a **litigation opportunity identification platform**. It combines:

- LLM model analysis and cost optimization (Sections 2-3)
- Taxonomy deepening with subsectors (Sections 4)
- Real-world business goals: identifying litigation targets through competitor portfolio overlap, product mapping, and patent family entanglement analysis (Sections 8-11)
- System enhancements: multi-portfolio support, product entity, admin tools, data layer (Sections 9-13)
- Pragmatic development phases prioritizing proof-of-concept litigation analysis (Section 14)

The guiding principle is **pre-screening at minimal cost**: the system's job is to identify high-confidence litigation opportunities before committing expensive resources (attorneys, 3rd party vendors like Patlytics at ~$25/patent for up to 20 product searches, discovery costs).

Additional requirements will be added as initiatives are further defined.

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

### Incremental Question Testing Approach

**Principle:** Add new questions but defer incorporating them into composite scores until validated.

1. Add new questions to templates with **weight 0** (scored but not counted in composite)
2. Run on a small batch (50-100 patents in the POC sector) to evaluate quality
3. Review LLM answers — are they informative? Consistent? Do they differentiate patents?
4. Once validated, assign weights and incorporate into composite score for new scoring runs
5. Use top-N renormalization (Section 6) to extend to the broader portfolio without full reruns

This prevents a new untested question from distorting the established ranking while still collecting data.

### New Question Categories

#### Portfolio-Level Additions (apply to all patents)
| Question | Suggested Weight (after validation) | What It Captures |
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
| G09G display patents (~400) | VIDEO_STREAMING | Display controller circuits, not streaming technology. Low scores (22-26), high competitor counts (2.3-2.8) — different profile than actual streaming patents. | Move to computing-ui or optics/photonics |

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

### Multiple Taxonomy Support

The current super-sector → sector → sub-sector hierarchy represents **one taxonomy** — primarily CPC-code-derived. The system should support **multiple taxonomies** that can coexist:

| Taxonomy Type | Basis | Purpose |
|---|---|---|
| **CPC-derived** (current) | CPC code groupings | Default technical classification |
| **Product-based** | Technology component → product mapping | "Which products use this technology?" |
| **Competitor-based** | Competitor filing patterns | "Where is Qualcomm filing?" |
| **Litigation-oriented** | Claim scope + market overlap | "Where are the strongest licensing opportunities?" |
| **User-contributed** | Expert knowledge, manual curation | Custom groupings for specific analyses |

Each patent can be classified under multiple taxonomies simultaneously. Scoring templates can be associated with any taxonomy — not just the CPC-derived one.

**Future consideration:** Taxonomy governance through expert voting. Subject matter experts could use slider-based ontological voting interfaces to collaboratively refine taxonomy boundaries and resolve classification disputes. This is a later-phase capability but the data model should not preclude it.

### Multi-Classification Design Principle

**Design principle (do not complicate early implementation, but preserve in data model):**

Just as patents have multiple CPC codes, any object in the system can have multiple classifications from the same or different taxonomy schemes:

- **Primary classification**: Used for most analysis, scoring, and display. Keeps things simple and costs down.
- **Secondary/tertiary classifications**: Available for cross-cutting analysis when needed (e.g., a patent primarily in `video-codec` but secondarily relevant to `wireless-transmission` due to wireless video applications).
- **Cross-scheme classifications**: A patent can be classified under the CPC-derived taxonomy AND the product-based taxonomy AND a competitor-based taxonomy simultaneously.

The data model should use a **many-to-many relationship with rank/priority** (e.g., `patent_classifications` table with `taxonomy_id`, `category_id`, `rank: primary|secondary|tertiary`) rather than a single `sector_id` foreign key. Most queries filter on `rank = 'primary'` for cost efficiency, but the full classification set is available when deeper analysis requires it.

This principle applies broadly — not just to patents but to any classifiable entity (products, companies, focus areas). It should not add complexity to the POC implementation but must remain a supported path in the schema design.

---

## 5. Competitor Portfolio Analysis Initiative

### Vision
Analyze competitor patent portfolios to understand where they are "playing" in the same technology spaces. Competitors (Netflix, Amazon, Google/YouTube, etc. for VIDEO_STREAMING; Qualcomm, Samsung, Intel for later WIRELESS/SEMICONDUCTOR phases) file patents strategically to:
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

### Top-N Scoring with Renormalization

**Principle:** Avoid expensive full-portfolio reruns. Expand information incrementally.

When new questions or models are introduced:
1. **Score top-N patents** per sector with the new questions/model (e.g., top 100-200 by existing composite)
2. **Renormalize lower patents**: Use statistical mapping to adjust lower-ranked patents' estimated scores based on how top-N scores shifted. This keeps relative rankings approximately stable without paying for full reruns.
3. **Expand coverage over time**: As new patents enter the system or as overnight batch capacity allows, gradually extend new scoring to more of the portfolio
4. **Flag renormalized vs. directly-scored**: UI should distinguish between patents scored with the current template vs. those with renormalized estimates

This approach means adding new questions doesn't force a $300+ rerun. New questions can be tested on small batches first, evaluated for quality, and only incorporated into the composite score formula after validation.

### Data Archiving

Before any bulk re-scoring or template change:
1. **Archive current scores** with timestamp and template version to a dated archive directory
2. **Maintain revert capability**: If new scoring produces worse results, revert to archived scores
3. **Archive format**: Copy `cache/llm-scores/` → `cache/archives/llm-scores-{date}-{templateVersion}/`
4. **Keep at least 2 previous versions** before pruning old archives

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

## 8. Business Goals — Litigation Opportunity Identification

### Strategic Objective

The system has reached a maturity point where individual features (sector scoring, family expansion, focus areas, LLM analysis) can be combined to deliver **actionable litigation intelligence**. The goal is to identify pockets of the portfolio where:

1. We have strong patents (high design-around difficulty, broad claims, standards relevance)
2. Major competitors are active in the same technology spaces (sector/subsector overlap)
3. Patent family density from multiple companies creates a **nexus of data** suggesting design entanglements
4. The data is rich enough to **pre-screen litigation opportunities** before committing expensive resources (3rd party vendors at ~$25/patent, attorney hours)

The system serves as a **pre-screening workstation** — its job is to minimize cost and maximize confidence before escalating opportunities to attorneys and paid analysis services.

### Feature Convergence

The key insight is that combining existing features creates capabilities greater than the sum of parts:

```
Sector Scores          → "These patents are strong in this technology area"
   +
Family Expansion       → "These patent families show competitor activity nearby"
   +
Focus Areas            → "Group the most interesting patents for deep custom analysis"
   +
Custom LLM Prompts     → "Synthesize all data into litigation strategy recommendations"
   =
Litigation Opportunity Pipeline
```

**Focus areas** become the output container — groups of patents identified through systematic analysis that are then subjected to custom LLM workflows for litigation strategy synthesis. The focus area is a placeholder for emergent analysis: its member patents share some overarching theme (technology overlap, competitor entanglement, product exposure) and the custom LLM capability can propose strategies, identify gaps, and recommend next steps.

### What "Success" Looks Like for Proof of Concept

Demonstrate the following workflow end-to-end in **VIDEO_STREAMING** against Netflix and Amazon:

1. Import competitor's top-N patents in VIDEO_STREAMING sectors
2. Identify technology subsectors with dense overlap between portfolios
3. Detect patent family entanglements (cross-citations, parallel filings, design-around patterns)
4. Export high-potential clusters to focus areas
5. Run custom LLM analysis synthesizing all available data into litigation opportunity assessment
6. Produce a ranked list of opportunities with confidence levels and recommended next steps
7. Validate top opportunities with Patlytics product mapping (150 free credits available)

---

## 9. Multi-Portfolio & Competitor Analysis

### Current State

- System is **single-portfolio**: all patents come from one `streaming-candidates-*.json` file (Broadcom, ~29k patents)
- Non-portfolio patents exist only as citation references (parents, citing patents) with limited data
- Affiliates are managed via static JSON config (`config/portfolio-affiliates.json`) — no UI, no API
- Admin page exists in nav but **is not implemented** (dead link to `/admin`)
- No multi-portfolio data model, no competitor portfolio concept

### Required Capabilities

#### 9.1 Multi-Portfolio Data Model

Extend the system to support multiple named portfolios:

```
Portfolio
  ├── name: "Broadcom" | "Qualcomm" | "Samsung" | etc.
  ├── type: "own" | "competitor" | "target"
  ├── affiliates: [{ name, patterns[], acquiredYear, parent }]
  ├── patents: [patent IDs discovered via affiliate/assignee search]
  └── metadata: { patentCount, sectorCoverage, lastUpdated }
```

Each portfolio has its own affiliate tree and assignee patterns. Patents can belong to multiple portfolios (rare but possible with acquisitions).

#### 9.2 Affiliate & Assignee Management

Build into the Admin screen — the ability to:

- **CRUD affiliates** for any portfolio (currently static JSON for Broadcom only)
- **LLM-assisted acquisition discovery**: Given a company name, use LLM to identify major acquisitions, subsidiaries, and former names. Populate affiliate candidates for review.
- **Assignee search**: Use USPTO API endpoints (PatentsView, ODP) to discover assignee name variations and patent counts per affiliate
- **Pattern builder**: Generate regex patterns for matching raw USPTO assignee strings to canonical names

The Broadcom affiliate management we did manually should become a repeatable, tool-assisted process for any competitor.

#### 9.3 Competitor Portfolio Import (Top-N)

Start with targeted imports, not full portfolios:

| Scope | Patent Count | Purpose |
|---|---|---|
| Top 50 per competitor | ~50-200 | Quick overlap detection in key sectors |
| Top 100 per sector overlap | ~500-1,000 | Deeper sector-level entanglement analysis |
| Top 1,000 per competitor | ~3,000-5,000 | Comprehensive competitive landscape |

**Import pipeline:**
1. Identify competitor affiliates (LLM-assisted + manual review)
2. Search PatentsView for patents by assignee in overlapping CPC codes
3. Import basic patent data (title, abstract, CPC, dates, assignee)
4. Run through our sector classification pipeline (cheap model)
5. Identify sectors with highest overlap density

#### 9.4 Sector Overlap Analysis

For each competitor portfolio, compute:

- **Sector overlap matrix**: How many competitor patents map to each of our sectors/subsectors?
- **Density hotspots**: Sectors where both portfolios have high patent density
- **Citation overlap**: Cross-citations between portfolios (forward/backward)
- **Family entanglement score**: Patent families with members from both portfolios in the same subsector
- **Temporal analysis**: Are competitor filings increasing or decreasing in specific sectors?

This analysis identifies the "battleground" sectors where litigation is most likely to find both strong own patents and evidence of competitor engagement.

---

## 10. Product Entity & External Data Integration

### The Product Concept

No product model exists in the system today. We need to add a first-class "Product" entity:

```
Product
  ├── name: "iPhone 15 Pro" | "Galaxy S24" | "Cisco Catalyst 9300" | etc.
  ├── company: → Company/Portfolio link
  ├── category: "smartphone" | "network-switch" | "wireless-ap" | etc.
  ├── techComponents: ["5G NR modem", "beamforming", "OFDMA", ...]  (LLM-inferred)
  ├── techStacks: ["5G NR base station radio", ...]  (LLM-inferred)
  ├── documentation: [{ type: "datasheet" | "teardown" | "spec", url, localPath }]
  ├── externalAnalysis: [{ vendor: "patlytics", reportDate, claimCharts: [...] }]
  └── linkedPatents: [{ patentId, relevanceScore, matchType }]
```

### Data Import from External Vendors

Support importing product data from paid analysis services:

- **Patlytics** (~$25/patent for up to 20 product searches): Produces product-to-patent mapping with claim chart stubs. **150 free credits available for POC.**
- **Import formats**: .xlsx, .csv, .pdf
- **PDF analysis**: Use LLM to extract product specifications, technology components, and tech stack information from product documentation PDFs
- **Link to patents**: Associate imported products with patents in our system; use LLM to infer tech component overlap

### Other Product Information Sources

Beyond paid vendors, product information can be assembled from publicly available sources:

- **iFixit**: Detailed teardowns of consumer electronics revealing component suppliers and technologies
- **FCC filings**: RF test reports with chipset identification for wireless devices
- **Product datasheets**: Manufacturer-published specifications listing technology components
- **Standards participation records**: 3GPP, IEEE, IETF contributor disclosures linking companies to technologies
- **Industry teardown services**: TechInsights, System Plus (higher cost, professional grade)

LLM world knowledge can also infer product-technology relationships from its training data, filling gaps where formal documentation is unavailable. These inferences should be tagged with confidence levels and validated against external data as it becomes available.

### Product Analysis Workflow

```
1. External vendor (Patlytics) → .xlsx/.csv export → Import to system
2. Product documentation (.pdf datasheets) → LLM extraction → tech components, specs
3. LLM inference: product tech stack → technology components → patent claim mapping
4. Associate products with companies and sectors
5. Cross-reference: "Which of our patents likely read on this product?"
```

### Strategic Use of External Vendors

External vendors are expensive (~$25/patent for up to 20 product searches per patent). We have **150 free Patlytics credits for POC** — use them wisely on the highest-confidence candidates. The system's job is to **pre-screen** so we only send the highest-confidence opportunities:

1. System identifies top-N candidate patents per sector (design-around, product mapping, evidence of use)
2. Human review narrows to top candidates worth external validation
3. Selected patents sent to Patlytics for product mapping
4. Results imported back into system for synthesis with all other data
5. Focus area LLM workflows combine everything into litigation opportunity assessment

---

## 11. Focus Area Enhancement for Litigation Workflows

### Current State

Focus areas already support:
- Patent grouping with search terms and scope definitions
- **Prompt templates** (PER_PATENT and COLLECTIVE modes) with LLM execution
- **Facet definitions** with LLM scoring (NUMERIC, CATEGORICAL, TEXT, BOOLEAN)
- **LLM workflows** with dependency graphs (tournament, chained, two-stage patterns)
- Keyword extraction and search term analysis

### Enhancements for Litigation Pipeline

#### Auto-Population from Overlap Analysis

When sector overlap analysis identifies hotspots:
- Auto-create focus groups containing patents from both portfolios in the overlapping subsector
- Tag with overlap metadata (competitor name, overlap density, citation connections)
- User reviews and formalizes into focus areas for deeper analysis

#### Litigation-Oriented Prompt Templates

Pre-built prompt templates for litigation analysis within focus areas:

| Template | Mode | Purpose |
|---|---|---|
| **Competitive Landscape Synthesis** | COLLECTIVE | "Given these N patents from [our portfolio] and M patents from [competitor], analyze technology overlap and identify potential infringement vectors" |
| **Claim-Product Mapping** | PER_PATENT | "Given this patent's claims and known products from [competitor], assess likelihood of infringement and evidence availability" |
| **Design-Around Assessment** | PER_PATENT | "Given competitor's patent activity in this space, assess whether competitor has likely designed around or is likely infringing" |
| **Litigation Strategy Proposal** | COLLECTIVE | "Synthesize all available data for this focus area and propose a litigation strategy including strengths, weaknesses, recommended evidence gathering, and estimated probability of success" |
| **3rd Party Screening** | PER_PATENT | "Rate this patent's readiness for external product mapping analysis. Consider: claim clarity, product visibility, evidence detectability, market relevance. Recommend: send to vendor / needs more data / skip" |

#### Focus Area as Attorney Handoff

Focus areas should support export for attorney review:
- Structured summary document (PDF/DOCX) with all LLM analysis results
- Claim-by-claim analysis for top patents
- Product mapping evidence
- Recommended next steps and confidence levels
- Cost estimates for further analysis (3rd party vendor fees, discovery costs)

---

## 12. Admin Screen & System Renaming

### App Rename: "Patent Workstation" → "IP Port"

Current locations to update:
- **Toolbar title**: `frontend/src/layouts/MainLayout.vue` line 83 (`<span class="text-weight-bold">Patent Workstation</span>`)
- **Browser tab title**: `frontend/src/layouts/MainLayout.vue` line 119 (router navigation guard)
- Any documentation or splash screens referencing the old name

"IP Port" better reflects the system's evolution beyond patent-only analysis to include products, companies, and litigation intelligence.

### Admin Screen Build-Out

The admin nav link exists but points to a dead route. Build:

| Admin Section | Capabilities |
|---|---|
| **Portfolios** | CRUD portfolios (own, competitor, target); set active portfolio |
| **Affiliates** | Manage affiliate trees per portfolio; LLM-assisted acquisition discovery; pattern builder |
| **Assignees** | Search USPTO for assignee variations; map to affiliates; track patent counts |
| **Competitors** | Define competitor companies; link to competitor portfolios; track overlap metrics |
| **Products** | Import products from .xlsx/.csv; manage product documentation; view tech stack mappings |
| **Scoring Config** | View/edit scoring templates; manage model tiers; view cost history |
| **System** | Cache stats; enrichment queue status; batch job status; data export |

---

## 13. Data Service Layer Considerations

### Problem Statement

As the system grows from single-portfolio to multi-portfolio with products, competitors, and external data imports, data management complexity increases significantly. Current data is spread across:

| Storage | What Lives There | Access Pattern |
|---|---|---|
| PostgreSQL | Sectors, templates, scores, snapshots, focus areas, prompt templates, LLM workflows | Structured queries, relationships |
| JSON cache files | PatentsView responses, file-wrapper data, PTAB data, LLM scores, prosecution scores, IPR scores, patent families | Key-value lookup by patent ID |
| Streaming-candidates JSON | Portfolio patent master data (29k patents) | Full load into memory at startup |
| USPTO bulk XML | Patent claims full text (via external SSD) | On-demand read by patent number |
| Elasticsearch | Patent search index (title, abstract, CPC) | Full-text search, faceted queries |
| Config JSON files | Scoring templates, affiliate definitions | Read at startup, manual edits |

### When to Build a Unified Data Layer

**Deferred to Phase 7** — but design decisions now should anticipate it:

- **Phase 1-2**: Continue with current storage but add clear service interfaces (e.g., `PatentDataService.getPatent(id)` that checks candidates → cache → PatentsView API → null)
- **Phase 3-5**: If multi-portfolio creates immediate pain with the single candidates file, consider early migration of patent master data to PostgreSQL. Otherwise defer.
- **Phase 7+**: Full data service layer with:
  - Unified patent lookup across all sources
  - Import/export pipeline for external system integration
  - Redis caching for hot data (sector scores, portfolio stats)
  - Replicated database for production deployment
  - API layer for ad-hoc analysis (Claude Code skills, external tools)

### Claude Code Skills Integration

Create a skills document that enables Claude Code to query the data layer for ad-hoc analysis:
- Patent lookup and enrichment data
- Sector score queries and comparisons
- Portfolio overlap computations
- Focus area contents and LLM results
- Cache statistics and data availability

This allows the system to be used as a research tool beyond the GUI — analysts can ask complex questions that combine data from multiple sources.

### Service Decomposition for Reuse

**Design principle:** As the data service layer develops, split reusable components into independent, testable services that can be maintained separately and used across other systems.

Many capabilities being built for IP Port are general-purpose and applicable to other systems doing LLM analysis of legal documents, patent/product analysis, and structured evaluation:

| Component | Reuse Potential | Current Location |
|---|---|---|
| **LLM Workflow Engine** | Prompt template execution, dependency graphs, tournament/chained patterns | `src/api/services/llm-workflow-service.ts` |
| **Prompt Template System** | PER_PATENT/COLLECTIVE modes, variable substitution, response parsing | `src/api/services/prompt-template-service.ts` |
| **Facet Calculation/Scoring** | Numeric/categorical/boolean scoring with aggregation | `src/api/services/facet-service.ts` |
| **Scoring Template Hierarchy** | Multi-level template inheritance with weight renormalization | `src/api/services/scoring-template-service.ts` |
| **LLM Scoring Service** | Structured question scoring with JSON response parsing | `src/api/services/llm-scoring-service.ts` |
| **Batch Processing Framework** | Concurrency control, rate limiting, progress tracking | Spread across services |
| **Taxonomy Classification** | Multi-taxonomy assignment, hierarchy management | DB + scoring templates |

**Target architecture:** Each component should be:
- Independently importable (clear module boundaries, minimal cross-dependencies)
- Separately testable (unit tests that don't require the full application context)
- Schema-segregated where practical (own Prisma models or schema segments)
- Documented with clear interfaces for external consumers

This is a gradual refactor, not a big-bang rewrite. As services are touched during POC phases, incrementally improve their boundaries and interfaces. The goal is that by Phase 7, these components are extractable for use in other SysMuse systems.

### Production Deployment Prelude

The data service layer work is a prelude to server deployment:
- Separate data access from business logic
- Define clear API contracts for each data source
- Build import/export pipelines that work in both dev (file-based) and prod (database-backed) modes
- Add monitoring, logging, and error handling appropriate for a server environment

---

## 14. Pragmatic Development Phases

These phases are organized around **proof of concept with litigation analysis** as the priority. Each phase should validate the approach before investing in the next. Pivots are expected based on findings.

### POC Scope: VIDEO_STREAMING Sector

The POC targets **VIDEO_STREAMING** — chosen because:
- **Attorney priority**: Already flagged for litigation review
- **Manageable scale**: ~1,857 sector-scored patents (vs 5,000+ in WIRELESS)
- **Clear competitors**: Netflix, Amazon (Prime Video/AWS Elemental), Disney+/Hulu, YouTube/Google, Apple TV+, Roku, Comcast/NBCUniversal
- **Well-defined technology landscape**: Codec, DRM, CDN, adaptive bitrate, recommendation, ad-insertion
- **Revenue exposure**: Streaming is a massive and growing market with clear per-subscriber licensing models

Samsung/Qualcomm wireless analysis is deferred — too many patents for initial POC and requires deeper taxonomy work first.

### Phase 0: Quick Wins & Rename (1-2 days)
**Goal:** Visible progress, remove friction.

- [ ] Rename "Patent Workstation" to "IP Port" in toolbar and browser title
- [ ] Add new portfolio-level LLM questions (Product Mapping Probability, Evidence of Use Detectability, Licensing Revenue Potential, Tech Component Classification)
- [ ] **Do NOT incorporate new questions into composite score yet** — run on a small batch (50-100 patents in VIDEO_STREAMING), evaluate quality, then decide on weight integration
- [ ] Update `portfolio-default.json` template with new questions at weight 0 (scored but not counted) for testing

### Phase 1: VIDEO_STREAMING Deep Dive & Multi-Portfolio Foundation (3-5 days)
**Goal:** Demonstrate end-to-end litigation analysis in VIDEO_STREAMING.

- [ ] Add `Portfolio` model to Prisma schema (name, type, affiliates)
- [ ] Migrate Broadcom affiliates from static JSON to database
- [ ] Build Admin page skeleton with Portfolio and Affiliate management
- [ ] LLM-assisted affiliate discovery for VIDEO_STREAMING competitors (Netflix, Amazon, etc.)
- [ ] PatentsView assignee search: find patent counts per affiliate pattern
- [ ] Import top 50-100 competitor patents in VIDEO_STREAMING sectors (Netflix, Amazon first)
- [ ] Archive current LLM scores before any re-scoring runs

**POC Target:** Import competitor patents for Netflix and Amazon in VIDEO_STREAMING; see them alongside our patents in the sector view.

### Phase 2: Sector Overlap Detection — VIDEO_STREAMING Focus (3-5 days)
**Goal:** Find the battleground subsectors within VIDEO_STREAMING.

- [ ] Run competitor patents through sector classification (Haiku/Flash, cheap)
- [ ] Compute sector overlap matrix within VIDEO_STREAMING subsectors
- [ ] Identify density hotspots — subsectors with high patent count from both portfolios
- [ ] Citation overlap analysis — cross-citations between our VIDEO_STREAMING patents and competitors'
- [ ] Family expansion comparison — parallel family activity in same subsectors
- [ ] Build overlap visualization in Sector Rankings or a new Competitive Landscape view

**POC Target:** Identify 2-3 VIDEO_STREAMING subsectors (e.g., adaptive-bitrate, DRM, codec-optimization) with strong overlap and rich data for litigation analysis.

### Phase 3: Focus Area Pipeline — Litigation Opportunities (3-5 days)
**Goal:** Turn VIDEO_STREAMING overlap hotspots into actionable analysis.

- [ ] Auto-create focus groups from overlap hotspots (our top patents + competitor nearby patents)
- [ ] Build litigation-oriented prompt templates (Competitive Landscape Synthesis, Design-Around Assessment, 3rd Party Screening)
- [ ] Run custom LLM analysis on focus areas using Opus Batch for highest quality
- [ ] Produce ranked litigation opportunity list with confidence levels
- [ ] Export format for attorney review (CSV + markdown initially; PDF/DOCX later)

**POC Target:** Produce 2-3 VIDEO_STREAMING litigation opportunity assessments. If compelling, validate top candidates with Patlytics (up to 150 free credits available).

### Phase 4: Product Layer & External Integration (5-7 days)
**Goal:** Add products to the analysis.

- [ ] Add `Product` model to Prisma schema
- [ ] Build product import from .xlsx/.csv (Patlytics exports)
- [ ] PDF document analysis: extract tech specs and components from product datasheets
- [ ] LLM tech stack inference: product → components → patent claim mapping
- [ ] Incorporate product data from public sources (iFixit teardowns, FCC filings, published specs)
- [ ] Link products to patents and companies in the system
- [ ] Enhance focus area LLM templates with product data context

**POC Target:** Import product data for 1-2 validated VIDEO_STREAMING litigation targets; demonstrate patent-product mapping within the system.

### Phase 5: Enrichment & Scoring Pipeline Upgrade (5-7 days)
**Goal:** Scale the analysis capability.

- [ ] Multi-model support in scoring service (model selection per tier)
- [ ] Anthropic Batch API integration for overnight scoring (prefer Anthropic — 1M context for synthesis jobs)
- [ ] Top-N scoring with renormalization for lower patents (avoid full-portfolio reruns)
- [ ] Persistent cost tracking per scoring run
- [ ] Data archiving before bulk re-scoring (revert capability)
- [ ] Re-scoring detection when templates change
- [ ] Subsector templates for VIDEO_STREAMING sectors with litigation-oriented questions
- [ ] Gradually extend to other super-sectors based on POC learnings

### Phase 6: Taxonomy Deepening (5-7 days)
**Goal:** Improve classification granularity across the portfolio.

- [ ] LLM-assisted subsector classification of full portfolio
- [ ] Misfit sector reorganization (rf-acoustic, audio, power-management, etc.)
- [ ] Multiple taxonomy support (CPC-derived, product-based, competitor-based, custom)
- [ ] Multi-model ensemble testing on sample sets
- [ ] Competitor-informed LLM questions at sector/subsector level
- [ ] Expand competitor analysis to WIRELESS sector (Samsung, Qualcomm) once taxonomy is deeper

### Phase 7: Data Service Layer & Production Readiness (deferred)
**Goal:** Prepare for scale and server deployment. Timeline TBD based on POC results.

- [ ] Unified data service layer (`PatentDataService`, `PortfolioService`, `ProductService`)
- [ ] Migrate patent master data from JSON to PostgreSQL
- [ ] Redis caching for hot paths
- [ ] Import/export pipeline for external systems
- [ ] Monitoring, logging, error handling
- [ ] Claude Code skills document for ad-hoc analysis
- [ ] Database replication and backup automation

### Phase Validation Checkpoints

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

## 15. Related Documents

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
| `FOCUS_AREA_SYSTEM_DESIGN.md` | Focus area architecture, search scopes, facets, workflows |
| `PROMPT_TEMPLATE_SYSTEM_DESIGN.md` | Prompt template execution and LLM workflow engine |

---

## 16. Resolved Questions

These questions were raised during planning and resolved during requirements gathering.

| # | Question | Resolution |
|---|---|---|
| 1 | **First competitor targets** | **VIDEO_STREAMING competitors**: Netflix, Amazon (Prime Video + AWS Elemental). Samsung/Qualcomm wireless deferred — too many patents for initial POC. |
| 2 | **Subsector granularity target** | 3-5 per large sector. Start with VIDEO_STREAMING subsectors, validate before expanding. |
| 3 | **Re-scoring budget** | **Top-N with renormalization.** Score top 100-200 per sector with new questions/models; renormalize lower patents statistically. Avoid full-portfolio reruns. Archive before re-scoring for revert capability. |
| 4 | **Multi-model integration priority** | **Prefer Anthropic models** — Haiku for triage, Sonnet for standard, Opus Batch for deep. 1M context (Sonnet 4.5) valuable for synthesis jobs. Non-Anthropic models (o3, Gemini) are Phase 6+ experiments. |
| 5 | **Tech stack database** | **LLM inference first**, supplemented with external data as discovered (iFixit, FCC filings, product datasheets). No formal tech stack DB needed initially — infer from patent claims + LLM world knowledge. |
| 6 | **Taxonomy governance** | Start manual, with LLM-assisted suggestions. Future: expert ontological voting with slider-based interfaces for collaborative taxonomy refinement. System should support multiple coexisting taxonomies. |
| 7 | **Patlytics budget** | **150 free credits for POC.** $25/patent for up to 20 product searches per patent (NOT $25 per product search). Use free credits on highest-confidence VIDEO_STREAMING candidates after Phase 3 analysis. |
| 8 | **Attorney interface** | **CSV + markdown for POC.** PDF/DOCX export is later-phase. Attorneys can review markdown in any viewer and CSV in Excel for sorting/filtering. |
| 9 | **Data service priority** | **Deferred to Phase 7.** Build clear service interfaces in Phase 1-2 but don't invest in a unified data layer until POC validates the approach. |
| 10 | **Production timeline** | **Deferred.** Focus on POC value delivery first. Production deployment timing depends on POC results and business decision to scale. |

## 17. Resolved Questions (Round 2)

| # | Question | Resolution |
|---|---|---|
| 1 | **VIDEO_STREAMING subsector proposal** | Highest-scoring sectors from aggregate view are **video-codec**, **video-server-cdn**, **video-drm** (in order). Break those out into subsectors. Also include **recommendation-personalization** and **ad-insertion** if represented in portfolio (need to check which sectors they currently fall into). |
| 2 | **New question weight integration** | No attorney assessments available initially. Use **automated methods**: score variance (does the question differentiate patents?) and information gain (does it add signal beyond existing questions?). Start with **smaller weights than logically ideal** given sparse population — new questions can help disambiguate closely-scored patents without dominating the composite. |
| 3 | **Competitor patent sourcing** | **PatentsView for basic data, claims on-demand.** After basic scoring and before LLM enrichment at portfolio level, export patent IDs. User runs Java XML extraction program to add individual patent claims to the exports directory. No need for bulk XML download of competitor patents upfront. |
| 4 | **Affiliate pattern accuracy** | **Manual parallel research.** As competitors are added, user will do parallel validation to confirm assignee patterns look correct. No automated validation needed for POC. |
| 5 | **Renormalization method** | Compare before/after scores for top-N rescored patents to measure variance. Apply sound statistical technique to sub-N patents. **Important constraint:** greater scrutiny (better model, more questions) sometimes *lowers* ratings — do not let renormalization artificially bump lower patents into top-N. Eventually rerun LLM on valuable patents for fair direct scoring. |

## 18. Resolved Questions (Round 3)

| # | Question | Resolution |
|---|---|---|
| 1 | **VIDEO_STREAMING sector mapping** | Recommendation and ad-insertion patents are **not well represented** in the Broadcom portfolio. `video-client-processing` is closest; some `video-server-cdn` patents may tangentially support ad-insertion infrastructure. Do not force these as subsectors — look for other breakouts that reflect actual portfolio strength. |
| 2 | **Service boundary timing** | **Deferred to data service layer / production prep phase.** During POC phases, **document proposed refactors** as services are touched so they can be reviewed incrementally. Actual decomposition happens when preparing for production release. |
| 3 | **Multi-classification schema** | **Implement from the start.** As subsector breakouts begin, patents frequently have multiple CPC codes — some independent, some dependent. Primary classification may need to be revisited based on analysis needs or limited dataset convenience. Retaining all classifications prevents data loss and supports future reclassification. |

## 19. Current CPC-to-Sector Classification (Reference)

Understanding the existing classification system is critical for multi-classification work and for onboarding new portfolio patents.

### How It Works Today

**Two parallel classification systems exist:**

| System | Config Source | Priority |
|---|---|---|
| **File-based** (primary) | `config/sector-breakout-v2.json` | Used by default; fast, no DB dependency |
| **DB-driven** (secondary) | `SectorRule` table via `sector-assignment-service.ts` | More expressive rules; falls back to file-based if DB is empty |

**Classification flow:**
1. Patent's CPC codes (from USPTO/PatentsView data) are matched against CPC prefix patterns
2. Patterns are sorted **longest-first** (most specific CPC code wins)
3. **First matching CPC code determines primary sector** — remaining CPC codes are not considered
4. Primary sector is mapped to super-sector via `config/super-sectors.json`

**Key files:**
| File | Role |
|---|---|
| `src/api/utils/sector-mapper.ts` | `getPrimarySector()`, `getSuperSector()` — core sync classification |
| `src/api/services/sector-assignment-service.ts` | DB-driven rules with CPC prefix, keyword, phrase, boolean match types |
| `config/sector-breakout-v2.json` | ~47 sectors with CPC prefix patterns |
| `config/super-sectors.json` | 9 super-sectors grouping sectors |
| `scripts/assign-sectors-v2.ts` | Batch assignment script |

### What Gets Lost Today

When a patent has CPC codes spanning multiple sectors (e.g., `H04L63/1416` → network-threat-protection AND `G06F9/45` → virtualization), only the first match is kept. The secondary classification is **discarded**. This means:
- Cross-domain patents lose their secondary technology characterization
- Reclassification requires re-running the mapper and may produce different results if CPC pattern order changes
- No way to query "which patents are relevant to BOTH security and virtualization?"

### What Needs to Change for Multi-Classification

When implementing the `patent_classifications` many-to-many table:
1. Run **all** CPC codes through the mapper (not stop at first match)
2. Store each match with rank: `primary` (first/most-specific match), `secondary`, `tertiary`
3. Determine primary ranking by: CPC code specificity (longest match), then CPC code order from USPTO data
4. Preserve raw CPC-to-sector mappings so reclassification is reproducible
5. Ensure new portfolio patents go through the same multi-classification pipeline

### Exhaustiveness & Catch-All Handling

The current system guarantees every patent gets classified:
- **Unmatched CPC codes** → `getPrimarySector()` returns `'general'` (line 111 of `sector-mapper.ts`)
- **`general` sector** → maps to **COMPUTING** super-sector via `unmappedSectorDefault` in `super-sectors.json`
- **~47 named sectors** with specific CPC patterns; everything else falls to `general`

This catch-all pattern must be replicated at the subsector level when subsectors are introduced (see Section 20).

**Note:** The current primary classification logic (first-CPC-match-wins) has been adequate so far but may need revisiting as we add subsectors where patent CPC code overlap is more common.

## 20. Resolved Questions (Round 4)

| # | Question | Resolution |
|---|---|---|
| 1 | **VIDEO_STREAMING subsector alternatives** | Codec-transcoding and streaming-protocols are good candidates. CDN category could break out routing vs. caching. **Use CPC code distribution** within existing sectors to find natural breakouts rather than forcing categories. Always include a **catch-all/general subsector** per sector for patents that don't fit specific subsectors — analyze this remainder category later for further breakouts. |
| 2 | **CPC-dependent vs. independent codes** | Currently using independent codes as primary (less frequent, selected first). Better approach: **evaluate by prevalence within our portfolio** — favor independent CPC codes that occur sufficiently to help define subsectors with fewer mapping rules. This is exploratory — hence the need for multiple taxonomies. Start simple with best-guess primary, retain all classifications for future reclassification. |
| 3 | **Subsector CPC analysis** | Detailed analysis completed from aggregate view data — see Section 21 for full VIDEO_STREAMING subsector proposals based on CPC distribution. |
| 4 | **General sector cleanup** | The `general` catch-all sector's contents are not visible in current UI. Analyze using aggregate service when convenient. Can aggregate CPC codes to find natural groupings with good membership numbers. Defer to subsector work phase. |

### Catch-All Subsector Pattern

When breaking sectors into subsectors, **every sector must have a catch-all subsector** (e.g., `video-codec-general`, `video-server-cdn-other`) that captures patents whose CPC codes don't match any specific subsector pattern. This ensures:

- **Exhaustive coverage**: Every patent in a sector belongs to exactly one subsector
- **Incremental refinement**: The catch-all can be analyzed later to find additional breakouts
- **No data loss**: Patents are never dropped from analysis because they don't fit a named subsector

This follows the existing pattern at sector level: `getPrimarySector()` returns `'general'` for unmatched patents, which maps to the COMPUTING super-sector. The same principle applies at each level of the hierarchy.

### CPC Classification Strategy for Subsectors

The current sector classification uses a **first-match-wins** approach: sort CPC patterns by specificity (longest first), first CPC code that matches determines the sector. This works at the sector level where technology domains are broad.

At the **subsector level**, where CPC code overlap is more common, a prevalence-based strategy may be more effective:

1. For each patent's CPC codes, identify all matching subsectors
2. Score each match by: CPC code independence (independent > dependent), portfolio prevalence of that CPC code, and pattern specificity
3. Assign primary subsector based on best score; retain others as secondary/tertiary
4. Favor independent CPC codes that define subsectors with fewer overall mapping rules (simpler taxonomy)

This is a later-phase refinement — initial subsector assignment can use the existing first-match approach, with the multi-classification table preserving all matches for reclassification.

### Known UI Issue

The Sector Scores page has a navigation bug: when expanding into the patent grid, the **next/previous pagination controls don't work properly**, and scrolling within the expanded grid is broken. This needs fixing before subsector analysis can be done effectively in the UI. (See also: Chrome scrollbar issue in `docs/SESSION_CONTEXT.md`.)

---

## 21. VIDEO_STREAMING Subsector Proposals (CPC Analysis)

Based on aggregate view data from the VIDEO_STREAMING super-sector, here are proposed subsector breakouts derived from CPC code distribution. CPC definitions sourced from the Cooperative Patent Classification scheme; local CPC data available at `/Volumes/GLSSD2/data/uspto/cpc`.

### Observations

**Three dominant CPC families in VIDEO_STREAMING:**
- **H04N19/\*** — Video coding/compression (codec patents). Highest scores in the portfolio (avg 30-50).
- **H04N21/\*** — Selective content distribution / interactive TV / VOD (streaming infrastructure). Moderate scores (avg 20-27).
- **G09G\*** — Display control circuits. Present in VIDEO_STREAMING with lower scores (avg 22-26) and high competitor counts (2.3-2.8). **Possible misfit** — these may be display controller patents that co-occur with video CPC codes but are fundamentally different technology. Worth evaluating whether they belong in VIDEO_STREAMING or should move to INTERFACE or COMPUTING.

Other families present: H04N5 (TV signal processing), H04N7 (television systems), H04L65 (real-time streaming protocols), G06T9 (image coding), G11B20 (recording signal processing).

### video-codec Subsector Proposals

The codec sector has the **highest scoring patents** in VIDEO_STREAMING and the clearest CPC-based clustering.

| Proposed Subsector | Key CPC Codes | Est. Patents | Avg Score | Technology Focus |
|---|---|---|---|---|
| **codec-prediction-transform** | H04N19/61, /51, /44, /60 | ~290 | 35-42 | Core hybrid coding: motion estimation + transform (DCT). The fundamental approach used in H.264/HEVC/VVC. Broadest patent claims. |
| **codec-adaptive-quantization** | H04N19/176, /124, /159, /157, /117 | ~190 | 33-51 | Adaptive coding decisions: block-level adaptation, quantization parameter control, prediction mode selection. **Highest average scores** — these are the decision-making patents that optimize quality. |
| **codec-filtering-quality** | H04N19/82, /86, /85 | ~97 | 44-47 | In-loop filtering, artifact reduction, pre/post-processing. **Very high scores and high litigation value** — filter patents are hard to design around in standards-compliant decoders. |
| **codec-entropy-syntax** | H04N19/91, /70, /13 | ~102 | 38-42 | Entropy coding (CABAC/CAVLC), bitstream syntax structure. Standards-essential for any compliant implementation. |
| **codec-implementation** | H04N19/42, /423, /433, /436, /40 | ~176 | 28-41 | Hardware implementation, memory management, parallel processing, transcoding. Lower scores on average but relevant to chip-level infringement (Qualcomm, MediaTek, Apple). |
| **codec-general** | Other H04N19/* | catch-all | — | Remaining codec patents; analyze later for further breakouts. |

**Litigation notes:**
- `codec-filtering-quality` and `codec-adaptive-quantization` have the highest scores and are the hardest to design around — standards mandate specific filtering and quantization behaviors.
- `codec-implementation` patents target chip vendors specifically (different litigation profile than algorithm patents).
- The codec sector overall has the lowest competitor count averages (0.6-1.3), suggesting less defensive patenting by competitors — potentially more room for licensing.

### video-server-cdn Subsector Proposals

The CDN sector is the largest by patent count in VIDEO_STREAMING. CPC codes cluster around H04N21 subgroups.

| Proposed Subsector | Key CPC Codes | Est. Patents | Avg Score | Technology Focus |
|---|---|---|---|---|
| **cdn-transport-protocol** | H04N21/6125, /2408, H04N7/17318, /163, H04L65/80, /612, H04L12/28* | ~250 | 21-29 | Internet transmission, transport protocols, real-time streaming (RTP/RTCP), server monitoring, multicast/broadcast. Core CDN delivery technology. |
| **cdn-client-processing** | H04N21/43615, /4305, /434, /4334, /436, /426, /44004 | ~220 | 20-25 | Client-side: home network interfacing, clock sync, demultiplexing, local storage/caching, buffer management. Targets STB/smart TV manufacturers. |
| **cdn-ui-interaction** | H04N21/482, /4826, /4828, /47, /47202, /47214, /458, /4316 | ~200 | 22-25 | Program selection, recommendations, VOD request, EPG, UI overlays. Targets streaming app developers (Netflix, YouTube, etc.). |
| **cdn-rights-drm** | H04N21/6582, /6581, /6587, /812, /8146, /814, /2383, /2385 | ~150 | 22-27 | DRM at transport level, rights management, ad insertion infrastructure, bandwidth allocation. Overlaps with video-drm sector — may need cross-referencing. |
| **cdn-metadata-billing** | H04N21/2543, /2668, /2343, /2741, /25*, /26* | ~180 | 22-26 | Content metadata, billing/subscription, targeted content delivery, content management. Targets OTT platform operators. |
| **cdn-general** | Other H04N21/* | catch-all | — | Remaining CDN patents. |

**Litigation notes:**
- `cdn-ui-interaction` is the most directly relevant to streaming service operators (Netflix, Amazon, YouTube) — EPG, recommendations, and VOD are core UX features.
- `cdn-transport-protocol` targets CDN infrastructure (Akamai, AWS CloudFront, Google Cloud CDN).
- `cdn-rights-drm` overlaps with the separate video-drm sector — need to decide on boundaries.

### video-drm Subsector Consideration

Video-drm is smaller in the portfolio. Likely too small to subsector initially. Keep as a single sector but note overlaps with `cdn-rights-drm` subsector above. May eventually merge or split based on analysis.

### Potential Misfits

| CPC Family | Count in VIDEO_STREAMING | Issue |
|---|---|---|
| **G09G\*** (display control) | ~400+ patents | Low scores (22-26), high competitor counts (2.3-2.8). Display controller technology, not streaming. May belong in INTERFACE or COMPUTING. |
| **H04N5/\*** (TV signal processing) | ~200+ patents | Legacy TV circuitry, sync, cameras. Some relevant (H04N5/44504 = satellite/cable tuners) but many are legacy. |
| **G11B20/\*** (recording) | ~50 patents | Signal processing for recording media. Low scores, low competitor overlap. Possible STORAGE misfit. |

These should be evaluated during taxonomy deepening (Phase 6) — some may need reclassification.

### Reference: CPC Code Definitions (Key Prefixes)

| CPC Prefix | Technology Area |
|---|---|
| **H04N19/61** | Transform + predictive hybrid coding (core H.264/HEVC/VVC approach) |
| **H04N19/176** | Adaptive coding at block/macroblock level |
| **H04N19/44** | Video decoders |
| **H04N19/51** | Motion estimation/compensation |
| **H04N19/82** | In-loop filtering (deblocking, interpolation) |
| **H04N19/86** | Coding artifact reduction |
| **H04N19/91** | Entropy coding (VLC, arithmetic/CABAC) |
| **H04N19/70** | Bitstream syntax structure |
| **H04N19/42** | Codec implementation details/hardware |
| **H04N19/40** | Video transcoding |
| **H04N21/43615** | Home network interfacing |
| **H04N21/4622** | Multi-source content retrieval |
| **H04N21/482** | Program selection / EPG / browsing |
| **H04N21/6125** | Internet transmission |
| **H04N21/812** | Advertisement content generation |
| **H04N21/2543** | Billing / subscription |
| **H04L65/80** | Real-time streaming protocols |
| **G09G5/\*** | Display control circuits (possible misfit) |

**Local CPC scheme data:** `/Volumes/GLSSD2/data/uspto/cpc`

## 22. Resolved Questions (Round 5)

| # | Question | Resolution |
|---|---|---|
| 1 | **G09G display patents** | Move to **computing-ui** (no INTERFACE sector exists). Optics/photonics is another possibility. These are display controller patents, not streaming technology. Reclassify during Phase 6 taxonomy work. |
| 2 | **cdn-rights-drm boundary** | **Split** transport-level DRM (cdn-rights-drm) from content-level DRM (video-drm) if sufficient patents exist in each with disparate competitor profiles. If the competitor sets overlap heavily, consolidate instead. |
| 3 | **General sector contents** | ~111 patents — a junk drawer of non-tech-portfolio CPC codes: welding (B23K), medical devices (A61B), batteries (H01M), combustion (F23D), electroplating (C25D), fasteners (F16B), exercise equipment (A63B), etc. **Not worth deep analysis** given tiny fraction of portfolio. Notable: 55 patents with "(none)" CPC codes have high avg scores (49.19) — possibly Broadcom business method or design patents lacking CPC classification. Low priority for reclassification. |

## 23. Open Questions

1. **55 patents with no CPC codes**: These have the highest average score (49.19) in the general sector. What are these? Business method patents? Design patents? Worth a quick look to ensure they're not misclassified high-value assets.
2. **computing-ui sector scope**: If G09G display patents move from VIDEO_STREAMING to computing-ui, does the existing computing sector structure accommodate them, or do we need a new sector?
