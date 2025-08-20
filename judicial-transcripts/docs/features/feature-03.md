# Feature 03: Remaining Parsing Issues

## Overview
After implementing features 01 and 02, several parsing issues remain that need to be addressed.

## Issues to Fix

### 1. REDIRECT/RECROSS Events Not Being Created
**Status**: ❌ Not working

**Problem**: 
- REDIRECT and RECROSS examination events are not being created, even within the same session
- The Line records containing "REDIRECT EXAMINATION" and "RECROSS-EXAMINATION" exist in the database
- The witness context appears to be present (e.g., Dr. Zhu is active when REDIRECT occurs)
- The Phase2Processor detects these lines but doesn't create WitnessCalledEvent records

**Evidence**:
```sql
-- 19 lines contain REDIRECT/RECROSS text
SELECT COUNT(*) FROM "Line" WHERE text LIKE '%REDIRECT%' OR text LIKE '%RECROSS%';
-- Result: 19

-- But no events created
SELECT COUNT(*) FROM "WitnessCalledEvent" 
WHERE "examinationType" IN ('REDIRECT_EXAMINATION', 'RECROSS_EXAMINATION');
-- Result: 0

-- Example: Session 3 has full examination sequence within same session
-- Page 305: DIRECT EXAMINATION
-- Page 335: CROSS-EXAMINATION  
-- Page 393: REDIRECT EXAMINATION (Dr. Zhu active as witness)
-- Page 405: RECROSS-EXAMINATION
-- Page 408: REDIRECT EXAMINATION
-- Page 435: DIRECT EXAMINATION
```

**Root Cause**: 
- In Phase2Processor.ts, the `checkExaminationChange()` method only creates events when `state.currentWitness` exists
- The witness context may not be properly maintained when examination type changes occur
- Need to investigate why witness context is lost between examination types

### 2. Attorney Name Parsing Issues
**Status**: ⚠️ Partially working

**Problem**:
- Middle initials are being included in the firstName field
- Multi-part first names (like "J. DAVID") are incorrectly parsed

**Current Parsing Results**:
```
// Problem cases:
"MR. ALFRED R. FABRICANT" → 
  firstName: "ALFRED R."  // Should be: "ALFRED"
  middleInitial: "R."     // Correct

"MS. KENDALL M. LOEBBAKA" →
  firstName: "KENDALL M."  // Should be: "KENDALL"  
  middleInitial: "M."      // Correct

"MR. J. DAVID HADDEN" →
  firstName: "J. DAVID"    // Correct (J. is part of first name)
  middleInitial: "DAVID"   // Should be: null or empty
```

**Files to Update**:
- `/src/services/AttorneyService.ts` - `parseAttorneyName()` method
- `/src/parsers/TranscriptParser.ts` - `parseFullName()` method

### 3. Witness Name Parsing Not Implemented
**Status**: ❌ Not working

**Problem**:
- Witness names are not being parsed into components at all
- All witnesses have empty firstName, middleInitial, lastName, and suffix fields
- Only the full name is stored

**Example Data**:
```sql
SELECT name, "firstName", "middleInitial", "lastName", suffix FROM "Witness";
-- Results show all component fields are NULL/empty:
-- "JOSEPH C. MCALEXANDER, III" → all fields empty
-- "MANLI ZHU, PH.D." → all fields empty
```

**Required Implementation**:
- Add name parsing logic when creating witnesses in Phase2Processor.ts
- Handle suffixes like "PH.D.", "III", etc.
- Parse firstName, middleInitial, lastName components

## Successfully Completed Items ✅

### From Feature 02:
1. **RUBINO suffix parsing** - Fixed comma-separated suffix (lastName: "RUBINO", suffix: "III")
2. **Attorney title discovery** - LOEBBAKA and LAQUER titles discovered from transcript
3. **Schema updates** - Added firstName, middleInitial, suffix fields to Attorney and Witness models
4. **Bulk insert optimization** - Implemented batch processing with configurable batchSize

## Testing Commands

```bash
# Reset database and test
npx prisma db push --force-reset
npx ts-node src/seed/seedDatabase.ts
npx ts-node src/cli/parse.ts parse --config "./config/example-trial-config-mac.json"

# Check results
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts -c "SELECT COUNT(*) as count, \"examinationType\" FROM \"WitnessCalledEvent\" GROUP BY \"examinationType\";"

docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts -c "SELECT name, \"firstName\", \"middleInitial\", \"lastName\", suffix FROM \"Attorney\" WHERE \"lastName\" IN ('FABRICANT', 'LOEBBAKA', 'HADDEN');"

docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts -c "SELECT name, \"firstName\", \"middleInitial\", \"lastName\", suffix FROM \"Witness\" LIMIT 5;"
```

## Priority
1. **High**: Fix REDIRECT/RECROSS event creation (critical for examination flow)
2. **Medium**: Implement witness name parsing (data completeness)
3. **Low**: Refine attorney name parsing for middle initials (cosmetic issue)

## Notes
- The REDIRECT/RECROSS issue appears to be related to witness context management in Phase2Processor
- Cross-session witness context preservation is not expected to work yet
- Within-session context should work but currently doesn't for examination changes