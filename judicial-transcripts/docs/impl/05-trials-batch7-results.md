# Batch 7 Testing Results - 5 Trials
**Date**: 2025-09-02
**Trials**: 68, 71, 72, 73, 75

## Configuration
```json
"activeTrials": [
  "68 Contentguard Holdings, Inc. V. Google",
  "71 Hinson Et Al V. Dorel",
  "72 Taylor V Turner",
  "73 Tq Delta, Llc V. Commscope",
  "75 Garrett V Wood County"
]
```

## Phase 1 Results
- **Total Sessions Created**: 27
- **All trials parsed successfully**: 100% success rate
- Trial distribution:
  - Trial 68 (Contentguard): 13 sessions
  - Trial 71 (Hinson): 4 sessions
  - Trial 72 (Taylor): 2 sessions
  - Trial 73 (Tq Delta): 6 sessions
  - Trial 75 (Garrett): 2 sessions

## Phase 2 Results
- **All 5 trials completed** Phase 2 processing
- **Total Events in Database**: 37,083
  - Statement Events: 36,202 (97.6%)
  - Court Directive Events: 764 (2.1%)
  - Witness Called Events: 117 (0.3%)

### Detailed Results by Trial

| Trial | Case Number | Sessions | DB Events | Phase 2 Reported | Status |
|-------|-------------|----------|-----------|------------------|--------|
| 68 Contentguard V. Google | 2:14-CV-00061-JRG | 13 | 12,078 | 12,078 | ✓ Match |
| 71 Hinson Et Al V. Dorel | 2:15-CV-00713-JRG | 4 | 12,883 | 6,454 | ⚠️ Double |
| 72 Taylor V Turner | 2:11-CV-00057-JRG | 2 | 3,448 | 3,448 | ✓ Match |
| 73 Tq Delta V. Commscope | 2:21-CV-00310-JRG | 6 | 6,994 | 6,994 | ✓ Match |
| 75 Garrett V Wood County | 6:17-CV-00507-JRG | 2 | 1,680 | 1,680 | ✓ Match |

## Issues Identified

### Trial 2 (Hinson) Double-Counting
- Phase 2 reported: 6,454 events
- Database contains: 12,883 events (exactly 2x - 1 event)
- Session event distribution:
  - Session 14 (2016-06-13): 2,961 events
  - Session 15 (2016-06-14): 5,070 events
  - Session 16 (2016-06-15): 3,752 events
  - Session 17 (2016-06-17): 1,100 events
- Total: 12,883 events
- Suspected cause: Phase 2 may be processing trial 2 twice or accumulating events

### Pattern Analysis
- When running Phase 2 with --trial-id parameter sequentially:
  - Trial 1: Correctly processed
  - Trial 2: Events appear to be doubled
  - Trials 3-5: Correctly processed
- This suggests an issue specific to trial 2 or the sequential processing

## Performance Metrics
- **Phase 1 Duration**: ~31 seconds for all 5 trials
- **Phase 2 Duration**: ~8 minutes total (run sequentially)
- **Average Events per Session**: 1,373
- **Average Sessions per Trial**: 5.4

## Summary Statistics
- **Total Trials**: 5
- **Total Sessions**: 27
- **Total Events Processed**: 37,083
  - Statement Events: 36,202
  - Witness Called Events: 117
  - Court Directive Events: 764
- **Success Rate**: 80% (4/5 trials correctly processed, 1 with double-counting)

## Next Steps
1. Investigate why trial 2 events are being doubled
2. Check if running Phase 2 individually vs. batch affects the results
3. Verify if the issue is reproducible with a fresh database
4. Consider adding validation to prevent duplicate event creation

## Conclusion
Batch 7 successfully processed 5 smaller trials with mostly correct results. However, trial 71 (Hinson) shows evidence of double-counting events during Phase 2 processing. This issue needs investigation before proceeding with larger batches.