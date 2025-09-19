# Feature-07I: WORD_RACE Calculations for Long Statement Detection

## Overview

This feature introduces the WORD_RACE family of calculations for the Long Statements Accumulator V3 algorithm, replacing the previous WEIGHTED_SQRT approaches. The WORD_RACE calculations use a simpler, more intuitive "word accumulation race" model that tracks which side (target speakers vs. others) is accumulating more words as the evaluation window extends, with distance-based adjustments to diminish the impact of statements further from the baseline.

## Core Concept: Word Accumulation Race

The WORD_RACE approach models statement detection as a competition:
1. Start with a strong baseline statement from target speakers (meeting minWords threshold)
2. As we extend the window, track whether target speakers or others are "winning" the word race
3. Apply distance factors to reduce the impact of statements further from the baseline
4. Maximize the `targetWordScore` - the cumulative adjusted word advantage

## Algorithm Details

### Variable Definitions

For each statement in the evaluation window:
- **statementIndex**: Position in the window (1 for baseline statement, incrementing for each subsequent statement)
- **targetWords**: Words spoken by target speakers in this statement
- **otherWords**: Words spoken by other speakers in this statement
- **distFactorExponent**: Mode-specific constant:
  - WORD_RACE: 1
  - WORD_RACE2: 2
  - WORD_RACE3: 3 (default)

### Calculated Values

For each statement at position `statementIndex`:

```
distFactor = statementIndex ^ (1 / distFactorExponent)

targetAdjWords = targetWords / distFactor

otherAdjWords = otherWords * distFactor

deltaAdjWords = targetAdjWords - otherAdjWords

targetWordScore = Σ(deltaAdjWords) for all statements in window
```

### Distance Factor Explanation

The distance factor serves two purposes:
1. **Diminishes target speaker impact** as we move away from the baseline (dividing by distFactor)
2. **Amplifies interruption penalty** for statements further from baseline (multiplying by distFactor)

This ensures that:
- The initial strong statement has maximum weight
- Later target speaker additions have diminishing returns
- Later interruptions become increasingly costly

### Mode Variations

#### WORD_RACE (distFactorExponent = 1)
- No distance penalty (distFactor always equals 1)
- All statements weighted equally
- Example: Statement 3 has distFactor = 3^(1/1) = 3

#### WORD_RACE2 (distFactorExponent = 2)
- Square root distance penalty
- Moderate sensitivity to distance
- Example: Statement 3 has distFactor = 3^(1/2) = √3 ≈ 1.732

#### WORD_RACE3 (distFactorExponent = 3) [DEFAULT]
- Cube root distance penalty
- Lower sensitivity to distance
- Example: Statement 3 has distFactor = 3^(1/3) = ∛3 ≈ 1.442
- Allows for longer statement windows with gradual decay

## Example Calculation

Consider a window with 3 statements using WORD_RACE3:

**Statement 1** (baseline, statementIndex = 1):
- targetWords = 1000, otherWords = 0
- distFactor = 1^(1/3) = 1
- targetAdjWords = 1000/1 = 1000
- otherAdjWords = 0*1 = 0
- deltaAdjWords = 1000 - 0 = 1000
- Running targetWordScore = 1000

**Statement 2** (statementIndex = 2):
- targetWords = 0, otherWords = 10 (court interruption)
- distFactor = 2^(1/3) ≈ 1.260
- targetAdjWords = 0/1.260 = 0
- otherAdjWords = 10*1.260 = 12.6
- deltaAdjWords = 0 - 12.6 = -12.6
- Running targetWordScore = 1000 - 12.6 = 987.4

**Statement 3** (statementIndex = 3):
- targetWords = 200, otherWords = 0 (target continues)
- distFactor = 3^(1/3) ≈ 1.442
- targetAdjWords = 200/1.442 ≈ 138.7
- otherAdjWords = 0*1.442 = 0
- deltaAdjWords = 138.7 - 0 = 138.7
- Running targetWordScore = 987.4 + 138.7 = 1126.1

The final targetWordScore of 1126.1 would be compared against other window configurations.

## JSON Output Structure

The evaluation logs include all calculation variables:

```json
{
  "evaluation": {
    "initialStatement": {
      "eventId": 851,
      "speaker": "MR_DACUS",
      "wordCount": 3436,
      "meetsThreshold": true,
      "statementIndex": 1,
      "targetWords": 3436,
      "otherWords": 0,
      "distFactor": 1,
      "targetAdjWords": 3436,
      "otherAdjWords": 0,
      "deltaAdjWords": 3436,
      "targetWordScore": 3436
    },
    "extensions": [
      {
        "step": 1,
        "addedEventId": 852,
        "addedSpeaker": "THE_COURT",
        "addedWords": 23,
        "decision": "extend",
        "statementIndex": 2,
        "targetWords": 0,
        "otherWords": 23,
        "distFactor": 1.260,
        "targetAdjWords": 0,
        "otherAdjWords": 29,
        "deltaAdjWords": -29,
        "targetWordScore": 3407,
        "totalWords": 3459,
        "speakerWords": 3436
      }
    ],
    "finalScore": 3252
  }
}
```

### Key Metrics Tracked

For initial statement and each extension:
- **statementIndex**: Position in evaluation sequence
- **targetWords**: Raw words by target speakers in this statement
- **otherWords**: Raw words by other speakers in this statement
- **distFactor**: Distance-based adjustment factor
- **targetAdjWords**: Distance-adjusted target words
- **otherAdjWords**: Distance-adjusted other words
- **deltaAdjWords**: Net word advantage for this statement
- **targetWordScore**: Cumulative score (what we maximize)

## Configuration

```json
{
  "longStatements": {
    "ratioMode": "WORD_RACE3",
    "minWords": 400,
    "minWordsOpening": 400,
    "minWordsClosing": 500,
    "aggregateTeam": true,
    "maxExtensionAttempts": 20
  }
}
```

### Configuration Parameters

- **ratioMode**: Calculation mode (WORD_RACE, WORD_RACE2, WORD_RACE3)
- **minWords**: Minimum words for baseline statement
- **minWordsOpening**: Override for opening statements
- **minWordsClosing**: Override for closing statements
- **aggregateTeam**: Combine all attorneys on same side
- **maxExtensionAttempts**: Maximum statements to evaluate beyond baseline

## Window Extension Logic

1. **Find baseline statement**: First statement by target speakers meeting minWords threshold
2. **Initialize score**: targetWordScore = baseline statement words
3. **Extend forward**: For each subsequent statement:
   - Calculate adjusted word contributions
   - Update targetWordScore
   - Continue if score improves or decline is minimal
   - Stop on deal-breakers (opposing long statement) or significant score decline
4. **Select best window**: Choose configuration with highest targetWordScore

## Advantages of WORD_RACE

1. **Intuitive Model**: Easy to understand as a "race" between speakers
2. **Distance Sensitivity**: Naturally favors compact statement blocks
3. **Asymmetric Penalties**: Interruptions hurt more when further from baseline
4. **Single Score**: Simple targetWordScore to maximize
5. **Tunable Sensitivity**: Three modes for different distance penalties

## Migration from WEIGHTED_SQRT

### Removed Calculations
- WEIGHTED_SQRT: Complex ratio of ratios approach
- WEIGHTED_SQRT2: Squared variant
- WEIGHTED_SQRT3: Cubed variant
- All "ratio of ratios" logic

### Simplified Approach
- No more separate targetSpeakerRatio and otherSpeakerRatio
- Single targetWordScore metric
- Clear distance-based adjustments
- More predictable behavior

## Implementation Considerations

### Deal-Breakers
The algorithm still stops immediately when encountering:
- Long statement (≥ minWords) from opposing attorney
- End of available statements in search window

### Lookahead Optimization
When encountering short interruptions (< 50 words):
- Look ahead up to 5 statements
- Check for significant same-team content
- Extend through interruption if found

### Team Aggregation
When `aggregateTeam` is true:
- All attorneys on same side count as target speakers
- Enables detection of split statements between co-counsel

## Testing Strategy

1. **Baseline Detection**: Verify correct identification of initial statements
2. **Extension Logic**: Test score calculations with various interruption patterns
3. **Distance Impact**: Validate that distant statements have reduced influence
4. **Mode Comparison**: Compare WORD_RACE vs WORD_RACE2 vs WORD_RACE3 results
5. **Edge Cases**: Test with no interruptions, many interruptions, split statements

## Related Features

- Feature-07H: Long Statements Accumulator V3 (core algorithm)
- Feature-07J: Trial Structure Detection (uses long statements)
- Feature-02J: Attorney metadata for role identification
- Feature-03: Statement event parsing

## Implementation Files

- `/src/phase3/LongStatementsAccumulatorV3.ts`: Core algorithm implementation
- `/src/phase3/StandardTrialHierarchyBuilder.ts`: Integration point
- `/config/trialstyle.json`: Configuration
- `/output/longstatements/*/`: Evaluation logs with detailed calculations