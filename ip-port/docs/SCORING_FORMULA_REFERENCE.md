# Scoring Formula Reference

## Template Hierarchy Summary

### Templates by Level

| Level | Count | Templates |
|-------|-------|-----------|
| **Portfolio** | 1 | `portfolio-default` |
| **Super-Sector** | 10 | wireless, computing, security, networking, video-streaming, semiconductor, imaging, interface, media, ai-ml |
| **Sector** | 54 | rf-acoustic, wireless-transmission, network-switching, computing-auth-boot, etc. |
| **Sub-Sector** | 14 | virtualization, error-detection, amplifiers, adc-dac, pll-clock, transistor-devices, semiconductor-manufacturing, chip-packaging, semiconductor-test, routing, packet-switching, qos-traffic, baseband-equalization, modulation-demodulation |

### Sub-Sector Level Questions (Most Detailed)

| Sub-Sector | Parent Sector | Questions Added |
|------------|---------------|-----------------|
| `virtualization` | computing-* | cloud_infrastructure, multi_tenancy, hypervisor_vmi, agentless_cloud |
| `error-detection` | network-error-control | coding_type, error_control_type, application_scope |
| `amplifiers` | analog-circuits | circuit_type, analog_performance, mixed_signal_integration |
| `adc-dac` | analog-circuits | signal_processing_type, data_rate, serdes_relevance |
| `pll-clock` | analog-circuits | (clock-specific questions) |
| `routing` | network-switching | network_layer, sdn_nfv, data_center_relevance |
| `packet-switching` | network-switching | protocol_layer, qos_management |
| `baseband-equalization` | network-signal-processing | signal_quality, signal_processing_innovation |
| `modulation-demodulation` | network-signal-processing | (modulation-specific) |

### Sectors with ONLY Sector-Level Questions (46)

Most sectors have questions defined at sector level only, inheriting from super-sector and portfolio. Examples:
- rf-acoustic, wireless-transmission, wireless-infrastructure
- video-codec, video-server-cdn, video-broadcast
- computing-auth-boot, computing-data-protection
- network-auth-access, network-threat-protection

### Sectors with ONLY Super-Sector Questions

**None** - All 56 active sectors have at least sector-level template definitions.

---

## Scoring Formula

### Composite Score Calculation

```
CompositeScore = ( Σ (Qᵢ_normalized × Wᵢ) / Σ Wᵢ ) × 100
```

Where:
- `Qᵢ_normalized = (Qᵢ_raw - 1) / (10 - 1)` (normalize 1-10 scale to 0-1)
- `Wᵢ` = weight for question i (from merged template)
- Sum is over all questions with valid responses

### Expanded Formula with All Terms

For a patent in sector S, super-sector SS:

```
Score = 100 × (
    (Q_technical_novelty - 1)/9 × W_technical_novelty +
    (Q_claim_breadth - 1)/9 × W_claim_breadth +
    (Q_design_around_difficulty - 1)/9 × W_design_around_difficulty +
    (Q_market_relevance - 1)/9 × W_market_relevance +
    (Q_implementation_clarity - 1)/9 × W_implementation_clarity +
    (Q_standards_relevance - 1)/9 × W_standards_relevance +
    (Q_unique_value - 1)/9 × W_unique_value +
    Σ (Q_super_sector_i - 1)/9 × W_super_sector_i +
    Σ (Q_sector_j - 1)/9 × W_sector_j +
    Σ (Q_sub_sector_k - 1)/9 × W_sub_sector_k
) / (
    W_technical_novelty + W_claim_breadth + W_design_around_difficulty +
    W_market_relevance + W_implementation_clarity + W_standards_relevance +
    W_unique_value + Σ W_super_sector_i + Σ W_sector_j + Σ W_sub_sector_k
)
```

---

## Portfolio-Level Weights (Base)

| Field Name | Weight | Scale |
|------------|--------|-------|
| `technical_novelty` | 0.20 | 1-10 |
| `claim_breadth` | 0.15 | 1-10 |
| `design_around_difficulty` | 0.20 | 1-10 |
| `market_relevance` | 0.15 | 1-10 |
| `implementation_clarity` | 0.15 | 1-10 |
| `standards_relevance` | 0.15 | 1-10 |
| `unique_value` | 0.10 | 1-10 |
| **Total** | **1.10** | |

*Note: Total > 1.0 at portfolio level; weights are renormalized after merging.*

---

## Super-Sector Weights (Example: WIRELESS)

| Field Name | Weight | Added By |
|------------|--------|----------|
| `component_vs_system` | 0.12 | super-sector |
| `deployment_target` | 0.12 | super-sector |
| `wireless_generation` | 0.12 | super-sector |
| `standards_essentiality` | 0.14 | super-sector |
| **Super-Sector Total** | **0.50** | |

---

## Sector Weights (Example: rf-acoustic)

| Field Name | Weight | Added By |
|------------|--------|----------|
| `filter_technology_type` | 0.15 | sector |
| `material_innovation` | 0.15 | sector |
| `frequency_band_coverage` | 0.15 | sector |
| `rf_frontend_application` | 0.12 | sector |
| `performance_improvement` | 0.15 | sector |
| `manufacturing_feasibility` | 0.10 | sector |
| **Sector Total** | **0.82** | |

---

## Merged Template Example: rf-acoustic

**Inheritance Chain:** `portfolio-default → wireless → rf-acoustic`

| Source | Questions | Raw Weight Sum |
|--------|-----------|----------------|
| Portfolio | 7 | 1.10 |
| Super-Sector (wireless) | 4 | 0.50 |
| Sector (rf-acoustic) | 6 | 0.82 |
| **Total** | **17** | **2.42** |

**After Renormalization** (divide each weight by 2.42):

| Field Name | Original | Normalized |
|------------|----------|------------|
| technical_novelty | 0.20 | 0.083 |
| claim_breadth | 0.15 | 0.062 |
| design_around_difficulty | 0.20 | 0.083 |
| market_relevance | 0.15 | 0.062 |
| implementation_clarity | 0.15 | 0.062 |
| standards_relevance | 0.15 | 0.062 |
| unique_value | 0.10 | 0.041 |
| component_vs_system | 0.12 | 0.050 |
| deployment_target | 0.12 | 0.050 |
| wireless_generation | 0.12 | 0.050 |
| standards_essentiality | 0.14 | 0.058 |
| filter_technology_type | 0.15 | 0.062 |
| material_innovation | 0.15 | 0.062 |
| frequency_band_coverage | 0.15 | 0.062 |
| rf_frontend_application | 0.12 | 0.050 |
| performance_improvement | 0.15 | 0.062 |
| manufacturing_feasibility | 0.10 | 0.041 |
| **Total** | 2.42 | **1.000** |

---

## Excel Formula Template

For a patent with responses Q1-Q17 in cells B2:R2:

```excel
=100 * (
    ((B2-1)/9)*0.083 +    // technical_novelty
    ((C2-1)/9)*0.062 +    // claim_breadth
    ((D2-1)/9)*0.083 +    // design_around_difficulty
    ((E2-1)/9)*0.062 +    // market_relevance
    ((F2-1)/9)*0.062 +    // implementation_clarity
    ((G2-1)/9)*0.062 +    // standards_relevance
    ((H2-1)/9)*0.041 +    // unique_value
    ((I2-1)/9)*0.050 +    // component_vs_system
    ((J2-1)/9)*0.050 +    // deployment_target
    ((K2-1)/9)*0.050 +    // wireless_generation
    ((L2-1)/9)*0.058 +    // standards_essentiality
    ((M2-1)/9)*0.062 +    // filter_technology_type
    ((N2-1)/9)*0.062 +    // material_innovation
    ((O2-1)/9)*0.062 +    // frequency_band_coverage
    ((P2-1)/9)*0.050 +    // rf_frontend_application
    ((Q2-1)/9)*0.062 +    // performance_improvement
    ((R2-1)/9)*0.041      // manufacturing_feasibility
)
```

---

## Dynamic Weight Handling

When a question has no response (missing), exclude from both numerator and denominator:

```
Score = 100 × Σ(Qᵢ_normalized × Wᵢ) / Σ(Wᵢ)
        where i ∈ {questions with valid responses}
```

This ensures scores remain comparable even when some questions are unanswered.

---

## Quick Reference: Question Count by Sector Type

| Sector Type | Portfolio | Super-Sector | Sector | Sub-Sector | Total |
|-------------|-----------|--------------|--------|------------|-------|
| Basic (no sub) | 7 | 4-6 | 4-8 | 0 | 14-17 |
| With sub-sector | 7 | 4-6 | 4-8 | 3-5 | 18-22 |

---

*Generated: February 2026*
