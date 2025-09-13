# Feature 07E Implementation Guide V2: Enhanced Closing Statement Detection

## Overview
This guide documents improvements to the closing statement detection algorithm in the LongStatementsAccumulator class, implementing a more sophisticated ratio calculation and defense-first search strategy.

## Date: 2025-09-13

## Key Improvements Implemented

### 1. New Weighted Square Root Ratio Algorithm

**Problem**: The traditional ratio calculation (speaker_words / total_words) was too sensitive to short interruptions, causing premature cutoff of closing statements.

**Solution**: Implemented a weighted square root ratio that considers both word count and statement count:
- Attorney score: `words / sqrt(statements)`
- Interruption score: `interruption_words / sqrt(interruption_statements)`
- Final ratio: `attorney_score / (attorney_score + interruption_score)`

**Benefits**:
- More tolerant of brief judicial interruptions (e.g., "Ten minutes remaining")
- Maintains quality by still penalizing frequent interruptions
- Better captures complete closing statements

### 2. Defense-First Search Strategy

**Problem**: Closing statements don't always follow plaintiff-then-defense order. In many trials, defense goes first, followed by plaintiff rebuttal.

**Solution**:
1. Search for defense closing first in the entire closing period
2. If found, search for plaintiff closing:
   - BEFORE defense (traditional closing)
   - AFTER defense (rebuttal closing)
3. Properly classify plaintiff statements as closing or rebuttal based on position

**Example from 01 Genband**:
- Defense closing: Events 5662-5664 (MR_VERHOEVEN)
- Plaintiff rebuttal: Event 5672 (MR_DACUS)

### 3. Configurable Algorithm Parameters

**Location**: `config/trialstyle.json` and trial-specific overrides

```json
{
  "longStatements": {
    "ratioMode": "WEIGHTED_SQRT",  // or "TRADITIONAL"
    "ratioThreshold": 0.7,
    "minWords": 500,
    "maxInterruptionRatio": 0.15
  }
}
```

**Features**:
- Per-trial customization via `output/multi-trial/{trial}/trialstyle.json`
- Mode selection between traditional and weighted algorithms
- Adjustable thresholds for different trial styles

### 4. Closing Period Adjustment Based on Jury Events

**Problem**: Closing period boundaries were fixed, potentially including jury deliberation or verdict events.

**Solution**: Automatically adjust closing period end boundary when jury events are detected:
1. Find jury deliberation and verdict sections
2. Adjust closing period to end before these events
3. Check for attorney statements between original end and jury events
4. Extend to include any rebuttal statements found

## Implementation Details

### LongStatementsAccumulator Changes

**File**: `src/phase3/LongStatementsAccumulator.ts`

Key additions:
- `calculateWeightedSqrtRatio()`: New ratio calculation method
- `calculateRatioByMode()`: Mode selection logic
- `meetsRatioThreshold()`: Configurable threshold checking

### StandardTrialHierarchyBuilder Changes

**File**: `src/phase3/StandardTrialHierarchyBuilder.ts`

Key modifications:
- `findClosingStatements()`: Implements defense-first search
- `adjustClosingPeriodBounds()`: Adjusts for jury events
- Config loading from trial-specific `trialstyle.json`

## Testing Results

### Trial: 01 Genband

**Before improvements**:
- Plaintiff closing was cut off mid-statement
- Defense closing was incomplete
- No rebuttal detection

**After improvements**:
- Defense closing: Complete capture (events 5662-5664)
- Plaintiff rebuttal: Properly detected (event 5672)
- Both statements fully captured with high confidence (1.00)

### Trial: 03 Core Wireless

**Results**:
- Opening statements detected successfully
- Closing statements not found (no defense attorneys identified in database)
- Demonstrates need for attorney metadata improvements

## Configuration Examples

### Conservative Settings (fewer false positives)
```json
{
  "longStatements": {
    "ratioMode": "TRADITIONAL",
    "ratioThreshold": 0.85,
    "minWords": 750,
    "maxInterruptionRatio": 0.1
  }
}
```

### Aggressive Settings (capture more statements)
```json
{
  "longStatements": {
    "ratioMode": "WEIGHTED_SQRT",
    "ratioThreshold": 0.6,
    "minWords": 400,
    "maxInterruptionRatio": 0.25
  }
}
```

## Validation Metrics

### Success Indicators
1. **Complete capture**: Closing statements include final "Thank you" statements
2. **Proper ordering**: Defense-plaintiff sequence correctly identified
3. **Rebuttal detection**: Plaintiff statements after defense properly classified
4. **Boundary accuracy**: No jury events included in closing period

### Known Limitations
1. Requires accurate attorney role assignments in database
2. May struggle with non-standard trial formats
3. Dependent on word count thresholds (configurable)

## Future Enhancements

### Short-term
1. Pattern-based detection for statement beginnings/endings
2. Contextual clues ("members of the jury", "on behalf of")
3. Attorney role inference from context

### Long-term
1. Machine learning model for statement boundary detection
2. Cross-trial learning for optimal parameters
3. Automatic attorney role detection from transcript content

## Migration Notes

### To apply these changes to existing trials:
1. Delete Phase 3 data: `npx ts-node src/cli/delete-trial.ts delete-phase3 "{trial-name}"`
2. Update config if needed in `config/trialstyle.json`
3. Reprocess: `npx ts-node src/cli/phase3.ts process --trial {trial-id}`

### Backward Compatibility
- Default mode is `WEIGHTED_SQRT` for better accuracy
- Falls back to traditional mode if explicitly configured
- Existing trials without config use sensible defaults

## Performance Impact

- Minimal processing overhead (< 1 second per trial)
- Memory usage unchanged
- File output size unchanged

## Related Files

- `src/phase3/LongStatementsAccumulator.ts` - Core algorithm implementation
- `src/phase3/StandardTrialHierarchyBuilder.ts` - Hierarchy builder with search strategy
- `config/trialstyle.json` - Default configuration
- `docs/features/feature-07E.md` - Original feature specification

## Conclusion

These improvements significantly enhance the accuracy and completeness of closing statement detection, particularly for trials with interruptions or non-standard ordering. The configurable nature allows fine-tuning per trial while maintaining a robust default behavior.