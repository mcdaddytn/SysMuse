# Next Steps: Competitor Expansion Implementation

## Current Status (2026-01-17)

### Completed
- [x] Created configurable competitor list (`config/competitors.json`)
- [x] Created competitor config service (`services/competitor-config.ts`)
- [x] Created citation mining script (`scripts/mine-all-citations.ts`)
- [x] Ran citation mining on 200 top patents (6,845 citations, 605 unique assignees)
- [x] Added 12 new validated competitors based on mining results
- [x] Updated citation-overlap scripts to use config file

### Current Competitor Count
- **61 companies** across 11 categories (82 patterns)
- Up from 23 original streaming-focused competitors

### New Competitors Added (Citation-Validated)
| Company | Category | Citations Found | Broadcom Patents Cited |
|---------|----------|-----------------|------------------------|
| IBM | enterprise | 226 | 74 |
| Forcepoint | cybersecurity | 149 | 8 |
| Palantir | enterprise | 104 | 3 |
| Darktrace | cybersecurity | 81 | 2 |
| Dropbox | enterprise | 59 | 4 |
| McAfee | cybersecurity | 49 | 18 |
| Sophos | cybersecurity | 33 | 7 |
| Samsung | telecom | 21 | 12 |
| Citrix | enterprise | 19 | 13 |
| Red Hat | enterprise | 16 | 9 |
| FireEye | cybersecurity | 15 | 4 |
| Huawei | telecom | 11 | 9 |

---

## NOT YET DONE - Competitor Portfolio Data

**We have NOT downloaded patent portfolios for the new competitors.**

Current state:
- `output/competitor-portfolios/` directory does NOT exist
- Only have Broadcom portfolio data (`output/broadcom-portfolio-2026-01-15.json`)
- Existing download script (`examples/download-competitor-portfolios.ts`) has hardcoded competitor list

---

## Next Session Tasks

### Task 1: Update Portfolio Download Script

Update `examples/download-competitor-portfolios.ts` to use the new competitor config:

```typescript
// Instead of hardcoded COMPETITORS array, load from config:
import { CompetitorMatcher } from '../services/competitor-config.js';

const matcher = new CompetitorMatcher();
const companies = matcher.getAllCompanyNames();
```

Also need to create assignee variant mappings for new companies:
- IBM: "International Business Machines Corporation", "IBM Corporation"
- McAfee: "McAfee, LLC", "McAfee Corp"
- Darktrace: "Darktrace Holdings Limited", "Darktrace PLC"
- etc.

### Task 2: Download New Competitor Portfolios

Run portfolio downloads for the 12 new competitors:

```bash
# Create output directory
mkdir -p output/competitor-portfolios

# Download each new competitor's portfolio
npx tsx examples/download-competitor-portfolios.ts --competitor IBM
npx tsx examples/download-competitor-portfolios.ts --competitor McAfee
# ... etc

# Or run all overnight
nohup npx tsx examples/download-competitor-portfolios.ts > competitor-download.log 2>&1 &
```

**Estimated time**: 2-4 hours for all new competitors (rate limited)

### Task 3: Re-run Citation Overlap Analysis

With the expanded competitor list, re-run citation overlap on ALL batches:

```bash
# This will now detect citations from 61 competitors instead of 23
npx tsx examples/citation-overlap-batch.ts 0 500
npx tsx examples/citation-overlap-batch.ts 500 1000
# ... continue through all batches
```

**Expected result**: Significantly more patents with competitor citations identified.

### Task 4: Run CPC Technology Overlap

Analyze technology overlap between Broadcom and new competitors:

```bash
npx tsx examples/cpc-overlap-analysis.ts
```

This identifies:
- Which technology areas (CPC codes) overlap with each competitor
- Potential infringement areas by technology category

### Task 5: Update Multi-Score Analysis

Re-run the multi-score analysis to incorporate new competitor data:

```bash
npx tsx examples/multi-score-analysis.ts
```

### Task 6: Run LLM v2 Analysis on New Candidates

Any new patents surfaced by expanded competitor overlap should get v2 LLM analysis:

```bash
npx tsx services/llm-patent-analysis-v2.ts analyze-file <new-overlap-file.json>
```

### Task 7: Generate Updated Reports

Create new combined rankings and CSV exports:

```bash
npx tsx services/combine-results.ts
npx tsx examples/export-priority-csvs.ts
```

---

## Suggested Execution Order

```
┌─────────────────────────────────────────────────────────────┐
│  Phase 1: Portfolio Download (2-4 hours, can run overnight) │
├─────────────────────────────────────────────────────────────┤
│  1. Update download script to use competitor config         │
│  2. Add assignee variants for new companies                 │
│  3. Run portfolio downloads for 12 new competitors          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 2: Re-run Overlap Analysis (4-6 hours)               │
├─────────────────────────────────────────────────────────────┤
│  1. Re-run citation overlap on all batches (0-4000)         │
│  2. Run CPC overlap analysis                                │
│  3. Run multi-score analysis                                │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 3: LLM Analysis & Reporting (2-3 hours)              │
├─────────────────────────────────────────────────────────────┤
│  1. Identify new high-value patents from expanded overlap   │
│  2. Run LLM v2 analysis on new candidates                   │
│  3. Generate updated rankings and CSVs                      │
│  4. Update top-250 actionable list                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Files Reference

### Configuration
| File | Purpose |
|------|---------|
| `config/competitors.json` | Master competitor list (61 companies) |
| `services/competitor-config.ts` | Config loader and pattern matcher |

### Scripts to Run
| Script | Purpose |
|--------|---------|
| `examples/download-competitor-portfolios.ts` | Download competitor patent portfolios |
| `examples/citation-overlap-batch.ts` | Run citation overlap analysis |
| `examples/cpc-overlap-analysis.ts` | Technology area overlap |
| `examples/multi-score-analysis.ts` | Combined scoring |
| `services/llm-patent-analysis-v2.ts` | LLM qualitative analysis |
| `services/combine-results.ts` | Merge all results |

### Output Files (Will Be Created)
| File | Purpose |
|------|---------|
| `output/competitor-portfolios/*.json` | Downloaded competitor portfolios |
| `output/citation-overlap-expanded-*.json` | New overlap results with 61 competitors |
| `output/cpc-overlap-expanded-*.json` | Technology overlap |
| `output/combined-rankings-expanded-*.csv` | Updated rankings |

---

## Key Metrics to Track

After running expanded analysis, compare:

| Metric | Before (23 competitors) | After (61 competitors) |
|--------|-------------------------|------------------------|
| Patents with competitor citations | ~700 | TBD |
| Total competitor citations | ~4,000 | TBD |
| Technology sectors covered | 2 | 11 |
| Actionable candidates | 250 | TBD (target: 400+) |

---

## Questions for Next Session

1. Should we download ALL competitor portfolios or prioritize high-citation ones first?
2. Do we want to run analysis in parallel (multiple batches) or sequential?
3. Should we update the strategy document with mining findings before or after full analysis?

---

*Document created: 2026-01-17*
*Next session: Execute competitor portfolio downloads and re-run analyses*
