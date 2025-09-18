# Feature-07J: Trial Structure Detection Framework with StandardTrialStructure Algorithm

## Overview

This feature defines a flexible framework for detecting and organizing the hierarchical structure of judicial trial transcripts. The framework supports multiple trial structure algorithms, with the primary implementation being the **StandardTrialStructure** algorithm that identifies common trial phases and their relationships through progressive window narrowing.

## Architecture

### Framework Design

The system allows for multiple trial structure detection algorithms to be configured and selected based on trial characteristics. Each algorithm implements a specific sequence of marker detection operations tailored to different trial types or jurisdictions.

```json
{
  "trialStructure": "StandardTrialStructure",
  "longStatements": {
    "ratioMode": "WEIGHTED_SQRT",
    "minWords": 400
  }
}
```

### Supported Trial Structures

1. **StandardTrialStructure** - The default algorithm for most trials
2. Future implementations could include:
   - `BenchTrialStructure` - For trials without jury
   - `CriminalTrialStructure` - For criminal proceedings
   - `AppellateStructure` - For appellate court proceedings

## StandardTrialStructure Algorithm

### Core Principle: Progressive Window Narrowing

The algorithm works by progressively identifying major trial periods and then using those boundaries to narrow the search windows for more specific sections. This approach:
- Reduces false positives by searching in contextually appropriate regions
- Improves performance by limiting search scope
- Creates natural hierarchical relationships between sections

### Phase 1: Establish Core Periods

#### 1.1 Find Witness Testimony Period
- **Purpose**: Identify the central portion of the trial where witnesses testify
- **Method**: Detect all witness examination sections and their hierarchy
- **Output**:
  - Complete witness testimony hierarchy with individual witness sections
  - `WITNESS_TESTIMONY_PERIOD` marker section encompassing all testimony
  - Boundary events marking the start and end of testimony

#### 1.2 Define Primary Trial Divisions
Based on the Witness Testimony Period boundaries, establish three major divisions:

1. **Pre-Witness Testimony Period**
   - Start: First event of trial
   - End: Last event before Witness Testimony Period begins
   - Contains: Jury selection, opening statements, preliminary matters

2. **Witness Testimony Period** (already established)
   - Start: First witness examination event
   - End: Last witness examination event
   - Contains: All witness testimonies and examinations

3. **Post-Witness Testimony Period**
   - Start: First event after Witness Testimony Period ends
   - End: Last event of trial
   - Contains: Closing statements, jury instructions, verdict, wrap-up

### Phase 2: Refine Pre-Testimony Period

#### 2.1 Find Jury Selection
- **Search Window**: Pre-Witness Testimony Period
- **Method**:
  - Find first `StatementEvent` with `speakerType = JUROR`
  - Find last `StatementEvent` with `speakerType = JUROR`
- **Output**: `JURY_SELECTION` marker section

#### 2.2 Define Pre-Testimony Subdivisions
If Jury Selection is found, create three subdivisions:

1. **Before Jury Selection**
   - Start: First event of trial
   - End: Last event before Jury Selection begins

2. **Jury Selection** (already established)
   - Start: First juror statement
   - End: Last juror statement

3. **After Jury Selection**
   - Start: First event after Jury Selection ends
   - End: Last event before Witness Testimony Period

If no Jury Selection is found, the entire Pre-Witness Testimony Period becomes the search window for subsequent sections.

### Phase 3: Find Opening Statements

#### 3.1 Determine Search Window
- **If Jury Selection exists**: Search within "After Jury Selection" period
- **If no Jury Selection**: Search entire Pre-Witness Testimony Period

#### 3.2 Apply Defense-First Strategy
Using the Long Statements Accumulator V3 algorithm (Feature-07H):

1. **Find Defense Opening First**
   - Search for longest defense attorney statement in window
   - Use WEIGHTED_SQRT ratio calculation
   - Require minimum word threshold

2. **Find Plaintiff Opening**
   - Search before defense opening (if found)
   - Or search entire window if no defense opening

3. **Create Marker Sections**
   - `OPENING_STATEMENT_PLAINTIFF`
   - `OPENING_STATEMENT_DEFENSE`
   - `OPENING_STATEMENTS_PERIOD` (encompassing both)

### Phase 4: Find Closing Statements

#### 4.1 Search Window
- **Primary**: Post-Witness Testimony Period
- **Refinement**: May be further narrowed if jury instructions are detected

#### 4.2 Apply Defense-First Strategy
Similar to opening statements:

1. **Find Defense Closing First**
   - Search for longest defense attorney statement

2. **Find Plaintiff Main Closing**
   - Search before defense closing

3. **Find Plaintiff Rebuttal**
   - Search after defense closing
   - Use reduced minimum word threshold (60% of main closing)

4. **Create Marker Sections**
   - `CLOSING_STATEMENT_PLAINTIFF`
   - `CLOSING_STATEMENT_DEFENSE`
   - `CLOSING_REBUTTAL_PLAINTIFF`
   - `CLOSING_STATEMENTS_PERIOD` (encompassing all)

### Phase 5: Find Post-Closing Sections

#### 5.1 Search for Jury Deliberation
- **Window**: After closing statements end
- **Method**: Detect markers indicating jury retirement
- **Output**: `JURY_DELIBERATION` marker section

#### 5.2 Find Jury Verdict
- **Window**: After Jury Deliberation (if found) or after closing statements
- **Method**: Detect verdict reading markers
- **Output**: `JURY_VERDICT` marker section

#### 5.3 Find Case Wrap-up
- **Window**: After Jury Verdict (if found)
- **Method**: Detect post-verdict proceedings
- **Output**: `CASE_WRAPUP` marker section

### Phase 6: Find Case Introduction

- **Window**: Before Jury Selection (if found) or start of trial
- **Method**: Detect initial court proceedings
- **Output**: `CASE_INTRODUCTION` marker section

## Hierarchical Structure

The resulting hierarchy for StandardTrialStructure:

```
TRIAL (root)
├── CASE_INTRODUCTION
├── JURY_SELECTION
├── OPENING_STATEMENTS_PERIOD
│   ├── OPENING_STATEMENT_PLAINTIFF
│   └── OPENING_STATEMENT_DEFENSE
├── WITNESS_TESTIMONY_PERIOD
│   ├── WITNESS_TESTIMONY_PLAINTIFF
│   │   └── [Individual witness sections]
│   └── WITNESS_TESTIMONY_DEFENSE
│       └── [Individual witness sections]
├── CLOSING_STATEMENTS_PERIOD
│   ├── CLOSING_STATEMENT_PLAINTIFF
│   ├── CLOSING_STATEMENT_DEFENSE
│   └── CLOSING_REBUTTAL_PLAINTIFF
├── JURY_DELIBERATION
├── JURY_VERDICT
└── CASE_WRAPUP
```

## Configuration

### Trial Style Configuration
```json
{
  "trialStructure": "StandardTrialStructure",
  "longStatements": {
    "ratioMode": "WEIGHTED_SQRT",
    "ratioThreshold": 0.6,
    "minWords": 400,
    "minWordsOpening": 400,
    "minWordsClosing": 500,
    "aggregateTeam": true
  },
  "windowNarrowing": {
    "useJurorStatements": true,
    "useWitnessTestimony": true,
    "progressiveRefinement": true
  }
}
```

### Algorithm Selection Logic

The system selects the appropriate trial structure algorithm based on:
1. Explicit configuration in `trialstyle.json`
2. Trial metadata (e.g., case type, jurisdiction)
3. Default to `StandardTrialStructure` if not specified

## Benefits of Window Narrowing Approach

### 1. Improved Accuracy
- Reduces false positives by searching in appropriate contexts
- Opening statements won't be confused with closing statements
- Jury selection won't overlap with witness testimony

### 2. Performance Optimization
- Smaller search windows mean faster processing
- Reduces computational complexity for ratio calculations
- Enables more sophisticated algorithms within narrowed windows

### 3. Logical Organization
- Creates natural boundaries between trial phases
- Maintains chronological order while respecting logical groupings
- Facilitates navigation and understanding of trial flow

### 4. Flexibility
- Can handle trials with missing sections (no jury, no opening, etc.)
- Gracefully degrades when sections aren't found
- Allows for trial-specific customization

## Implementation Considerations

### Private vs. Public Markers

Some periods are used only for window narrowing and don't need visible markers:
- Pre-Witness Testimony Period (private)
- Post-Witness Testimony Period (private)
- Before/After Jury Selection subdivisions (private)

These can be tracked internally without creating database records.

### Error Handling

The algorithm must handle:
- Missing sections (no jury selection, no closing statements)
- Overlapping statements (attorneys speaking simultaneously)
- Split statements (multiple attorneys for same side)
- Unusual trial sequences

### Extensibility

New trial structure algorithms can be added by:
1. Implementing the `TrialStructureDetector` interface
2. Defining the detection sequence
3. Registering in the algorithm factory
4. Adding configuration support

## Related Features

- **Feature-07H**: Long Statements Accumulator V3 (defense-first strategy)
- **Feature-07I**: WEIGHTED_SQRT ratio calculations
- **Feature-02J**: Attorney metadata for role identification
- **Feature-03**: Witness testimony detection and hierarchy

## Future Enhancements

### Potential Additional Structures

1. **BenchTrialStructure**
   - No jury selection phase
   - Modified opening/closing detection
   - Judge-centric markers

2. **CriminalTrialStructure**
   - Arraignment phase
   - Sentencing phase
   - Plea proceedings

3. **AppellateStructure**
   - Oral arguments instead of witness testimony
   - No jury phases
   - Focus on legal arguments

### Machine Learning Integration

- Train models on window boundaries for each trial type
- Automatically suggest optimal structure based on trial characteristics
- Learn from manual corrections to improve detection

## Testing Strategy

### Unit Tests
- Test each phase independently with mock data
- Verify window narrowing logic
- Test boundary conditions

### Integration Tests
- Full trial processing with known structures
- Verify hierarchy creation
- Test with various missing sections

### Validation
- Compare against manually annotated trials
- Measure precision and recall for each section type
- Track processing time improvements from window narrowing