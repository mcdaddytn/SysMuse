# Feature 03M Implementation: Attorney-Speaker Relationship Fix

## Problem Statement
The Attorney table had a unique constraint on `speakerId` that prevented attorneys from working across multiple trials. When the same attorney (e.g., MR. JONES) appeared in multiple trials (24 Fractus V. T-Mobile Us, 44 Beneficial V. Advance, 61 Nichia Corporation V. Everlight Electronics), Phase2 processing would fail with unique constraint violations.

## Root Cause
The original schema design incorrectly placed the speaker association directly on the Attorney model with a unique constraint. This meant each attorney could only have one speaker record across the entire system, preventing them from participating in multiple trials where they would need different speaker records per trial.

## Solution Implemented

### 1. Schema Changes
Moved the speaker association from the Attorney table to the TrialAttorney junction table:

**Before:**
```prisma
model Attorney {
  speakerId Int? @unique
  speaker Speaker? @relation("AttorneySpeaker")
  // ...
}

model Speaker {
  attorney Attorney? @relation("AttorneySpeaker")
  // ...
}
```

**After:**
```prisma
model Attorney {
  // speakerId removed
  // ...
}

model TrialAttorney {
  speakerId Int?
  speaker Speaker? @relation("TrialAttorneySpeaker")
  @@unique([trialId, speakerId])
  // ...
}

model Speaker {
  trialAttorneys TrialAttorney[] @relation("TrialAttorneySpeaker")
  // ...
}
```

### 2. Code Updates

#### Phase2Processor.ts
- Updated attorney creation to not include speakerId
- Modified to associate speaker with TrialAttorney instead of Attorney
- Fixed examining attorney lookup to use TrialAttorney.speaker

#### AttorneyService.ts  
- Updated `getAttorneysForTrial()` to map speaker from TrialAttorney
- Fixed `findAttorneyBySpeakerPrefix()` to use new relationship
- Modified all speaker lookups to go through TrialAttorney

#### MultiTrialSpeakerService.ts
- Updated `createAttorneyWithSpeaker()` to associate speaker via TrialAttorney
- Modified `associateAttorneyWithTrial()` to include speakerId parameter

#### SpeakerRegistry.ts
- Updated to load speakers through trialAttorneys relation
- Modified attorney lookups to use TrialAttorney associations

#### Phase2ReportQueries.ts
- Fixed examination report queries to access attorney through `speaker.trialAttorneys[0].attorney`

## Testing Results

### Test Configuration
Created `config/test-multi-attorney.json` with minimal trial set:
- 24 Fractus V. T-Mobile Us
- 44 Beneficial V. Advance  
- 61 Nichia Corporation V. Everlight Electronics

### Verification
After implementation, MR. JONES successfully exists as a single attorney record (ID: 3) with separate speaker associations per trial:

| Trial | Trial ID | Speaker ID | Role |
|-------|----------|------------|------|
| 24 Fractus V. T-Mobile Us | 1 | 4 | DEFENDANT |
| 44 Beneficial V. Advance | 2 | 85 | PLAINTIFF |
| 61 Nichia Corporation V. Everlight Electronics | 3 | 132 | PLAINTIFF |

Phase1 and Phase2 process all three trials without constraint violations.

## Database Backup
A database backup with the successful implementation has been created:
- Backup file: `backups/judicial_transcripts_feature-03M-attorney-speaker-fix.sql`
- Created after successful Phase2 processing of all three test trials
- Contains example of attorney (MR. JONES) working across multiple trials

## Files Modified
- `/prisma/schema.prisma`
- `/src/parsers/Phase2Processor.ts`
- `/src/services/AttorneyService.ts`
- `/src/services/MultiTrialSpeakerService.ts`
- `/src/services/SpeakerRegistry.ts`
- `/src/services/Phase2ReportQueries.ts`
- `/src/services/ExaminationContextManager.ts` (minor updates)

## Rollback Instructions
If needed, restore the previous schema:
1. Restore speakerId to Attorney model with @unique constraint
2. Remove speakerId from TrialAttorney model
3. Update all service files to use Attorney.speaker instead of TrialAttorney.speaker
4. Run `npx prisma db push --force-reset` to rebuild database

## Known Limitations

### Same Last Name Within Trial
When multiple attorneys in the same trial share the same last name (e.g., two attorneys named PENNINGTON), the system cannot distinguish between them if they have the same speakerPrefix. This causes a unique constraint violation on `[trialId, speakerId]` in TrialAttorney.

**Example Case**: Trial 21 Cassidian V Microdata has:
- MR. ED PENNINGTON 
- MR. JOHN PENNINGTON

Both had speakerPrefix "MR. PENNINGTON" causing Phase2 to fail when processing "BY MR. EDWARD PENNINGTON" in examinations.

**Solution Applied**: 
1. Updated trial-metadata.json to use more specific speaker prefixes:
   - "MR. EDWARD PENNINGTON" for Ed Pennington
   - "MR. JOHN PENNINGTON" for John Pennington

2. Enhanced Phase2Processor regex pattern (line 703) to capture full names in examination lines:
   - Old: `/^BY\s+(MR\.|MS\.|MRS\.|DR\.)\s+([A-Z]+):?$/` (captures last name only)
   - New: `/^BY\s+(MR\.|MS\.|MRS\.|DR\.)\s+([A-Z]+(?:\s+[A-Z]+)*):?$/` (captures full name)
   
   This allows matching "BY MR. EDWARD PENNINGTON:" to "MR. EDWARD PENNINGTON" in metadata.

### Future Improvements Needed
1. **Enhanced Attorney Matching**: Use full names or first name initials when attorneys share last names
2. **LLM Integration**: Future LLM jobs will provide more detailed attorney information for better disambiguation
3. **Smart Speaker Prefix Generation**: Automatically detect and handle same-last-name conflicts during metadata generation
4. **Examination Context**: Better parsing of "BY MR. [FULL NAME]" patterns to match against attorney first names

## Metadata Import Issue (Discovered during implementation)

### Problem
Attorneys imported from trial-metadata.json files are not automatically associated with trials through TrialAttorney records during the import phase. This causes Phase2 to fail to find them when processing transcripts, leading to:
1. Creation of duplicate attorneys with the same speakerPrefix
2. Loss of rich metadata (firstName, middleInitial, barNumber, etc.) from the imported attorneys  
3. Anonymous speakers or dynamically created attorneys without proper data

### Example Case
- Attorney id=2: "MR. DACUS" with full metadata from trial-metadata.json import
- Attorney id=4: "MR. DACUS" created dynamically in Phase2 without metadata
- Only id=4 gets TrialAttorney association, id=2 remains orphaned

### Current Workaround
Modified `AttorneyService.findAttorneyBySpeakerPrefix()` to:
1. First search for attorney WITH trial association (existing behavior)
2. If not found, search for attorney by speakerPrefix WITHOUT requiring trial association
3. Return the attorney if found (Phase2 will create the TrialAttorney association)
4. Only create AnonymousSpeaker if no attorney exists at all

This ensures imported attorneys are found and properly associated when encountered in transcripts.

### Proper Fix Required
The metadata import process (`src/cli/override.ts`) needs to create TrialAttorney associations when importing attorneys. The trial-metadata.json files contain associative IDs that should link:
- Attorney → TrialAttorney → Trial
- Attorney → TrialAttorney → LawFirm  
- Attorney → TrialAttorney → LawFirmOffice

Implementation is complex due to:
- Need to maintain backward compatibility with existing trial-metadata.json files
- Must preserve ability to share attorneys across trials (same attorney, different TrialAttorney records)
- Override logic handles multiple entity types and relationships

## Future Considerations
- The API layer will need updates to properly query attorney-speaker relationships through TrialAttorney
- Consider adding indexes on TrialAttorney.speakerId for performance
- May want to add validation to ensure attorneys don't get duplicate speakers within same trial
- Implement more sophisticated attorney matching logic that considers first names and middle initials
- Fix metadata import to properly create TrialAttorney associations