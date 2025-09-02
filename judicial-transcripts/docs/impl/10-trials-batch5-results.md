# Batch 5 Testing Results - 10 Trials
**Date**: 2025-09-01
**Trials**: 49-67 (selected trials)

## Configuration
```json
"activeTrials": [
  "49 Luvncare V Royal King",
  "51 Packet Sandvine",
  "52 Personalized Apple",
  "55 SSL V Citrix",
  "59 Gree V. Supercell",
  "61 Nichia Corporation V. Everlight Electronics",
  "62 Simpleair V. Google 582",
  "63 Solas Oled Ltd. V. Samsung",
  "65 Ticketnetwork V. Ceats",
  "67 Gonzalez V. New Life"
]
```

## Phase 1 Results
- **Total Sessions Created**: 51
- **All trials parsed successfully**: 100% success rate
- **Notable Configurations**:
  - Trial 49 (Luvncare): "*" delimiter detected
  - Trial 55 (SSL V Citrix): "*" delimiter detected
  - Trial 61 (Nichia): "*" delimiter detected
  - Trial 62 (Simpleair 582): "*" delimiter detected

## Phase 2 Results  
- **All 10 trials completed successfully** with event processing
- **Total Events Generated**: 53,932
  - Statement Events: 52,766 (97.8%)
  - Witness Called Events: 189 (0.4%)
  - Court Directive Events: 977 (1.8%)

### Detailed Results by Trial

| Trial | Case Number | Sessions | Total Events | Statements | Witnesses | Directives |
|-------|-------------|----------|--------------|------------|-----------|------------|
| 49 Luvncare V Royal King | 2:10-CV-00461-JRG | 7 | 4,745 | 4,606 | 0 | 139 |
| 51 Packet Sandvine | 2:16-CV-147-JRG | 2 | 1,653 | 1,619 | 0 | 34 |
| 52 Personalized Apple | 2:15-CV-1366-JRG | 1 | 1,732 | 1,693 | 5 | 34 |
| 55 SSL V Citrix | 2:08-CV-00158-JRG | 11 | 15,694 | 15,452 | 52 | 190 |
| 59 Gree V. Supercell | 2:13-CV-00702-JRG | 4 | 3,852 | 3,806 | 21 | 25 |
| 61 Nichia V. Everlight | 2:13-CV-587 | 6 | 3,115 | 3,025 | 21 | 69 |
| 62 Simpleair V. Google 582 | 2:14-CV-907-JRG | 5 | 5,125 | 4,993 | 17 | 115 |
| 63 Solas Oled V. Samsung | 2:15-CV-1470 | 3 | 446 | 406 | 0 | 40 |
| 65 Ticketnetwork V. Ceats | 2:19-CV-152-JRG | 6 | 6,032 | 5,838 | 27 | 167 |
| 67 Gonzalez V. New Life | 2:19-CV-237-JRG | 6 | 11,538 | 11,328 | 46 | 164 |

## Key Observations

1. **100% Success Rate**: All 10 trials completed both Phase 1 and Phase 2 successfully
2. **Lower Session Count**: Only 51 sessions total (lowest batch average of 5.1 sessions/trial)
3. **Three Trials with No Witnesses**: Trials 49, 51, and 63 had 0 witness events
4. **High Statement Ratio**: 97.8% of all events are statement events
5. **Trial 52 Single Session**: Personalized Apple trial had only 1 session but still generated 1,732 events

## Performance Metrics
- **Phase 1 Duration**: ~26 seconds
- **Phase 2 Duration**: ~5.5 minutes for all 10 trials
- **Average Events per Session**: 1,057 (highest so far)
- **Average Sessions per Trial**: 5.1 (lowest so far)

## Notable Patterns
- **Trial 55 (SSL V Citrix)**: Highest event count (15,694) and most sessions (11)
- **Trial 63 (Solas Oled)**: Lowest event count (446) with 3 sessions
- **Witness Distribution**: Only 7 of 10 trials had witness events

## Summary Statistics
- **Total Trials**: 10
- **Total Sessions**: 51
- **Total Events Processed**: 53,932
  - Statement Events: 52,766
  - Witness Called Events: 189
  - Court Directive Events: 977
- **Success Rate**: 100% (10/10 trials fully processed)

## Comparison with Previous Batches

| Metric | Batch 1 | Batch 2 | Batch 3 | Batch 4 | Batch 5 |
|--------|---------|---------|---------|---------|---------|
| Total Trials | 10 | 10 | 10 | 10 | 10 |
| Total Sessions | 87 | 85 | 89 | 78 | 51 |
| Phase 1 Success | 100% | 100% | 100% | 100% | 100% |
| Phase 2 Success | 40% | 50% | 50% | 100% | 100% |
| Total Events | ~20K | ~25K | 52,176 | 65,658 | 53,932 |
| Events/Session | 230 | 294 | 586 | 841 | 1,057 |

## Trends
- **Decreasing Session Counts**: Clear downward trend in average sessions per trial
- **Increasing Event Density**: Events per session continues to increase
- **Stable Success Rates**: Last two batches showing 100% Phase 2 success

## Next Steps
1. Continue testing with remaining trials
2. Investigate why some trials have 0 witness events
3. Document successful delimiter patterns

## Conclusion
Batch 5 demonstrates excellent performance with 100% success rate despite having the lowest session count. The high event density (1,057 events/session) indicates efficient parsing of dense transcript content. The presence of trials with 0 witness events suggests variation in trial formats or witness handling patterns that may need investigation.