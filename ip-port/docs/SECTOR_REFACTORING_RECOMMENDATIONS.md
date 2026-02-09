# Sector Refactoring Recommendations

*Analysis Date: February 2026*
*Based on 27,584 scored patents across 56 sectors*

## Executive Summary

| Category | Count | Action |
|----------|-------|--------|
| **High Priority Splits** | 4 sectors | Split into sub-sectors |
| **Merge Candidates** | 10 sectors | Merge into larger sectors |
| **Template Reviews** | 6 sectors | Review scoring template |
| **Large Sector Evaluation** | 2 sectors | Evaluate for sub-grouping |

---

## 1. HIGH PRIORITY SPLITS

### 1.1 video-server-cdn (stdDev=15.6, n=137)

**Current State:** Highest variance sector, scores range 15.5-77.9

**Recommended Split (3 sub-sectors):**

| Sub-Sector | Patents | Avg Score | Characteristics |
|------------|---------|-----------|-----------------|
| `video-cdn-infrastructure` | 51 (37%) | 49.1 | High: delivery_scalability (+1.8), infrastructure_layer (+1.6), transcoding |
| `video-streaming-standards` | 42 (31%) | 56.9 | High: market_relevance, standards_relevance |
| `video-streaming-legacy` | 44 (32%) | 27.2 | Low scores across all dimensions - legacy/niche |

**Key Differentiating Questions:**
- `delivery_scalability` (stdDev=2.45)
- `infrastructure_layer` (stdDev=2.33)
- `transcoding_capability` (stdDev=2.06)

---

### 1.2 test-measurement (stdDev=14.3, n=152)

**Current State:** High variance semiconductor testing sector

**Recommended Split (3 sub-sectors):**

| Sub-Sector | Patents | Avg Score | Characteristics |
|------------|---------|-----------|-----------------|
| `test-dft-integrated` | 35 (23%) | 60.3 | High: dft_integration (+5.2), chip_integration (+3.7), test_method (+3.0) |
| `test-ate-process` | 65 (43%) | 47.3 | High: process_node_applicability, ate_relevance; Low: dft_integration |
| `test-general-measurement` | 52 (34%) | 29.0 | Low scores on all test-specific questions |

**Key Differentiating Questions:**
- `dft_integration` (stdDev=3.03) - strongest differentiator
- `process_node_applicability` (stdDev=2.99)
- `chip_integration` (stdDev=2.66)

**Insight:** Clear separation between Design-for-Test (DFT) integrated solutions vs. process/ATE-focused vs. general measurement patents.

---

### 1.3 network-protocols (stdDev=14.4, n=262)

**Current State:** High variance networking sector

**Recommended Split (2 sub-sectors):**

| Sub-Sector | Patents | Avg Score | Characteristics |
|------------|---------|-----------|-----------------|
| `network-protocols-core` | 194 (74%) | 54.6 | High: market_relevance (+1.1), unique_value (+0.8), standards_relevance |
| `network-protocols-legacy` | 65 (25%) | 31.3 | Low: market_relevance (-3.1), unique_value (-2.1) |

**Note:** Cluster 2 (3 patents) are outliers - review for reassignment.

**Key Differentiating Questions:**
- `market_relevance` (stdDev=2.05)
- `standards_relevance` (stdDev=1.99)

---

### 1.4 network-error-control (stdDev=13.3, n=710)

**Current State:** Large sector with moderate-high variance

**Recommended Split (3 sub-sectors):**

| Sub-Sector | Patents | Avg Score | Characteristics |
|------------|---------|-----------|-----------------|
| `error-control-standards` | 278 (39%) | 59.9 | High: standards_relevance (+1.0), network_architecture (+0.9), scalability (+0.7) |
| `error-control-enterprise` | 264 (37%) | 55.8 | High: market_relevance, unique_value; Low: scalability (-3.7), protocol_relevance |
| `error-control-legacy` | 168 (24%) | 34.7 | Low scores across all dimensions |

**Key Differentiating Questions:**
- `standards_relevance` (stdDev=2.12)
- `market_relevance` (stdDev=1.99)
- `network_architecture` (stdDev=1.93)

---

## 2. MERGE CANDIDATES

### Priority 1: Very Low Count (< 20 patents)

| Sector | Count | Avg | → Merge Into |
|--------|-------|-----|--------------|
| `wireless-security` | 7 | 50.8 | `computing-auth-boot` or `network-auth-access` |
| `recognition-biometrics` | 11 | 29.6 | `cameras-sensors` (same IMAGING super-sector) |
| `magnetics-inductors` | 12 | 57.6 | `analog-circuits` (both passive components) |
| `ai-ml` | 17 | 41.1 | Keep separate - strategic category |
| `streaming-multimedia` | 18 | 42.8 | `video-client-processing` or `network-multiplexing` |

### Priority 2: Low Count (20-50 patents)

| Sector | Count | Avg | → Merge Into |
|--------|-------|-----|--------------|
| `fintech-business` | 27 | 53.2 | `computing-data-protection` (data/transaction focus) |
| `wireless-services` | 27 | 50.8 | `wireless-mimo-antenna` or `wireless-infrastructure` |
| `image-processing` | 38 | 49.3 | `cameras-sensors` |
| `general` | 44 | 43.6 | Reassign to specific sectors based on CPC |
| `semiconductor-modern` | 49 | 51.4 | `semiconductor` (general) or `lithography` |

### Merge Rationale Notes:

- **wireless-security → computing-auth-boot**: Both handle authentication/security, just different transport
- **magnetics-inductors → analog-circuits**: Both are passive components, similar evaluation criteria
- **streaming-multimedia → video-client-processing**: Overlapping multimedia handling focus
- **general**: These are likely design patents or unclassified - need individual review

---

## 3. TEMPLATE REVIEWS NEEDED

### Sectors with abnormally low scores (avg < 40, portfolio avg = 51.6)

| Sector | Count | Avg | Diff | Issue |
|--------|-------|-----|------|-------|
| `video-storage` | 125 | 30.3 | -21.4 | **CRITICAL** - Template not suited to storage patents |
| `video-drm-conditional` | 58 | 34.1 | -17.5 | DRM questions may be too specific |
| `pcb-packaging` | 52 | 39.6 | -12.0 | Review packaging-specific questions |
| `video-broadcast` | 320 | 39.8 | -11.9 | Broadcast vs streaming mismatch |
| `3d-stereo-depth` | 64 | 40.0 | -11.6 | Niche category, review relevance |
| `display-control` | 111 | 40.2 | -11.4 | Display vs video streaming mismatch |

### video-storage Analysis:

**Problem:** 68% of patents score 20-40, with many video-specific questions scoring near minimum:
- `trick_play`: avg=1.3 (most patents score 1)
- `recording_capability`: avg=1.7
- `codec_compression`: avg=1.3
- `streaming_protocol`: avg=1.3

**Recommendation:**
1. Create storage-specific template that doesn't penalize non-streaming features
2. Or merge into general `storage` sector with appropriate template
3. Consider if these patents belong in VIDEO_STREAMING super-sector at all

---

## 4. LARGE SECTOR EVALUATION

### computing-auth-boot (n=6,556)

**Current State:** Largest sector, moderate variance (stdDev=11.7)

**Cluster Analysis (k=4):**

| Cluster | Patents | Avg Score | Characteristics |
|---------|---------|-----------|-----------------|
| **Mainstream** | 4,108 (63%) | 51.2 | Near-average across all dimensions |
| **Low-Value** | 74 (1%) | 7.9 | Very low scores - review for removal |
| **Below-Average** | 892 (14%) | 35.7 | Lower market_relevance, unique_value |
| **Premium** | 1,484 (23%) | 64.5 | High scores across dimensions |

**Recommendation:**
- Consider sub-sector by technology: boot security, runtime auth, key management
- Flag 74 low-value patents for review
- Current structure acceptable given moderate variance

### network-auth-access (n=4,399)

**Similar to computing-auth-boot** - evaluate if natural sub-groupings exist by:
- Authentication method (cert, token, biometric)
- Network layer (application, transport, network)
- Deployment (enterprise, cloud, edge)

---

## 5. IMPLEMENTATION PLAN

### Phase 1: Template Fixes (Immediate)
1. Review `video-storage` template - questions not appropriate for storage patents
2. Review `video-drm-conditional` template
3. Consider moving video-storage out of VIDEO_STREAMING super-sector

### Phase 2: Merges (Low Risk)
1. Merge `wireless-security` → `computing-auth-boot`
2. Merge `magnetics-inductors` → `analog-circuits`
3. Merge `image-processing` → `cameras-sensors`
4. Reassign `general` patents to specific sectors

### Phase 3: Splits (Requires New Templates)
1. Split `video-server-cdn` into 3 sub-sectors
2. Split `test-measurement` into 3 sub-sectors
3. Split `network-error-control` into 3 sub-sectors

### Phase 4: Large Sector Review
1. Evaluate `computing-auth-boot` for sub-sectoring
2. Evaluate `network-auth-access` for sub-sectoring

---

## 6. SCORE RECALCULATION APPROACH

After structural changes, use the recalculation tool:

```bash
# Preview impact of weight changes
npx tsx scripts/recalculate-composite-scores.ts --dry-run --details

# Apply to specific sector after merge
npx tsx scripts/recalculate-composite-scores.ts --sector=analog-circuits --apply

# Use custom weights for specific sectors
npx tsx scripts/recalculate-composite-scores.ts --weights-file=config/weight-profiles/storage-focused.json --apply
```

---

## 7. MONITORING METRICS

After refactoring, track:

| Metric | Current | Target |
|--------|---------|--------|
| Sectors with stdDev > 14 | 4 | 0 |
| Sectors with count < 20 | 5 | 0 |
| Sectors with avg < 40 | 6 | 0 |
| Portfolio avg score | 51.6 | 50-55 |
| Portfolio stdDev | 11.9 | 10-13 |

---

*Generated by sector-refactoring-analysis.ts and analyze-sector-for-split.ts*
