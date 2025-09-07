# Workflow Solution for Feature 03L

## Date: 2025-09-07

## Problem Summary

The Enhanced Trial Workflow Service had several critical issues:

1. **Batch Processing Confusion**: Phase1 processed ALL trials in `includedTrials` but workflow only tracked state for one trial
2. **LLM Override Timing**: Overrides were run before Phase1, causing duplicate trials with incorrect caseHandle values
3. **State Detection Order**: Database state was checked before file existence, causing steps to be skipped incorrectly
4. **PDF Conversion Logic**: No intelligent checking for whether conversion was actually needed

## Solution Implemented

### 1. Per-Trial Processing

All phases now support individual trial filtering:

```bash
# PDF Conversion for single trial
npm run convert-pdf config.json --trial "21 Cassidian V Microdata"

# Phase1 for single trial  
npx ts-node src/cli/parse.ts parse --phase1 --config config.json --trial "21 Cassidian V Microdata"

# Phase2 for single trial (by ID)
npx ts-node src/cli/parse.ts parse --phase2 --config config.json --trial-id 7
```

**Changes Made:**
- `src/cli/parse.ts`: Added `--trial` and `--trial-id` options
- `src/cli/convert-pdf.ts`: Added `--trial` option
- `src/services/EnhancedTrialWorkflowService.ts`: Updated to pass trial parameters to commands

### 2. Workflow Step Reordering

LLM Override processing now happens AFTER Phase1:

**Old Order:**
1. PDF Convert
2. LLM Override (generates trial-metadata.json)
3. Override Import
4. Phase1

**New Order:**
1. PDF Convert (copies trial-metadata.json from source if exists)
2. Phase1 (parses caseNumber from pageHeader)
3. LLM Override (only if trial-metadata.json missing)
4. Override Import (upserts based on caseNumber)

This ensures:
- Trial record exists with correct caseNumber before overrides
- No duplicate trials from caseHandle mismatches
- User-edited trial-metadata.json files are preserved

### 3. Intelligent PDF Conversion

The PDF convert step now:
1. Checks for `conversion-summary.json` in destination
2. If exists and complete, checks for newer source files
3. Copies `trial-metadata.json` from source if newer or missing
4. Only converts PDFs if actually needed

### 4. Trial Metadata Management

**Preservation of Work:**
- All generated trial-metadata.json files copied to source directories
- Removed `caseHandle` field (derived at import time)
- Changed `overrideAction` to "upsert" for all trials
- Files can be safely edited in source and will be copied during conversion

**Scripts Created:**
- `scripts/sync-trial-metadata.sh`: Copies files from dest to source
- `scripts/fix-trial-metadata-edits.sh`: Applies JSON edits to remove caseHandle

### 5. Override Import Improvements

The OverrideImporter now:
- Handles "upsert" action properly
- Always derives caseHandle from caseNumber (never trusts override data)
- Upserts trials based on caseNumber as unique key

## Workflow Execution

### Clean Start Workflow

```bash
# 1. Reset database
npm run db:reset

# 2. Run workflow for a single trial
npx ts-node src/cli/workflow.ts run --phase phase1 --config config/multi-trial-config-mac.json

# The workflow will:
# - Convert PDFs (or skip if up-to-date)
# - Copy trial-metadata.json from source
# - Run Phase1 to parse trial and get caseNumber
# - Run LLM Override if needed (or use existing trial-metadata.json)
# - Import overrides with upsert
```

### Manual Per-Trial Execution

```bash
# For trial "21 Cassidian V Microdata"
TRIAL="21 Cassidian V Microdata"

# 1. Convert PDFs
npm run convert-pdf config/multi-trial-config-mac.json --trial "$TRIAL"

# 2. Run Phase1
npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json --trial "$TRIAL"

# 3. Check/generate LLM overrides (if needed)
if [ ! -f "output/multi-trial/$TRIAL/trial-metadata.json" ]; then
  npx ts-node src/cli/override.ts extract \
    --trial-path "output/multi-trial/$TRIAL" \
    --output "output/multi-trial/$TRIAL/trial-metadata.json"
fi

# 4. Import overrides
npx ts-node src/cli/override.ts import "output/multi-trial/$TRIAL/trial-metadata.json"

# 5. Run Phase2
npx ts-node src/cli/parse.ts parse --phase2 --config config/multi-trial-config-mac.json --trial "$TRIAL"
```

## Key Benefits

1. **No More Duplicate Trials**: Upsert based on caseNumber prevents duplicates
2. **Preserves Manual Edits**: trial-metadata.json files in source are respected
3. **Efficient Processing**: Only processes what's needed for each trial
4. **Clear State Management**: Each trial's workflow state accurately reflects completion
5. **Flexible Execution**: Can run single trials or batches as needed

## Testing Checklist

- [x] Trial-metadata.json files preserved in source directories
- [x] PDF conversion skips when files are up-to-date
- [x] Phase1 extracts caseNumber from pageHeader
- [x] LLM overrides run after Phase1
- [x] Override import uses upsert with caseNumber
- [x] Individual trial processing works for all phases
- [x] Workflow tracks state correctly per trial

## Files Modified

1. `src/cli/parse.ts` - Added trial filtering options
2. `src/cli/convert-pdf.ts` - Added trial filtering option
3. `src/services/EnhancedTrialWorkflowService.ts` - Reordered steps, added trial parameters
4. `src/services/override/OverrideImporter.ts` - Added upsert action handling
5. `scripts/sync-trial-metadata.sh` - New script for file syncing
6. `scripts/fix-trial-metadata-edits.sh` - New script for JSON editing

## Next Steps

1. Monitor workflow execution for any edge cases
2. Consider adding progress tracking for multi-trial workflows
3. Add validation to ensure trial-metadata.json format is correct before import
4. Consider automated backup of source trial-metadata.json files before edits