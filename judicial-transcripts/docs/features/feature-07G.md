# Feature-07G: MarkerSection Text Enhancement and Phase3 Improvements

## Overview
Improvements to MarkerSection text generation, storage, and phase3 processing capabilities.

## Requirements

### 1. MarkerSection Text Output to Files
- Create output directory `./output/markersections/`
- Save full text for each MarkerSection to individual text files
- Use MarkerSection.name as the root of the filename (with .txt extension)
- Organize by trial subdirectory using Trial.shortName

### 2. Summary Modes for MarkerSection.text
- **SUMMARYABRIDGED1** (original mode):
  - Excerpt from the beginning (5 lines)
  - Summary statistics (events, speakers, words, etc.)
  
- **SUMMARYABRIDGED2** (new default):
  - Excerpt from the beginning (3 lines)
  - ... separator
  - Excerpt from the end (3 lines)
  - Summary statistics
  
- Make configurable in multi-trial-config-mac.json
- Default to SUMMARYABRIDGED2 for better debugging visibility

### 3. MarkerSection Text Append and Clean Modes
- Add `markerAppendMode` configuration (similar to statementAppendMode)
  - Options: 'space', 'newline', 'windowsNewline', 'unixNewline'
- Add `markerCleanMode` configuration (similar to statementCleanMode)
  - Options: 'NONE', 'REMOVEEXTRASPACE'
- Apply these modes when building MarkerSection.text content

### 4. Concise MarkerSection Names
- Apply abbreviations to make names more concise:
  - WitnessExamination → WitExam
  - WITNESS_TESTIMONY → WitTest
  - REDIRECT_EXAMINATION → Redir
  - RECROSS_EXAMINATION → Recross
  - DIRECT_EXAMINATION → Direct
  - CROSS_EXAMINATION → Cross
  - OPENING_STATEMENT → Opening
  - CLOSING_STATEMENT → Closing
  
- Use witnessFingerprint instead of WITNESS_ID numbers
- Use session_handle instead of session IDs
- Replace spaces with underscores in names
- Include Trial.shortName in the name for uniqueness
- Avoid using database IDs in names

### 5. Phase3-Only Deletion Capability
- Add ability to delete only phase3 data (Markers and MarkerSections)
- Preserve phase1 and phase2 data in database
- Update TrialWorkflowState to allow phase3 rerun
- Useful for testing phase3 changes without full data reload

### 6. Fix HTML Entity Artifacts
- Fix HTML entities (&#39;, &quot;, etc.) in MarkerSection text
- Apply fixes in template generation before saving to database
- Ensure Mustache templates don't escape HTML entities
- Clean up existing hierarchy-view output formatting

### 7. Fix Witness Testimony End Detection
- **Critical Issue**: Last witness examination often extends to end of trial
- Must detect when the last witness stops speaking
- Set end of witness testimony period correctly
- This affects closing statement detection which should come after witness testimony
- Special handling needed for last witness (no next witness to mark boundary)

### 8. Session Output Text Issues
- Investigate why hierarchical session output (_sess suffix) shows strange statements
- Often shows "All rise." from different speakers (COURT SECURITY OFFICER, witnesses, etc.)
- This seems incorrect and needs investigation
- May be related to how session boundaries are detected

## Configuration Schema Updates

Add to TranscriptConfig and TrialStyleConfig:
```typescript
{
  // Summary mode for MarkerSection text
  "markerSummaryMode": "SUMMARYABRIDGED1" | "SUMMARYABRIDGED2",
  
  // Text handling for MarkerSection
  "markerAppendMode": "space" | "newline" | "windowsNewline" | "unixNewline",
  "markerCleanMode": "NONE" | "REMOVEEXTRASPACE",
  
  // Output options
  "saveMarkerSectionsToFile": boolean,
  "markerSectionOutputDir": string
}
```

## Implementation Priority
1. Fix HTML entity issues (affects existing output)
2. Fix witness testimony end detection (critical for correct hierarchy)
3. Implement summary modes and configuration
4. Add phase3-only deletion capability
5. Implement concise naming conventions
6. Add file output capability
7. Investigate session text issues

## Testing Requirements
- Test with large dataset (multi-trial-config-mac.json)
- Verify witness testimony boundaries are correct
- Ensure closing statements are found after witness testimony
- Validate that HTML entities are properly decoded
- Test phase3-only deletion and rerun
- Verify file output structure and naming

## Future Enhancements (Noted but not for immediate implementation)
- Schema changes for alternate summaries table
- LLM-generated summaries as alternatives
- Derived names from MarkerSection.name
- Ability to swap between different summary versions