# Feature-03P: Parsing Bug Fixes for GUI Display

## Overview
Critical bug fixes for parsing issues that affect data display in the GUI developed in Feature-09C. These issues primarily involve attorney assignment, witness event tracking, and section hierarchy generation.

## Issues to Fix

### 1. WitnessCalledEvent Missing AttorneyId
**Problem**: WitnessCalledEvents are being created without attorneyId, which should never happen.

**Current Behavior**:
- Some WitnessCalledEvents lack attorneyId
- The "BY MR. [ATTORNEY]" pattern is not being properly associated with the witness event

**Expected Behavior**:
- Every WitnessCalledEvent MUST have an attorneyId
- The attorney should be established from the "BY MR. [ATTORNEY]" pattern within the witness block
- If the attorney pattern appears immediately after the witness called event (within a few lines), update the just-created event

**Solution**:
- Process the entire witness call block together to extract all relevant data
- Ensure attorney identification is part of the WitnessCalledEvent creation
- If attorney is identified after event creation but within the same block, update the event

### 2. Incorrect Attorney Assignment (Off-by-One Error)
**Problem**: Attorneys are being assigned to the wrong examination type - the attorney who conducted direct examination is being assigned to cross-examination.

**Current Behavior**:
- Attorney assignment appears to be delayed by one event
- The current attorney is set AFTER creating the witness event, affecting the next examination
- This causes attorney roles to be reversed (direct examiner assigned to cross, etc.)

**Expected Behavior**:
- Attorney conducting examination should be correctly assigned to their examination type
- Direct examination attorney should be assigned to direct examination events
- Cross examination attorney should be assigned to cross examination events

**Solution**:
- Set current attorney BEFORE creating witness/examination events
- Ensure attorney context is established when processing witness blocks
- Fix timing of attorney assignment in the parsing sequence

### 3. Redundant MarkerSection Hierarchy Entries
**Problem**: Blank and redundant sections are being created in the MarkerSection hierarchy.

**Redundant Patterns Identified**:
1. "CompleteWitnessTestimony" as child of "Witness Testimony Period" with no children
2. "Witness Testimony" alongside specific witness sections like "WitTest_MARK_STEWART"

**Expected Behavior**:
- Only meaningful sections with content or children should be in hierarchy
- Remove redundant parent sections that have specific child sections
- Clean hierarchy without duplicate or empty intermediate nodes

**Solution**:
- Filter out sections without children that duplicate parent functionality
- Remove generic sections when specific witness sections exist
- Implement hierarchy cleanup during phase3 processing

### 4. Summary File Naming and Organization
**Problem**: Current file naming is redundant and folder structure doesn't support multiple summary types.

**Current Structure**:
```
output/markersections/22 Core Wireless V. Apple/
  22 Core Wireless V. Apple_22_Core_Wireless_V_Apple_-_Complete_Trial.txt
  22 Core Wireless V. Apple_Defense_Closing_Statement.txt
```

**New Structure**:
```
output/markersections/22 Core Wireless V. Apple/FullText/
  Complete_Trial.txt
  Defense_Closing_Statement.txt
output/markersections/22 Core Wireless V. Apple/Abridged1/
  Complete_Trial.txt
  Defense_Closing_Statement.txt
output/markersections/22 Core Wireless V. Apple/Abridged2/
  Complete_Trial.txt
  Defense_Closing_Statement.txt
```

**Future Structure (for LLM summaries)**:
```
output/markersections/22 Core Wireless V. Apple/LLMSummary1/
output/markersections/22 Core Wireless V. Apple/LLMSummary2/
```

**Solution**:
- Remove redundant trial name prefix from filenames
- Use MarkerSection.name with .txt extension
- Create subdirectories for different summary types
- Prepare structure for future LLM summary integration

### 5. Overlapping Accumulator Patterns
**Problem**: Accumulator patterns for objections and interactions create overlapping matches.

**Current Behavior**:
- Accumulator evaluates after advancing by single event
- Creates overlapping patterns when matches occur within the window
- Results in duplicate or overlapping objection/interaction markers

**Expected Behavior**:
- After finding a match, advance cursor to END of current pattern
- Prevent overlapping matches within the same window
- Clean, non-overlapping pattern matches

**Solution**:
- Implement cursor advancement to end of matched pattern
- Make this the default behavior for accumulators
- Add optional configuration for different advancement strategies

## Implementation Priority
1. Fix attorney assignment issues (Critical for data accuracy)
2. Fix overlapping accumulator patterns (Affects objection/interaction detection)
3. Clean up MarkerSection hierarchy (Improves navigation)
4. Reorganize summary file structure (Prepares for future features)

## Testing Requirements
- Verify all WitnessCalledEvents have attorneyId
- Confirm attorney assignments match examination types
- Check MarkerSection hierarchy has no redundant entries
- Validate new file naming and folder structure
- Ensure no overlapping objection/interaction patterns

## Files to Modify
- `src/services/TranscriptParser.ts` - Attorney assignment logic
- `src/services/WitnessService.ts` - Witness event creation
- `src/services/MarkerSectionService.ts` - Hierarchy building and summary generation
- `src/services/AccumulatorService.ts` - Pattern matching cursor advancement
- Phase 3 processing scripts for summary generation

## Success Criteria
- GUI displays correct attorney for each examination
- No missing attorneyId in database
- Clean MarkerSection hierarchy without redundancy
- Organized summary file structure ready for multiple summary types
- No overlapping objection/interaction patterns in output