# Feature-03I: Override System and Speaker Identification - Implementation Guide

## Overview
This implementation guide documents the findings and required improvements for the LLM-based override system and speaker identification workflow.

## Current Implementation Status

### Working Components
1. **LLM Extraction**: Successfully extracts attorney, judge, and law firm information from transcript headers
2. **Override Import**: Can import override data into database (with Insert action specified)
3. **Basic Speaker Prefix Generation**: LLM correctly generates speaker prefixes (e.g., "MR. SMITH")

### Issues Identified

#### 1. Speaker Creation Timing (Critical)
**Current Issue**: Speakers are created during override import instead of during transcript parsing

**Impact**: 
- Creates Speaker records for people who may never speak
- Breaks the logical flow of speaker identification
- Causes incorrect speaker statistics

**Required Fix**:
- Remove Speaker creation from `OverrideImporter.ts`
- Create Speakers only when encountered in transcript
- Maintain speaker-attorney correlation through speakerPrefix field

#### 2. Override Action and Key Defaults
**Current Issue**: 
- Default override action is "Update" (should be "Upsert")
- Default override key is "id" (should be fingerprint fields)
- LLM extractor doesn't add these fields

**Impact**: 
- Import fails when trying to update non-existent records
- No deduplication across trials (same judge/attorney created multiple times)

**Required Fix**:
- Change defaults in `OverrideImporter.ts`:
  - Attorney: `overrideAction: 'Upsert'`, `overrideKey: 'attorneyFingerprint'`
  - Judge: `overrideAction: 'Upsert'`, `overrideKey: 'judgeFingerprint'`
  - LawFirm: `overrideAction: 'Upsert'`, `overrideKey: 'lawFirmFingerprint'`
  - Trial: `overrideAction: 'Insert'`, `overrideKey: 'caseNumber'`
- OR have LLM extractor automatically add these fields

#### 3. Override File Location and Naming
**Current Issue**: Confusion about where override files should be located and how they're discovered

**Possible Solutions**:
- Standardize on `trial-metadata.json` in trial directories
- Support multiple locations with clear precedence rules
- Add configuration option for override file path

## Proposed Workflow

### Phase 1: LLM Extraction
1. Parse first 2 pages of first session transcript
2. Extract entities with speaker prefixes
3. Save as `trial-metadata.json` in trial directory
4. Include "overrideAction": "Insert" for all entities

### Phase 2: Manual Review
1. User reviews generated metadata
2. Edits speaker prefixes if needed
3. Adds alternative speaker prefixes if necessary

### Phase 3: Import Override Data
1. Import metadata WITHOUT creating Speaker records
2. Store Attorney/Judge records with speakerPrefix field
3. Create fingerprints for cross-trial matching

### Phase 4: Transcript Parsing
1. When speaker encountered (e.g., "MR. SMITH:")
2. Check for existing Speaker with that prefix
3. If not found, look up Attorney/Judge by speakerPrefix
4. Create Speaker record and link to Attorney/Judge
5. If no match, create AnonymousSpeaker

## Future Enhancements

### 1. Speaker Prefix Alternatives
Add support for multiple speaker prefixes per attorney:
```json
{
  "speakerPrefix": "MR. SMITH",
  "speakerPrefixAlternatives": ["SMITH", "MR. S"]
}
```

### 2. Automatic Override Integration
- Automatically check for and load override files during parsing
- Generate overrides if missing (with user prompt)
- Cache generated overrides for reuse

### 3. Cross-Trial Speaker Correlation
- Use attorneyFingerprint for matching across trials
- Handle attorneys who appear in multiple trials
- Maintain consistent speaker identification

### 4. Override Validation
- Validate speaker prefixes against known patterns
- Check for conflicts between attorneys
- Warn about missing critical fields

## Testing Requirements

### Test Case 1: Clean Import
1. Reset database
2. Import override with Insert actions
3. Verify no Speakers created
4. Parse transcript
5. Verify Speakers created on first utterance

### Test Case 2: Speaker Matching
1. Import override with attorneys
2. Parse transcript with matching speakers
3. Verify correct Speaker-Attorney linkage
4. Verify unmatched speakers become AnonymousSpeaker

### Test Case 3: Multi-Trial Correlation
1. Import overrides for multiple trials
2. Same attorney in different trials
3. Verify fingerprint matching works
4. Verify consistent speaker identification

## Implementation Priority

1. **High Priority**: Fix Speaker creation timing
2. **Medium Priority**: Standardize override file handling
3. **Low Priority**: Add speaker prefix alternatives

## Related Documentation
- Feature-02S: Data corrections and overrides
- `docs/feature-assets/feature-03I/`: Sample override files
- `src/services/override/`: Override implementation code
- `src/services/speakers/`: Speaker identification code

## Notes for Development
- Maintain backward compatibility with existing override files
- Consider migration path for existing data
- Add comprehensive logging for debugging speaker matching
- Include metrics for speaker identification accuracy

#### 4. LawFirmOffice Unique Constraint Issues
**Current Issue**: Unique constraint on (lawFirmId, name) causes import failures
- Multiple trials have offices named "Main Office" for the same law firm
- Transaction rollback loses all imported data when one entity fails

**Impact**: Can't import multiple trials with shared law firms

**Required Fix**:
- Change unique constraint to include more fields
- Or generate unique office names
- Or handle office deduplication better

## Temporary Workarounds Applied During Testing

### Workaround 1: Manual Addition of Override Fields
**Date**: 2025-09-06
**Issue**: LLM-generated metadata files lack overrideAction and overrideKey fields
**Workaround Applied**:
- Manually added `overrideAction` and `overrideKey` to all entities in metadata files
- Used "Upsert" for entities with fingerprints (Attorney, Judge, LawFirm, LawFirmOffice)
- Used "Insert" for unique entities (Trial with caseNumber)
- Script used to patch files before import
- **Note**: LawFirmOffice must also use Upsert with lawFirmOfficeFingerprint to avoid duplicates

**Why Needed**: Without these fields, imports fail because default action is "Update" which expects existing records

### Workaround 2: Clear Speaker Table
**Date**: 2025-09-06
**Issue**: Speakers being created during override import instead of transcript parsing
**Workaround Applied**:
- Manually cleared Speaker table after import: `DELETE FROM "Speaker"`
- This simulates the correct state where speakers don't exist until encountered in transcript

**Why Needed**: To test speaker identification as it should work when the bug is fixed

## Open Questions
1. Should we support regex patterns in speaker prefixes?
2. How to handle speaker prefix conflicts (two attorneys with same last name)?
3. Should override data be versioned for tracking changes?
4. How to handle mid-trial attorney substitutions?

---
*Last Updated: 2025-09-06*
*Status: In Progress - Gathering Requirements*