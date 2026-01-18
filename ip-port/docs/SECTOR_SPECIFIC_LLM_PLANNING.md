# Sector-Specific LLM Analysis Planning

## Overview

This document outlines the strategy for sector-specific LLM analysis with a focus on **product identification** to maximize the value of third-party vendor integrations (Patlytics heat maps, claim chart generation).

**Key Insight:** Our patent analysis should feed directly into vendor workflows:
- **Patlytics:** 20 products per patent @ ~$25/patent for heat map analysis
- **Claim Charts:** Token-based cost for detailed claim-to-product mapping

We need to identify the best products BEFORE engaging vendors to maximize ROI.

---

## Product-Focused Analysis Pipeline

### Phase 1: Patent → Infringer → Product Discovery

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Patent Analysis │ --> │ Competitor      │ --> │ Product         │
│ (Our System)    │     │ Citations       │     │ Identification  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        ▼                       ▼                       ▼
   LLM suggests          We know who's           Web search for
   likely implementers   citing our patents      actual products
```

### Phase 2: Lateral Product Expansion

```
┌─────────────────────────────────────────────────────────────────┐
│ Products Found from Citations                                   │
│ (e.g., ByteDance TikTok, Apple Face ID)                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Lateral Expansion via Web Search                                │
│ - Competitive products (Kuaishou, Snapchat for TikTok)          │
│ - Similar products from other companies                         │
│ - Market leader products in same category                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Sector-Specific LLM Prompt Enhancements

### Standard V3 Fields (All Sectors)
Keep existing cross-sector signals:
- implementation_type, standards_relevance, standards_bodies
- market_segment, lifecycle_stage, geographic_scope
- product_types, likely_implementers

### NEW: Product-Focused Questions

Add to sector-specific prompts:

```json
{
  "product_analysis": {
    "specific_products": ["List 5-10 specific named products this patent likely covers"],
    "product_categories": ["What product categories are most relevant?"],
    "market_leaders": ["Who are the top 3 market leaders in this space?"],
    "product_evidence_sources": ["Where would you find evidence of implementation?"],
    "product_features_mapped": ["What specific product features map to claim elements?"]
  },

  "commercial_intelligence": {
    "revenue_model": ["subscription", "hardware_sale", "licensing", "freemium", "enterprise"],
    "unit_volume_estimate": ["<1M", "1M-10M", "10M-100M", "100M-1B", ">1B"],
    "price_point": ["<$10", "$10-100", "$100-1000", "$1000-10000", ">$10000"],
    "revenue_per_unit_estimate": "Rough estimate of infringing component value"
  },

  "litigation_grouping": {
    "related_patents": ["Other patents that cover similar technology"],
    "portfolio_strength": ["Does this patent strengthen a litigation portfolio?"],
    "claim_overlap": ["Do claims overlap with related patents in portfolio?"]
  }
}
```

---

## Priority Sectors for Deep Analysis

Based on top 250 V2 sector distribution and damages potential:

### Tier 1: Very High Damages + High Representation

| Sector | Top 250 Count | Damages Tier | Key Infringers |
|--------|---------------|--------------|----------------|
| **video-codec** | 18 | Very High | ByteDance, Apple, Netflix |
| **cloud-auth** | 35 | High | Banks, Microsoft, Okta |
| **network-switching** | 22 | High | Cisco, Juniper, Arista |

### Tier 2: High Damages + Moderate Representation

| Sector | Top 250 Count | Damages Tier | Key Infringers |
|--------|---------------|--------------|----------------|
| **network-threat-protection** | 12 | High | CrowdStrike, Palo Alto |
| **network-auth-access** | 13 | High | Microsoft, Okta, Ping |
| **wireless-scheduling** | 11 | High | Qualcomm, Apple, Samsung |

### Tier 3: Specialized High-Value

| Sector | Top 250 Count | Damages Tier | Key Infringers |
|--------|---------------|--------------|----------------|
| **rf-acoustic** | 1 (in top 250) | Very High | Murata, Skyworks, Qorvo |
| **video-drm-conditional** | 0 (in top 250) | Very High | Netflix, Disney+, Apple |

---

## Sector-Specific Prompt Templates

### Video Codec Sector

```
CONTEXT: Analyze these video codec/compression patents for licensing potential.

FOCUS AREAS:
1. HEVC/H.264/H.265/AV1/VVC standards relevance
2. Streaming platform implementation (Netflix, YouTube, Disney+, TikTok)
3. Hardware encoder/decoder chips (Qualcomm Snapdragon, Apple A-series)
4. Adaptive bitrate streaming implementations (HLS, DASH)
5. Video conferencing (Zoom, Teams, WebRTC)

PRODUCT QUESTIONS:
- Which specific streaming apps likely implement this technology?
- Which smartphone SoCs contain relevant encoder/decoder hardware?
- Is this relevant to video transcoding services (AWS Elemental, etc.)?
- What specific codec profiles (Main, High, etc.) are covered?

INFRINGER PRIORITIZATION:
- ByteDance/TikTok: $X billion video views daily
- Meta/Instagram Reels: Competing short-form video
- Netflix: Premium streaming, high per-user value
- Apple: Hardware + software integration
```

### Cloud Authentication Sector

```
CONTEXT: Analyze these authentication/identity patents for enterprise licensing.

FOCUS AREAS:
1. MFA/2FA implementations (TOTP, FIDO2, passkeys)
2. SSO protocols (SAML, OAuth, OIDC)
3. Biometric authentication (fingerprint, face, voice)
4. Mobile authentication (push notifications, app-based)
5. Enterprise IAM platforms

PRODUCT QUESTIONS:
- Which specific auth products implement this? (Okta, Auth0, Ping, etc.)
- Is this in mobile OS authentication? (Face ID, Android Biometrics)
- Does this cover banking authentication specifically?
- Which enterprise SSO products are relevant?

INFRINGER PRIORITIZATION:
- Financial services (BoA, Chase, Capital One) - high per-transaction value
- Okta/Auth0: Pure-play identity, clear product mapping
- Microsoft (Azure AD, Windows Hello): Massive install base
- Apple (Face ID, iCloud Keychain): Premium ecosystem
```

### RF/Acoustic Sector

```
CONTEXT: Analyze these BAW/FBAR/RF filter patents for hardware licensing.

FOCUS AREAS:
1. 4G/5G RF front-end filters
2. Frequency bands covered (Sub-6GHz, mmWave)
3. Filter bank architectures
4. Antenna tuning and switching
5. Module integration

PRODUCT QUESTIONS:
- Which specific RF filter part numbers are relevant?
- What smartphone models use affected filters?
- Which base station equipment includes this technology?
- Are there automotive/IoT applications?

INFRINGER PRIORITIZATION:
- Murata: Market leader in smartphone filters
- Skyworks: Major RF front-end supplier
- Qorvo: High-performance filters
- Qualcomm: Integrated RF solutions
```

---

## Within-Sector Ranking Methodology

For patents that make it to top 250 via overall scoring, provide **within-sector ranking**:

### Sector-Specific Score Adjustments

```
SectorScore = BaseScore × SectorMultiplier × ProductClarityBonus

Where:
- BaseScore: Standard V3 score
- SectorMultiplier:
  - 1.2 if top 5 in sector
  - 1.1 if top 10 in sector
  - 1.0 otherwise
- ProductClarityBonus:
  - 1.1 if specific products identified
  - 1.05 if product categories clear
  - 1.0 if general
```

### Litigation Grouping Score

Patents that work well together for litigation get bonus:

```
LitigationGroupScore = SectorScore + GroupBonus

GroupBonus:
- +5% if patent strengthens existing group
- +3% if patent fills claim gap in group
- +2% if patent adds defendant coverage
```

---

## Implementation Phases

### Phase 1: Complete V3 LLM on Top 400 (Current)
- Running: Bubble zone (130 patents)
- Result: Complete V3 coverage for potential top 250 after reshuffling

### Phase 2: Sector-Specific Prompts for Top Sectors (Next)
1. Create sector prompt templates (video-codec, cloud-auth, network-switching)
2. Run on sector patents within top 400
3. Extract product lists and infringer details

### Phase 3: Product Expansion via Web Search
1. For each identified product, search for:
   - Competitive products
   - Market alternatives
   - Regional variants
2. Build product database linked to patents

### Phase 4: Patlytics Preparation
1. For top 50 patents, compile 20-product shortlists
2. Prioritize products by:
   - Revenue/volume potential
   - Evidence accessibility
   - Claim mapping confidence
3. Submit to Patlytics for heat map analysis

---

## Diminishing Returns Analysis

### When to Stop Broad V3 Analysis

| Coverage Level | Patents | Est. Cost | Expected Value |
|----------------|---------|-----------|----------------|
| Top 250 | 250 | ~$2 | High - fills gaps in rankings |
| Top 400 | 400 | ~$3 | Medium - captures bubble-up |
| Top 600 | 600 | ~$5 | Low - unlikely to enter top 250 |
| Top 1000 | 1000 | ~$8 | Very Low - sector-specific better |

**Recommendation:** Stop broad V3 at top 400, switch to sector-specific.

### When to Switch to Sector-Specific

Trigger points:
1. Top 400 coverage complete
2. Stable top 250 (minimal bubble-up in last recalculation)
3. Clear sector leaders identified

---

## Metrics for Sector Analysis Success

1. **Product Identification Rate:** % of patents with specific products named
2. **Infringer Coverage:** # of unique infringers identified per sector
3. **Claim Mapping Confidence:** LLM confidence in product-to-claim mapping
4. **Litigation Group Coherence:** # of patents that group well together

---

*Document created: 2026-01-18*
*Status: PLANNING - Ready for sector-specific prompt development*
