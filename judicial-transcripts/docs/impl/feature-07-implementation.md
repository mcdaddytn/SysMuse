# Feature-07 Implementation Guide: Pattern Accumulators

## Overview
This document details the implementation of the Pattern Accumulator system (Phase 3), including lessons learned, critical fixes, and diagnostic tools developed during implementation.

## Implementation Status
**Status**: Partially Complete (Phase 1 & 2 complete, Phase 3 implemented with disabled problematic accumulators)

### Completed Components
1. **Phase 1**: ElasticSearch expression evaluation against statements
2. **Phase 2**: Database seeding with ES expressions and accumulator configurations
3. **Phase 3**: AccumulatorEngine with sliding window evaluation
4. **Diagnostic Tools**: Debug CSV output and focused match exports

### Key Files
- `src/phase3/AccumulatorEngine.ts` - Main accumulator evaluation engine
- `src/db/seed/phase2Seeds.ts` - Seed data for ES expressions and accumulators
- `src/phase3/testAccumulatorDebug.ts` - Diagnostic tool for accumulator analysis
- `src/phase3/exportJudgeAttorneyMatches.ts` - Export tool for specific accumulator matches

## Critical Implementation Issues & Solutions

### 1. Event Sorting Problem (CRITICAL)
**Issue**: Events were incorrectly sorted by `startTime` alone, causing events from different sessions to be interleaved.

**Root Cause**: Multiple sessions can have the same time values (e.g., "01:00:02") but from different days.

**Solution**: Sort by `id` instead of `startTime`:
```typescript
// WRONG - causes session interleaving
orderBy: { startTime: 'asc' }

// CORRECT - maintains chronological order
orderBy: { id: 'asc' }

// Alternative if you need time-based sorting
orderBy: [
  { sessionId: 'asc' },
  { startTime: 'asc' }
]
```

**Impact**: Reduced false positive rate from 5.27% to 1.64% for judge_attorney_interaction accumulator.

### 2. Sliding Window Implementation
**Issue**: Initial implementation created overlapping markers for the same interaction cluster.

**Solution**: Implement window skip mechanism:
```typescript
// Track last match position for each accumulator
const lastMatchIndex: Map<string, number> = new Map();

// Skip evaluation if too close to last match
if (lastMatch !== undefined && statementIndex < lastMatch + accumulator.windowSize) {
  continue; // Skip this evaluation
}

// After a match, record position
if (evaluation.matched) {
  lastMatchIndex.set(accumulator.name, statementIndex);
}
```

### 3. Speaker Type Detection for Boolean Accumulators
**Implementation**: Properly count distinct speakers by type within window:
```typescript
// Count speakers by type
const speakerTypeCounts = new Map<string, Set<number>>();

for (const statement of window.statements) {
  if (statement.speaker && statement.speakerId) {
    const type = statement.speaker.speakerType;
    if (!speakerTypeCounts.has(type)) {
      speakerTypeCounts.set(type, new Set());
    }
    speakerTypeCounts.get(type)!.add(statement.speakerId);
  }
}

// Check requirements (e.g., judge + 2 attorneys)
const hasJudge = speakerTypeCounts.has('JUDGE');
const attorneyCount = 
  (speakerTypeCounts.get('ATTORNEY')?.size || 0) + 
  (speakerTypeCounts.get('DEFENSE_COUNSEL')?.size || 0) + 
  (speakerTypeCounts.get('PROSECUTOR')?.size || 0);
```

### 4. Performance Optimization
**Issue**: Storing all accumulator results (including non-matches) created excessive data.

**Solution**: Only store positive matches:
```typescript
// Store result only if matched or has significant score
if (evaluation.matched || evaluation.score > 0) {
  await this.storeResult(accumulator, window, evaluation, trialId);
}
```

## Diagnostic Tools

### 1. Accumulator Debug Test (`testAccumulatorDebug.ts`)
Generates comprehensive CSV showing accumulator values at every event.

**Usage**:
```bash
npx ts-node src/phase3/testAccumulatorDebug.ts [trialId]
```

**Output**: `output/csv/accumulator_debug.csv`
- Shows score, confidence, matched status for all accumulators
- Includes SKIP markers showing window skip mechanism
- Helpful for tuning thresholds and window sizes

### 2. Match Export Tool (`exportJudgeAttorneyMatches.ts`)
Exports only the matched windows for specific accumulator analysis.

**Usage**:
```bash
npx ts-node src/phase3/exportJudgeAttorneyMatches.ts [trialId]
```

**Output**: `output/csv/judge_attorney_matches.csv`
- Shows only statements that are part of matched windows
- Groups statements by window_id
- Includes speaker and text preview

### 3. Sorting Verification (`checkSorting.ts`)
Diagnostic tool to verify event sorting is correct.

**Usage**:
```bash
npx ts-node src/phase3/checkSorting.ts
```

Shows events sorted different ways to identify sorting issues.

### 4. Window Size Updater (`updateWindowSize.ts`)
Utility to update accumulator window sizes in database.

**Usage**:
```bash
npx ts-node src/phase3/updateWindowSize.ts
```

## Running Phase 3

### Prerequisites
1. Database must have Phase 2 data loaded
2. Trial events must be properly imported with correct IDs

### Execution Steps

1. **Run ElasticSearch expression evaluation**:
```bash
npx ts-node src/runPhase3.ts es [trialId]
```

2. **Run accumulator evaluation** (currently with some disabled):
```bash
npx ts-node src/runPhase3.ts accumulators [trialId]
```

3. **Generate diagnostic output**:
```bash
npx ts-node src/phase3/testAccumulatorDebug.ts [trialId]
```

4. **Review results**:
- Check `output/csv/accumulator_debug.csv` in spreadsheet application
- Look for patterns in match distribution
- Verify window skip is working (SKIP markers)

## Current Accumulator Status

### Active Accumulators
- `objection_sustained` - Detects sustained objections
- `objection_overruled` - Detects overruled objections  
- `sidebar_request` - Detects sidebar requests
- `witness_examination_transition` - Detects examination transitions

### Disabled Accumulators (Need Tuning)
- `judge_attorney_interaction` - Currently generates acceptable number of matches (~1.64% with window=5)
- `opposing_counsel_interaction` - Needs refinement

## Recommended Window Sizes
Based on testing:
- **5 statements**: Good for capturing brief interactions (objections, procedural matters)
- **10 statements**: Too broad, captures unrelated exchanges
- **3 statements**: May be too narrow, misses context

## Additional Implementation Details

### Video Deposition Marker Handling
**Issue**: Video depositions have no Q&A recorded in the transcript (everything is on video). The backward search for the last "A." speaker prefix was causing the end marker to be set before the start marker.

**Solution**: Added special handling for `VIDEO_DEPOSITION` examination type in `WitnessMarkerDiscovery.findExaminationBoundary()`. For video depositions, both start and end markers are set to the same WitnessCalledEvent location.

### ElasticSearchResult Storage Optimization  
**Issue**: Originally storing results for every expression-statement combination created millions of records.

**Solution**: Modified to only store matches (when `matched === true`), reducing data volume by 99%+.

**Impact**: 
- Records reduced from ~40,000+ to ~400 per trial
- Dramatically improved performance
- Reduced database storage requirements

## Known Issues & Future Work

1. **Accumulator Tuning**: Need to refine thresholds and combinations for disabled accumulators
2. **ES Expression Matching**: Currently using simple string matching, should integrate actual Elasticsearch
3. **Performance**: Consider batch processing for large trials
4. **Marker Clustering**: Implement sophisticated clustering to group related markers
5. **Video Deposition Support**: Current implementation handles basic cases but may need refinement

## Testing Recommendations

1. **Always verify sorting**: Run `checkSorting.ts` after any data import
2. **Use debug CSV**: Generate `accumulator_debug.csv` to visualize accumulator behavior
3. **Start with small windows**: Begin with window_size=5 and adjust based on results
4. **Monitor match rates**: Typical rates should be <5% for most accumulators

## Database Considerations

- Event IDs must be chronologically assigned during import
- SessionId + startTime can be used as alternative sorting method
- Accumulator results table can grow large - only store matches

## Lessons Learned

1. **Sorting is critical**: Wrong sorting completely invalidates pattern matching
2. **Window size matters**: Smaller windows (5) are more precise than larger (10)
3. **Skip mechanism essential**: Prevents redundant markers for same interaction
4. **Debug tools invaluable**: CSV output essential for understanding accumulator behavior
5. **Start conservative**: Better to have fewer, accurate matches than many false positives