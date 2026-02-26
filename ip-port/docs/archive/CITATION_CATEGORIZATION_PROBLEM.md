# Citation Categorization Problem

*Created: 2026-01-22*
*Status: DOCUMENTED - Implementation Pending*

## Problem Statement

Our current citation analysis counts `forward_citations` (total) and `competitor_citations` (from tracked competitors), but does not separately track **within-portfolio citations** from affiliates (VMware, Broadcom, Nicira, etc.).

This matters because:
1. Portfolio patents citing each other represents "self-interest" rather than external market validation
2. High self-citation rates may artificially inflate patent scores
3. VMware patents dominate V3 rankings (84% of top 500) - need to understand if citation patterns contribute

## Current State

### What We Track

| Field | Description | Source |
|-------|-------------|--------|
| `forward_citations` | Total patents citing this patent (from ANY assignee) | PatentsView API |
| `competitor_citations` | Citations from tracked competitors (131 companies) | Filtered from `competitor_cites` |
| `competitor_cites` | List of competitor citations with details | Stored in citation-overlap JSON |

### What We Don't Track

| Missing Field | Description | Why Important |
|---------------|-------------|---------------|
| `portfolio_citations` | Citations from portfolio affiliates | Identifies self-citations |
| `third_party_citations` | Citations from non-competitor, non-affiliate companies | True external interest |
| `external_citations` | `forward_citations - portfolio_citations` | Adjusted total for scoring |

### Citation Math

```
forward_citations = competitor_citations + portfolio_citations + third_party_citations
                  = competitor_citations + (unknown remainder)
```

Currently we only know:
- `forward_citations` (total)
- `competitor_citations` (subset)
- The remainder is a mix of portfolio and third-party citations

## Impact Analysis: VMware Example

From `vmware-citation-results-2026-01-20.json` (6,475 VMware patents):

| Metric | Value | Percentage |
|--------|-------|------------|
| Total forward citations | 52,923 | 100% |
| Competitor citations | 13,526 | 25.6% |
| Non-competitor citations | 39,397 | 74.4% |

The 74.4% "non-competitor" bucket includes both:
- Portfolio affiliate citations (VMware citing VMware, Nicira citing VMware, etc.)
- Third-party citations (smaller companies not in competitor list)

**Key Question:** What portion of that 74.4% is within-portfolio self-citation?

## VMware Dominance in Rankings

| Ranking Set | V2 | V3 |
|-------------|----|----|
| VMware in Top 100 | 65 (65%) | 97 (97%) |
| VMware in Top 250 | 141 (56%) | 232 (93%) |
| VMware in Top 500 | 219 (44%) | 420 (84%) |

V3 has significantly higher VMware representation. Contributing factors:
1. V3 uses default values (3.0/5) for missing LLM scores
2. V3 uses aggressive tiered citation normalization
3. V3 factor floors prevent weak factors from zeroing scores
4. **Potentially:** High within-portfolio citations inflating citation-based scores

## Portfolio Affiliates to Track

From `config/portfolio-affiliates.json`:

| Affiliate | Display Name | Patterns |
|-----------|--------------|----------|
| Broadcom | Broadcom | Broadcom, Broadcom Inc, Broadcom Corporation |
| VMware | VMware | VMware LLC, VMware, VMWare, VMware, Inc |
| Nicira | Nicira (VMware SDN) | Nicira, Inc, Nicira Inc, Nicira |
| Avago | Avago Technologies | Avago, Avago Technologies, etc. |
| LSI | LSI Corporation | LSI Logic, LSI Corporation, LSI |
| Symantec | Symantec Enterprise | Symantec, Symantec Corporation |
| CA Technologies | CA Technologies | CA, Inc, CA Technologies, Computer Associates |
| Carbon Black | Carbon Black | Carbon Black, Carbon Black, Inc. |
| Pivotal | Pivotal Software | Pivotal, Pivotal Software |
| Others | Various | Brocade, Blue Coat, Avi Networks, Lastline, Nyansa |

## Proposed Solution

### New Citation Fields

Add to citation-overlap output and RawData:

```typescript
interface EnhancedCitationData {
  forward_citations: number;        // Total (existing)
  competitor_citations: number;     // From competitors (existing)
  portfolio_citations: number;      // NEW: From affiliates
  third_party_citations: number;    // NEW: Everyone else
  external_citations: number;       // NEW: forward - portfolio
  portfolio_citation_ratio: number; // NEW: portfolio / forward
}
```

### Modified Citation Overlap Script

```typescript
// In citation-overlap analysis:
for (const citingPatent of allCitingPatents) {
  const assignee = citingPatent.assignee;

  if (isCompetitor(assignee)) {
    competitorCites.push(citingPatent);
  } else if (isPortfolioAffiliate(assignee)) {
    portfolioCites.push(citingPatent);  // NEW
  } else {
    thirdPartyCites.push(citingPatent); // NEW
  }
}
```

### Scoring Adjustment Options

1. **Use `external_citations` instead of `forward_citations`** in scoring
2. **Apply penalty for high `portfolio_citation_ratio`** (e.g., >30%)
3. **Weight `competitor_citations` higher** relative to total citations
4. **Create "adjusted citation score"** that discounts self-citations

## Estimation Script

See `scripts/estimate-portfolio-citations.ts` for sampling analysis that:
1. Samples top-rated patents (especially VMware)
2. Queries PatentsView API for all citing patents
3. Categorizes each as competitor/portfolio/third-party
4. Estimates portfolio citation rates to prioritize this fix

## Estimation Results (2026-01-22)

Ran `scripts/estimate-portfolio-citations.ts` on 28 sampled patents from V3 TopRated:
- 20 VMware patents
- 8 Non-VMware patents

### Key Findings

| Metric | VMware Patents | Non-VMware Patents | Difference |
|--------|---------------|-------------------|------------|
| **Avg Portfolio (Self) Citations** | **16.5%** | **1.7%** | **+14.8 pp** |
| Avg Competitor Citations | 70.5% | 81.4% | -10.9 pp |
| Avg Third-Party Citations | 13.0% | 16.9% | -3.9 pp |
| Patents with >20% self-citations | 4/20 (20%) | 0/8 (0%) | +20 pp |

### High Self-Citation Patents (VMware/Nicira)

| Rank | Patent | Affiliate | Portfolio % | Top Self-Citators |
|------|--------|-----------|-------------|-------------------|
| 9 | 9747249 | Nicira | **79.0%** | VMware(65), Nicira(14) |
| 54 | 9762619 | Nicira | **61.8%** | Nicira(28), VMware(6) |
| 7 | 9860151 | Nicira | **39.0%** | Nicira(18), VMware(14) |
| 55 | 9047133 | VMware | **33.3%** | VMware(16) |

### Interpretation

1. **VMware patents self-cite at 10x the rate** of non-VMware patents (16.5% vs 1.7%)
2. **Nicira patents are the worst offenders** - some with 60-80% self-citations
3. **This inflates VMware's forward citation counts** and distorts competitive interest signals
4. **Non-VMware patents** (CA Tech, Symantec, Avago) have negligible self-citation rates

### Impact on Scoring

Current scoring treats all forward citations equally. A patent with 100 forward citations where:
- 80 are from portfolio affiliates (VMware citing Nicira)
- 20 are from competitors

...gets the same citation score as a patent with:
- 0 from portfolio
- 100 from competitors

This likely contributes to VMware's dominance (84% of V3 Top 500).

## Priority Assessment

| Factor | Assessment |
|--------|------------|
| Data accuracy impact | **High** - 74% of citations uncategorized |
| Scoring impact | **HIGH** - VMware has 10x self-citation rate; directly inflates scores |
| Implementation effort | **Medium** - Requires re-running citation overlap analysis |
| API cost | **Low** - Same API calls, different categorization |

**RECOMMENDATION:** High priority to implement. The 14.8% self-citation differential is significant and likely inflates VMware patent rankings.

## Next Steps

1. [x] Run estimation script on sample of top patents
2. [x] Quantify portfolio citation rates for VMware vs non-VMware
3. [ ] Decide on scoring adjustment approach (options below)
4. [ ] Modify citation-overlap scripts to track all three categories
5. [ ] Re-run citation analysis for full portfolio
6. [ ] Update scoring formulas

### Scoring Adjustment Options

**Option A: Exclude Portfolio Citations**
```
external_citations = forward_citations - portfolio_citations
use external_citations in scoring
```

**Option B: Discount Portfolio Citations**
```
adjusted_citations = external_citations + (portfolio_citations * 0.25)
```

**Option C: Separate Competitive Signal**
```
competitive_signal = competitor_citations / external_citations
use competitive_signal as separate metric
```

---

*Results from estimation analysis run 2026-01-22*
*Full results: `output/portfolio-citation-estimate-2026-01-22.json`*
