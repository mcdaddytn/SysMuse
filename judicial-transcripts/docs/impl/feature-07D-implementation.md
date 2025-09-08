# Feature 07D Implementation Guide

## Overview
Implementation of Standard Trial Sequence and Trial/Session hierarchy for organizing trial transcripts into meaningful sections.

## Implementation Date
2024-01-08

## Core Components

### 1. StandardTrialHierarchyBuilder
**Location**: `src/phase3/StandardTrialHierarchyBuilder.ts`

**Purpose**: Builds the complete trial hierarchy with proper parent-child relationships.

**Key Methods**:
- `buildStandardHierarchy()` - Main entry point
- `buildWitnessTestimonyHierarchy()` - Bottom-up construction of witness testimony sections
- `findOpeningStatements()` - Uses LongStatementsAccumulator to find opening statements
- `findClosingStatements()` - Uses LongStatementsAccumulator to find closing statements
- `createSessionHierarchy()` - Creates session-based organization

### 2. LongStatementsAccumulator
**Location**: `src/phase3/LongStatementsAccumulator.ts`

**Purpose**: Identifies long continuous statements (opening/closing arguments) using word count analysis.

**Key Features**:
- Word count-based detection (500+ words threshold)
- Attorney role detection via TrialAttorney relationships
- Fallback to traditional sliding window approach
- Confidence scoring based on word count and speaker dominance

**Algorithm**:
1. Search for high word count events (>500 words) by attorneys
2. Group nearby high word count events (within 10 events)
3. Calculate speaker dominance ratio
4. Return blocks meeting minimum word count and maximum interruption thresholds

### 3. WitnessMarkerDiscovery (Modified)
**Location**: `src/phase3/WitnessMarkerDiscovery.ts`

**Key Fix**: Proper detection of last witness examination end
- Searches for last witness statement by speaker type
- Falls back to attorney speech transition detection
- Prevents extension to end of trial (was bug causing event 5717 issue)

## Database Schema

### MarkerSectionType Enum Values Used
```
TRIAL
SESSION
CASE_INTRO
JURY_SELECTION
OPENING_STATEMENTS_PERIOD
OPENING_STATEMENT_PLAINTIFF
OPENING_STATEMENT_DEFENSE
WITNESS_TESTIMONY_PERIOD
WITNESS_TESTIMONY_PLAINTIFF
WITNESS_TESTIMONY_DEFENSE
WITNESS_TESTIMONY
WITNESS_EXAMINATION
CLOSING_STATEMENTS_PERIOD
CLOSING_STATEMENT_PLAINTIFF
CLOSING_STATEMENT_DEFENSE
CLOSING_REBUTTAL_PLAINTIFF
JURY_DELIBERATION
JURY_VERDICT
CASE_WRAPUP
```

## Hierarchy Structure

### Level 1: TRIAL
- Root node containing entire trial
- Events 1 to last event
- 100% confidence

### Level 2: Major Sections (under TRIAL)
- CASE_INTRO
- JURY_SELECTION
- OPENING_STATEMENTS_PERIOD
- WITNESS_TESTIMONY_PERIOD
- CLOSING_STATEMENTS_PERIOD
- JURY_DELIBERATION
- JURY_VERDICT
- CASE_WRAPUP

### Level 2: SESSION (parallel hierarchy under TRIAL)
- SESSION nodes for each court session
- Based on SessionBoundaryEvent records

### Level 3: Sub-sections
- Under OPENING_STATEMENTS_PERIOD:
  - OPENING_STATEMENT_PLAINTIFF
  - OPENING_STATEMENT_DEFENSE
  
- Under WITNESS_TESTIMONY_PERIOD:
  - WITNESS_TESTIMONY_PLAINTIFF
  - WITNESS_TESTIMONY_DEFENSE
  
- Under CLOSING_STATEMENTS_PERIOD:
  - CLOSING_STATEMENT_PLAINTIFF
  - CLOSING_STATEMENT_DEFENSE
  - CLOSING_REBUTTAL_PLAINTIFF

### Level 4: Individual Components
- Under WITNESS_TESTIMONY_PLAINTIFF/DEFENSE:
  - WITNESS_TESTIMONY (per witness)
  
- Under WITNESS_TESTIMONY:
  - WITNESS_EXAMINATION (per examination type)

## Configuration

### Thresholds for LongStatementsAccumulator
```typescript
// Opening Statements
{
  minWords: 50,              // Lower threshold for testing
  maxInterruptionRatio: 0.4  // Allow up to 40% interruption
}

// Closing Statements  
{
  minWords: 100,             // Higher threshold
  maxInterruptionRatio: 0.3  // Allow up to 30% interruption
}
```

### Word Count Detection
- High word count threshold: 500 words
- Events within 10 IDs considered part of same statement block

## Testing Results - 01 Genband Trial

### Statistics
- Total sections: 65 (after cleanup)
- Event coverage: 100% (5717/5717 events)
- Witness examinations: 31
- Sessions: 8

### Key Sections Found
- Opening Statement Plaintiff: Event 851 (3,438 words)
- Opening Statement Defense: Events 855-857 (3,330 words total)
- Witness Testimony Period: Events 886-5417
- Closing Statements: Events 5653-5672
- Jury Verdict: Events 5709-5711

## Disabled Components

### ActivityMarkerDiscovery
- Temporarily disabled to prevent creation of non-standard sections
- Was creating 3,935+ BENCH_CONFERENCE sections
- Will re-enable with better filtering

### Non-Standard Section Types Removed
- BENCH_CONFERENCE
- SIDEBAR
- OBJECTION_SEQUENCE
- CUSTOM

## CLI Commands

### Build Hierarchy
```bash
npx ts-node src/cli/build-hierarchy.ts build --trial 1 --clean --stats
```

### Run Full Phase 3
```bash
npx ts-node src/cli/phase3.ts process --trial 1 --clean
```

### Inspect Hierarchy
```bash
npx ts-node src/cli/build-hierarchy.ts inspect --trial 1
```

## Next Steps

1. Test on additional trials
2. Implement objection pattern detection
3. Add Mustache template rendering for sections
4. Enable LLM summarization
5. Re-enable ActivityMarkerDiscovery with proper filtering

## Known Issues

1. Some closing statement events may overlap - need better boundary detection
2. COMPLETE_WITNESS_TESTIMONY section may be redundant with WITNESS_TESTIMONY_PERIOD
3. Need to handle trials without certain sections (e.g., no jury selection in bench trials)

## Dependencies

- Phase 2 must complete successfully (witness called events, session boundaries)
- TrialAttorney relationships must be properly seeded for attorney role detection
- Word counts must be populated on TrialEvent records