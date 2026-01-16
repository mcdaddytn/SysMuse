# Expanded Patent Analysis Strategy

## Executive Summary

This document proposes an expanded patent analysis methodology that goes beyond competitor citation overlap to identify high-value patents through LLM-based qualitative assessment. The goal is to surface exceptional patents that may not have competitor citations but possess strong characteristics for licensing or litigation.

---

## Current Methodology (v1)

### Selection Criteria
Patents are selected based on **competitor citation overlap** - where our target competitors (Microsoft, Amazon, Apple, Google, etc.) have cited our client's patents in their own filings.

### Rationale
- Competitor citations demonstrate relevance to competitor product areas
- Provides objective evidence of patent value
- Creates potential evidence of willful infringement awareness

### Limitations
- Only captures patents that competitors have cited
- Newer patents may not have citations yet
- Some valuable patents may simply not have been cited
- Misses patents covering competitor products where no citation exists

---

## Proposed Expanded Methodology (v2)

### Two-Track Approach

#### Track A: Competitor Overlap (Current)
Continue analyzing patents with competitor citations using current methodology.

#### Track B: LLM-Based Discovery
Analyze active patents WITHOUT competitor citations using enhanced prompts designed to surface:
1. Patents with strong product applicability
2. Patents covering current technology trends
3. Patents with clear enforcement potential

---

## Proposed New Prompts and Metrics

### PROMPT SET 1: Market/Product Applicability

**Purpose**: Identify patents likely covering products in the market regardless of citation overlap.

```
Analyze this patent for potential commercial applicability:

1. technology_category: Categorize the core technology (e.g., "video streaming", "cloud computing", "mobile device", "data security", "network infrastructure", "AI/ML", "IoT", "payment processing")

2. product_types: List specific product types this patent might cover (e.g., "smartphone apps", "streaming services", "cloud storage", "smart home devices")

3. likely_implementers: What types of companies would likely implement this technology? (e.g., "streaming providers", "device manufacturers", "cloud providers", "social media platforms")

4. market_relevance_score (1-5): How relevant is this technology to current products in the market?
   - 5 = Core technology in widespread use today
   - 4 = Common technology in many products
   - 3 = Niche but commercially relevant
   - 2 = Limited current commercial application
   - 1 = Obsolete or no commercial relevance

5. detection_method: How would you detect if a product infringes this patent?
   - "Observable from product features"
   - "Requires technical documentation review"
   - "Requires source code analysis"
   - "Requires reverse engineering"
   - "Difficult to detect"

6. evidence_accessibility_score (1-5): How accessible is evidence of infringement?
   - 5 = Visible from public product/marketing materials
   - 4 = Determinable from public technical documentation
   - 3 = Requires product testing/analysis
   - 2 = Requires internal documents/discovery
   - 1 = Essentially undetectable without insider access
```

### PROMPT SET 2: Technology Trend Alignment

**Purpose**: Identify patents aligned with current technology trends that may become increasingly valuable.

```
Analyze this patent for alignment with current technology trends:

1. primary_tech_trend: Which major technology trend does this patent relate to?
   - "Artificial Intelligence / Machine Learning"
   - "Cloud Computing / Edge Computing"
   - "5G / Network Infrastructure"
   - "Video Streaming / Codecs"
   - "Cybersecurity / Privacy"
   - "IoT / Smart Devices"
   - "Autonomous Vehicles"
   - "AR/VR / Metaverse"
   - "Blockchain / Web3"
   - "Other"

2. trend_alignment_score (1-5): How well does this patent align with current industry direction?
   - 5 = Core enabling technology for major trend
   - 4 = Important supporting technology
   - 3 = Tangentially related to trends
   - 2 = Declining relevance
   - 1 = No trend alignment

3. growth_trajectory: Is the relevant market/technology growing, stable, or declining?

4. future_value_score (1-5): How valuable will this patent likely be in 3-5 years?
   - 5 = Increasing value - technology becoming more prevalent
   - 4 = Stable high value
   - 3 = Stable moderate value
   - 2 = Declining value
   - 1 = Likely obsolete

5. standards_relevance: Is this patent relevant to any industry standards (e.g., MPEG, WiFi, 5G, USB)?
   - "Essential to standard"
   - "Related to standard"
   - "No standards relevance"
```

### PROMPT SET 3: Claim Quality Deep Dive

**Purpose**: Detailed analysis of claim strength for litigation/licensing viability.

```
Analyze the patent claims for litigation/licensing viability:

1. independent_claim_count_estimate: How many independent claims does this patent likely have based on the abstract?
   - "1-2 (narrow)"
   - "3-5 (moderate)"
   - "6+ (broad coverage)"

2. claim_type_assessment: What type of claims are likely present?
   - "Method/process claims"
   - "System/apparatus claims"
   - "Both method and system"
   - "Computer-readable medium"

3. means_plus_function_risk (1-5): Risk of narrow interpretation due to means-plus-function claiming
   - 5 = Low risk - concrete structural elements
   - 3 = Moderate risk - some functional language
   - 1 = High risk - heavy functional claiming

4. claim_clarity_score (1-5): How clear and well-defined are the claim boundaries?
   - 5 = Very clear boundaries, easy to map to products
   - 4 = Clear with minor ambiguities
   - 3 = Some ambiguous terms
   - 2 = Significant ambiguity
   - 1 = Very unclear, difficult to interpret

5. infringement_theory: What would be the most likely infringement theory?
   - "Direct infringement - single party performs all steps"
   - "Induced infringement - manufacturer induces users"
   - "Contributory infringement - component supplier"
   - "Joint infringement - multiple parties required"

6. litigation_complexity_score (1-5): How complex would litigation be?
   - 5 = Straightforward case
   - 4 = Manageable complexity
   - 3 = Moderate complexity
   - 2 = Complex, expensive to prove
   - 1 = Very complex, uncertain outcome
```

### PROMPT SET 4: Specific Infringer Identification

**Purpose**: Direct assessment of which companies might be infringing (for attorney review).

```
Based on the patent's technology, identify potential infringers:

1. high_probability_infringers: List companies most likely to use this technology
   - Company name and rationale

2. product_examples: Specific products or services that might infringe
   - Product/service name and which company

3. infringement_indicators: What observable features would indicate infringement?

4. investigation_priority_score (1-5): How much priority should this patent receive for infringement investigation?
   - 5 = High priority - clear targets and evidence path
   - 4 = Good priority - likely targets identifiable
   - 3 = Moderate - some investigation needed
   - 2 = Low - targets unclear
   - 1 = Very low - no clear path forward
```

---

## Proposed New Scoring Dimensions

### Track B Scoring (Non-Overlap Patents)

```
discovery_score = (
  market_relevance_score * 0.25 +
  evidence_accessibility_score * 0.20 +
  trend_alignment_score * 0.15 +
  claim_clarity_score * 0.20 +
  investigation_priority_score * 0.20
) / 5 * 100
```

### Combined Universal Score

For patents analyzed with both Track A and Track B:

```
universal_score = (
  eligibility_score * 0.20 +
  validity_score * 0.20 +
  enforcement_clarity * 0.15 +
  market_relevance_score * 0.15 +
  evidence_accessibility_score * 0.15 +
  claim_clarity_score * 0.15
) / 5 * 100
```

---

## Implementation Phases

### Phase 1: Prompt Testing (Current Discussion)
- Review proposed prompts with attorneys
- Refine language and scoring criteria
- Finalize prompt configuration files

### Phase 2: Pilot Run
- Run new prompts on subset of patents
- Compare results with attorney expectations
- Calibrate scoring weights

### Phase 3: Full Deployment
- Analyze all active patents in portfolio
- Generate combined rankings
- Create investigation priority queue

---

## Questions for Attorney Review

1. **Prompt Language**: Are the proposed prompts capturing the right information for your analysis?

2. **Rating Scales**: Are the 1-5 scales appropriately defined? Should any criteria be adjusted?

3. **New Metrics**: Which proposed metrics are most valuable?
   - Market relevance
   - Evidence accessibility
   - Trend alignment
   - Claim clarity
   - Investigation priority

4. **Infringer Identification**: Is the "Specific Infringer Identification" prompt appropriate, or should LLM suggestions be avoided for liability reasons?

5. **Scoring Weights**: What factors should be weighted most heavily for:
   - Licensing opportunities?
   - Litigation candidates?
   - Portfolio positioning?

6. **Additional Prompts**: What other questions would help identify strong patents that current methodology misses?

---

## File Locations

- Current prompt: `config/prompts/patent-analysis-v1.json`
- Proposed expanded prompts: (to be created after attorney feedback)
- Scoring configuration: (configurable weights in prompt JSON files)

---

## Next Steps

1. Attorney review of this document
2. Feedback incorporation into prompt design
3. Create `patent-analysis-v2.json` with expanded prompts
4. Pilot test on sample patents
5. Refine based on results
6. Full portfolio analysis
