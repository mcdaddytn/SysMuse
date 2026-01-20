# Patent Portfolio Analysis - Session Context (2026-01-20)

## Current State Summary

| Metric | Value |
|--------|-------|
| Total Patents | 17,040 |
| Unique Sectors | 114 |
| Super-Sectors | 13 |
| Large Sectors (>500) | 1 (vmh-placement: 689) |
| Good Sectors (50-500) | 76 |
| Small Sectors (<50) | 37 |

## Recent Accomplishments (This Session)

### Sector Breakout Complete
Broke out 16 large sectors into 114 granular sub-sectors:

| Original Sector | Patents | Sub-Sectors |
|-----------------|---------|-------------|
| network-security | 5,255 | 7 |
| computing | 3,179 | 8 |
| wireless | 2,024 | 11 |
| video-image | 1,767 | 7 |
| signal-processing | 1,467 | 8 |
| virtualization | 1,402 | 7 |
| network-auth | 1,373 | 7 |
| sdn-networking | 1,266 | 7 |
| cloud-orchestration | 1,220 | 6 |
| network-protocols | 1,010 | 7 |
| network-infrastructure | 955 | 6 |
| vm-hypervisor | 871 | 4 |
| system-security | 788 | 8 |
| video-streaming | 616 | 5 |
| fault-tolerance | 586 | 7 |
| cloud-config | 562 | 9 |

### Updated Config Files
- `config/super-sectors.json` - Updated with all 114 sectors mapped to 13 super-sectors
- `output/patent-sector-assignments.json` - All 17,040 patents assigned to sectors

---

## Completed This Session

### Data Merging Complete
- LLM analyses merged into multi-score-analysis (2,289 patents)
- Sector/super-sector assignments merged (17,040 patents)
- Scripts: `npm run merge:llm`, `npm run merge:sectors`, `npm run merge:all`

### Summary Tabs Added
The export script now generates 4 summary CSV files alongside the main TOPRATED export:
- **SUMMARY-SUPERSECTOR** - Aggregation by 13 super-sectors
- **SUMMARY-SECTOR** - Aggregation by 114 sectors
- **SUMMARY-COMPETITOR** - Top 50 competitors citing our patents
- **SUMMARY-AFFILIATE** - Breakdown by portfolio company

### Generated Files (2026-01-20)
```
output/
├── TOPRATED-2026-01-20.csv         # Main top 500 patents
├── TOPRATED-LATEST.csv             # Symlink to latest
├── SUMMARY-SUPERSECTOR-2026-01-20.csv
├── SUMMARY-SECTOR-2026-01-20.csv
├── SUMMARY-COMPETITOR-2026-01-20.csv
├── SUMMARY-AFFILIATE-2026-01-20.csv
├── all-patents-scored-v3-2026-01-20.csv
└── unified-topRated-v3-2026-01-20.json
```

### Regenerate Spreadsheets
```bash
npm run topRated:v3
```

---

## Super-Sector Hierarchy

| Super-Sector | Display Name | Patent Count* | Sectors |
|--------------|--------------|---------------|---------|
| SECURITY | Security | ~2,600 | 17 |
| VIRTUALIZATION | Virtualization & Cloud | ~2,800 | 26 |
| SDN_NETWORK | SDN & Network Infrastructure | ~2,600 | 21 |
| WIRELESS | Wireless & RF | ~2,400 | 17 |
| VIDEO_STREAMING | Video & Streaming | ~1,300 | 10 |
| COMPUTING | Computing & Systems | ~1,700 | 6 |
| FAULT_TOLERANCE | Fault Tolerance | ~900 | 8 |
| STORAGE | Storage | ~240 | 1 |
| IMAGING | Imaging & Optics | ~290 | 4 |
| SEMICONDUCTOR | Semiconductor | ~340 | 1 |
| AI_ML | AI & ML | ~56 | 1 |
| AUDIO | Audio | ~23 | 1 |
| OTHER | Other | ~34 | 1 |

*Approximate - run aggregation script for exact counts

---

## Key Files

### Data Files
| File | Description |
|------|-------------|
| `output/patent-sector-assignments.json` | Sector assignments for all 17,040 patents |
| `output/multi-score-analysis-LATEST.json` | Main scored analysis (needs LLM merge) |
| `output/llm-analysis-v3/combined-v3-2026-01-20.json` | LLM analyses (2,329 patents) |
| `output/vmware-llm-analysis/combined-vmware-llm-2026-01-20.json` | VMware LLM analyses (2,162 patents) |

### Config Files
| File | Description |
|------|-------------|
| `config/super-sectors.json` | 13 super-sectors with 114 sector mappings |
| `config/sector-damages.json` | Damages tiers by sector |
| `config/portfolio-affiliates.json` | Affiliate company normalization |
| `config/broadcom-assignees.json` | Portfolio company assignees |

### Scripts
| Script | Purpose |
|--------|---------|
| `scripts/calculate-and-export-v3.ts` | Main spreadsheet generation |
| `scripts/assign-cpc-sectors.ts` | Sector assignment from CPC codes |
| `scripts/breakout-*.ts` | Individual sector breakout scripts |

---

## Spreadsheet Tabs (Planned)

### Top Rated Tab (Main)
- Top 500 patents by composite score
- All scoring columns (LLM, citation, stakeholder profiles)
- Sector and super-sector assignments

### Summary Tabs
1. **By Super-Sector** - 13 rows, aggregate metrics
2. **By Sector** - 114 rows, detailed breakdown
3. **By Competitor** - Patents citing by competitor
4. **By Affiliate** - Patents by portfolio company

### Supporting Tabs
- Scoring methodology
- Sector definitions
- Data dictionary

---

## Commands Quick Reference

```bash
# Regenerate sector assignments (if needed)
npx tsx scripts/assign-cpc-sectors.ts

# Generate main export
npx tsx scripts/calculate-and-export-v3.ts

# Check sector distribution
cat output/patent-sector-assignments.json | jq 'to_entries | map(.value.sector) | group_by(.) | map({sector: .[0], count: length}) | sort_by(-.count) | .[0:20]'

# Count patents by super-sector (after aggregation)
npx tsx scripts/aggregate-by-super-sector.ts
```

---

## Session History

| Date | Key Activity |
|------|--------------|
| 2026-01-20 | Completed 16 sector breakouts, updated super-sectors config |
| 2026-01-20 | VMware/affiliate merge complete (17,040 patents) |
| 2026-01-19 | VMware citation analysis, LLM follower overnight |
| 2026-01-18 | Initial CPC-based sector assignment |
| 2026-01-15 | Multi-score analysis framework |
