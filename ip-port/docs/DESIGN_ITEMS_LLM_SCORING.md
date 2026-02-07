# Design Items: LLM Scoring & Sector-Specific Features

**Date:** 2026-02-06
**Status:** Design Discussion

---

## 1. Sector-Specific Summary Pages

### Problem
Different sectors have different scoring metrics. The current patent summary page shows a fixed set of columns that doesn't adapt to sector-specific metrics.

### Design Considerations

1. **Dynamic Column Selection**
   - When viewing patents in a specific sector, show columns relevant to that sector's scoring template
   - Include inherited columns from parent templates (super-sector, portfolio-default)
   - Allow user to toggle between "all columns" and "sector-relevant columns"

2. **Column Selection UI**
   - Checkbox list with grouping by template level (base, super-sector, sector, sub-sector)
   - "Save column preferences" per sector or globally
   - Presets: "Minimal", "Standard", "Full with Reasoning"

3. **Handling Mixed Records**
   - When viewing patents across multiple sectors (e.g., portfolio-wide view):
     - Option A: Show union of all columns, blank for non-applicable
     - Option B: Show only common columns, with "expand" to see sector-specific
     - Option C: Group patents by sector, each section has its own columns
   - Recommended: Start with Option A, add Option B as enhancement

### Implementation Notes
- Store column preferences in localStorage or user settings
- API already returns metrics as JSON object - frontend can dynamically render columns
- Consider lazy-loading reasoning text (large strings) on demand

---

## 2. LLM Job Management from Sector Enrichment

### Problem
LLM scoring jobs are currently triggered via API calls. Users need a UI to:
- Start scoring jobs for sectors/sub-sectors
- Monitor progress in real-time
- Configure job options (claims context, limits, etc.)

### Design Considerations

1. **Job Configuration Options**
   ```
   - Sector/Sub-sector selection
   - Patent limit (default: 500)
   - Concurrency (1-5, default: 2)
   - Minimum patent year filter (e.g., 2010+)
   - Rescore existing (yes/no)
   - Context options:
     - Include claims: none | independent_only | all_claims
     - Max claim tokens (default: 800)
     - Max claims (default: 5)
   ```

2. **Progress Monitoring**
   - Real-time progress bar (X/Y patents)
   - Estimated time remaining
   - Current patent being processed
   - Token usage accumulator
   - Error count and list

3. **Job History**
   - Store job metadata: start time, end time, config, results
   - Link to export results
   - Re-run with same config button

### API Endpoints Needed
- `POST /api/scoring-jobs` - Create and start a job
- `GET /api/scoring-jobs/:id` - Get job status/progress
- `GET /api/scoring-jobs` - List recent jobs
- `DELETE /api/scoring-jobs/:id` - Cancel running job

### Implementation Notes
- Use server-sent events (SSE) or polling for progress updates
- Store job state in database (new `ScoringJob` model)
- Consider queue system for multiple jobs

---

## 3. Claims Context Configuration

### Problem
Claims context significantly affects scoring quality and cost. Need flexible configuration options.

### Current Options (Implemented)
```typescript
interface ContextOptions {
  includeAbstract?: boolean;      // default: true
  includeLlmSummary?: boolean;    // default: true
  includeClaims?: 'none' | 'independent_only' | 'all';  // default: 'none'
  maxClaimTokens?: number;        // default: 800
  maxClaims?: number;             // default: 5
}
```

### Future Options to Consider
1. **Claim Selection Strategies**
   - `independent_only` - Only independent claims (current)
   - `all_claims` - All claims (expensive)
   - `first_n_claims` - First N claims regardless of type
   - `longest_claims` - Claims with most detail
   - `broadest_claims` - Claims with fewest limitations (requires NLP)

2. **Token Budget Mode**
   - Set total token budget, auto-select claims to fit
   - Priority: independent > dependent, longer > shorter

3. **Caching**
   - Cache extracted claims to avoid re-parsing XML
   - Pre-extract claims for all patents in background job

### Cost Implications
| Mode | Avg Extra Tokens | Cost Multiplier |
|------|------------------|-----------------|
| none | 0 | 1.0x |
| independent_only (5 max) | ~800 | 1.5x |
| all_claims (capped 2000) | ~1500 | 2.0x |
| all_claims (uncapped) | ~2500 | 2.5x |

---

## 4. Claims Availability Tracking

### Problem
Not all patents have claims available in our XML bulk data. Need to:
- Track which patents have claims
- Prioritize patents with claims for enhanced scoring
- Report on claims gaps

### Current State
- XML bulk data covers ~2005-2025 grants
- ~87% of recent patents (2010+) have claims in our data
- Older patents may have different XML formats

### Solutions

1. **Claims Availability Index**
   - Pre-scan all XML files, build index: `patent_id -> has_claims`
   - Store in database or JSON cache
   - Update incrementally when new XML files added

2. **Scoring Table Enhancement**
   - Add `claimsUsed: boolean` field to score records
   - Track whether claims were available and used for each score

3. **Export Enhancement** (Implemented)
   - Added `claims_available` column to export
   - Claims analysis endpoint: `GET /api/scoring-templates/claims-analysis/:superSector`

### API Endpoint Added
```
GET /api/scoring-templates/claims-analysis/:superSector
  ?topN=100   // Analyze top N by score

Returns:
{
  superSector, totalAnalyzed, withClaims, withoutClaims,
  claimsAvailabilityRate, bySector: {...},
  missingClaimsPatents: [...]
}
```

---

## 5. Export Enhancements

### Current Implementation
`GET /api/scoring-templates/export/:superSector`

### Columns Included
- Base patent info (id, title, date, assignee, sector, etc.)
- Forward citations, CPC codes
- Base score, LLM composite score
- Claims availability flag
- All sector-specific metrics with:
  - Score (1-10)
  - Confidence (0-1)
  - Reasoning (text, optional)

### Query Parameters
- `format`: csv (default) | json
- `includeReasoning`: true (default) | false
- `minScore`: filter by minimum composite score

### Future Enhancements
- Add filter by sector within super-sector
- Add filter by patent date range
- Add filter by claims availability
- Support Excel format (.xlsx)
- Streaming export for large datasets

---

## Priority Order

1. **High Priority**
   - [x] Export with all columns + reasoning + claims flag
   - [x] Claims analysis endpoint
   - [ ] Claims availability index (pre-scan)

2. **Medium Priority**
   - [ ] Sector-specific column selection in UI
   - [ ] LLM job management UI
   - [ ] Job history tracking

3. **Lower Priority**
   - [ ] Advanced claim selection strategies
   - [ ] Excel export format
   - [ ] Real-time job progress via SSE

---

*Document created: 2026-02-06*
