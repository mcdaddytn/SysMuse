# Feature-07H: Enhanced Opening and Closing Argument Detection with Advanced Long Accumulator

## Overview
Refined detection of opening and closing arguments in judicial transcripts using multi-strategy search, team aggregation for split arguments, sliding window evaluation with state tracking, and validation to exclude non-argument sections.

## Problem Statement
The current LongStatementsAccumulator (Feature-07E) has limitations in detecting opening and closing arguments:
1. **Missing arguments** - Fails to detect some opening/closing statements that exist in transcripts
2. **Split arguments** - Cannot handle arguments split between multiple attorneys on the same side
3. **Incorrect chronological ordering** - Sometimes identifies arguments in wrong order (e.g., finding rebuttal as main closing)
4. **False positives** - May capture witness examination or other non-argument sections
5. **Lack of visibility** - No tracking of evaluated windows for algorithm refinement

## Enhanced Long Accumulator Algorithm

### Overall Algorithm Steps

#### Step 1: Establish Initial Enclosing Window
- **Opening Statements**: Between trial start and beginning of witness testimony
  - Further refined: Find end of last juror statement (if any) to shrink start boundary
  - End boundary: First witness testimony event
- **Closing Statements**: Between end of witness testimony and trial end
  - Start boundary: Last witness testimony event
  - Further refined: Find start of first juror statement at trial end to shrink end boundary

#### Step 2: Find Defense Long Statements FIRST (Primary Search)
**CRITICAL STRATEGY**: We intentionally search for defense statements FIRST, even though chronologically plaintiff statements come before defense. This counterintuitive approach works because:
- **Defense statements are often easier to detect** (typically longer, more structured)
- **Defense statements serve as a reliable anchor point** for narrowing the search
- **Once found, defense position helps us accurately locate plaintiff statements**

Process:
- Find all StatementEvent objects within enclosing window where defense attorney speaks
- Identify candidate starting statements that exceed `minWords` threshold
- **Critical**: First StatementEvent MUST meet threshold to be a candidate start
- For each candidate start:
  - Extend window forward aggregating consecutive StatementEvents
  - Calculate ratio using WEIGHTED_SQRT at each extension
  - Continue extending while ratio improves or stays above threshold
  - Stop when ratio begins declining
  - Track maximum ratio achieved
- Select the window with highest final ratio as defense statement
- **Deal-breakers**:
  - Opposing attorney statement exceeding minWords threshold breaks the window
  - Cannot continue aggregation past such interruptions

#### Step 3: Narrow Window for Plaintiff Statement (Search BEFORE Defense)
- **KEY**: Now search CHRONOLOGICALLY BEFORE the defense statement
- Update enclosing window: Start remains the same, END becomes defense statement start - 1
- This creates a smaller search window for plaintiff initial statement
- **Ensures correct chronological order**: Plaintiff will be found before defense

#### Step 4: Find Plaintiff Long Statement (In Narrowed Window Before Defense)
- Apply same algorithm as Step 2 but for plaintiff attorneys
- Search within the narrowed window (events BEFORE defense statement)
- Select highest ratio window as plaintiff statement
- **Result**: Plaintiff statement position < Defense statement position (correct chronological order)

#### Step 5: Search for Optional Plaintiff Rebuttal
- Search window: After defense statement end, before original enclosing window end
- Only consider if a statement meets minWords threshold
- Apply same extension algorithm to find optimal rebuttal boundaries

### State Tracking and JSON Output

All evaluated windows are logged to `output/longstatements/[trial-name]/` with:
- Window start/end events
- Speaker composition
- Word counts (total, speaker, interruptions)
- Ratio calculations at each step
- Extension decisions
- Final selection reasoning

JSON structure for each evaluated window:
```json
{
  "windowId": "defense_candidate_1",
  "startEventId": 5662,
  "endEventId": 5664,
  "speakerRole": "DEFENSE",
  "evaluation": {
    "initialStatement": {
      "eventId": 5662,
      "speaker": "MR_VERHOEVEN",
      "wordCount": 1523,
      "meetsThreshold": true
    },
    "extensions": [
      {
        "step": 1,
        "addedEventId": 5663,
        "ratio": 0.95,
        "decision": "extend",
        "totalWords": 2847,
        "speakerWords": 2700
      }
    ],
    "finalRatio": 0.98,
    "selected": true
  }
}
```

## Solution Approach

### 1. Team Aggregation
- Aggregate statements from all attorneys on the same side (plaintiff or defense)
- Handle split arguments where multiple attorneys share opening/closing duties
- Maintain speaker attribution while calculating team-level metrics

### 2. Multi-Strategy Search
Execute multiple search strategies and compare results:

#### Defense-First Strategy (Most Effective - Primary Approach)
**The Core Insight**: Search for defense arguments FIRST, even though they come second chronologically.

Why this works:
- Defense arguments are typically easier to detect (longer, more structured, fewer variations)
- Once found, defense position provides a reliable anchor point
- We then search BEFORE the defense position to find plaintiff arguments

Expected chronological results:
- **Opening Statements**: Plaintiff (found second) → Defense (found first)
- **Closing Statements**: Plaintiff (found second) → Defense (found first) → Rebuttal (found third)

This counterintuitive approach significantly improves detection accuracy by using the more reliable defense statements as reference points.

#### Plaintiff-First Strategy (Fallback)
- Search for plaintiff argument first
- Use plaintiff position to narrow search for defense
- Validate chronological order

#### Parallel Strategy (Validation)
- Search for both sides independently
- Compare and validate results

#### Chronological Strategy (Discovery)
- Find all high-word-count attorney statements
- Sort chronologically and assign roles based on position

### 3. Validation Criteria

#### Initial Statement Requirements
- **First StatementEvent MUST meet minWords threshold** to be considered as start
- This alone significantly narrows candidates

#### Arguments must NOT contain:
- Witness testimony statements
- Juror statements (except during voir dire for opening)
- Excessive interruptions from non-attorneys exceeding minWords threshold
- Opposing attorney statements exceeding minWords (deal-breaker for extension)

#### Arguments SHOULD contain:
- High concentration of attorney speech (>70% typical, using WEIGHTED_SQRT ratio)
- Minimal judge interruptions (time warnings acceptable)
- Continuous narrative flow

### 4. Chronological Order Rules

#### Opening Statements (Expected Order)
1. Plaintiff opening (first)
2. Defense opening (second)

#### Closing Arguments (Expected Order)
1. Plaintiff closing (first)
2. Defense closing (second)
3. Plaintiff rebuttal (optional, third)

**Note**: The algorithm validates this order and uses it for window narrowing

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
  minWords: 400,           // Minimum words for initial statement to qualify
  maxInterruptionRatio: 0.4, // Up to 40% interruption allowed
  ratioMode: 'WEIGHTED_SQRT', // Primary ratio calculation mode
  ratioThreshold: 0.4,      // Minimum speaker dominance ratio
  aggregateTeam: true,      // Enable team aggregation

  // New parameters for enhanced algorithm
  outputDir: './output/longstatements',  // Directory for window tracking JSON
  trackEvaluations: true,   // Enable detailed window evaluation tracking
  requireInitialThreshold: true, // First statement must meet minWords
  breakOnOpposingLongStatement: true, // Stop extension on opposing minWords statement

  // Window refinement parameters
  refineJurorBoundaries: true,  // Shrink windows based on juror statements
  maxExtensionAttempts: 20,     // Maximum forward extensions to try
  declineThreshold: 0.05        // Stop extending if ratio drops by this amount
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

## Algorithm Logging and Analysis

### Window Evaluation Output
Each trial generates a comprehensive log in `output/longstatements/[trial-name]/`:

```
output/longstatements/
├── 01 Genband/
│   ├── opening-evaluation.json    # All evaluated windows for opening statements
│   ├── closing-evaluation.json    # All evaluated windows for closing statements
│   ├── final-selections.json      # Final selected windows with reasoning
│   └── algorithm-summary.json     # Summary statistics and performance metrics
├── 04 Intellectual Ventures/
│   └── ...
```

### Evaluation Tracking Structure
```json
{
  "trial": "01 Genband",
  "phase": "closing",
  "evaluations": [
    {
      "searchStrategy": "defense-first",
      "enclosingWindow": {
        "start": 5000,
        "end": 5700,
        "refinedByJuror": false
      },
      "defenseSearch": {
        "candidates": [
          {
            "candidateId": "def_1",
            "initialEvent": 5662,
            "initialWords": 1523,
            "meetsThreshold": true,
            "extensions": [...],
            "finalWindow": [5662, 5664],
            "finalRatio": 0.98
          }
        ],
        "selected": "def_1",
        "selectionReason": "highest_ratio"
      },
      "plaintiffSearch": {
        "narrowedWindow": [5000, 5661],
        "candidates": [...],
        "selected": "pl_1"
      },
      "rebuttalSearch": {
        "searchWindow": [5665, 5700],
        "found": true,
        "window": [5672, 5676]
      }
    }
  ],
  "finalSelection": {
    "plaintiff": [5653, 5661],
    "defense": [5662, 5664],
    "rebuttal": [5672, 5676]
  }
}
```

## Status
In Development - Enhanced algorithm with state tracking and window evaluation logging being implemented