# 5 Trials Test Results - Batch 2

## Test Configuration
- **Date**: September 1, 2025
- **Parser Mode**: Multi-pass
- **Phases Run**: Phase 1 (Complete) and Phase 2 (Partial)
- **Database**: Clean reset with seed data

## Trials Tested
1. **17 Wi-Lan V. Apple** (uses * delimiter)
2. **18 Wi-Lan V. Htc**
3. **19 Alfonso Cioffi Et Al V. Google**
4. **20 Biscotti Inc. V. Microsoft Corp**
5. **21 Cassidian V Microdata**

## Overall Database Statistics

### Total Records Created
- **Trials**: 5
- **Sessions**: 54
- **Pages**: 6,743
- **Lines**: 204,053
- **Trial Events**: 30,712
- **Statement Events**: 30,031
- **Witness Events**: 123
- **Directive Events**: 557
- **Speakers**: 82
- **Witnesses**: 19

## Per-Trial Statistics

| Trial ID | Trial Name | Sessions | Pages | Lines | Total Events | Statements | Witnesses | Directives |
|----------|------------|----------|-------|-------|--------------|------------|-----------|------------|
| 1 | Wi-Lan V. Apple | 20 | 3,203 | 81,222 | 23,251 | 22,743 | 98 | 410 |
| 2 | Wi-Lan V. Htc | 12 | 1,921 | 48,732 | 7,461 | 7,288 | 25 | 147 |
| 3 | Alfonso Cioffi Et Al V. Google | 10 | 23 | 33,738 | 0* | 0* | 0* | 0* |
| 4 | Biscotti Inc. V. Microsoft | 9 | 1,369 | 34,463 | 0* | 0* | 0* | 0* |
| 5 | Cassidian V Microdata | 3 | 227 | 5,898 | 0* | 0* | 0* | 0* |

*Phase 2 did not complete for trials 3-5

## Event Type Summary Table (Trials 1-2 Only)

| Trial | StatementEvents | WitnessCalledEvents | CourtDirectiveEvents | Total Events |
|-------|-----------------|---------------------|---------------------|--------------|
| 1 - Wi-Lan V. Apple | 22,743 | 98 | 410 | 23,251 |
| 2 - Wi-Lan V. Htc | 7,288 | 25 | 147 | 7,461 |
| **Totals** | **30,031** | **123** | **557** | **30,712** |

## Phase 1 Performance
- **Completion Rate**: 100% (5/5 trials)
- **Total Sessions Created**: 54
- **Average Sessions per Trial**: 10.8
- **Total Lines Parsed**: 204,053

## Phase 2 Performance
- **Completion Rate**: 40% (2/5 trials)
- **Events Processed**: 30,712 (for completed trials only)
- **Issue**: Phase 2 processing appears to have stalled after trial 2

## Key Observations

### Successful Processing (Trials 1-2)
- **Wi-Lan V. Apple**: Largest trial with 20 sessions and 23,251 events
- **Wi-Lan V. Htc**: 12 sessions with 7,461 events
- Both trials processed completely through Phase 2
- High witness event count for Wi-Lan V. Apple (98)

### Data Distribution Anomalies
- **Trial 3 (Alfonso Cioffi)**: Only 23 pages for 33,738 lines (suggests page detection issue)
- **Trial 5 (Cassidian)**: Only 3 sessions - smallest trial in batch

### Phase 2 Issues
- Processing appears to have encountered issues with "Unable to resolve A speaker" warnings
- Trials 3-5 have no events despite successful Phase 1 parsing
- Process may have stalled due to witness resolution issues

## Comparison with Batch 1

| Metric | Batch 1 (Trials 3,10,11,15,16) | Batch 2 (Trials 17-21) |
|--------|--------------------------------|------------------------|
| Trials Processed | 5 | 5 |
| Total Sessions | 40 | 54 |
| Total Lines | 131,134 | 204,053 |
| Phase 1 Success | 100% | 100% |
| Phase 2 Success | 100% | 40% |
| Total Events (Complete) | 31,390 | 30,712* |

*Only includes trials 1-2 due to incomplete Phase 2

## Issues Identified
1. **Phase 2 Stability**: Process stalled after trial 2 with witness resolution warnings
2. **Page Detection**: Trial 3 shows extreme page/line ratio (23 pages for 33,738 lines)
3. **Witness Resolution**: Extensive "Unable to resolve A speaker" warnings in Phase 2

## Recommendations
1. Investigate witness resolution logic that's causing Phase 2 to fail
2. Add timeout and error recovery to Phase 2 processing
3. Review page detection for Alfonso Cioffi trial
4. Consider running Phase 2 trials individually rather than in batch

## Summary
Phase 1 completed successfully for all 5 trials, creating 54 sessions and parsing over 204,000 lines. However, Phase 2 only completed for 2 out of 5 trials (Wi-Lan cases), processing 30,712 events. The Phase 2 process appears to have issues with witness resolution that prevented completion for trials 3-5. Despite the partial Phase 2 completion, the successful trials show good event extraction with proper distribution across statement, witness, and directive events.