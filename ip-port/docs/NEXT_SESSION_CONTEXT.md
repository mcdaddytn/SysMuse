# Patent Portfolio Analysis - Session Context (2026-01-21)

## Current State Summary

| Metric | Value |
|--------|-------|
| Total Patents (Full Portfolio) | 29,470 |
| With Citation Analysis | 17,040 |
| With Competitor Citations | 7,677 |
| With LLM Analysis | 2,669 |
| Unique Sectors | 41 |
| Super-Sectors | 10 |

### Affiliate Breakdown
| Affiliate | Total | Active | With Citations |
|-----------|-------|--------|----------------|
| Broadcom | 11,086 | 10,038 | 3,139 |
| VMware | 5,386 | 5,386 | 1,741 |
| LSI Corporation | 3,714 | 607 | 472 |
| Symantec Enterprise | 3,584 | 3,503 | 1,171 |
| Avago Technologies | 2,918 | 2,917 | 301 |
| CA Technologies | 1,400 | 1,394 | 315 |
| Nicira (VMware SDN) | 1,028 | 1,028 | 370 |
| Other affiliates | 354 | 352 | 168 |

## Recent Accomplishments (2026-01-21)

### VMware Patent Integration Fix

Fixed missing VMware patents in batch generation and portfolio exports:

**Issue Discovered:**
- VMware patents (6,414) were missing from heatmap batches despite being dominant in TopRated rankings (327 of top 500)
- Root cause: VMware patents stored in separate `vmware-patents-2026-01-19.json`, not merged into `broadcom-portfolio`
- Additionally, VMware patents had citation data but no pre-calculated `overallActionableScore`

**Fixes Applied:**
1. **`merge-portfolio-for-attorney.ts`**: Now includes patents from multi-score-analysis not in broadcom-portfolio
   - Added VMware date handling (uses `grant_date` instead of `date`)
   - Portfolio now includes 29,470 patents (was 22,589)

2. **`generate-heatmap-batches.ts`**: Added runtime score calculation for patents without pre-calculated scores
   - Uses `calculateSimpleScore()`: citation component (0-60 pts) + years component (0-40 pts)
   - 2,111 VMware patents got calculated scores, 978 eligible for batches

**Results:**
- 31 VMware/Nicira patents now in batches (12.6% of 246 total)
- Top VMware patents: 10749870 (score=85.6), 10333975 (score=82.4), 10326841 (score=82.1)
- VMware well-represented in VIRTUALIZATION and SDN_NETWORK sector diversity batches

### Sector Reference Data Enhancement

Added comprehensive sector reference data to support heat map analysis:

**New Reference Data Files:**
| File | Description |
|------|-------------|
| `SECTOR-MAPPING-LATEST.csv` | 41 sectors mapped to 10 super-sectors with stats |
| `SUPER-SECTOR-SUMMARY-LATEST.csv` | Super-sector overview (patents, top 100/250 representation) |
| `CPC-REFERENCE-LATEST.csv` | 171 CPC code descriptions |
| `CPC-SECTOR-OVERLAP-LATEST.csv` | Top 100 CPC codes mapped to sectors/super-sectors |
| `TOP15-SECTOR-COMPARISON-LATEST.csv` | Top 15 per sector vs overall ranking |

**New VBA Macro:**
- `ImportSectorReferenceData()` in `WithinSectorMacros.bas` imports all reference worksheets

**Config Updates:**
- Updated `super-sectors.json` to v3.0 with actual sector names from `sector-breakout-v2.json`
- Created `cpc-descriptions.json` with 171 CPC code descriptions

**Usage:**
```bash
# Generate reference data
npx tsx scripts/generate-sector-reference-data.ts

# In Excel (after copying CSVs to workbook folder):
# Run macro: ImportSectorReferenceData()
```

### Heat Map Batch Generation v2 Complete

Generated 10 batches of patents (248 total, 2 duplicates removed) for vendor submission using new dual-purpose strategy:
1. **Evaluate vendor quality** - Do heat maps provide actionable product matches?
2. **Validate our scoring methodology** - Do top-ranked patents correlate with better heat map results?

**Key Results:**
| Metric | v1 (Sequential) | v2 (Interleaved) |
|--------|-----------------|------------------|
| SECURITY % | 66.4% | 48.0% |
| Super-sectors represented | 8 | 11 (all) |
| Strategy comparison | None | Parallel (2 batches/day) |

### New Batch Strategy: Interleaved with Sampling

**Batch Pattern (alternating for parallel comparison):**
- Batches 1, 3, 5: **High-Value Sampled** - Round-robin from top 100 across sectors
- Batches 2, 4, 6, 7: **Sector Diversity** - Top performers from each non-SECURITY super-sector
- Batches 8, 9, 10: **Strategic Fill** - Remaining high-scoring patents

**High-Value Sampled (3 batches):**
- Pool of top 100 patents distributed via round-robin by sector
- Ensures sector diversity even within highest-ranked patents
- Tracks `pool_rank` to validate if rank 1-25 performs better than 75-100

**Sector Diversity (4 batches):**
- Excludes SECURITY entirely (already 48% of high-value batches)
- Targets all 10 non-SECURITY super-sectors with quotas
- Sample from top 500 (not just top of each sector)

### New Scripts Created

| Script | Purpose |
|--------|---------|
| `scripts/generate-heatmap-batches.ts` | Generate batches from config with multiple strategies |
| `scripts/generate-batch-summary.ts` | Create comprehensive strategy document with per-batch analysis |

**Usage:**
```bash
# Generate batches (outputs JSON + CSVs)
npx tsx scripts/generate-heatmap-batches.ts [--dry-run] [--config path]

# Generate strategy summary document
npx tsx scripts/generate-batch-summary.ts
```

### New Configuration

Created `config/heatmap-batch-config.json` (v2.0) with:
- Interleaved pattern support
- High-value sampling parameters (poolSize, sectorSpread)
- Sector diversity quotas by super-sector
- SECURITY exclusion toggle

### Output Files Generated

| File | Description |
|------|-------------|
| `output/heatmap-batches-LATEST.json` | Full batch data with metadata and pool_rank |
| `output/HEATMAP-BATCH-001.csv` - `010.csv` | Individual batch CSVs for vendor |
| `output/HEATMAP-BATCH-STRATEGY-LATEST.md` | Comprehensive strategy document |
| `output/HEATMAP-BATCH-STRATEGY-2026-01-21.md` | Dated backup |

---

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

## Next Session: Heat Map Vendor Execution

### Immediate Next Steps

1. **Submit first batches to vendor**
   - Start with Batch 001 (High-Value Sampled) and Batch 002 (Sector Diversity)
   - Send 2 batches per day for parallel strategy comparison
   - Track turnaround time and quality

2. **Design feedback loop**
   - Schema for capturing heat map results
   - How to incorporate product data into future batch selection
   - Track which sectors yield best product matches
   - Compare high-value vs sector-diversity batch results

3. **Analyze results by pool_rank**
   - Do patents ranked 1-25 yield better heat maps than 75-100?
   - Use to validate/refine our scoring methodology

### Queued Improvements

| Improvement | Priority | Notes |
|-------------|----------|-------|
| Add `super_sector` column to TopRated rankings worksheet | Medium | User requested during batch analysis |
| Add CPC description column to TopRated rankings | Medium | Show human-readable CPC names instead of codes |
| Add `super_sector` column to ATTORNEY-PORTFOLIO CSV | Low | For attorney review worksheets |
| Claim breadth correlation with heat map quality | Low | Analyze after receiving vendor results |

**Note**: Sector reference data now available in sector workbook via `ImportSectorReferenceData()` macro. This provides sector-to-super-sector mapping, CPC descriptions, and CPC-to-sector overlap analysis as separate worksheets.

### Current Batch Distribution (v2)

| Super-Sector | Patents | % |
|--------------|---------|---|
| SECURITY | 119 | 48.0% |
| WIRELESS | 30 | 12.1% |
| SDN_NETWORK | 24 | 9.7% |
| VIRTUALIZATION | 19 | 7.7% |
| VIDEO_STREAMING | 17 | 6.9% |
| COMPUTING | 13 | 5.2% |
| FAULT_TOLERANCE | 13 | 5.2% |
| IMAGING | 6 | 2.4% |
| AI_ML | 4 | 1.6% |
| SEMICONDUCTOR | 2 | 0.8% |
| AUDIO | 1 | 0.4% |
| **Total** | **248** | **100%** |

---

## Key Files

### Data Files
| File | Description |
|------|-------------|
| `output/ATTORNEY-PORTFOLIO-LATEST.csv` | Full portfolio (29,470 patents) |
| `output/ATTORNEY-PORTFOLIO-AGGREGATIONS-*.json` | Pre-computed summaries |
| `output/multi-score-analysis-LATEST.json` | Scored analysis (17,040 patents) |
| `output/broadcom-portfolio-2026-01-15.json` | Raw USPTO data (22,589 patents) |
| `output/SECTOR-MAPPING-LATEST.csv` | Sector to super-sector mapping with stats |
| `output/SUPER-SECTOR-SUMMARY-LATEST.csv` | Super-sector overview with metrics |
| `output/CPC-REFERENCE-LATEST.csv` | CPC code descriptions |
| `output/CPC-SECTOR-OVERLAP-LATEST.csv` | CPC to sector/super-sector mapping |
| `output/TOP15-SECTOR-COMPARISON-LATEST.csv` | Top 15 per sector vs overall ranking |

### Config Files
| File | Description |
|------|-------------|
| `config/super-sectors.json` | 10 super-sectors with 41 sector mappings (v3.0) |
| `config/sector-breakout-v2.json` | 41 detailed sectors with CPC patterns |
| `config/cpc-descriptions.json` | CPC code descriptions (171 codes) |
| `config/competitors.json` | 131 competitor companies with patterns |
| `config/portfolio-affiliates.json` | Affiliate company normalization |
| `config/heatmap-batch-config.json` | Heat map batch generation settings (v2.0) |

### Scripts
| Script | Purpose |
|--------|---------|
| `scripts/merge-portfolio-for-attorney.ts` | Generate attorney CSV with full portfolio |
| `scripts/generate-sector-reference-data.ts` | Generate sector reference CSVs for Excel |
| `scripts/calculate-and-export-v3.ts` | Generate V3 top-rated spreadsheets |
| `scripts/generate-heatmap-batches.ts` | Generate heat map vendor batches |
| `scripts/generate-batch-summary.ts` | Generate batch strategy summary document |

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
| 2026-01-21 | VMware patent integration fix: 31 VMware patents now in batches, portfolio expanded to 29,470 |
| 2026-01-21 | Heat map batch generation v2: interleaved strategy, 246 patents, SECURITY reduced to 48% |
| 2026-01-21 | Created `generate-heatmap-batches.ts`, `generate-batch-summary.ts`, batch config |
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

*Last Updated: 2026-01-21 (VMware Integration Fix)*
