# Feature-03J: Override System Fixes and Speaker Identification Improvements

## Overview
This feature addresses critical issues discovered during testing of the LLM-based override system and speaker identification workflow. These fixes are required to make the override system functional for multi-trial processing.

## Background
Testing revealed several issues with the current implementation:
1. Speakers are being created at the wrong time (during import instead of parsing)
2. LLM-generated metadata lacks required configuration fields
3. Database constraints prevent proper multi-trial imports
4. Speaker identification logic needs proper integration with override data

## Requirements

### 1. Fix Speaker Creation Timing
**Current Issue**: Speakers are created during override import in `OverrideImporter.ts`
**Required Fix**: 
- Remove ALL speaker creation from `OverrideImporter.ts`
- Speakers should ONLY be created during transcript parsing when encountered
- Speaker creation should happen in phase2 when processing actual dialogue

### 2. Fix Override Field Generation
**Current Issue**: LLM extractor doesn't generate `overrideAction` and `overrideKey` fields
**Required Fix**:
- Modify `LLMExtractor.ts` to automatically add:
  - For Attorneys: `overrideAction: "Upsert"`, `overrideKey: "attorneyFingerprint"`
  - For Judges: `overrideAction: "Upsert"`, `overrideKey: "judgeFingerprint"`
  - For LawFirms: `overrideAction: "Upsert"`, `overrideKey: "lawFirmFingerprint"`
  - For LawFirmOffices: `overrideAction: "Upsert"`, `overrideKey: "lawFirmOfficeFingerprint"`
  - For CourtReporters: `overrideAction: "Upsert"`, `overrideKey: "courtReporterFingerprint"`
  - For Trials: `overrideAction: "Insert"`, `overrideKey: "caseNumber"`

### 3. Fix OverrideImporter Defaults
**Current Issue**: Default action is "Update" which fails for new data
**Required Fix**:
- Change default `overrideAction` from "Update" to "Upsert" in `OverrideImporter.ts`
- Use fingerprint fields as default `overrideKey` when available

### 4. Fix LawFirmOffice Constraints
**Current Issue**: Unique constraint on (lawFirmId, name) causes failures
**Required Fix**:
- Ensure LawFirmOffice uses fingerprint-based deduplication
- The fingerprint should include location to differentiate offices

### 5. Implement Proper Speaker Identification in Phase2
**Current Issue**: Speaker identification not properly integrated with override data
**Required Fix**:
- Phase2 should:
  1. Process lines with speaker prefixes (e.g., "THE COURT:", "MR. SMITH:")
  2. Look up Attorney/Judge by speakerPrefix field
  3. Create Speaker record on first encounter
  4. Link Speaker to Attorney/Judge/CourtReporter if match found
  5. Create AnonymousSpeaker if no match

### 6. Handle Examination Context Properly
**Context**: "BY MR. SMITH" is NOT a speaker prefix but examination context
**Required Understanding**:
- Lines like "DIRECT EXAMINATION BY MR. SMITH" indicate who is conducting examination
- Actual speaker prefixes during examination are typically:
  - "Q." or "Q" for attorney questions
  - "A." or "A" for witness answers
  - "THE COURT:" for judge
  - "MR. SMITH:" for direct attorney speech

## Implementation Priority
1. **Critical**: Fix speaker creation timing (remove from import)
2. **Critical**: Fix LLM extractor to add override fields
3. **High**: Fix OverrideImporter defaults
4. **High**: Implement proper phase2 speaker identification
5. **Medium**: Fix LawFirmOffice constraint handling

## Success Criteria
1. Override import does NOT create any Speaker records
2. LLM-generated metadata includes all required override fields
3. Multiple trials with shared attorneys/judges import successfully
4. Phase2 creates speakers when first encountered in transcript
5. Speakers are correctly linked to attorneys/judges via speakerPrefix
6. Examination context ("BY MR. X") is not treated as speaker prefix

## Testing Requirements
1. Import multiple trials with shared entities (same judge, overlapping attorneys)
2. Verify no speakers created during import
3. Run phase2 and verify speakers created on first utterance
4. Verify speaker-attorney matching via speakerPrefix
5. Verify Q/A patterns during examination are properly handled
6. Verify "BY MR. X" lines are recognized as examination context, not speakers

## Dependencies
- Must understand existing speaker identification patterns
- Must preserve existing Q/A examination handling
- Must maintain backward compatibility with existing data

## Notes
- This is a bug fix feature, not new functionality
- The architecture is mostly correct, just needs proper implementation
- Fingerprint-based deduplication is key to multi-trial support