# Patent Metrics Reference Guide

This document describes all metrics in the combined rankings export (`combined-rankings-*.csv`) and provides formulas for recalculating scores with custom weights in Excel or other spreadsheet tools.

## CSV Column Reference

| Column | Field Name | Type | Description |
|--------|------------|------|-------------|
| A | Final Rank | Integer | Overall ranking (1 = best) based on Final Score |
| B | Patent ID | String | USPTO patent number (without "US" prefix) |
| C | Title | String | Patent title |
| D | Grant Date | Date | Patent grant date (YYYY-MM-DD) |
| E | Assignee | String | Current patent assignee/owner |
| F | Years Remaining | Decimal | Estimated years until patent expires (from 20-year term) |
| G | Forward Citations | Integer | Number of later patents citing this patent |
| H | Competitor Citations | Integer | Citations from identified competitors |
| I | Top Competitors | String | List of competitors citing this patent |
| J | Licensing Score | Decimal | Calculated licensing potential (0-100) |
| K | Litigation Score | Decimal | Calculated litigation value (0-100) |
| L | Strategic Score | Decimal | Calculated strategic/portfolio value (0-100) |
| M | Quantitative Overall | Decimal | Combined quantitative score (0-100) |
| N | LLM Eligibility | Integer | 101 patent eligibility strength (1-5) |
| O | LLM Validity | Integer | Prior art validity strength (1-5) |
| P | LLM Claim Breadth | Integer | Claim scope/breadth (1-5) |
| Q | LLM Enforcement | Integer | Infringement detectability (1-5) |
| R | LLM Design-Around | Integer | Difficulty to design around (1-5) |
| S | LLM Confidence | Integer | LLM's confidence in analysis (1-5) |
| T | LLM Quality Score | Decimal | Weighted LLM score (0-100) |
| U | Final Score | Decimal | Combined final score (0-100) |

---

## Raw Metrics (No Calculation Needed)

### Years Remaining (Column F)
- **Source**: Calculated from grant date
- **Formula**: `20 - (current_year - grant_year)` adjusted for exact dates
- **Range**: 0 to ~20 years
- **Interpretation**: Higher = more time to monetize

### Forward Citations (Column G)
- **Source**: PatentsView API
- **Description**: Count of all patents that cite this patent
- **Interpretation**: Higher = more influential/foundational patent

### Competitor Citations (Column H)
- **Source**: PatentsView API + competitor matching
- **Description**: Count of citations specifically from identified competitors
- **Interpretation**: Higher = competitors are building on this technology

---

## LLM Ratings (Columns N-S)

All LLM ratings use a **1-5 scale where HIGHER = BETTER** for the patent holder.

### LLM Eligibility (Column N) - 101 Patent Eligibility Strength
| Score | Label | Description |
|-------|-------|-------------|
| 5 | Very Strong | Clearly patent-eligible, specific technical implementation |
| 4 | Strong | Strong technical elements, minor abstract concepts |
| 3 | Moderate | Mixed technical/abstract, outcome uncertain |
| 2 | Weak | Significant abstract concepts, limited technical specificity |
| 1 | Very Weak | Likely ineligible, primarily abstract idea |

### LLM Validity (Column O) - Prior Art Strength
| Score | Label | Description |
|-------|-------|-------------|
| 5 | Very Strong | Novel approach, minimal prior art concerns |
| 4 | Strong | Some prior art exists but claims are differentiated |
| 3 | Moderate | Relevant prior art exists, claims may need narrowing |
| 2 | Weak | Significant prior art overlap, validity questionable |
| 1 | Very Weak | Strong prior art, likely invalid |

### LLM Claim Breadth (Column P)
| Score | Label | Description |
|-------|-------|-------------|
| 5 | Very Broad | Foundational claims, wide applicability |
| 4 | Broad | Covers multiple approaches/technologies |
| 3 | Moderate | Covers a class of implementations |
| 2 | Narrow | Specific to particular use case |
| 1 | Very Narrow | Highly specific implementation details |

### LLM Enforcement (Column Q) - Infringement Detectability
| Score | Label | Description |
|-------|-------|-------------|
| 5 | Very Clear | Infringement obvious from product/service |
| 4 | Clear | Infringement readily observable |
| 3 | Moderate | Detectable with technical analysis |
| 2 | Difficult | Requires significant reverse engineering |
| 1 | Very Difficult | Infringement hard to detect/prove |

### LLM Design-Around (Column R) - Difficulty to Avoid
| Score | Label | Description |
|-------|-------|-------------|
| 5 | Very Difficult | No practical alternatives, must license |
| 4 | Difficult | Few practical alternatives |
| 3 | Moderate | Alternatives possible with effort |
| 2 | Easy | Known workarounds available |
| 1 | Very Easy | Trivial alternatives exist |

### LLM Confidence (Column S)
| Score | Label | Description |
|-------|-------|-------------|
| 5 | Very High | High confidence in all assessments |
| 4 | High | Confident in most assessments |
| 3 | Moderate | Some uncertainty in assessments |
| 2 | Low | Significant uncertainty |
| 1 | Very Low | Limited information, low confidence |

---

## Calculated Scores & Formulas

### Licensing Score (Column J)

**Purpose**: Estimates value for patent licensing deals. Requires active patent term.

**Current Formula**:
```
IF Years_Remaining <= 0 THEN 0
ELSE:
  term_multiplier = MIN(1, Years_Remaining / 10)
  competitor_value = MIN(100, Competitor_Citations * 5)
  citation_value = MIN(30, SQRT(Forward_Citations) * 3)

  Licensing_Score = (competitor_value * 0.6 + citation_value * 0.4) * term_multiplier
```

**Excel Formula** (assuming row 2):
```excel
=IF(F2<=0, 0,
  (MIN(100, H2*5)*0.6 + MIN(30, SQRT(G2)*3)*0.4) * MIN(1, F2/10))
```

**Weights**:
- Competitor citations: **60%**
- Forward citations: **40%**
- Term multiplier: Linear scale up to 10 years

### Litigation Score (Column K)

**Purpose**: Estimates value for patent litigation. Requires 3+ years remaining term.

**Current Formula**:
```
IF Years_Remaining < 3 THEN 0
ELSE:
  term_factor = MIN(1, Years_Remaining / 8)
  competitor_value = MIN(50, Competitor_Citations * 3)
  citation_value = MIN(50, SQRT(Forward_Citations) * 5)

  Litigation_Score = (competitor_value + citation_value) * term_factor
```

**Excel Formula** (assuming row 2):
```excel
=IF(F2<3, 0,
  (MIN(50, H2*3) + MIN(50, SQRT(G2)*5)) * MIN(1, F2/8))
```

**Weights**:
- Competitor citations: **50%** (capped at 50 points)
- Forward citations: **50%** (capped at 50 points)
- Term multiplier: Linear scale up to 8 years

### Strategic Score (Column L)

**Purpose**: Portfolio/defensive value. Includes expired patents for strategic purposes.

**Current Formula**:
```
competitor_value = MIN(60, Competitor_Citations * 4)
citation_value = MIN(40, SQRT(Forward_Citations) * 4)

Strategic_Score = competitor_value + citation_value
```

**Excel Formula** (assuming row 2):
```excel
=MIN(60, H2*4) + MIN(40, SQRT(G2)*4)
```

**Weights**:
- Competitor citations: **60%** max
- Forward citations: **40%** max

### Quantitative Overall (Column M)

**Purpose**: Combined quantitative score from the three use-case scores.

**Current Formula**:
```
Quantitative_Overall = MAX(Licensing_Score, Litigation_Score, Strategic_Score) * 0.5
                     + (Licensing_Score + Litigation_Score + Strategic_Score) / 3 * 0.5
```

**Excel Formula** (assuming row 2):
```excel
=MAX(J2,K2,L2)*0.5 + AVERAGE(J2,K2,L2)*0.5
```

**Weights**:
- Best single score: **50%**
- Average of all three: **50%**

### LLM Quality Score (Column T)

**Purpose**: Weighted combination of LLM ratings.

**Current Formula**:
```
LLM_Quality_Score = (
  LLM_Eligibility * 0.25 +
  LLM_Validity * 0.25 +
  LLM_Claim_Breadth * 0.20 +
  LLM_Enforcement * 0.15 +
  LLM_Design_Around * 0.15
) / 5 * 100
```

**Excel Formula** (assuming row 2):
```excel
=(N2*0.25 + O2*0.25 + P2*0.20 + Q2*0.15 + R2*0.15) / 5 * 100
```

**Current Weights**:
| Factor | Weight | Rationale |
|--------|--------|-----------|
| Eligibility (101) | **25%** | Critical - invalid patents have no value |
| Validity | **25%** | Critical - prior art can invalidate |
| Claim Breadth | **20%** | Important - broader = more licensing leverage |
| Enforcement | **15%** | Important - must be able to prove infringement |
| Design-Around | **15%** | Important - alternatives reduce leverage |

### Final Score (Column U)

**Purpose**: Combined score incorporating both quantitative and LLM analysis.

**Current Formula**:
```
IF LLM_Quality_Score is empty:
  Final_Score = Quantitative_Overall
ELSE:
  term_factor = MIN(1, Years_Remaining / 15) * 100

  Final_Score = Quantitative_Overall * 0.50 +
                LLM_Quality_Score * 0.30 +
                term_factor * 0.20
```

**Excel Formula** (assuming row 2):
```excel
=IF(T2="", M2,
  M2*0.50 + T2*0.30 + MIN(1, F2/15)*100*0.20)
```

**Current Weights**:
| Factor | Weight | Rationale |
|--------|--------|-----------|
| Quantitative Overall | **50%** | Citation data is objective |
| LLM Quality Score | **30%** | Qualitative analysis adds insight |
| Term Factor | **20%** | Time value of the patent |

---

## Custom Recalculation Examples

### Example 1: Prioritize 101 Eligibility
If you want to heavily weight patents with strong 101 eligibility:

```excel
=IF(T2="", M2,
  M2*0.30 + (N2/5*100)*0.50 + T2*0.20)
```

### Example 2: Litigation-Focused Ranking
For a litigation campaign, emphasize litigation score and enforcement clarity:

```excel
=K2*0.40 + (Q2/5*100)*0.30 + (R2/5*100)*0.20 + (N2/5*100)*0.10
```

### Example 3: Licensing-Focused Ranking
For licensing programs, weight licensing score and claim breadth:

```excel
=J2*0.40 + (P2/5*100)*0.30 + (F2/20*100)*0.30
```

### Example 4: Risk-Adjusted Score
Penalize patents with low validity or eligibility scores:

```excel
=M2 * (N2/5) * (O2/5)
```
This multiplies the quantitative score by eligibility and validity factors, heavily penalizing risky patents.

### Example 5: Equal Weight All LLM Factors
```excel
=(N2 + O2 + P2 + Q2 + R2) / 25 * 100
```

---

## Recommended Excel Setup

1. **Import CSV** into Excel
2. **Add custom columns** for your recalculated scores (e.g., columns V, W, X)
3. **Create named ranges** for weight parameters:
   - `W_ELIGIBILITY` = 0.25
   - `W_VALIDITY` = 0.25
   - `W_BREADTH` = 0.20
   - `W_ENFORCEMENT` = 0.15
   - `W_DESIGNAROUND` = 0.15
4. **Reference weights in formulas**:
   ```excel
   =(N2*W_ELIGIBILITY + O2*W_VALIDITY + P2*W_BREADTH + Q2*W_ENFORCEMENT + R2*W_DESIGNAROUND) / 5 * 100
   ```
5. **Change weights** by updating the named ranges - all formulas update automatically

---

## Notes

- **Empty LLM values**: 3 patents lack abstracts and have no LLM analysis. Filter these out or handle with `IF(T2="", ...)` logic.
- **Score normalization**: All calculated scores target 0-100 range for easy comparison.
- **Rating scale consistency**: All LLM ratings use 1-5 where higher = better, enabling simple weighted averages.
