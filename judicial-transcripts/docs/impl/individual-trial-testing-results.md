# Individual Trial Testing Results
**Date**: 2025-09-02
**Testing Mode**: Individual trial processing (Phase 1 + Phase 2)

## Summary
All trials tested individually showed **100% accuracy** between Phase 2 reported events and database stored events.

## Test Results

| Trial | Name | Case Number | Sessions | Phase 2 Events | DB Events | Status |
|-------|------|-------------|----------|----------------|-----------|--------|
| 71 | Hinson Et Al V. Dorel | 2:15-CV-00713-JRG | 4 | 6,429 | 6,429 | ✅ Perfect Match |
| 72 | Taylor V Turner | 2:11-CV-00057-JRG | 2 | 3,448 | 3,448 | ✅ Perfect Match |
| 73 | Tq Delta V. Commscope | 2:21-CV-00310-JRG | 6 | 6,994 | 6,994 | ✅ Perfect Match |
| 75 | Garrett V Wood County | 6:17-CV-00507-JRG | 2 | 1,680 | 1,680 | ✅ Perfect Match |

## Event Type Breakdown

### Trial 71 (Hinson)
- Statement Events: 6,236 (97.0%)
- Witness Events: 16 (0.2%)
- Directive Events: 177 (2.8%)

### Trial 72 (Taylor)
- Statement Events: 3,385 (98.2%)
- Witness Events: 0 (0.0%)
- Directive Events: 63 (1.8%)

### Trial 73 (Tq Delta)
- Statement Events: 6,926 (99.0%)
- Witness Events: 0 (0.0%)
- Directive Events: 68 (1.0%)

### Trial 75 (Garrett)
- Statement Events: 1,643 (97.8%)
- Witness Events: 5 (0.3%)
- Directive Events: 32 (1.9%)

## Key Findings

1. **Individual Processing Works Correctly**: When trials are processed one at a time (reset database, Phase 1, Phase 2), the event counts are accurate.

2. **Batch Processing Issue**: The double-counting issue only appeared when running multiple trials in sequence without database reset.

3. **Trial 68 Page Structure Issue**: Trial 68 (Contentguard) has structural problems with pages - most sessions show only 1 page instead of proper page counts.

4. **Trial Suffix Pattern**: Files with "Trial" suffix (like Hinson) represent full-day transcripts and are correctly handled as single MORNING sessions.

## Important Notes

### File Naming Conventions
- **"Trial" suffix**: Full-day transcript (e.g., "June 13, 2016 Trial.txt")
  - Should be treated as a single all-day session
  - Mapped to MORNING session type
  - Similar to how "AM and PM" suffix indicates a full-day transcript

- **"AM"/"PM" suffixes**: Half-day sessions
  - AM → MORNING session type
  - PM → AFTERNOON session type
  - PM1 → EVENING session type (special case)

## Recommendations

1. **Exclude Trial 68** from batch testing until page structure issue is resolved
2. **Run trials individually** for accurate results until batch processing issue is fixed
3. **Update parser** to formally recognize "Trial" suffix as full-day indicator
4. **Investigate** why batch processing causes event duplication in some trials

## Conclusion
Individual trial processing produces accurate and consistent results. All tested trials (71, 72, 73, 75) show perfect alignment between Phase 2 reporting and database storage when processed independently.