# Feature-03Q: Enhanced Interaction Accumulator Constraints

## Overview
Improve the quality and usability of interaction accumulator results by enforcing stricter constraints and providing detailed statement-level metadata.

## Problem Statement
The `judge_attorney_interaction` and `opposing_counsel_interaction` accumulators were generating results that included:
- Long monologues instead of brief interactions
- Windows without proper speaker type requirements
- Limited visibility into which statements contributed to matches
- No truncation for display statements outside the evaluation window

## Requirements

### 1. Word Count Constraint
- Maximum 20 words per statement within the evaluation window
- Windows containing any statement exceeding 20 words are immediately disqualified
- Prevents long statements/monologues from being classified as interactions

### 2. Enhanced Speaker Requirements

#### judge_attorney_interaction
- Must have at least 3 distinct speakers
- Must include both a JUDGE and at least one ATTORNEY
- Windows missing either speaker type are disqualified

#### opposing_counsel_interaction
- Must have at least 3 distinct speakers
- Must include a JUDGE
- Must include at least one PLAINTIFF attorney
- Must include at least one DEFENDANT attorney
- Attorney roles verified against TrialAttorney table

### 3. Display Window Enhancement
- Expand display size from 5 to 9 statements
- Evaluation window remains 5 statements
- Display window adds 2 statements before and 2 after evaluation window
- Statements outside evaluation window truncated to 20 words with ellipsis

### 4. Statement-Level Metadata
Each statement in results includes:
- `statementId`: Unique identifier
- `speakerHandle`: Speaker name
- `speakerType`: JUDGE, ATTORNEY, JUROR, etc.
- `text`: Full or truncated statement text
- `wordCount`: Original word count
- `inEvaluationWindow`: Boolean for 5-statement evaluation window
- `contributedToEvaluation`: Boolean for match contribution

## Implementation Components

### Modified Files
1. `seed-data/accumulator-expressions.json`
   - Added `maxStatementWords: 20` constraint
   - Updated `displaySize: 9` for both accumulators
   - Added `ATTORNEY` to required speakers for judge_attorney_interaction
   - Activated opposing_counsel_interaction

2. `src/phase3/AccumulatorEngineV2.ts`
   - Added word count validation in `evaluateWindow()`
   - Enhanced speaker type checking for judge_attorney_interaction
   - Added `checkAttorneyRoles()` for plaintiff/defense verification
   - Modified `storeResult()` to build statement-level metadata
   - Added `statementContributed()` helper method
   - Implemented text truncation for display statements

## Benefits
- Higher quality interaction detection
- Reduced false positives from long statements
- Clear visibility into evaluation logic
- Better debugging capabilities
- More interpretable results for downstream processing

## Testing
Tested on Trial 01 Genband:
- judge_attorney_interaction: 137 matches
- opposing_counsel_interaction: 61 matches
- Confirmed truncation working for statements outside evaluation window
- Verified attorney role detection functioning correctly

## Usage
1. Update accumulator configurations in seed data
2. Delete phase3 data for target trial
3. Rerun phase3 processing
4. Results include enhanced metadata automatically