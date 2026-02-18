# Scoring Methodology V3 Design

## Overview

This document outlines a redesign of the patent scoring methodology that groups metrics into three logical categories reflecting real-world patent value drivers:

1. **Damages Potential** - What could the patent be worth if successful?
2. **Success Probability** - How likely is the case to survive challenges?
3. **Risk/Yield Factors** - What could reduce the ultimate recovery?

## Current State (V2)

V2 uses a weighted sum of 9 metrics × multiplicative year factor:

```
FinalScore = (Weighted Sum of 9 metrics) × YearMultiplier
```

**Limitation:** All metrics are treated equally in terms of *type* - they're all just weights in a sum. This doesn't reflect that some metrics affect the size of potential damages while others affect whether you'll win at all.

---

## Proposed V3: Three-Factor Model

### Formula

```
PatentValue = DamagesScore × SuccessScore × RiskFactor
```

Or alternatively:

```
PatentValue = (DamagesScore × YearFactor) × SuccessScore × RiskFactor
```

### Factor Definitions

#### 1. Damages Score (0-100)
*"How much could this patent be worth if we win?"*

| Metric | Source | Weight | Notes |
|--------|--------|--------|-------|
| Sector Damages Estimate | Manual/LLM | 40% | Order of magnitude: low/med/high/very high |
| Competitor Citations | Data | 25% | More citations = more infringing companies |
| Market Relevance | LLM | 20% | Current market activity |
| Forward Citations | Data | 15% | Technology importance indicator |

**Sector Damages Estimates (Proposed Scale):**

| Rating | Annual Sector Revenue | Example Sectors |
|--------|----------------------|-----------------|
| 1 - Low | <$1B | Niche industrial |
| 2 - Medium | $1B - $10B | Enterprise software |
| 3 - High | $10B - $100B | Consumer electronics, cloud |
| 4 - Very High | >$100B | Mobile devices, semiconductors |

#### 2. Success Score (0-1.0)
*"How likely are we to win/survive challenges?"*

| Metric | Source | Weight | Notes |
|--------|--------|--------|-------|
| Eligibility Score | LLM | 30% | 101 patent eligibility |
| Validity Score | LLM | 30% | Prior art strength |
| Claim Breadth | LLM | 20% | Scope of claims |
| Prosecution Quality | API | 20% | Clean prosecution history |

**Scale:** 0.0 (will fail) to 1.0 (certain success)

#### 3. Risk Factor (0-1.0)
*"What could reduce our recovery?"*

| Metric | Source | Weight | Notes |
|--------|--------|--------|-------|
| IPR Risk Score | API | 35% | PTAB challenge history/likelihood |
| Design-Around Difficulty | LLM | 30% | Can infringers easily avoid? |
| Enforcement Clarity | LLM | 35% | Can we prove infringement? |

**Scale:** 0.0 (high risk) to 1.0 (low risk/high yield)

---

## Year Factor Integration Options

### Option A: Multiply Damages Score
```
AdjustedDamages = DamagesScore × YearFactor
PatentValue = AdjustedDamages × SuccessScore × RiskFactor
```

Rationale: Years remaining affects total potential damages (less time = less royalties)

### Option B: Multiply Final Score
```
PatentValue = (DamagesScore × SuccessScore × RiskFactor) × YearFactor
```

Rationale: Years affect everything equally

### Option C: Combined with Damages (Additive then Multiplicative)
```
CombinedDamages = (DamageWeight × DamagesScore) + (YearWeight × YearScore)
PatentValue = CombinedDamages × SuccessScore × RiskFactor
```

Rationale: Years and damages are both "value" factors

**Recommendation:** Option A - Years directly affect potential damages recovery

---

## New LLM Questions for Damages Estimation

### Proposed Additions to V4 Prompt

```json
{
  "damages_indicators": {
    "market_size_estimate": "tiny|small|medium|large|massive",
    "unit_volume_relevance": "low|medium|high",
    "revenue_per_unit_relevance": "low|medium|high",
    "licensing_rate_estimate": "0.1%|0.5%|1%|2%|5%+",
    "comparable_settlements": "none_known|low|medium|high"
  },
  "infringement_evidence": {
    "product_examples": ["list of likely infringing products"],
    "detection_difficulty": "easy|moderate|difficult|very_difficult",
    "public_documentation": "abundant|some|limited|none"
  }
}
```

---

## Sector Damages Configuration

### Proposed `config/sector-damages.json`

```json
{
  "sectors": {
    "video_codec": {
      "damages_rating": 4,
      "description": "Very High - streaming platforms, devices",
      "annual_market_size": "$200B+",
      "key_infringers": ["ByteDance", "Tencent", "Apple", "Google"]
    },
    "rf_acoustic": {
      "damages_rating": 4,
      "description": "Very High - every 4G/5G smartphone",
      "annual_market_size": "$50B+ (RF front-end)",
      "key_infringers": ["Murata", "Skyworks", "Qorvo"]
    },
    "cloud_auth": {
      "damages_rating": 3,
      "description": "High - enterprise cloud security",
      "annual_market_size": "$20B",
      "key_infringers": ["Microsoft", "Amazon", "Google"]
    },
    "cybersecurity": {
      "damages_rating": 3,
      "description": "High - enterprise security spending",
      "annual_market_size": "$180B",
      "key_infringers": ["CrowdStrike", "Palo Alto", "Microsoft"]
    },
    "bluetooth_wireless": {
      "damages_rating": 3,
      "description": "High - IoT, consumer devices",
      "annual_market_size": "$10B",
      "key_infringers": ["Apple", "Samsung", "Qualcomm"]
    }
  }
}
```

---

## Implementation Plan

### Phase 1: Sector Damages Rating (Quick Win)
1. Create `config/sector-damages.json` with ratings for known sectors
2. Update `calculate-unified-top250-v3.ts` to incorporate sector damages
3. Test on current top 250

### Phase 2: LLM Question Expansion
1. Add damages-related questions to V4 prompt
2. Run on sample patents to validate
3. Integrate into scoring

### Phase 3: Full Three-Factor Model
1. Regroup existing metrics into Damages/Success/Risk
2. Implement multiplicative scoring
3. Create Excel formulas for user adjustment

### Phase 4: GUI Integration
1. Allow sector damages editing in GUI
2. Display three-factor breakdown
3. Enable what-if analysis

---

## Migration Path from V2 to V3

| V2 Component | V3 Mapping |
|--------------|------------|
| competitor_citations | Damages Score |
| forward_citations | Damages Score |
| market_relevance | Damages Score |
| eligibility_score | Success Score |
| validity_score | Success Score |
| claim_breadth | Success Score |
| prosecution_quality | Success Score |
| ipr_risk_score | Risk Factor |
| design_around_difficulty | Risk Factor |
| enforcement_clarity | Risk Factor |
| years_remaining | Year Factor (multiply damages) |

---

## Open Questions for Discussion

1. **Sector granularity:** Should sector damages be at CPC level or broader categories?

2. **Competitor weighting:** Should citations from high-revenue competitors count more?

3. **Time decay:** Should year factor be linear or exponential?

4. **Floor values:** Should there be minimum scores to prevent zeros?

5. **User customization:** Which factors should users be able to adjust?

---

*Document created: 2026-01-17*
*Status: DRAFT for review*
