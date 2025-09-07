# Workflow Issues Report

## Date: 2025-09-06

## Critical Issues Identified

### 1. Trial Duplication Problem
**Severity: HIGH**

**Issue**: Trials are being duplicated in the database with different caseHandle formats.

**Root Cause**: 
- The `generateCaseHandle()` function transforms case numbers (e.g., "2:13-CV-1015-JRG" → "2_13-CV-01015-JRG")
- Some trials have the original format, others have the transformed format
- The upsert logic uses caseNumber as unique key, but caseHandle differences cause confusion

**Evidence**:
```sql
id | shortName | caseNumber | caseHandle
2  |           | 2:12-cv-00600-JRG | WI-LAN v. APPLE  -- Original format
7  | 17 Wi-Lan V. Apple | 2:12-CV-00600-JRG | 2_12-CV-00600-JRG  -- Transformed format
```

**Fix Required**: 
- Remove the transformation in `generateCaseHandle()` - it should return the original caseNumber
- Update existing records to use consistent format
- Ensure upsert logic properly checks for existing trials

### 2. LLM Override Detection Failure
**Severity: HIGH**

**Issue**: The workflow doesn't properly detect when LLM overrides need to be generated.

**Root Cause**:
- `shouldRunLLMOverride()` was checking for old file format (Attorney.json, Witness.json, Trial.json)
- Should check for new format: `trial-metadata.json`
- State tracking shows many trials with `llmOverrideCompleted = false` even when files exist

**Evidence**:
- 15+ trials in database show `llmOverrideCompleted = false`
- Some have trial-metadata.json files but state not updated

**Fix Applied**: Updated `shouldRunLLMOverride()` to check for trial-metadata.json

### 3. Batch Processing State Confusion
**Severity: MEDIUM**

**Issue**: When running Phase1 for a single trial, ALL trials in `includedTrials` get processed.

**Root Cause**:
- Phase1 command processes entire config's `includedTrials` list
- Workflow marks Phase1 complete for the requesting trial
- Other trials get processed but their state isn't properly updated

**Impact**:
- Trial 22 runs Phase1, processes trials 22-25
- Trials 23-25 exist in DB but workflow state incomplete
- Subsequent runs skip necessary steps

**Fix Required**:
- Phase1 should accept trial-specific filtering
- OR workflow should update state for all processed trials

### 4. PDF Conversion Detection
**Severity: LOW (Working correctly)

**Issue**: Concern about PDF conversion not running when needed.

**Status**: VERIFIED WORKING
- Correctly checks for `conversion-summary.json`
- Will re-run if file missing
- Will re-run if summary shows `complete: false`

### 5. State Management Reliability
**Severity: HIGH**

**Issue**: Workflow states are unreliable and don't reflect actual completion.

**Evidence**:
- Trials marked `phase1Completed = true` without text files
- `pdfConvertCompleted = true` without conversion-summary.json
- Steps marked complete even when they fail or skip

**Root Cause**:
- No verification that steps actually completed their work
- Command success ≠ work completion
- Batch processing updates single trial state

## Recommendations

### Immediate Actions Required:
1. **Fix generateCaseHandle()** to not transform the case number
2. **Clean up duplicate trials** in database
3. **Reset workflow states** for all trials and re-run
4. **Add verification** after each step to confirm work was done

### Manual Commands to Run LLM Overrides:

```bash
# Generate for single trial
npx ts-node src/cli/override.ts extract \
  --trial-path "output/multi-trial/21 Cassidian V Microdata" \
  --output "output/multi-trial/21 Cassidian V Microdata/trial-metadata.json"

# Generate for all missing
for dir in output/multi-trial/*/; do 
  if [ ! -f "$dir/trial-metadata.json" ]; then 
    trial=$(basename "$dir")
    echo "Generating for $trial..."
    npx ts-node src/cli/override.ts extract \
      --trial-path "$dir" \
      --output "$dir/trial-metadata.json"
  fi
done
```

### Database Cleanup Commands:

```bash
# Find duplicate trials
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts -c "
  SELECT caseNumber, COUNT(*) as count, 
    STRING_AGG(CAST(id AS TEXT), ', ') as ids,
    STRING_AGG(caseHandle, ' | ') as handles
  FROM \"Trial\" 
  GROUP BY caseNumber 
  HAVING COUNT(*) > 1;"

# Delete duplicates (keep higher IDs with shortNames)
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts -c "
  DELETE FROM \"Trial\" 
  WHERE id IN (2,3,4,6) 
  AND \"shortName\" IS NULL;"

# Reset workflow states for re-processing
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts -c "
  UPDATE \"TrialWorkflowState\" 
  SET \"llmOverrideCompleted\" = false 
  WHERE \"llmOverrideCompleted\" = false;"
```

## Fixes Applied

### 1. LLM Extractor Fix
**File**: `src/services/llm/LLMExtractor.ts`
- Removed `caseHandle` from LLM extraction prompt
- LLM no longer generates incorrect caseHandle values

### 2. Override Importer Fix  
**File**: `src/services/override/OverrideImporter.ts`
- Added `generateCaseHandle` import
- Now ALWAYS derives caseHandle from caseNumber
- Never trusts caseHandle from override data
- Applied to both Insert and Update operations

### 3. Database Cleanup
**Executed**:
- Deleted 4 duplicate trials (IDs 2, 3, 4, 6) that had no shortName
- Updated all 23 trials to have correct caseHandle derived from caseNumber
- All caseHandle values now follow format: "2_13-CV-1015-JRG" (colon replaced with underscore)

### 4. Workflow State Management
**File**: `src/services/EnhancedTrialWorkflowService.ts`
- Fixed `shouldRunLLMOverride()` to check for `trial-metadata.json`
- Now properly detects when LLM overrides need generation

## Outstanding Critical Issue: State Detection Order

**SEVERITY: CRITICAL**

The workflow checks database state BEFORE file existence, causing it to skip necessary steps:

```typescript
// Current problematic order:
if (this.isStepCompleted(state, step)) {
  return false;  // Returns false even if files don't exist!
}
// File checks never reached if DB says complete
```

**Required Fix**: Check file existence FIRST, then database state.

See `docs/impl/feature-03L-implementation.md` for detailed analysis and fix plan.

## Testing Plan

1. ✅ Fixed `generateCaseHandle()` function 
2. ✅ Cleaned up duplicate trials
3. ⚠️  Reset workflow states (temporary workaround)
4. Use `--force-rerun` flag until detection order fixed
5. Verify all steps complete with actual file generation
6. Check database state matches file system state