# Claims Integration Analysis

## Executive Summary

This document analyzes the effort, cost, and testing approach for incorporating patent claims text into LLM scoring context.

## Current State

### Data Sources

| Source | Claims Available | Status |
|--------|------------------|--------|
| USPTO Bulk XML | **Full claims with structure** | 25,987 XML files on external drive (3.9 GB) |
| PatentsView API | No | API excludes claims text |
| LLM Cache | No | Only abstract/summary cached |

### XML Structure

Claims are available in USPTO bulk XML files at `/Volumes/PortFat4/uspto/bulkdata/export/`:

```xml
<claims id="claims">
  <claim id="CLM-00001" num="00001">
    <claim-text>1. A method of... comprising:
      <claim-text>step a;</claim-text>
      <claim-text>step b;</claim-text>
    </claim-text>
  </claim>
  <claim id="CLM-00002" num="00002">
    <claim-text>2. The method of <claim-ref idref="CLM-00001">claim 1</claim-ref>, wherein...</claim-text>
  </claim>
</claims>
```

**Key observations:**
- Independent claims: No `<claim-ref>` element
- Dependent claims: Reference parent via `<claim-ref idref="CLM-XXXXX">`
- Claims are nested (sub-claim-text within claim-text)

---

## Token Cost Analysis

### Sample Data (39 patents analyzed)

| Metric | Average | Range |
|--------|---------|-------|
| Claims per patent | 19 | 10-30 |
| Total claims chars | 5,730 | 2,000-15,000 |
| **Total claims tokens** | **1,432** | 500-3,600 |
| Independent claims tokens | ~600 | 300-1,200 |
| Dependent claims tokens | ~800 | 400-2,400 |

### Current Context (without claims)

| Component | Tokens (est.) |
|-----------|---------------|
| Patent metadata | 100 |
| Abstract | 150 |
| LLM enrichment (summary, problem, solution) | 300 |
| Questions (7-11) | 500 |
| Response format instructions | 150 |
| **Total input** | **~1,200** |
| **Output (11 metrics + reasoning)** | **~800** |

### With Claims Added

| Scenario | Additional Tokens | Total Input | Cost Multiplier |
|----------|------------------|-------------|-----------------|
| **Independent claims only** | +600-800 | ~1,900 | **1.6x** |
| **First 3 independent claims** | +400-500 | ~1,700 | **1.4x** |
| All claims | +1,400-1,700 | ~2,900 | **2.4x** |
| Full description (not recommended) | +5,000-10,000 | ~10,000 | **8x** |

**Recommendation:** Use independent claims only (1.6x cost) or first 3 independent claims (1.4x cost).

---

## Implementation Effort

### Phase 1: Claims Extraction (1-2 hours)

Add to `patent-xml-parser-service.ts`:

```typescript
interface PatentClaimsData {
  patentId: string;
  independentClaims: Claim[];
  dependentClaims: Claim[];
  totalClaimCount: number;
  parseError?: string;
}

interface Claim {
  number: number;
  text: string;
  dependsOn?: number;  // For dependent claims
}

function extractPatentClaims(xmlPath: string): PatentClaimsData
function extractClaimsText(patentId: string, options: { independentOnly?: boolean; maxClaims?: number }): string
```

### Phase 2: Claims Cache (2-3 hours)

Create claims cache infrastructure:
- Cache location: `cache/patent-claims/{patentId}.json`
- Store parsed claims structure (not raw XML)
- On-demand loading in `llm-scoring-service.ts`

### Phase 3: Template Variants (1-2 hours)

Add context configuration to scoring templates:

```json
{
  "contextConfig": {
    "includeAbstract": true,
    "includeClaims": "independent_only",
    "maxClaimTokens": 800,
    "includeLlmSummary": true
  }
}
```

Template variants:
1. **minimal** - Abstract only (~150 tokens context)
2. **standard** - Abstract + LLM summary (~450 tokens context) [CURRENT]
3. **claims** - Abstract + LLM summary + independent claims (~1,100 tokens context)
4. **full** - Abstract + LLM summary + all claims (~1,850 tokens context)

### Phase 4: Comparison Testing (2-3 hours)

Create test framework to compare scoring quality:
- Select 50 test patents (diverse sectors, claim complexity)
- Score with standard vs claims context
- Compare: score variance, reasoning quality, specific metric changes

---

## Test Plan

### Test Set Selection

Select 50 patents from video-codec sector (currently being scored):
- 10 high composite score (>7.5)
- 10 medium-high (6.0-7.5)
- 20 medium (4.5-6.0)
- 10 low (<4.5)

### Scoring Comparison

Run parallel scoring with different context levels:

```bash
# 1. Get test set from completed video-codec scores
curl -s http://localhost:3001/api/scoring-templates/scores/sub-sector/video-codec | jq '.scores | sort_by(-.compositeScore)'

# 2. Re-score with claims context (separate template)
POST /api/scoring-templates/llm/score-patent
Body: { patent_id: "...", template_variant: "claims" }
```

### Metrics to Compare

| Metric | Expected Impact from Claims |
|--------|---------------------------|
| `claim_breadth` | **High** - Direct claims analysis |
| `enforceability` | **High** - Claims language quality |
| `novelty` | Medium - Claims define unique features |
| `technical_merit` | Medium - Claims show implementation depth |
| `market_relevance` | Low - Abstract covers this |
| `defensive_value` | Medium - Dependent claims show design-around difficulty |

### Success Criteria

Claims context is valuable if:
1. Score variance increases for claim-specific metrics (breadth, enforceability)
2. Reasoning text references specific claim language
3. Correlation with IPR risk scores improves
4. Human spot-check confirms reasoning quality

---

## Cost Projection

### Full Portfolio Scoring

| Scenario | Patents | Input Tokens | Output Tokens | Total Tokens | Est. Cost* |
|----------|---------|--------------|---------------|--------------|------------|
| Standard (no claims) | 28,913 | 34.7M | 23.1M | 57.8M | $173 |
| With independent claims | 28,913 | 55.5M | 23.1M | 78.6M | **$236** |
| With all claims | 28,913 | 83.3M | 23.1M | 106.4M | $319 |

*Using Claude 3.5 Sonnet pricing: $3/M input, $15/M output

**Incremental cost for claims: +$63 (36%) for independent claims only**

### Batch Testing Cost

50 patent comparison test:
- 50 patents × 2 variants × ~2,500 tokens = 250K tokens
- Estimated cost: **~$1-2**

---

## Recommended Approach

### Short-term (This Session)

1. **Build claims extraction function** - Add `extractPatentClaims()` to XML parser
2. **Create claims cache** - Store parsed claims for test patents
3. **Select test set** - Pick 50 video-codec patents once scoring completes
4. **Run comparison** - Score with/without claims, analyze differences

### Medium-term

1. **Add context configuration** - Template-level control over included context
2. **Evaluate results** - Determine if claims add meaningful signal
3. **Decide on rollout** - If valuable, integrate into main scoring pipeline
4. **Backfill claims cache** - Process all 26K patents with XML files

### Long-term (if claims prove valuable)

1. **Re-score portfolio** - With claims + revised question weights
2. **Integrate with prosecution** - Claims + prosecution history for validity
3. **Claims comparison** - Track claim amendments, prior art overlaps

---

## Additional XML Data Available

Beyond claims, USPTO bulk XML includes other potentially useful data for the patent detail screen:

| Data | Location in XML | Current Status |
|------|-----------------|----------------|
| Claims (full text) | `<claims>` | Not extracted |
| Description | `<description>` | Not extracted (very large) |
| Drawings (refs) | `<drawings>` | Not extracted |
| Priority claims | `<priority-claims>` | Not extracted |
| Related applications | `<related-documents>` | Not extracted |
| Examiner cited refs | `<us-references-cited>` | Not extracted |

**Recommendation:** Extract claims now; evaluate description/drawings later based on specific use cases.

---

*Last Updated: 2026-02-06*
