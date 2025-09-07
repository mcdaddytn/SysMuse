# Feature 03L Implementation Guide: Workflow State Management Issues

## Problem Statement

The Enhanced Trial Workflow Service is not correctly detecting when steps need to be run for new trials. Specifically:

1. **PDF Conversion** is marked complete without actually running
2. **LLM Override generation** is skipped even when `trial-metadata.json` doesn't exist
3. **Phase1** is marked complete without proper prerequisites

## Root Cause Analysis

### Issue 1: State Persistence Across Batch Runs

When processing trials in batch mode, the workflow creates state entries for ALL trials in `includedTrials`, not just the one being processed.

**Evidence:**
- Running workflow for trial 22 processes trials 22, 23, 24, 25
- All get marked with `pdfConvertCompleted = true` and `phase1Completed = true`
- But only trial 22 actually has its steps tracked properly

### Issue 2: Smart Detection Logic Conflicts

The workflow has two layers of detection:
1. **Database state flags** (e.g., `pdfConvertCompleted`)
2. **File existence checks** (e.g., checking for `conversion-summary.json`)

**The Problem:**
```typescript
// In shouldRunStep()
if (this.config.forceRerun) {
  return true;
}

// Check basic completion flags first
if (this.isStepCompleted(state, step)) {
  return false;  // <-- This returns false even if files don't exist!
}

// Additional smart checks based on file existence
// Never reached if database says complete!
```

The database flag is checked BEFORE file existence, so if the database says a step is complete, the file check never happens.

### Issue 3: Batch Processing Commands

Commands like `convert-pdf` and `parse --phase1` process ALL trials in the config's `includedTrials` list, but the workflow only updates state for the requesting trial.

**Example Flow:**
1. Trial 46 requests PDF conversion
2. PDF converter processes trials 46, 47, 48, 49 (all in `includedTrials`)
3. Workflow marks only trial 46 as `pdfConvertCompleted = true`
4. Trials 47-49 have files but database shows incomplete
5. Next run for trial 47 sees files exist, skips conversion, marks complete without verification

## Current Implementation Problems

### 1. EnhancedTrialWorkflowService.ts

```typescript
private async shouldRunStep(
  state: TrialWorkflowState,
  step: WorkflowStep,
  trial: any
): Promise<boolean> {
  // Problem: Database state checked before file existence
  if (this.isStepCompleted(state, step)) {
    return false;  // Returns false even if files missing
  }
  
  // File checks never reached if DB says complete
  switch (step) {
    case WorkflowStep.PDF_CONVERT:
      return await this.shouldRunPdfConvert(trial);
    // ...
  }
}
```

### 2. Phase1 Command Processing

```typescript
// In parse.ts
// Processes ALL trials in includedTrials
for (const trialDir of includedTrials) {
  // Process trial...
}

// But workflow only knows about one trial
await workflowService.runToPhase(trialId, WorkflowPhase.PHASE1);
```

### 3. State Update Without Verification

```typescript
private async executeStep(/*...*/) {
  const result = await this.executeStep(trialId, step, trial);
  
  // Problem: Marks complete even if command processed other trials
  await this.updateStepState(trialId, step, true, duration);
}
```

## Required Fixes

### Fix 1: Reorder Detection Logic

File existence should be checked BEFORE database state:

```typescript
private async shouldRunStep(
  state: TrialWorkflowState,
  step: WorkflowStep,
  trial: any
): Promise<boolean> {
  if (this.config.forceRerun) {
    return true;
  }
  
  // CHECK FILES FIRST!
  const filesExist = await this.checkStepFiles(step, trial);
  if (!filesExist) {
    return true;  // Files missing, must run
  }
  
  // Only check DB state if files exist
  if (this.isStepCompleted(state, step)) {
    return false;
  }
  
  // If files exist but DB says incomplete, verify and update
  await this.updateStepState(trial.id, step, true);
  return false;
}
```

### Fix 2: Trial-Specific Processing

Commands should accept trial-specific filtering:

```typescript
// PDF Conversion
npm run convert-pdf config.json --trial "46 Droplets V. Ebay"

// Phase1 
npx ts-node src/cli/parse.ts parse --phase1 --config config.json --trial "46 Droplets V. Ebay"
```

### Fix 3: Verify Before Marking Complete

```typescript
private async executeStep(/*...*/) {
  const result = await this.executeStep(trialId, step, trial);
  
  // VERIFY the work was actually done
  const verified = await this.verifyStepCompletion(step, trial);
  
  if (verified) {
    await this.updateStepState(trialId, step, true, duration);
  } else {
    throw new Error(`Step ${step} reported success but verification failed`);
  }
}

private async verifyStepCompletion(step: WorkflowStep, trial: any): Promise<boolean> {
  switch (step) {
    case WorkflowStep.PDF_CONVERT:
      // Check conversion-summary.json exists and is complete
      const summaryPath = path.join(this.config.outputDir, trial.shortName, 'conversion-summary.json');
      if (!fs.existsSync(summaryPath)) return false;
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
      return summary.complete === true;
      
    case WorkflowStep.LLM_OVERRIDE:
      // Check trial-metadata.json exists
      const metadataPath = path.join(this.config.outputDir, trial.shortName, 'trial-metadata.json');
      return fs.existsSync(metadataPath);
      
    // ... other steps
  }
}
```

## Workarounds (Current State)

Until fixes are implemented:

### 1. Use --force-rerun
```bash
npx ts-node src/cli/workflow.ts run --phase phase1 --config config.json --force-rerun
```

### 2. Reset Database State Before Running
```sql
UPDATE "TrialWorkflowState" 
SET "pdfConvertCompleted" = false,
    "llmOverrideCompleted" = false,
    "phase1Completed" = false
WHERE "trialId" IN (46, 47, 48, 49);
```

### 3. Run Steps Manually
```bash
# Convert PDFs
npm run convert-pdf config/multi-trial-config-mac.json

# Generate LLM overrides
for dir in output/multi-trial/*/; do
  if [ ! -f "$dir/trial-metadata.json" ]; then
    npx ts-node src/cli/override.ts extract \
      --trial-path "$dir" \
      --output "$dir/trial-metadata.json"
  fi
done

# Run Phase1
npx ts-node src/cli/parse.ts parse --phase1 --config config.json
```

## Test Cases to Verify Fix

### Test 1: New Trial Processing
1. Add new trial to `includedTrials`
2. Ensure no files exist in output directory
3. Run workflow for phase1
4. Verify:
   - PDF files are converted
   - conversion-summary.json created
   - trial-metadata.json generated
   - Database has sessions/pages/lines

### Test 2: Partial Completion Recovery
1. Delete trial-metadata.json but keep text files
2. Run workflow
3. Verify LLM override runs but not PDF conversion

### Test 3: Database State Mismatch
1. Set `pdfConvertCompleted = true` in database
2. Delete all text files
3. Run workflow
4. Verify PDF conversion runs despite database state

## Implementation Priority

1. **HIGH**: Fix detection order (files before database)
2. **HIGH**: Add verification after step execution
3. **MEDIUM**: Add trial-specific filtering to batch commands
4. **LOW**: Add detailed logging for debugging

## Related Files

- `src/services/EnhancedTrialWorkflowService.ts` - Main workflow orchestration
- `src/cli/parse.ts` - Phase1 command processing
- `src/cli/convert-pdf.ts` - PDF conversion command
- `src/cli/workflow.ts` - Workflow CLI interface
- `src/services/override/OverrideImporter.ts` - Override import logic

## Session Handoff Notes

For the next session, focus on:

1. **Reorder the detection logic** in `shouldRunStep()` to check files first
2. **Add verification** after each step completes
3. **Test with trials 46-49** in the new batch to ensure all steps run
4. Consider adding `--trial` parameter to batch commands for single-trial processing

The core issue is that the workflow trusts database state over actual file existence, and batch commands process multiple trials but only update state for one. These architectural issues need to be addressed for reliable workflow operation.