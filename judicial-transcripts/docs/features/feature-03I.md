# Feature 03I: Fix Attorney-Speaker Association with Metadata Enhancement

## Problem Statement

During Phase 2 parsing, attorney speakers are being created without proper association to attorney records and without using the LLM-generated metadata for enhancement. This results in:

1. **Duplicate speakers**: Multiple speaker records for the same attorney with different handles
2. **Wrong gender prefixes**: Attorneys parsed from summary sections have incorrect prefixes (e.g., "MR. NOWIERSKI" for Ms. Lauren Nowierski)
3. **No attorney associations**: Speakers created from transcript text (e.g., "MR. KELLMAN") have no associated attorney record
4. **No metadata enhancement**: Attorney fingerprints and additional metadata from LLM generation are not being applied

## Current State

### Example Database State After Phase 2:
```
All attorney speakers: 10
  MR. DAVIS            | MR_DAVIS                       | NO ATTORNEY
  MR. FINDLAY          | MR_FINDLAY                     | NO ATTORNEY
  MR. IVEY             | MR_IVEY                        | NO ATTORNEY
  MR. KELLMAN          | MR_KELLMAN                     | NO ATTORNEY
  MR. MALZ             | ATTORNEY_MALZ                  | Mr. Jordan N. Malz
  MR. NOWIERSKI        | ATTORNEY_NOWIERSKI             | Ms. Lauren M. Nowierski  [WRONG GENDER]
  MR. PETRIE           | ATTORNEY_PETRIE                | Mr. Kyle G. Petrie
  MR. PRZYBYLSKI       | ATTORNEY_PRZYBYLSKI            | Ms. Jennifer M. Przybylski [WRONG GENDER]
  MR. STEINMETZ        | ATTORNEY_STEINMETZ             | Mr. Adam D. Steinmetz
  MS. NOWIERSKI        | MS_NOWIERSKI                   | NO ATTORNEY [DUPLICATE]
```

### What's Working:
- Attorney metadata is successfully loaded from `attorney-metadata.json`
- AttorneyService has logic to match by fingerprint and speakerPrefix
- Metadata enhancement logic exists in AttorneyService

### What's Broken:
- Phase 2 processor creates speakers directly without going through AttorneyService
- Summary parsing extracts wrong gender prefixes from appearance lines
- No deduplication of speakers when the same attorney appears with different prefixes

## Root Causes

1. **Phase2Processor.ts**: Creates speakers directly without using AttorneyService
2. **SpeakerRegistry**: Doesn't check for existing attorneys or use metadata when creating attorney speakers
3. **Summary parsing**: Incorrectly derives speaker prefixes from appearance text format

## Proposed Solution

### 1. Integrate AttorneyService into Phase 2 Speaker Creation

When Phase2Processor encounters an attorney speaker:
```typescript
// Instead of just creating a speaker
const speaker = await createSpeaker(speakerPrefix, 'ATTORNEY');

// Should do:
const attorneyService = new AttorneyService(prisma, trialStyleConfig);
const attorneyId = await attorneyService.createOrUpdateAttorney(
  trialId,
  { 
    name: speakerPrefix,  // Will be enhanced by metadata
    speakerPrefix: speakerPrefix 
  },
  role // Determine from context or default
);
```

### 2. Fix Summary Attorney Extraction

The summary parser should:
- Extract full attorney names with correct titles
- Pass complete attorney info to AttorneyService
- Let AttorneyService generate correct speaker prefixes

### 3. Implement Speaker Deduplication

- When creating a speaker, check for existing speakers with similar prefixes
- Consolidate speakers that refer to the same attorney
- Use fingerprints for cross-reference

## Implementation Steps

1. **Update Phase2Processor**:
   - Add AttorneyService integration
   - Pass trialStyleConfig through the chain
   - Use AttorneyService.createOrUpdateAttorney() for attorney speakers

2. **Update SpeakerRegistry**:
   - Add method to check for existing attorneys before creating speakers
   - Implement speaker consolidation logic

3. **Fix Summary Parser**:
   - Extract complete attorney information from APPEARANCES section
   - Preserve correct gender titles (Mr./Ms./Mrs./Dr.)

4. **Add Speaker Resolution Pass**:
   - After initial speaker creation, run a consolidation pass
   - Match speakers by prefix similarity and attorney fingerprints
   - Merge duplicate speaker references

## Expected Outcome

After implementation, the database should show:
```
All attorney speakers: 19 (or appropriate count)
  MR. DAVIS            | ATTORNEY_DAVIS_MR              | Mr. William E. Davis, III
  MR. FINDLAY          | ATTORNEY_FINDLAY_MR            | Mr. Eric Findlay
  MR. IVEY             | ATTORNEY_IVEY_MR               | Mr. Gerald F. Ivey
  MR. KELLMAN          | ATTORNEY_KELLMAN_MR            | Mr. Alan S. Kellman
  MS. NOWIERSKI        | ATTORNEY_NOWIERSKI_MS          | Ms. Lauren M. Nowierski
  // ... etc, all with proper associations and fingerprints
```

## Testing Requirements

1. Parse trial "04 Intellectual Ventures" with metadata
2. Verify all attorneys have fingerprints from metadata
3. Verify no duplicate speakers
4. Verify correct gender prefixes
5. Verify all attorney speakers have attorney associations

## Dependencies

- Feature 02Y (Attorney metadata generation) - COMPLETED
- AttorneyService with metadata loading - COMPLETED
- Phase 2 processing infrastructure - EXISTS

## Priority

HIGH - This is blocking proper attorney tracking across trials and accurate speaker identification.

## Notes

- The AttorneyService already has the logic for metadata matching and enhancement
- The main work is integrating it properly into the Phase 2 processing flow
- This will enable cross-trial attorney tracking via fingerprints