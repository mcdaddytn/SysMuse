# 5 Trials Complete Test Results - Phase 1 & 2

## Test Configuration
- **Date**: September 1, 2025
- **Parser Mode**: Multi-pass
- **Phases Run**: Phase 1 and Phase 2
- **Database**: Clean reset with seed data

## Trials Tested
1. **03 Core Wireless** - CORE WIRELESS LICENSING vs LG ELECTRONICS
2. **10 Metaswitch Genband 2016** - METASWITCH NETWORKS vs GENBAND
3. **11 Dataquill Limited** - DATAQUILL LIMITED vs ZTE
4. **15 Optis Wireless Technology V. Huawei** - OPTIS WIRELESS vs HUAWEI
5. **16 Saint Lawrence V. Motorola** - SAINT LAWRENCE vs MOTOROLA

## Overall Database Statistics

### Total Records Created
- **Trials**: 5
- **Sessions**: 40
- **Pages**: 2,259
- **Lines**: 131,134
- **Trial Events**: 31,390
- **Statement Events**: 30,472
- **Witness Events**: 125
- **Directive Events**: 793
- **Speakers**: 156
- **Witnesses**: 31

## Per-Trial Statistics

| Trial ID | Trial Name | Sessions | Pages | Lines | Total Events | Statements | Witnesses | Directives | Speakers |
|----------|------------|----------|-------|-------|--------------|------------|-----------|------------|----------|
| 1 | Core Wireless | 8 | 16 | 25,060 | 1,955 | 1,778 | 27 | 150 | 37 |
| 2 | Metaswitch | 9 | 476 | 32,837 | 7,998 | 7,728 | 45 | 225 | 34 |
| 3 | Dataquill | 8 | 8 | 28,842 | 7,013 | 6,835 | 31 | 147 | 32 |
| 4 | Optis | 10 | 1,130 | 28,533 | 8,465 | 8,273 | 0 | 192 | 25 |
| 5 | Saint Lawrence | 5 | 629 | 15,862 | 5,959 | 5,858 | 22 | 79 | 28 |

## Detailed Event Breakdown by Trial

### StatementEvent Distribution
- **Trial 1 (Core Wireless)**: 1,778 statements (91% of trial events)
- **Trial 2 (Metaswitch)**: 7,728 statements (96.6% of trial events)
- **Trial 3 (Dataquill)**: 6,835 statements (97.5% of trial events)
- **Trial 4 (Optis)**: 8,273 statements (97.7% of trial events)
- **Trial 5 (Saint Lawrence)**: 5,858 statements (98.3% of trial events)

### WitnessCalledEvent Distribution
- **Trial 1 (Core Wireless)**: 27 witness events (1.4% of trial events)
- **Trial 2 (Metaswitch)**: 45 witness events (0.6% of trial events)
- **Trial 3 (Dataquill)**: 31 witness events (0.4% of trial events)
- **Trial 4 (Optis)**: 0 witness events (0% - anomaly)
- **Trial 5 (Saint Lawrence)**: 22 witness events (0.4% of trial events)

### CourtDirectiveEvent Distribution
- **Trial 1 (Core Wireless)**: 150 directive events (7.7% of trial events)
- **Trial 2 (Metaswitch)**: 225 directive events (2.8% of trial events)
- **Trial 3 (Dataquill)**: 147 directive events (2.1% of trial events)
- **Trial 4 (Optis)**: 192 directive events (2.3% of trial events)
- **Trial 5 (Saint Lawrence)**: 79 directive events (1.3% of trial events)

### Top Court Directive Types (Across All Trials)
1. **Jury out**: 157 occurrences
2. **Bench conference**: 96 occurrences
3. **Bench conference concluded**: 95 occurrences
4. **Jury in**: 85 occurrences
5. **Recess**: 78 occurrences
6. **Video clip playing**: 58 occurrences
7. **End of video clip**: 57 occurrences
8. **Courtroom unsealed**: 25 occurrences
9. **Witness sworn**: 17 occurrences
10. **Courtroom sealed**: 12 occurrences

## Key Observations

### Data Distribution
- **Largest Trial**: Optis (Trial 4) with 8,465 events and 1,130 pages
- **Smallest Trial**: Core Wireless (Trial 1) with 1,955 events but only 16 pages
- **Average Events per Trial**: 6,278
- **Average Lines per Trial**: 26,227

### Event Type Distribution
- **Statement Events**: 97.1% of all events (30,472 / 31,390)
- **Directive Events**: 2.5% (793 / 31,390)
- **Witness Events**: 0.4% (125 / 31,390)

### Anomalies
- **Trial 4 (Optis)**: No witness events detected despite having 8,465 total events
- **No Attorneys or Judges**: Zero records in Attorney and Judge tables (possible extraction issue)
- **Core Wireless**: Very low page count (16) compared to line count (25,060) - suggests page header detection issues

## Phase 1 Performance
- **Total Processing Time**: ~16 seconds for all 5 trials
- **Average per Trial**: ~3.2 seconds
- **Sessions Created**: 40 (average 8 per trial)

## Phase 2 Performance
- **Total Processing Time**: ~4 minutes for all 5 trials
- **Events Processed**: 31,390 total
- **Processing Rate**: ~130 events/second

## Data Quality Metrics
- **Date Extraction**: 100% success (all sessions have valid dates)
- **Session Type Detection**: 100% (AM/PM/ALLDAY properly assigned)
- **Speaker Identification**: 156 unique speakers across 5 trials
- **Witness Identification**: 31 witnesses found (except Trial 4)

## Issues Identified
1. **Attorney/Judge Extraction**: Not working - 0 records in both tables
2. **Page Detection**: Inconsistent - Core Wireless has only 16 pages for 25,060 lines
3. **Witness Detection**: Trial 4 (Optis) has no witness events despite being a large trial

## Recommendations
1. Investigate attorney and judge extraction logic in Phase 2
2. Review page header detection in Core Wireless trial
3. Check witness event detection for Optis trial
4. Consider implementing Phase 3 for marker discovery

## Event Type Summary Table

| Trial | StatementEvents | WitnessCalledEvents | CourtDirectiveEvents | Total Events |
|-------|-----------------|---------------------|---------------------|--------------|
| 1 - Core Wireless | 1,778 | 27 | 150 | 1,955 |
| 2 - Metaswitch | 7,728 | 45 | 225 | 7,998 |
| 3 - Dataquill | 6,835 | 31 | 147 | 7,013 |
| 4 - Optis | 8,273 | 0 | 192 | 8,465 |
| 5 - Saint Lawrence | 5,858 | 22 | 79 | 5,959 |
| **Totals** | **30,472** | **125** | **793** | **31,390** |

## Summary
The test successfully processed 5 trials through both Phase 1 and Phase 2, creating over 31,000 events and 131,000 lines of transcript data. The multi-pass parser performed well with 100% completion rate. Main areas for improvement are attorney/judge extraction and consistent page detection across different transcript formats.