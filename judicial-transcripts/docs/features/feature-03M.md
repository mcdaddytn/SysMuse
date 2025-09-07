# Feature-03M: Fix Attorney-Speaker Relationships and Examination Associations

## Problem Statement

The current implementation has critical issues with attorney-speaker relationships and witness examination attorney associations when processing multiple trials:

### Issue 1: Attorney-Speaker Unique Constraint Violation
- **Problem**: The Attorney table has a unique constraint on speakerId, preventing attorneys from being associated with different speakers across multiple trials
- **Impact**: Phase2 processing fails when the same attorney appears in multiple trials
- **Example**: MR. JONES appears in:
  - "24 Fractus V. T-Mobile Us" (trial ID 51 in current DB)
  - "44 Beneficial V. Advance" (trial ID 81 in current DB)
  - "61 Nichia Corporation V. Everlight Electronics" (trial ID 99 in current DB)
- **Error**: When processing "61 Nichia Corporation V. Everlight Electronics" after the others, Phase2 fails with "Unique constraint failed on the fields: (`speakerId`)"

### Issue 2: Incorrect Attorney Association in Witness Examinations
- **Problem**: The system is not correctly tracking which attorney conducts each examination type
- **Evidence**: In trial "34 Personalized Media V Google" (case 2:19-CV-90-JRG), witness THOMAS SCOTT shows all examinations (DIRECT, CROSS, REDIRECT, RECROSS) conducted by MR. GRINSTEIN
- **Expected**: Attorneys should alternate between plaintiff (DIRECT/REDIRECT) and defense (CROSS/RECROSS)
- **Actual attorneys in trial**: MR. GRINSTEIN and MR. VERHOEVEN appear in the transcript text with "BY MR. GRINSTEIN" and "BY MR. VERHOEVEN" patterns

### Issue 3: Missing Attorney Information in Examinations
- **Problem**: Some examination reports show examinations without associated attorneys
- **Impact**: Unable to track which attorney conducted specific examinations

## Root Causes

1. **Schema Design Issue**: The one-to-one relationship between Attorney and Speaker doesn't support attorneys working across multiple trials
2. **Phase2 Processing Logic**: Attempts to update attorney speakerId without checking for existing associations
3. **Examination Processing**: Not correctly identifying and associating attorneys during examination event parsing

## Proposed Solution

### 1. Schema Changes
- Remove the unique constraint on Attorney.speakerId
- Consider moving speaker association to TrialAttorney junction table
- Alternative: Allow null speakerId for attorneys and handle speaker association per trial

### 2. Phase2Processor Updates
- Check for existing speaker associations before updating
- Handle speaker creation per trial context
- Implement proper error handling for constraint violations

### 3. Examination Processing Enhancement
- Track attorney changes during examination sequences
- Implement logic to identify attorney switches between examination types
- Parse "BY MR./MS. [NAME]" patterns more accurately

## Database State Recommendation

**For Implementation**: Keep the current database state if possible. It contains valuable error data and trial relationships that will help verify the fix.

**For Clean Testing**: Reset the database and run only the minimal test set (trials 24, 44, 61) to:
1. Reduce processing time
2. Isolate the specific issue
3. Create a reproducible test case

The minimal test set will recreate the exact error condition in about 5-10 minutes versus hours for all trials.

## Testing Strategy

### Test Set 1: Multiple Trial Attorney Conflicts (Minimal Reproduction)
Run these trials together to reproduce the speaker constraint issue:
- "24 Fractus V. T-Mobile Us"
- "44 Beneficial V. Advance"  
- "61 Nichia Corporation V. Everlight Electronics"

These trials all contain MR. JONES and will trigger the constraint violation when run in sequence.

**Additional trials with MR. JONES** (for expanded testing):
- "02 Contentguard"
- "19 Alfonso Cioffi Et Al V. Google"
- "20 Biscotti Inc. V. Microsoft Corp"

### Test Set 2: Examination Attorney Association
Focus on trial "34 Personalized Media V Google":
- Verify MR. GRINSTEIN and MR. VERHOEVEN are correctly identified
- Ensure examinations alternate between attorneys
- Check witness THOMAS SCOTT examinations show correct attorney associations

### Test Commands
```bash
# Reset database
npm run db:reset

# Run problematic trials
npx ts-node src/cli/workflow.ts run --phase phase2 --config config/test-multi-attorney.json

# Check examination output
cat output/phase2/2_19-CV-90-JRG_examinations.txt
```

## Implementation Steps

1. **Immediate Fix** (for testing continuation):
   - Add try-catch in Phase2Processor for speaker assignment
   - Log warnings instead of failing on constraint violations

2. **Schema Refactor**:
   - Analyze impact of removing unique constraint
   - Design new speaker-attorney relationship model
   - Update Prisma schema and regenerate client

3. **Processing Logic Update**:
   - Refactor Phase2Processor attorney-speaker association
   - Enhance examination parsing to track attorney switches
   - Implement attorney side detection (plaintiff vs defense)

4. **Validation**:
   - Create unit tests for attorney-speaker associations
   - Add integration tests for multi-trial processing
   - Validate examination reports show correct attorney associations

## Success Criteria

1. Phase2 processing completes successfully for all 51+ trials
2. Attorneys can work across multiple trials without constraint violations
3. Examination reports show correct attorney associations with proper switching between sides
4. Database maintains referential integrity while supporting multi-trial attorneys

## Related Files

- `/src/parsers/Phase2Processor.ts` - Main processing logic
- `/prisma/schema.prisma` - Database schema
- `/src/parsers/ExaminationParser.ts` - Examination event parsing
- `/src/services/MultiTrialSpeakerService.ts` - Speaker management

## Database Analysis

Current problematic attorneys in multiple trials:
- MR. JONES (3 trials)
- MR. FIRM (3 trials)  
- MR. III (3 trials)
- MS. HENRY (2 trials)
- MR. DACUS (2 trials)

These attorneys provide good test cases for validating the fix.