# LLM Scoring System Analysis

## Executive Summary

The portfolio has **26,553 patents** with LLM sector scores across **56 sectors** in **9 super-sectors**. The scoring system uses a 4-level hierarchical template structure with question inheritance. Composite scores range from 1.2 to 81.8 with a median of 53.3.

---

## 1. Hierarchy Structure

```
Portfolio Default (7 base questions)
    └── Super-Sector (11 templates, adds 4-6 questions each)
        └── Sector (54 templates, adds 4-8 questions each)
            └── Sub-Sector (14 templates, optional refinement)
```

### Template Inheritance Flow
- Questions merge from Portfolio → Super-Sector → Sector → Sub-Sector
- Same `fieldName` at a more specific level **overrides** the parent level
- Weights are auto-normalized to sum to 1.0 after merging
- Typical merged template has **10-14 questions**

---

## 2. Score Distribution by Super-Sector

| Super-Sector | Count | Avg | StdDev | Median | Range |
|--------------|-------|-----|--------|--------|-------|
| SEMICONDUCTOR | 1,689 | 54.6 | 10.2 | 56.6 | 1.2-75.7 |
| COMPUTING | 1,805 | 55.4 | 9.6 | 56.8 | 4.3-81.4 |
| SECURITY | 13,736 | 52.0 | 11.4 | 53.3 | 1.3-81.8 |
| WIRELESS | 2,648 | 51.4 | 11.2 | 53.1 | 1.7-77.4 |
| NETWORKING | 4,809 | 50.7 | 12.7 | 52.9 | 1.3-81.0 |
| IMAGING | 445 | 48.1 | 12.1 | 49.8 | 2.1-76.2 |
| VIDEO_STREAMING | 1,360 | 42.9 | 14.3 | 42.8 | 1.7-79.4 |
| AI_ML | 17 | 41.1 | 7.6 | 40.1 | 23.7-50.8 |

**Observations:**
- SEMICONDUCTOR and COMPUTING have highest average scores (54-55)
- VIDEO_STREAMING has lowest average (42.9) and highest variance (14.3)
- AI_ML has very few patents (17) - candidate for merge or expansion

---

## 3. Base Questions (Portfolio Level)

These 7 questions appear in ALL patent scores:

| Field Name | Avg | StdDev | Weight | Notes |
|------------|-----|--------|--------|-------|
| `market_relevance` | 7.12 | 1.72 | 0.15 | Good discrimination |
| `implementation_clarity` | 7.00 | 0.79 | 0.15 | **Low variance** - may not discriminate |
| `unique_value` | 6.46 | 1.32 | 0.10 | Moderate discrimination |
| `claim_breadth` | 6.25 | 0.97 | 0.15 | **Low variance** |
| `technical_novelty` | 5.91 | 0.93 | 0.20 | **Low variance** |
| `design_around_difficulty` | 4.91 | 1.05 | 0.20 | Moderate discrimination |
| `standards_relevance` | 3.85 | 1.75 | 0.15 | Good discrimination |

**Issue:** Three base questions (`claim_breadth`, `technical_novelty`, `implementation_clarity`) have stdDev < 1.0, meaning they don't discriminate well between patents.

---

## 4. Scoring Formula

```
CompositeScore = (Σ normalized_score × weight) / totalWeight × 100

Where:
  normalized_score = (raw_score - scale.min) / (scale.max - scale.min)
  totalWeight = Σ weights of questions with responses
```

**Key Characteristics:**
- Missing questions are excluded from totalWeight (automatic renormalization)
- All scores normalized to 0-100 scale
- Weights auto-normalize if they don't sum to 1.0

---

## 5. Identified Issues

### 5a. Low-Discriminating Questions
Three base questions have stdDev < 1.0:
- `claim_breadth` (0.97) - Nearly all patents score 6-7
- `technical_novelty` (0.93) - Nearly all patents score 5-7
- `implementation_clarity` (0.79) - Nearly all patents score 7-8

**Recommendation:** Consider:
1. Revising question prompts for more nuanced responses
2. Adjusting scale (1-5 instead of 1-10?)
3. Reducing weight of low-discriminating questions

### 5b. High Variance Sector (Sub-Sector Split Candidate)
- `video-server-cdn`: stdDev=15.5, count=137, range=15.5-77.9

**Recommendation:** Analyze patents to identify natural sub-groupings (e.g., CDN infrastructure vs. adaptive streaming vs. edge caching)

### 5c. Low Count Sectors (Merge Candidates)

| Sector | Count | Avg | Recommendation |
|--------|-------|-----|----------------|
| wireless-security | 7 | 50.8 | Merge into SECURITY super-sector |
| recognition-biometrics | 11 | 29.6 | Merge into IMAGING or SECURITY |
| magnetics-inductors | 12 | 57.6 | Merge into SEMICONDUCTOR |
| ai-ml | 17 | 41.1 | Keep separate but needs expansion |
| streaming-multimedia | 18 | 42.8 | Merge into VIDEO_STREAMING |
| wireless-services | 27 | 50.8 | Merge into WIRELESS super-sector |
| fintech-business | 27 | 53.2 | Consider as cross-cutting category |
| image-processing | 38 | 49.3 | Merge into IMAGING |
| general | 44 | 43.6 | Re-assign to specific sectors |
| semiconductor-modern | 49 | 51.4 | Merge into SEMICONDUCTOR |

### 5d. Score Distribution Anomalies
- **recognition-biometrics** has very low average (29.6) compared to portfolio (51.5)
- May indicate template questions not well-suited to biometric patents
- Consider specialized biometric template

---

## 6. Refactoring Recommendations

### Priority 1: Improve Base Question Discrimination
1. Analyze `claim_breadth` responses - why clustered around 6-7?
2. Consider more specific criteria in question prompts
3. Possible solutions:
   - Add comparison context ("compared to average patents in this field...")
   - Use relative scale ("top 10% / top 25% / average / below average")
   - Split into sub-questions

### Priority 2: Merge Low-Count Sectors
- Threshold: Sectors with <50 patents should be merged or justified
- Create mapping: old_sector → new_sector
- Re-calculate scores with appropriate template

### Priority 3: Split High-Variance Sectors
- `video-server-cdn` should be analyzed for sub-groupings
- Use clustering on existing LLM responses to identify natural splits
- Create sub-sector templates for each grouping

### Priority 4: Template Coverage Audit
- 54 sector templates configured but 56 sectors have scores
- 2 sectors using fallback templates
- Identify which sectors need dedicated templates

---

## 7. Score Recalculation Approach

When refactoring sectors:

```typescript
// 1. Define sector remapping
const sectorRemap = {
  'wireless-security': 'security-network',
  'recognition-biometrics': 'imaging-recognition',
  // ...
};

// 2. Update patent assignments
UPDATE patents SET primary_sector = 'new_sector' WHERE primary_sector = 'old_sector';

// 3. Recalculate composite scores with new templates
// Option A: Full rescore (expensive but accurate)
// Option B: Weight adjustment only (preserve LLM responses)

// 4. Recalculate ranks within new sectors
```

### Weight Adjustment Formula (Option B)
If only changing weights, not questions:
```
new_composite = Σ(metric_score × new_weight) / Σ(new_weights)
```

This preserves existing LLM responses while applying new weighting scheme.

---

## 8. Monitoring Metrics

After any refactoring, track:

| Metric | Target | Current |
|--------|--------|---------|
| Portfolio score avg | 50-55 | 51.5 |
| Portfolio stdDev | 10-15 | 11.9 |
| Min sector count | >50 | 7 (wireless-security) |
| Max sector stdDev | <15 | 15.5 (video-server-cdn) |
| Base question stdDev | >1.0 | 0.79-0.97 (3 below) |

---

## 9. Next Steps

1. **Immediate:** Document current state (this document)
2. **Short-term:** Address low-count sectors via merge
3. **Medium-term:** Revise low-discriminating questions
4. **Long-term:** Implement automated monitoring for score distribution anomalies

---

*Generated: February 2026*
*Analysis based on 26,553 scored patents across 56 sectors*
