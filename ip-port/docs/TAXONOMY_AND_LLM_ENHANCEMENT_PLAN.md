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

The guiding principle is **pre-screening at minimal cost**: the system's job is to identify high-confidence litigation opportunities before committing expensive resources (attorneys, 3rd party vendors like Patlytics at ~$25/patent, discovery costs).

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

Demonstrate the following workflow end-to-end for 2-3 target competitors:

1. Import competitor's top-N patents in overlapping sectors
2. Identify technology subsectors with dense overlap between portfolios
3. Detect patent family entanglements (cross-citations, parallel filings, design-around patterns)
4. Export high-potential clusters to focus areas
5. Run custom LLM analysis synthesizing all available data into litigation opportunity assessment
6. Produce a ranked list of opportunities with confidence levels and recommended next steps
7. Select top opportunities for 3rd party product mapping validation (Patlytics)

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

- **Patlytics** (~$25/patent for up to 20 products): Produces product-to-patent mapping with claim chart stubs
- **Import formats**: .xlsx, .csv, .pdf
- **PDF analysis**: Use LLM to extract product specifications, technology components, and tech stack information from product documentation PDFs
- **Link to patents**: Associate imported products with patents in our system; use LLM to infer tech component overlap

### Product Analysis Workflow

```
1. External vendor (Patlytics) → .xlsx/.csv export → Import to system
2. Product documentation (.pdf datasheets) → LLM extraction → tech components, specs
3. LLM inference: product tech stack → technology components → patent claim mapping
4. Associate products with companies and sectors
5. Cross-reference: "Which of our patents likely read on this product?"
```

### Strategic Use of External Vendors

External vendors are expensive ($25/patent × 20 products = $500 per patent analysis). The system's job is to **pre-screen** so we only send the highest-confidence opportunities:

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

**Not yet** — but design decisions now should anticipate it:

- **Phase 1-2**: Continue with current storage but add clear service interfaces (e.g., `PatentDataService.getPatent(id)` that checks candidates → cache → PatentsView API → null)
- **Phase 3**: When multi-portfolio lands, the single candidates file becomes a bottleneck. Migrate patent master data to PostgreSQL.
- **Phase 4+**: Full data service layer with:
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

### Production Deployment Prelude

The data service layer work is a prelude to server deployment:
- Separate data access from business logic
- Define clear API contracts for each data source
- Build import/export pipelines that work in both dev (file-based) and prod (database-backed) modes
- Add monitoring, logging, and error handling appropriate for a server environment

---

## 14. Pragmatic Development Phases

These phases are organized around **proof of concept with litigation analysis** as the priority. Each phase should validate the approach before investing in the next. Pivots are expected based on findings.

### Phase 0: Quick Wins & Rename (1-2 days)
**Goal:** Visible progress, remove friction.

- [ ] Rename "Patent Workstation" to "IP Port" in toolbar and browser title
- [ ] Add new portfolio-level LLM questions (Product Mapping Probability, Evidence of Use Detectability, Licensing Revenue Potential, Tech Component Classification)
- [ ] Update `portfolio-default.json` template; re-score a sample sector to validate

### Phase 1: Multi-Portfolio Foundation (3-5 days)
**Goal:** Support competitor portfolios at a basic level.

- [ ] Add `Portfolio` model to Prisma schema (name, type, affiliates)
- [ ] Migrate Broadcom affiliates from static JSON to database
- [ ] Build Admin page skeleton with Portfolio and Affiliate management
- [ ] LLM-assisted affiliate discovery: given company name, suggest acquisitions and subsidiaries
- [ ] PatentsView assignee search: find patent counts per affiliate pattern
- [ ] Import competitor patent basics (title, abstract, CPC, assignee, dates) for top-N

**POC Target:** Import top 50-100 patents for 2 key competitors (e.g., Qualcomm, Samsung) in 2-3 high-overlap sectors.

### Phase 2: Sector Overlap Detection (3-5 days)
**Goal:** Find the battleground sectors.

- [ ] Run competitor patents through sector classification (Haiku/Flash, cheap)
- [ ] Compute sector overlap matrix (our patents vs competitor patents per sector)
- [ ] Identify density hotspots — sectors with high patent count from both portfolios
- [ ] Citation overlap analysis — cross-citations between portfolios
- [ ] Family expansion comparison — parallel family activity in same subsectors
- [ ] Build overlap visualization in the Sector Rankings or a new Competitive Landscape view

**POC Target:** Identify 3-5 "battleground" sectors with strong overlap and rich data for analysis.

### Phase 3: Focus Area Pipeline (3-5 days)
**Goal:** Turn overlap hotspots into actionable analysis.

- [ ] Auto-create focus groups from overlap hotspots (our top patents + competitor nearby patents)
- [ ] Build litigation-oriented prompt templates (Competitive Landscape Synthesis, Design-Around Assessment, 3rd Party Screening)
- [ ] Run custom LLM analysis on focus areas using Opus for highest quality
- [ ] Produce ranked litigation opportunity list with confidence levels
- [ ] Export format for attorney review

**POC Target:** Produce 2-3 litigation opportunity assessments with enough detail to evaluate whether they warrant Patlytics validation (~$500-1,500 per opportunity).

### Phase 4: Product Layer & External Integration (5-7 days)
**Goal:** Add products to the analysis.

- [ ] Add `Product` model to Prisma schema
- [ ] Build product import from .xlsx/.csv (Patlytics exports)
- [ ] PDF document analysis: extract tech specs and components from product datasheets
- [ ] LLM tech stack inference: product → components → patent claim mapping
- [ ] Link products to patents and companies in the system
- [ ] Enhance focus area LLM templates with product data context

**POC Target:** Import product data for 1-2 validated litigation targets; demonstrate patent-product mapping within the system.

### Phase 5: Enrichment & Scoring Pipeline Upgrade (5-7 days)
**Goal:** Scale the analysis capability.

- [ ] Multi-model support in scoring service (model selection per tier)
- [ ] Anthropic Batch API integration for overnight scoring
- [ ] Priority-based scoring (V2 scores → sector scores → triage scores)
- [ ] Persistent cost tracking per scoring run
- [ ] Re-scoring detection when templates change
- [ ] Subsector templates for top 5 largest sectors with litigation-oriented questions

### Phase 6: Taxonomy Deepening & Data Layer (5-7 days)
**Goal:** Improve classification granularity and prepare for scale.

- [ ] LLM-assisted subsector classification of full portfolio
- [ ] Misfit sector reorganization (rf-acoustic, audio, power-management, etc.)
- [ ] Custom taxonomy groupings beyond CPC codes
- [ ] Unified data service layer (`PatentDataService`, `PortfolioService`, `ProductService`)
- [ ] Multi-model ensemble testing on sample sets
- [ ] Competitor-informed LLM questions at sector/subsector level

### Phase 7: Production Readiness (ongoing)
**Goal:** Server deployment preparation.

- [ ] Migrate patent master data from JSON to PostgreSQL
- [ ] Redis caching for hot paths
- [ ] Import/export pipeline for external systems
- [ ] Monitoring, logging, error handling
- [ ] Claude Code skills document for ad-hoc analysis
- [ ] Database replication and backup automation

### Phase Validation Checkpoints

| After Phase | Validate | Pivot If |
|---|---|---|
| 1 | Can we import competitor patents and see them in the system? | Multi-portfolio model is wrong — simplify |
| 2 | Do overlap hotspots correlate with known litigation areas? | Sector taxonomy too coarse — deepen first |
| 3 | Do LLM assessments produce actionable litigation intelligence? | LLM questions need refactoring — iterate templates |
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

## 16. Open Questions

1. **First competitor targets**: Which 2-3 competitors for Phase 1 POC? Qualcomm and Samsung are likely candidates given wireless/semiconductor overlap.
2. **Subsector granularity target**: How many subsectors per sector is useful vs. noise? 3-5 per large sector?
3. **Re-scoring budget**: When templates change, do we re-score all affected patents or just top-N?
4. **Multi-model integration priority**: Which non-Anthropic model to integrate first for testing? (o3 is most interesting for reasoning quality at 0.13x cost)
5. **Tech stack database**: Build from LLM inference, or seed from external data sources?
6. **Taxonomy governance**: Automated thresholds for split/merge or manual?
7. **Patlytics budget**: How many patents can we send to Patlytics in the POC phase? (~$25/patent × 20 products)
8. **Attorney interface**: What export format do attorneys prefer for opportunity review? PDF, DOCX, structured web view?
9. **Data service priority**: Build unified data layer in Phase 6, or earlier if multi-portfolio creates immediate pain?
10. **Production timeline**: When does server deployment need to happen? This affects how much infrastructure investment to make early.
