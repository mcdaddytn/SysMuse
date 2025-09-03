# Feature 03F: Trial Transcript State Management - Assets

## Overview
This directory contains supporting assets for implementing the Trial Transcript State Management feature.

## Contents

### Sample Configuration Files

#### sample-trialstyle-enhanced.json
Example of enhanced trialstyle.json with workflow configuration:

```json
{
  "fileConvention": "AUTO",
  "fileSortingMode": "AUTO",
  "pageHeaderLines": 2,
  "statementAppendMode": "space",
  "summaryCenterDelimiter": "AUTO",
  "orderedFiles": [],
  "unidentifiedFiles": [],
  "metadata": {},
  
  "workflow": {
    "enableLLMOverrides": true,
    "enableLLMMarkers": false,
    "cleanupPhase2After": true,
    "phase2RetentionHours": 24,
    
    "overrides": {
      "mode": "merge",
      "files": {
        "attorneys": "overrides/attorneys.json",
        "judge": "overrides/judge.json",
        "witnesses": "overrides/witnesses.json",
        "metadata": "overrides/metadata.json"
      }
    },
    
    "llm": {
      "provider": "openai",
      "model": "gpt-4",
      "maxRetries": 3,
      "timeout": 300000
    }
  }
}
```

### Sample Override Files

#### sample-attorneys-override.json
```json
{
  "attorneys": [
    {
      "name": "John Smith",
      "barNumber": "TX12345",
      "role": "PLAINTIFF",
      "firm": "Smith & Associates",
      "office": "Dallas, TX"
    },
    {
      "name": "Jane Doe",
      "barNumber": "TX67890",
      "role": "DEFENDANT",
      "firm": "Doe Legal Group",
      "office": "Houston, TX"
    }
  ]
}
```

#### sample-judge-override.json
```json
{
  "judge": {
    "name": "Hon. Robert Johnson",
    "court": "United States District Court",
    "district": "Eastern District of Texas",
    "division": "Marshall Division"
  }
}
```

#### sample-metadata-override.json
```json
{
  "metadata": {
    "caseName": "Plaintiff Corp. v. Defendant Inc.",
    "caseNumber": "2:19-CV-00123-JRG",
    "alternateCaseNumber": null,
    "plaintiff": "Plaintiff Corporation",
    "defendant": "Defendant Incorporated",
    "alternateDefendant": null,
    "courtReporter": "Mary Williams, CSR",
    "reporterLicense": "CSR No. 12345"
  }
}
```

### Workflow State Examples

#### sample-workflow-state.json
Example of workflow state tracking:
```json
{
  "trialId": 1,
  "trialName": "01 Generic Plaintiff v Generic Defendant",
  "workflowState": {
    "pdfConvertCompleted": true,
    "pdfConvertAt": "2024-01-15T10:00:00Z",
    "phase1Completed": true,
    "phase1CompletedAt": "2024-01-15T10:30:00Z",
    "llmOverrideCompleted": false,
    "overrideImportCompleted": false,
    "phase2Completed": false,
    "phase2IndexCompleted": false,
    "phase3Completed": false,
    "llmMarkerCompleted": false,
    "markerImportCompleted": false,
    "phase3IndexCompleted": false,
    "phase2CleanupCompleted": false,
    
    "trialStylePath": "/data/trials/01/trialstyle.json",
    "overrideFilesPath": "/data/trials/01/overrides/",
    "sourcePdfPath": "/data/pdf/01 Generic Plaintiff v Generic Defendant/",
    "destinationTxtPath": "/data/txt/01 Generic Plaintiff v Generic Defendant/",
    
    "llmOverrideStatus": "PENDING",
    "llmMarkerStatus": "SKIPPED"
  }
}
```

### CLI Usage Examples

#### run-workflow-phase2.sh
```bash
#!/bin/bash
# Run workflow to Phase 2 for all trials in config
npx ts-node src/cli/workflow.ts run \
  --phase phase2 \
  --config config/multi-trial-config-mac.json \
  --verbose
```

#### run-workflow-complete.sh
```bash
#!/bin/bash
# Run complete workflow with system reset
npx ts-node src/cli/workflow.ts run \
  --phase phase3 \
  --config config/multi-trial-config-mac.json \
  --reset-system \
  --verbose
```

#### check-workflow-status.sh
```bash
#!/bin/bash
# Check workflow status for specific trial
npx ts-node src/cli/workflow.ts status --trial-id 1
```

## Implementation Notes

### State Machine Definition
The workflow follows this state progression:
1. INITIAL → PDF_CONVERTED
2. PDF_CONVERTED → PHASE1_COMPLETE
3. PHASE1_COMPLETE → OVERRIDES_COMPLETE (optional)
4. OVERRIDES_COMPLETE → PHASE2_COMPLETE
5. PHASE2_COMPLETE → PHASE2_INDEXED
6. PHASE2_INDEXED → PHASE3_COMPLETE
7. PHASE3_COMPLETE → MARKERS_COMPLETE (optional)
8. MARKERS_COMPLETE → PHASE3_INDEXED
9. PHASE3_INDEXED → COMPLETE

### Error Recovery Strategy
- Each step is idempotent
- Failed steps can be retried
- State is persisted after each successful step
- Partial failures in multi-trial processing continue with next trial

### Performance Considerations
- PDF conversion can be slow for large trials
- LLM tasks are async and may take minutes
- Elasticsearch indexing should be batched
- Consider parallel processing for multi-trial workflows

## Testing Data

### Mock LLM Responses
Located in `mock-llm-responses/` subdirectory for testing LLM integration without actual API calls.

### Test Trial Configurations
Small test trials for rapid development testing in `test-configs/` subdirectory.

## Related Features
- Feature-02S: Trial corrections and override system
- Feature-03E: MarkerSection text aggregation
- Feature-02T: Multi-trial configuration support