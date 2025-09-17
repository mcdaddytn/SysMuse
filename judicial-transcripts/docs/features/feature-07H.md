# Feature-07H: Enhanced Opening and Closing Argument Detection

## Overview
Refined detection of opening and closing arguments in judicial transcripts using multi-strategy search, team aggregation for split arguments, and validation to exclude non-argument sections.

## Problem Statement
The current LongStatementsAccumulator (Feature-07E) has limitations in detecting opening and closing arguments:
1. **Missing arguments** - Fails to detect some opening/closing statements that exist in transcripts
2. **Split arguments** - Cannot handle arguments split between multiple attorneys on the same side
3. **Incorrect chronological ordering** - Sometimes identifies arguments in wrong order (e.g., finding rebuttal as main closing)
4. **False positives** - May capture witness examination or other non-argument sections

## Solution Approach

### 1. Team Aggregation
- Aggregate statements from all attorneys on the same side (plaintiff or defense)
- Handle split arguments where multiple attorneys share opening/closing duties
- Maintain speaker attribution while calculating team-level metrics

### 2. Multi-Strategy Search
Execute multiple search strategies and compare results:

#### Defense-First Strategy (Often Most Effective)
- Search for defense argument first (often easier to detect due to length/structure)
- Use defense position to narrow search window for plaintiff arguments
- For opening: plaintiff should be BEFORE defense
- For closing: plaintiff should be BEFORE defense, rebuttal AFTER defense

#### Plaintiff-First Strategy
- Search for plaintiff argument first
- Use plaintiff position to narrow search for defense
- Validate chronological order

#### Parallel Strategy
- Search for both sides independently
- Compare and validate results

#### Chronological Strategy
- Find all high-word-count attorney statements
- Sort chronologically and assign roles based on position

### 3. Validation Criteria
Arguments must NOT contain:
- Witness testimony statements
- Juror statements (except during voir dire for opening)
- Excessive interruptions from non-attorneys

Arguments SHOULD contain:
- High concentration of attorney speech (>70% typical)
- Minimal judge interruptions (time warnings acceptable)
- Continuous narrative flow

### 4. Chronological Order Rules

#### Opening Statements
1. Plaintiff opening (first)
2. Defense opening (second)

#### Closing Arguments
1. Plaintiff closing (first)
2. Defense closing (second)
3. Plaintiff rebuttal (optional, third)

## Technical Implementation

### Components
1. **LongStatementsAccumulatorV2** - Enhanced accumulator with team aggregation
2. **ArgumentFinder** - Orchestrates multi-strategy search and validation
3. **StandardTrialHierarchyBuilder** - Integration point

### Key Features
- Team attorney aggregation
- Multi-strategy parallel execution
- Speaker type validation
- Chronological order verification
- Confidence scoring with validation scores

## Configuration Parameters

```typescript
{
  minWords: 400,           // Minimum words for opening (500 for closing)
  maxInterruptionRatio: 0.4, // Up to 40% interruption allowed
  ratioMode: 'SMART_EXTEND', // or 'WEIGHTED_SQRT', 'TEAM_AGGREGATE'
  ratioThreshold: 0.4,      // Minimum speaker dominance ratio
  aggregateTeam: true       // Enable team aggregation
}
```

## Success Metrics
- Detect 95%+ of opening statements
- Detect 95%+ of closing arguments including rebuttals
- Zero false positives from witness testimony
- Correct chronological ordering in all cases

## Test Cases

### 01 Genband
- Missing: Plaintiff closing at event 5658 (MR. KUBEHL, 2246 words)
- Defense closing at 5662 (MR. VERHOEVEN, 3167 words)
- Plaintiff rebuttal at 5672 (MR. DACUS, 1362 words)

### 28 Implicit V Netscout
- Plaintiff opening found
- Defense opening incorrectly identified (jury selection instead)
- Look for text: "Defendant may now present its opening statement to the jury"

### 36 Salazar V Htc
- Plaintiff opening found
- Defense opening incorrectly placed before plaintiff (should be after)
- Defense opening starts with: "MR. WILLIAMS: May it please the Court. Ladies and gentlemen of the jury..."

## Dependencies
- Feature-07E: Original LongStatementsAccumulator
- Attorney role assignments must be complete
- Speaker identification must be accurate

## Status
In Development - Initial implementation complete, refinement needed for edge cases