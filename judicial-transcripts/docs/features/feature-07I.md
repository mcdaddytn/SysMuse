# Feature-07I: Corrected WEIGHTED_SQRT Ratio Calculations for Long Statement Detection

## Overview

This feature corrects the implementation of the WEIGHTED_SQRT family of ratio calculations used in the Long Statements Accumulator V3 algorithm for detecting opening and closing statements in judicial transcripts. The previous implementation incorrectly calculated ratios against total words, rather than using the "ratio of ratios" approach that properly weights long statements from target speakers against interruptions.

## Problem Statement

The original implementation of WEIGHTED_SQRT variants incorrectly calculated:
- `WEIGHTED_SQRT`: `speakerWords / sqrt(totalWords)`
- `WEIGHTED_SQRT2`: `(speakerWords/totalWords)^2 * sqrt(speakerWords/100)`
- `WEIGHTED_SQRT3`: `(speakerWords/totalWords)^3 * sqrt(speakerWords/100)`

These calculations did not properly distinguish between target speakers and other speakers, and did not account for the number of statement chunks (which is crucial for detecting long uninterrupted statements).

## Solution: Ratio of Ratios Approach

### Core Concept

The corrected algorithm uses a "ratio of ratios" approach:
1. Calculate a ratio for target speakers: `targetSpeakerRatio`
2. Calculate a ratio for other speakers: `otherSpeakerRatio`
3. The final score is: `targetSpeakerRatio / otherSpeakerRatio`

This approach naturally favors windows where target speakers have long continuous statements while other speakers have short interruptions.

### Variable Definitions

For any evaluation window:
- **targetSpeakerWords**: Total words spoken by attorneys on the target side (e.g., PLAINTIFF)
- **targetSpeakerStatements**: Number of StatementEvent instances by target speakers
- **otherSpeakerWords**: Total words spoken by all other speakers (judges, opposing attorneys, etc.)
- **otherSpeakerStatements**: Number of StatementEvent instances by other speakers

### Ratio Calculations by Mode

#### WEIGHTED_SQRT
```
targetSpeakerRatio = targetSpeakerWords / sqrt(targetSpeakerStatements)
otherSpeakerRatio = otherSpeakerWords / sqrt(otherSpeakerStatements)
finalRatio = targetSpeakerRatio / otherSpeakerRatio
```

**Example**: If plaintiff attorneys speak 1000 words across 2 statements (600 + 400), and the court interrupts with 10 words in 1 statement:
- targetSpeakerRatio = 1000 / sqrt(2) = 707.1
- otherSpeakerRatio = 10 / sqrt(1) = 10
- finalRatio = 707.1 / 10 = 70.71

#### WEIGHTED_SQRT2
```
targetSpeakerRatio = targetSpeakerWords^2 / sqrt(targetSpeakerStatements)
otherSpeakerRatio = otherSpeakerWords^2 / sqrt(otherSpeakerStatements)
finalRatio = targetSpeakerRatio / otherSpeakerRatio
```

This squares the word counts, giving even stronger preference to long statements.

#### WEIGHTED_SQRT3
```
targetSpeakerRatio = targetSpeakerWords^3 / sqrt(targetSpeakerStatements)
otherSpeakerRatio = otherSpeakerWords^3 / sqrt(otherSpeakerStatements)
finalRatio = targetSpeakerRatio / otherSpeakerRatio
```

This cubes the word counts, providing the strongest preference for long statements.

#### TRADITIONAL
```
finalRatio = targetSpeakerWords / (targetSpeakerWords + otherSpeakerWords)
```

Simple ratio of target speaker words to total words (fallback mode).

## Implementation Details

### 1. Speaker Classification

For each StatementEvent in the evaluation window:
- Identify if the speaker is a "target speaker" based on:
  - Speaker type (ATTORNEY, JUDGE, JUROR, etc.)
  - Attorney role (PLAINTIFF vs DEFENDANT)
  - Team aggregation setting (all attorneys on same side count as target)

### 2. Statistics Collection

The algorithm tracks:
- Word counts for each speaker group
- Statement counts for each speaker group
- Individual speaker ratios
- Overall ratio of ratios

### 3. Window Extension Logic

Starting from a candidate long statement:
1. Calculate initial ratio using the ratio of ratios approach
2. Attempt to extend the window by adding the next statement
3. Recalculate the ratio with the extended window
4. Continue extending if ratio improves or declines minimally
5. Stop when:
   - Ratio declines significantly (beyond threshold)
   - Opposing attorney makes a long statement (deal-breaker)
   - No more statements available

### 4. Lookahead Optimization

When encountering short interruptions (< 50 words), the algorithm looks ahead up to 5 statements to check if there's significant same-team content coming. If found, it extends through the interruption to capture the complete statement block.

## Configuration

The algorithm is configured in `trialstyle.json`:

```json
{
  "longStatements": {
    "ratioMode": "WEIGHTED_SQRT",
    "ratioThreshold": 0.6,
    "minWords": 400,
    "minWordsOpening": 400,
    "minWordsClosing": 500,
    "maxInterruptionRatio": 0.3,
    "aggregateTeam": true
  }
}
```

### Configuration Parameters

- **ratioMode**: Which calculation mode to use (WEIGHTED_SQRT recommended)
- **ratioThreshold**: Minimum ratio to accept a window as valid
- **minWords**: Minimum words for initial statement to be considered
- **minWordsOpening**: Override for opening statements
- **minWordsClosing**: Override for closing statements
- **maxInterruptionRatio**: Maximum ratio of interruption words (deprecated)
- **aggregateTeam**: Whether to combine all attorneys on same side

## JSON Output Enhancement

The evaluation logs now include detailed metrics for algorithm analysis:

### Example Output Structure
```json
{
  "evaluation": {
    "initialStatement": {
      "eventId": 5672,
      "speaker": "MR_DACUS",
      "wordCount": 1362,
      "meetsThreshold": true,
      "text": "Thank you, Your Honor. Let me address a few things right off the bat..."
    },
    "extensions": [
      {
        "step": 1,
        "addedEventId": 5673,
        "addedSpeaker": "THE_COURT",
        "addedWords": 3,
        "ratio": 0.9978,
        "decision": "extend",
        "totalWords": 1365,
        "speakerWords": 1362,
        "targetSpeakerWords": 1362,
        "targetSpeakerStatements": 1,
        "otherSpeakerWords": 3,
        "otherSpeakerStatements": 1,
        "targetSpeakerRatio": 1362,
        "otherSpeakerRatio": 3
      }
    ]
  }
}
```

### Key Metrics Tracked

- **targetSpeakerWords**: Words by target attorneys
- **targetSpeakerStatements**: Number of statements by target
- **otherSpeakerWords**: Words by all other speakers
- **otherSpeakerStatements**: Number of statements by others
- **targetSpeakerRatio**: Calculated ratio for target speakers
- **otherSpeakerRatio**: Calculated ratio for other speakers
- **ratio**: Final ratio of ratios score

## Text Truncation

To improve readability of evaluation logs:
- Initial statement text truncated to 50 words
- Display window statements truncated to 50 words
- Full text preserved for statements within evaluation window

## Benefits

1. **Accurate Detection**: Properly identifies long uninterrupted statements
2. **Resistance to Interruptions**: Short court interjections don't break detection
3. **Team Support**: Handles split statements between co-counsel
4. **Transparent Scoring**: Detailed metrics show why windows are selected
5. **Tunable**: Different modes (SQRT, SQRT2, SQRT3) for different sensitivities

## Migration Notes

### Removed Features
- **SMART_EXTEND**: Removed as it was incorrectly implemented and WEIGHTED_SQRT provides better results

### Updated Defaults
- Changed default ratioMode from SMART_EXTEND to WEIGHTED_SQRT
- Updated minWords from 500 to 400 for better coverage
- Increased maxInterruptionRatio from 0.15 to 0.3 for more flexibility

## Testing Results

Testing on "01 Genband" trial shows improved detection:
- Correctly identifies plaintiff closing split between MR_DACUS and MR_KUBEHL
- Properly distinguishes main closing from rebuttal statements
- Accurate ratio calculations that reflect actual speaker dominance

Example corrected calculation for a mixed window:
- Plaintiff: 1000 words in 2 statements → ratio = 707.1
- Court: 10 words in 1 statement → ratio = 10
- Final score: 70.71 (strong plaintiff dominance)

## Related Features

- Feature-07H: Original Long Statements Accumulator V3
- Feature-02J: Attorney metadata for role identification
- Feature-03: Statement event parsing

## Implementation Files

- `/src/phase3/LongStatementsAccumulatorV3.ts`: Core algorithm with corrected calculations
- `/src/phase3/StandardTrialHierarchyBuilder.ts`: Integration with hierarchy builder
- `/config/trialstyle.json`: Default configuration
- `/output/longstatements/*/`: Evaluation logs with detailed metrics