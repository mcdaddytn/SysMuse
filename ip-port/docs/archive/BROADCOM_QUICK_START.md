# Broadcom Portfolio Builder - Quick Start

## What This Does

Builds a **complete patent portfolio** for Broadcom Inc., including all patents from:
- Broadcom Inc. (original + post-Avago)
- Avago Technologies
- LSI Corporation
- Brocade Communications
- CA Technologies
- Symantec Corporation
- VMware

Expected output: **~50,000+ patents** with full analysis.

## Prerequisites

1. **API Keys** (from main setup):
   - `PATENTSVIEW_API_KEY` ✓
   - `USPTO_ODP_API_KEY` (optional, for IPR analysis)

2. **Dependencies installed**:
   ```bash
   npm install
   ```

## Quick Run

```bash
# Full portfolio build (30-60 minutes)
npm run example:broadcom
```

This will:
1. Search PatentsView for all Broadcom-related assignees
2. Download complete patent metadata
3. Analyze by acquisition entity
4. Categorize by technology area
5. Check for IPR challenges (sample)
6. Generate reports and export data

## What You Get

### Console Output
```
═══════════════════════════════════════════════════════════════
           BROADCOM PATENT PORTFOLIO ANALYSIS REPORT           
═══════════════════════════════════════════════════════════════

Generated: 1/14/2026, 3:45:23 PM
Configuration: Broadcom Complete Portfolio

─────────────────────────────────────────────────────────────
  PORTFOLIO SUMMARY
─────────────────────────────────────────────────────────────

Total Patents: 52,347
Date Range: 1980-03-15 to 2026-01-10

─────────────────────────────────────────────────────────────
  BREAKDOWN BY ACQUISITION
─────────────────────────────────────────────────────────────

Broadcom Inc.                      15,234 (29.1%)
Avago Technologies                 12,876 (24.6%)
LSI Corporation                     8,543 (16.3%)
VMware                              6,721 (12.8%)
Brocade Communications              4,231 (8.1%)
CA Technologies                     2,987 (5.7%)
Symantec Corporation                1,755 (3.4%)

─────────────────────────────────────────────────────────────
  TOP TECHNOLOGY AREAS (CPC)
─────────────────────────────────────────────────────────────

H04 - Electric Communication       18,234 (34.8%)
G06 - Computing; Calculating       12,456 (23.8%)
H01 - Basic Electric Elements       9,876 (18.9%)
G11 - Information Storage           5,432 (10.4%)
```

### Files Generated

**In `./output/` directory:**

1. **`broadcom-portfolio-YYYY-MM-DD.json`**
   - Complete dataset with all metadata
   - Full analysis results
   - IPR challenge data
   - Ready for further processing

2. **`broadcom-patents-YYYY-MM-DD.csv`**
   - Spreadsheet-friendly format
   - Patent number, title, date, assignee, CPC
   - Easy to filter and sort
   - Import into Excel/Google Sheets

## Configuration

The search uses **`config/broadcom-assignees.json`**:

```json
{
  "portfolio": "Broadcom Complete Portfolio",
  "assignees": [
    {
      "entity": "Broadcom Inc.",
      "variants": [
        "Broadcom Inc.",
        "Broadcom Corporation",
        "Broadcom Corp."
      ]
    },
    // ... more entities
  ]
}
```

**To modify:**
- Edit `config/broadcom-assignees.json`
- Add/remove entities or name variants
- Adjust search parameters

## Customization

### Search Subset of Entities

Edit the config file to include only specific entities:

```json
{
  "assignees": [
    {
      "entity": "VMware",
      "variants": ["VMware, Inc.", "VMware, LLC"]
    }
  ]
}
```

### Adjust Time Range

In `broadcom-portfolio-builder.ts`, modify the query:

```typescript
const query = {
  _and: [
    {
      _or: allVariants.map(variant => ({
        'assignees.assignee_organization': variant
      }))
    },
    { _gte: { patent_date: '2020-01-01' } }  // Add date filter
  ]
};
```

### Change IPR Sample Size

Default checks 50 patents. To check more:

```typescript
// In main() function
const challenges = await checkIPRChallenges(patents, 200); // Check 200 instead
```

## Performance

| Phase | Time | API Calls |
|-------|------|-----------|
| Patent Discovery | ~30 min | ~50-100 |
| Portfolio Analysis | ~1 min | 0 (local) |
| IPR Check (50 patents) | ~1 min | ~50 |
| **Total** | **~35 min** | **~150** |

**Note**: All within free API rate limits.

## Expected Results

For complete Broadcom portfolio:
- **Total Patents**: 50,000-55,000
- **Oldest Patent**: Early 1980s
- **Newest Patents**: Current month
- **Top Technologies**: Networking, semiconductors, storage
- **VMware Patents**: 6,000-8,000 (largest recent addition)

## Use Cases

### 1. Litigation Preparation
- Identify relevant patents by technology
- Check for existing IPR challenges
- Analyze prosecution history of key patents

### 2. Patent Portfolio Valuation
- Count patents by acquisition
- Identify high-citation patents
- Assess technology coverage

### 3. Competitive Intelligence
- Compare Broadcom vs competitor portfolios
- Track recent innovation areas
- Monitor acquisition integration

### 4. Due Diligence
- Verify patent counts match public claims
- Identify potential risk areas
- Check assignment records

## Troubleshooting

**"No patents found"**
→ Check API key is set in .env
→ Verify config file exists at `config/broadcom-assignees.json`

**"API rate limit exceeded"**
→ Script has built-in rate limiting
→ If error persists, increase delays in code

**"Out of memory"**
→ Node.js default heap may be too small
→ Run with: `node --max-old-space-size=4096 ...`

**"File not found: config/broadcom-assignees.json"**
→ Ensure you're running from project root
→ Check file exists in `config/` directory

## Next Steps

1. **Run the full build** to get baseline portfolio
2. **Export to database** for ongoing tracking
3. **Set up monthly updates** to capture new patents
4. **Deep dive into specific patents** using File Wrapper API
5. **Monitor IPR challenges** using PTAB API

## Integration with Existing Tools

### Export to Excel
```bash
# CSV file can be opened directly in Excel
open output/broadcom-patents-YYYY-MM-DD.csv
```

### Import to Database
```typescript
import { patents } from './output/broadcom-portfolio-YYYY-MM-DD.json';

// Insert into your database
await db.patents.insertMany(patents);
```

### Feed to Analysis Pipeline
```typescript
import { buildPatentList, analyzePortfolio } from './examples/broadcom-portfolio-builder.js';

const patents = await buildPatentList();
const analysis = analyzePortfolio(patents);

// Send to your analysis tools
await yourAnalysisTool.process(analysis);
```

## Template for Other Companies

To adapt for another company:

1. Copy `config/broadcom-assignees.json` → `config/yourcompany-assignees.json`
2. Update assignee names and variants
3. Copy `examples/broadcom-portfolio-builder.ts` → `examples/yourcompany-builder.ts`
4. Update config file reference
5. Run: `npx ts-node --esm examples/yourcompany-builder.ts`

**Example entities to track:**
- Intel + Altera + Mobileye + Habana Labs
- Qualcomm + NXP Semiconductors
- AMD + Xilinx + ATI Technologies
- NVIDIA + Mellanox + ARM (pending)

---

This case study demonstrates production-ready code for building comprehensive patent portfolios for companies with complex M&A histories.
