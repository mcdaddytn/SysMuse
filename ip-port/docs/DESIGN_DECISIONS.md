# Design Decisions & Architecture Notes

*Extracted from session context to keep operational state concise*
*Last Updated: 2026-01-19*

---

## Scoring Philosophy

### Current State (V2 - Working Well)

**Formula:**
```
Score = Σ(weight_i × normalized_metric_i) × YearMultiplier
```

**Metrics (10):**
- competitor_citations, competitor_count, forward_citations
- eligibility_score, validity_score, claim_breadth
- enforcement_clarity, design_around_difficulty
- ipr_risk_score, prosecution_quality_score

**Key insight:** No sector_damages weight = organic diversity across sectors.

### Proposed V3 (Not Implemented)

**Three-factor multiplicative model:**
```
FinalScore = DamagesScore × SuccessScore × RiskFactor × YearMultiplier
```

**Issue identified:** 40% sector weight in DamagesScore creates floor effects, over-weighting high-tier sectors.

**Decision:** Keep V2 for overall Top 250. Use sector_damages only for:
1. Within-sector ranking (comparing like patents)
2. Sector-level portfolio views
3. GUI filtering by damages potential

---

## Configurable Scoring Design

All scoring parameters should be JSON-configurable for future GUI control:

```json
// config/scoring-config.json (to be created)
{
  "version": "1.0",
  "scoringModel": "v2-additive",

  "tierMapping": {
    "4": 1.00,  // Very High
    "3": 0.90,  // High (compressed from 0.75)
    "2": 0.75,  // Medium (compressed from 0.50)
    "1": 0.50   // Low (compressed from 0.25)
  },

  "weights": {
    "aggressive": { ... },
    "moderate": { ... },
    "conservative": { ... }
  },

  "filters": {
    "minYearsRemaining": 3,
    "minEligibilityScore": 2
  },

  "yearMultiplier": {
    "base": 0.3,
    "scale": 0.7,
    "exponent": 0.8
  }
}
```

---

## Within-Sector Scoring

For comparing patents within the same sector (all have same damages tier):

```
WithinSectorRank = (
  0.30 × CompetitorCitationRank +
  0.25 × LLMQualityRank +
  0.20 × ForwardCitationRank +
  0.15 × YearsRemainingRank +
  0.10 × IPRProsecutionRank
)
```

Use cases:
- Attorney sector specialization (different attorneys research different sectors)
- Vendor testing diversity (test partner tools across sectors)
- Litigation grouping (patents that work together in same sector)

---

## Database Schema Principles

**Stack:** PostgreSQL + Prisma ORM + MTI (Multi-Table Inheritance) pattern

**Core entities (initial design):**
- `Patent` - base patent data
- `PatentMetrics` - calculated scores, citations
- `PatentLLMAnalysis` - LLM-generated assessments
- `Sector` - sector definitions with damages tiers
- `Competitor` - competitor companies with discovery provenance
- `CitationRelationship` - patent-to-patent citations
- `ScoringProfile` - stakeholder weight profiles
- `AnalysisJob` - background job tracking

**Incremental citation updates:**
```sql
-- When adding new competitor:
-- 1. Find cached citing patents with matching assignee
-- 2. Update competitor_match flag
-- 3. Recalculate affected scores
-- No API calls for existing data!
```

---

## GUI-Ready Configuration

All configuration should be JSON/text files for smooth GUI transition:

| Config Type | Current Location | GUI Editable? |
|-------------|------------------|---------------|
| Competitors | config/competitors.json | Yes (add/remove/categorize) |
| Sector definitions | config/sector-breakout-v2.json | Yes (CPC mappings) |
| Sector damages | config/sector-damages.json | Yes (tier assignments) |
| Scoring weights | (to create) config/scoring-config.json | Yes |
| LLM prompts | config/prompts/*.json | View/select variants |
| Search terms | config/sector-prompts/*.json | Yes |

---

## Excel Integration Notes

**Current state:** Column mismatch between CSV (28 cols) and macro (20 cols)

**Decision:** Defer fix until actively using Excel. Options:
1. Create dedicated `export-for-excel.ts` with exact column order
2. Update macro to handle current CSV format
3. Wait for GUI to replace Excel workflow

---

## Citation Overlap Algorithm

**Complexity:** O(n × m) where n = patents, m = avg citations per patent

**Not geometric** - we query "who cites our patents", not "compare all competitors to each other"

**Bottleneck:** API rate limiting (45 req/min), not algorithmic

**Future optimization with database:**
- Cache citation relationships
- Store assignee→competitor mappings
- Incremental delta updates (~30 min vs 12 hours)

---

## Sector Coverage (Current Top 250)

| Sector | Count | Status |
|--------|-------|--------|
| network-security | 87 | Good representation |
| cloud-auth | 41 | Good |
| video-image | 29 | Good |
| wireless | 28 | Good |
| computing | 25 | Good |
| audio | 0 | Missing |
| general | 0 | Expected (catch-all) |
| security-crypto | 0 | Missing |

**Action:** Within-sector scoring will surface best patents from underrepresented sectors.

---

*Document created to reduce NEXT_SESSION_CONTEXT.md size*
