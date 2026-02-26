# Excel Workbook Guide for Patent Portfolio Analysis

This guide explains how to set up macro-enabled Excel workbooks (.xlsm) to analyze patent data with configurable user weights, enabling iterative refinement of scoring strategies without code changes.

---

## Overview: Macro-Enabled Workbook System

### Worksheets Generated

| Worksheet | Purpose | Updates |
|-----------|---------|---------|
| **RawData** | Imported patent metrics from CSV | On import |
| **UserWeights** | User weight profiles + relative weights | Manual editing |
| **Score_Aggressive** | Top N patents scored with aggressive weights | Auto (formulas) |
| **Score_Moderate** | Top N patents scored with moderate weights | Auto (formulas) |
| **Score_Conservative** | Top N patents scored with conservative weights | Auto (formulas) |
| **Score_Combined** | Top N with weighted average of all users | Auto (formulas) |

### User Profiles

| Profile | Strategy | Emphasis |
|---------|----------|----------|
| **Aggressive** | Litigation-focused, seeking larger wins | Enforcement clarity, competitor citations |
| **Moderate** | Balanced licensing and portfolio management | Even distribution across all metrics |
| **Conservative** | Defensive, cross-licensing leverage | Validity, claim breadth, design-around difficulty |

### Key Features

- **Live Dynamic Updates**: Change weights in UserWeights sheet, scores update automatically
- **Multiple User Views**: Each user profile has its own scored worksheet
- **Combined Consensus View**: Weighted average across all user profiles
- **Relative User Weights**: Adjust influence of each user type on combined score
- **Macro-Driven Setup**: Run macro to import data and generate all worksheets

---

## Quick Start

### 1. Create New Macro-Enabled Workbook

```
1. Open Excel
2. File -> New -> Blank Workbook
3. File -> Save As -> PatentAnalysis.xlsm (Excel Macro-Enabled Workbook)
```

### 2. Import VBA Module

```
1. Press Alt+F11 to open VBA Editor
2. File -> Import File
3. Select: excel/PatentAnalysisMacros.bas
4. Close VBA Editor (Alt+Q)
```

### 3. Run Import Macro

```
1. Press Alt+F8 to open Macro dialog
2. Select: ImportAllData
3. Click Run
```

The macro will:
- Import the CSV data to RawData sheet
- Create UserWeights sheet with default profiles
- Generate all 4 scoring worksheets
- Sort by score and assign ranks

### 4. Manipulate Weights

Edit cells in UserWeights sheet:
- **Rows 4-11**: Metric weights per user profile
- **Rows 18-20**: Relative weights between user profiles

All scoring sheets update automatically.

---

## Files Reference

| File | Location | Purpose |
|------|----------|---------|
| `PatentAnalysisMacros.bas` | `excel/` | VBA module to import |
| `user-weight-profiles.json` | `config/` | Seed data for weights (DB sync) |
| `patents-raw-metrics-*.csv` | `output/` | CSV to import |

---

---

## Workbook 1: Analysis Workbook Setup

### Step 1: Create Weight Configuration Sheet

Create a sheet named `Config` with the following structure:

| Row | A | B | C | D | E | F |
|-----|---|---|---|---|---|---|
| 1 | **Metric** | **Default** | **Litigation** | **Licensing** | **Defensive** | **Quick Wins** |
| 2 | competitor_citations | 0.25 | 0.15 | 0.30 | 0.35 | 0.20 |
| 3 | forward_citations | 0.10 | 0.05 | 0.10 | 0.20 | 0.00 |
| 4 | years_remaining | 0.15 | 0.15 | 0.20 | 0.00 | 0.15 |
| 5 | eligibility_score | 0.15 | 0.20 | 0.10 | 0.00 | 0.20 |
| 6 | validity_score | 0.15 | 0.20 | 0.10 | 0.00 | 0.20 |
| 7 | claim_breadth | 0.10 | 0.10 | 0.15 | 0.25 | 0.00 |
| 8 | enforcement_clarity | 0.10 | 0.15 | 0.05 | 0.20 | 0.25 |
| 9 | **Total** | =SUM(B2:B8) | =SUM(C2:C8) | =SUM(D2:D8) | =SUM(E2:E8) | =SUM(F2:F8) |

**Named Ranges (recommended):**
```
W_COMPETITOR = Config!$B$2
W_FORWARD = Config!$B$3
W_YEARS = Config!$B$4
W_ELIGIBILITY = Config!$B$5
W_VALIDITY = Config!$B$6
W_BREADTH = Config!$B$7
W_ENFORCEMENT = Config!$B$8
```

### Step 2: Create Data Import Sheet

Create a sheet named `PatentData` and import the Raw Metrics CSV.

**Expected Columns After Import:**

| Col | Field | Description |
|-----|-------|-------------|
| A | patent_id | USPTO patent number |
| B | title | Patent title |
| C | grant_date | Date granted |
| D | assignee | Patent owner |
| E | years_remaining | Years until expiration |
| F | forward_citations | Total citations received |
| G | competitor_citations | Citations from competitors |
| H | competitors_citing | List of citing competitors |
| I | sector | Emergent technology sector |
| J | cpc_codes | CPC classification codes |
| K | eligibility_score | LLM 101 eligibility (1-5) |
| L | validity_score | LLM prior art strength (1-5) |
| M | claim_breadth | LLM claim scope (1-5) |
| N | enforcement_clarity | LLM detectability (1-5) |
| O | design_around_difficulty | LLM difficulty (1-5) |

### Step 3: Add Calculated Score Columns

Add these columns starting at P:

**Column P: Normalized Competitor Citations**
```excel
=MIN(1, G2/20)
```

**Column Q: Normalized Forward Citations**
```excel
=MIN(1, SQRT(F2)/30)
```

**Column R: Normalized Years Remaining**
```excel
=MIN(1, E2/15)
```

**Column S: Normalized Eligibility**
```excel
=K2/5
```

**Column T: Normalized Validity**
```excel
=L2/5
```

**Column U: Normalized Claim Breadth**
```excel
=M2/5
```

**Column V: Normalized Enforcement**
```excel
=N2/5
```

**Column W: Weighted Score (Default Profile)**
```excel
=(P2*Config!$B$2)+(Q2*Config!$B$3)+(R2*Config!$B$4)+(S2*Config!$B$5)+(T2*Config!$B$6)+(U2*Config!$B$7)+(V2*Config!$B$8)
```

**Column X: Weighted Score (Litigation)**
```excel
=(P2*Config!$C$2)+(Q2*Config!$C$3)+(R2*Config!$C$4)+(S2*Config!$C$5)+(T2*Config!$C$6)+(U2*Config!$C$7)+(V2*Config!$C$8)
```

**Column Y: Weighted Score (Licensing)**
```excel
=(P2*Config!$D$2)+(Q2*Config!$D$3)+(R2*Config!$D$4)+(S2*Config!$D$5)+(T2*Config!$D$6)+(U2*Config!$D$7)+(V2*Config!$D$8)
```

### Step 4: Create Summary Sheet

Create a `Summary` sheet with:

```
Row 1: "Top 25 by Default Score"
Row 2-26: =LARGE(PatentData!W:W, ROW()-1) with INDEX/MATCH to retrieve patent details

Row 30: "Top 25 by Litigation Score"
...etc
```

---

## CSV Export Types

### Type 1: Full Metrics CSV (for viewing)

Generated by: `npx tsx scripts/export-enhanced-csv.ts`

Output file: `output/patents-enhanced-YYYY-MM-DD.csv`

**Columns:**
1. rank - Pre-calculated rank
2. patent_id
3. title
4. grant_date
5. assignee
6. years_remaining
7. forward_citations
8. competitor_citations
9. competitors_citing
10. discovery_strategy - Which strategy found this patent
11. sector - Technology sector from clustering
12. sector_terms - Key terms defining the sector
13. cpc_codes
14. eligibility_score (LLM)
15. validity_score (LLM)
16. claim_breadth (LLM)
17. enforcement_clarity (LLM)
18. design_around_difficulty (LLM)
19. market_relevance (LLM v2)
20. trend_alignment (LLM v2)
21. evidence_accessibility (LLM v2)
22. score_default - Pre-calculated
23. score_litigation - Pre-calculated
24. score_licensing - Pre-calculated
25. score_product_discovery - Pre-calculated
26. score_defensive - Pre-calculated
27. score_quick_wins - Pre-calculated

**Use Case:** Attorney review, quick filtering, viewing all data in one place.

### Type 2: Raw Metrics CSV (for Excel formulas)

Generated by: `npx tsx scripts/export-raw-metrics-csv.ts` (to be created)

**Columns:**
1-15: Same as Full Metrics CSV up to design_around_difficulty
16+: LLM text answers (analysis_summary, recommendations) - rightmost columns

**Use Case:** Import to Analysis Workbook for custom formula-based scoring.

---

## Creating Multiple Weight Profiles

### Option A: Multiple Columns in Config Sheet

Add columns for each profile (shown above). Reference different columns in score formulas.

### Option B: Multiple Config Sheets

Create `Config_Litigation`, `Config_Licensing`, etc. with same structure.

### Option C: VBA Macro for Profile Switching

```vba
Sub SwitchProfile(profileName As String)
    Dim configRange As Range
    Dim profileCol As Integer

    ' Find profile column
    Select Case profileName
        Case "Default": profileCol = 2
        Case "Litigation": profileCol = 3
        Case "Licensing": profileCol = 4
        Case "Defensive": profileCol = 5
        Case "QuickWins": profileCol = 6
    End Select

    ' Copy profile weights to active column B
    Sheets("Config").Range("B2:B8").Value = _
        Sheets("Config").Range(Cells(2, profileCol), Cells(8, profileCol)).Value

    ' Refresh calculations
    Application.Calculate
End Sub
```

---

## Step-by-Step: Import and Analyze

### Initial Setup (One Time)

1. **Create Analysis Workbook**
   - File → New → Blank Workbook
   - Save as `PatentAnalysis.xlsx` (or `.xlsm` if using macros)

2. **Create Config Sheet**
   - Add sheet, name it "Config"
   - Enter weight matrix as shown above
   - Verify totals = 1.0

3. **Create PatentData Sheet**
   - Add sheet, name it "PatentData"
   - Add column headers in row 1

### For Each Analysis Run

1. **Generate Fresh CSV**
   ```bash
   npx tsx scripts/export-raw-metrics-csv.ts
   ```

2. **Import CSV to PatentData Sheet**
   - Data → From Text/CSV
   - Select `output/patents-raw-metrics-YYYY-MM-DD.csv`
   - Import settings: Delimited, Comma, Text qualifier: Double quote
   - Load to existing sheet "PatentData" starting at A1

3. **Extend Formulas**
   - Ensure calculated columns (P onwards) extend to all data rows
   - Tip: Use Table format (Ctrl+T) for auto-extending formulas

4. **Analyze**
   - Sort by Column W (Default Score) descending
   - Filter by sector, competitor, CPC codes
   - Adjust weights in Config sheet and observe score changes

5. **Compare Profiles**
   - Sort by Column X (Litigation) to see litigation-focused ranking
   - Sort by Column Y (Licensing) to see licensing-focused ranking

---

## Advanced: Sector-Based Analysis

### Filter by Sector

Add a slicer or filter on Column I (sector):

| Sector | Focus |
|--------|-------|
| Network/Communication: user/cloud | Cloud authentication |
| Video/Image: video/sink | Video codec |
| RF/Acoustic | BAW/FBAR filters |
| Security/Threat | Cybersecurity |
| AI/ML | Machine learning |

### Sector-Specific Weights

Create sector-specific weight profiles:

**RF/Acoustic Focus:**
```
competitor_citations: 0.30  (high - concentrated competitor landscape)
forward_citations: 0.15
years_remaining: 0.20
eligibility_score: 0.10  (less 101 risk for hardware)
validity_score: 0.15
claim_breadth: 0.05
enforcement_clarity: 0.05
```

**Cybersecurity Focus:**
```
competitor_citations: 0.20
forward_citations: 0.10
years_remaining: 0.15
eligibility_score: 0.20  (higher 101 risk for software)
validity_score: 0.20
claim_breadth: 0.05
enforcement_clarity: 0.10
```

---

## Workflow Summary

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Run Analysis Pipeline                                        │
│     npx tsx scripts/citation-overlap-batch.ts                   │
│     npx tsx services/llm-patent-analysis.ts                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Export CSVs                                                  │
│     npx tsx scripts/export-enhanced-csv.ts  (for viewing)       │
│     npx tsx scripts/export-raw-metrics-csv.ts  (for Excel)      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Import to Excel Workbook                                     │
│     - Import raw metrics CSV to PatentData sheet                │
│     - Formulas auto-calculate scores                            │
│     - Adjust weights in Config sheet                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Iterate                                                      │
│     - Change weights, observe ranking changes                   │
│     - Filter by sector for focused analysis                     │
│     - Export filtered results for attorney review               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `config/scoring-weights.json` | Master weight profiles (used by export scripts) |
| `output/patents-enhanced-*.csv` | Full export with pre-calculated scores |
| `output/patents-raw-metrics-*.csv` | Raw data for Excel formula calculations |
| `scripts/export-enhanced-csv.ts` | Generates full metrics export |
| `scripts/export-raw-metrics-csv.ts` | Generates raw metrics export |

---

## Quick Reference: Key Excel Formulas

**Normalize a 0-100+ value to 0-1:**
```excel
=MIN(1, A1/MAX_VALUE)
```

**Normalize with square root (for high-variance metrics like citations):**
```excel
=MIN(1, SQRT(A1)/SQRT_MAX)
```

**Weighted sum with named ranges:**
```excel
=(norm_competitor*W_COMPETITOR)+(norm_forward*W_FORWARD)+(norm_years*W_YEARS)+...
```

**Rank within dataset:**
```excel
=RANK(W2, W:W, 0)
```

**Lookup patent by rank:**
```excel
=INDEX(A:A, MATCH(LARGE(W:W, 1), W:W, 0))
```

---

## VBA Macro Reference

### Available Macros

| Macro | Arguments | Description |
|-------|-----------|-------------|
| `ImportAllData` | None | Imports data using default prefix (edit in macro) |
| `ImportAllDataWithPrefix` | `filePrefix` | Imports data with specified file prefix |
| `GenerateAllWorksheets` | None | Generates scoring worksheets (default top 250) |
| `GenerateScoringWorksheets` | `topN` | Generates scoring worksheets for top N patents |
| `ClearAllData` | None | Clears all data sheets (keeps structure) |
| `DeleteAllGeneratedSheets` | None | Deletes all generated sheets (use with caution) |
| `RefreshAll` | None | Full refresh: clear, import, generate |

### Configuring the Import Prefix

To change the import file prefix, edit the `ImportAllData` macro:

```vba
Public Sub ImportAllData()
    Dim prefix As String
    prefix = "patents-raw-metrics-2026-01-17"  ' <-- Change this for new imports

    ImportAllDataWithPrefix prefix
End Sub
```

Or call `ImportAllDataWithPrefix` directly from VBA with your prefix.

### UserWeights Sheet Structure

**Section 1: Metric Weights (Rows 3-12)**
```
| Metric                    | Aggressive | Moderate | Conservative | Description |
|---------------------------|------------|----------|--------------|-------------|
| competitor_citations      | 25%        | 20%      | 10%          | ...         |
| forward_citations         | 5%         | 10%      | 15%          | ...         |
| years_remaining           | 10%        | 15%      | 10%          | ...         |
| eligibility_score         | 15%        | 15%      | 10%          | ...         |
| validity_score            | 10%        | 15%      | 25%          | ...         |
| claim_breadth             | 5%         | 10%      | 15%          | ...         |
| enforcement_clarity       | 20%        | 10%      | 5%           | ...         |
| design_around_difficulty  | 10%        | 5%       | 10%          | ...         |
| TOTAL                     | 100%       | 100%     | 100%         |             |
```

**Section 2: Relative User Weights (Rows 17-21)**
```
| User Profile   | Relative Weight | Description |
|----------------|-----------------|-------------|
| Aggressive     | 33%             | Litigation-focused |
| Moderate       | 34%             | Balanced approach |
| Conservative   | 33%             | Defensive posture |
| TOTAL          | 100%            |             |
```

### Named Ranges Created

| Name | Reference | Purpose |
|------|-----------|---------|
| `W_Aggressive` | UserWeights!$B$4:$B$11 | Aggressive metric weights |
| `W_Moderate` | UserWeights!$C$4:$C$11 | Moderate metric weights |
| `W_Conservative` | UserWeights!$D$4:$D$11 | Conservative metric weights |
| `RelWeight_Aggressive` | UserWeights!$B$18 | Aggressive relative weight |
| `RelWeight_Moderate` | UserWeights!$B$19 | Moderate relative weight |
| `RelWeight_Conservative` | UserWeights!$B$20 | Conservative relative weight |

---

## Scoring Worksheets

### Individual User Score Sheets (Score_Aggressive, etc.)

| Column | Field | Formula |
|--------|-------|---------|
| A | Rank | Sequential after sort |
| B | Patent ID | From RawData |
| C | Title | From RawData |
| D | Grant Date | From RawData |
| E | Years Remaining | From RawData |
| F | Forward Citations | From RawData |
| G | Competitor Citations | From RawData |
| H | Competitors Citing | From RawData |
| I | Sector | From RawData |
| J | **Score** | Weighted sum of normalized metrics |
| K-R | Normalized Metrics | Individual normalized values |

**Score Formula (references UserWeights):**
```
=K{row}*UserWeights!$B$4 + L{row}*UserWeights!$B$5 + ... + R{row}*UserWeights!$B$11
```

### Combined Score Sheet (Score_Combined)

| Column | Field | Formula |
|--------|-------|---------|
| A-I | Same as individual sheets | From RawData |
| J | **Combined Score** | Weighted average of user scores |
| K | Aggressive Score | Calculated with aggressive weights |
| L | Moderate Score | Calculated with moderate weights |
| M | Conservative Score | Calculated with conservative weights |

**Combined Score Formula:**
```
=K{row}*UserWeights!$B$18 + L{row}*UserWeights!$B$19 + M{row}*UserWeights!$B$20
```

---

## Workflow: New Data Import

```bash
# 1. Generate fresh CSV export
npx tsx scripts/export-raw-metrics-csv.ts

# 2. Copy CSV to workbook directory (or use file dialog)
cp output/patents-raw-metrics-2026-01-17.csv /path/to/workbook/

# 3. Open workbook, edit ImportAllData prefix if needed
# 4. Run RefreshAll macro (Alt+F8 -> RefreshAll)
```

---

## Tips

1. **Weights Must Sum to 100%**: The TOTAL row shows if weights are valid
2. **Sorting is Automatic**: Sheets sort by score descending after generation
3. **Formulas Update Live**: Change a weight, all scores recalculate
4. **Relative Weights for Consensus**: Adjust B18:B20 to favor different user types
5. **Add Custom User Types**: Duplicate a column in the weights section, add new scoring sheet

---

## Troubleshooting

**"Macros are disabled"**
- File -> Options -> Trust Center -> Trust Center Settings -> Macro Settings
- Enable "Disable all macros with notification"
- Re-open the file and click "Enable Content"

**"CSV file not found"**
- Ensure CSV is in same directory as workbook or in `output/` subdirectory
- Check the file prefix in the macro matches your CSV filename

**"Reference error in formulas"**
- Ensure UserWeights sheet exists with correct structure
- Re-run `CreateUserWeightsSheet` or `RefreshAll`

---

*Document created: 2026-01-17*
*For use with Patent Portfolio Analysis Platform*
*VBA Module: excel/PatentAnalysisMacros.bas*
*Config: config/user-weight-profiles.json*
