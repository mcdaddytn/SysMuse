# Patent Portfolio Analysis - Session Context (2026-01-21)

## Current State Summary

| Metric | Value |
|--------|-------|
| Total Patents (Full Portfolio) | 22,589 |
| With Citation Analysis | 10,159 |
| With Competitor Citations | 5,333 |
| With LLM Analysis | 543 |
| Unique Sectors | 114 |
| Super-Sectors | 13 |

## Recent Accomplishments (2026-01-20)

### Full Portfolio Merge Complete
Merged ALL 22,589 patents from broadcom-portfolio into attorney export:
- Previously: 17,040 patents (only those through citation pipeline)
- Now: 22,589 patents (full portfolio including ~5,500 never processed)
- Patent 8595331 (CA, Inc.) and similar missing patents now included

### New Attorney Questions Worksheet
Added `AttorneyQuestions` worksheet to `AttorneyPortfolioMacros.bas`:
- Top patents ranked by Overall Score with LLM analysis
- Highlights the 5 attorney analysis questions:
  - **101 Eligibility Score** (1-5): Patent eligibility strength
  - **Validity Score** (1-5): Prior art strength
  - **Summary**: High-level for non-technical audience
  - **Prior Art Problem**: Problem addressed by patent
  - **Technical Solution**: How the solution works
- Color-coded scores, data bars, and frozen headers

### New Columns in Attorney Export
- `non_competitor_citations` - Forward citations not from competitors (captures potential unknown infringers)
- `super_sector` - Parent sector grouping
- `has_citation_analysis` - Y/N flag for citation pipeline status
- Scoring columns: licensing, litigation, strategic, acquisition, overall

### Fixed VBA Macros
- Fixed CPC column index (ByCPC was showing "Unknown")
- Updated all column constants for new CSV format
- Added data coverage metrics to Summary sheet

---

## Next Session: Heat Map Vendor Batches

### Goal
Prepare 10 batches of 25 patents each (250 total) for submission to patent/product heat map vendor.

### Vendor Details
- **Cost**: $25 per patent
- **Output**: Product heat map with ~20 potential infringing products per patent
- **Strategy**: Test run with 10 batches, analyze results between batches

### Batch Selection Strategy

**Balancing Factors:**
1. **Patent Strength** - Use top-rated patents with high Overall Score
2. **Sector Diversity** - Spread across super-sectors to discover products in different markets
3. **Sector Depth** - Don't under-represent any sector, ensure meaningful data comes back
4. **Claim Breadth** - Prefer broader claims (vendor uses claim charts for product matching)

**Proposed Distribution (10 batches × 25 = 250 patents):**

| Super-Sector | Suggested Patents | Rationale |
|--------------|-------------------|-----------|
| SECURITY | 40-50 | Strong competitive citations, clear products |
| VIRTUALIZATION | 40-50 | Large portfolio, enterprise products |
| SDN_NETWORK | 30-40 | Network infrastructure products |
| WIRELESS | 30-40 | Mobile/IoT market opportunity |
| VIDEO_STREAMING | 25-30 | Consumer electronics targets |
| COMPUTING | 20-25 | Broad applicability |
| FAULT_TOLERANCE | 15-20 | Enterprise infrastructure |
| Others | 15-20 | Exploratory coverage |

### Available Data for Selection

**Claim Breadth Data (543 patents):**
| Score | Count | Meaning |
|-------|-------|---------|
| 4 | 129 | Broad claims - PREFER for heat map |
| 3 | 388 | Moderate breadth |
| 2 | 26 | Narrow claims |

**Key Insight**: Claim breadth may correlate with competitor citations (broader claims = more infringers found). We can analyze this relationship to refine selection.

### Tasks for Next Session

1. **Analyze claim breadth correlation**
   - Compare claim_breadth vs competitor_citations
   - Determine if claim breadth should weight batch selection

2. **Create batch generation script**
   - Input: Selection criteria (super-sector quotas, min score, etc.)
   - Output: 10 JSON/CSV batches of 25 patents each

3. **Generate first batches for review**
   - Batch 1-3: Focused on highest-value patents
   - Batch 4-7: Sector diversity spread
   - Batch 8-10: Exploratory (under-represented areas)

4. **Design feedback loop**
   - Schema for capturing heat map results
   - How to incorporate product data into future batch selection
   - Track which sectors yield best product matches

---

## Key Files

### Data Files
| File | Description |
|------|-------------|
| `output/ATTORNEY-PORTFOLIO-LATEST.csv` | Full portfolio (22,589 patents) |
| `output/ATTORNEY-PORTFOLIO-AGGREGATIONS-*.json` | Pre-computed summaries |
| `output/multi-score-analysis-LATEST.json` | Scored analysis (17,040 patents) |
| `output/broadcom-portfolio-2026-01-15.json` | Raw USPTO data (22,589 patents) |

### Config Files
| File | Description |
|------|-------------|
| `config/super-sectors.json` | 13 super-sectors with 114 sector mappings |
| `config/competitors.json` | 131 competitor companies with patterns |
| `config/portfolio-affiliates.json` | Affiliate company normalization |

### Scripts
| Script | Purpose |
|--------|---------|
| `scripts/merge-portfolio-for-attorney.ts` | Generate attorney CSV with full portfolio |
| `scripts/calculate-and-export-v3.ts` | Generate V3 top-rated spreadsheets |

### VBA Macros
| File | Purpose |
|------|---------|
| `excel/AttorneyPortfolioMacros.bas` | Attorney portfolio with 5 questions |
| `excel/PatentAnalysisMacros.bas` | V3 top-rated analysis |
| `excel/PatentAnalysisMacros-V2.bas` | V2 analysis (full scoring) |
| `excel/WithinSectorMacros.bas` | Within-sector analysis |

---

## Commands Quick Reference

```bash
# Regenerate attorney portfolio (full 22K)
npx tsx scripts/merge-portfolio-for-attorney.ts

# Regenerate V3 top-rated export
npx tsx scripts/calculate-and-export-v3.ts

# Check claim breadth distribution
python3 -c "
import csv
with open('output/ATTORNEY-PORTFOLIO-LATEST.csv') as f:
    reader = csv.DictReader(f)
    scores = {}
    for row in reader:
        cb = row.get('claim_breadth', '')
        if cb and cb.strip():
            try:
                scores[int(float(cb))] = scores.get(int(float(cb)), 0) + 1
            except: pass
    for s, c in sorted(scores.items()): print(f'{s}: {c}')
"

# Count patents by super-sector
python3 -c "
import csv
with open('output/ATTORNEY-PORTFOLIO-LATEST.csv') as f:
    sectors = {}
    for row in csv.DictReader(f):
        s = row.get('super_sector') or 'unassigned'
        sectors[s] = sectors.get(s, 0) + 1
    for s, c in sorted(sectors.items(), key=lambda x: -x[1]):
        print(f'{s}: {c}')
"
```

---

## Session History

| Date | Key Activity |
|------|--------------|
| 2026-01-21 | Planning heat map vendor batches, updated strategy guide |
| 2026-01-20 | Full portfolio merge (22,589), Attorney Questions worksheet, CPC fix |
| 2026-01-20 | Completed 16 sector breakouts, summary tabs |
| 2026-01-19 | VMware/affiliate merge complete (17,040 patents) |
| 2026-01-18 | Initial CPC-based sector assignment |
| 2026-01-15 | Multi-score analysis framework |

---

## Vendor Integration Roadmap

### Phase 1: Heat Map Vendor (Current Focus)
- **Cost Model**: $25 per patent × 20 products
- **Batch Size**: 25 patents per submission
- **Test Run**: 10 batches (250 patents, ~$6,250)
- **Output**: Product matches, market segments, potential infringers

### Phase 2: Claim Chart Vendor (Future)
- **Cost Model**: Token-based (LLM/compute usage)
- **Input**: Multiple patents grouped by target competitor
- **Output**: Claim charts mapping patents to products
- **Strategy**: Use heat map data to select patents + competitors for claim charts

### Data Flow
```
Our Portfolio → Heat Map Vendor → Product Matches → Competitor Analysis
                                         ↓
                          Claim Chart Vendor → Litigation Packages
                                         ↓
                               Attorney Review → Assertion
```

---

*Last Updated: 2026-01-21*
