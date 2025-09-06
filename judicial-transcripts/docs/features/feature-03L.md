# Feature-03L: Enhanced Workflow Management with LLM Integration and User Review

## Overview
Enhance the trial processing workflow to automatically handle LLM-generated overrides and markers with user review checkpoints, implement intelligent step skipping based on completion status, and provide comprehensive sync capabilities between source and destination directories.

## Goals
1. Integrate LLM override generation automatically before Phase 1
2. Add user review checkpoints for LLM-generated metadata
3. Implement smart step detection to avoid redundant processing
4. Add dual LLM marker generation phases (post-Phase2 and post-Phase3)
5. Provide bidirectional sync between source and destination directories
6. Remove unnecessary path fields from TrialWorkflowState
7. Document all workflow states comprehensively

## Key Components

### 1. Enhanced Workflow Sequence

#### Complete Processing Pipeline:
1. **PDF Conversion** - Convert PDFs to text, copy metadata
2. **LLM Override Generation** - Generate attorney/witness/trial overrides via LLM
3. **User Review Gate** - Pause for user review if not auto-approved
4. **Override Import** - Import approved overrides to database
5. **Phase 1** - Initial parsing and database population
6. **Phase 2** - Enhanced processing and relationship building
7. **LLM Marker Generation 1** - Post-Phase2 marker discovery
8. **User Review Gate** - Pause for marker review if not auto-approved
9. **Marker Import 1** - Import approved markers
10. **Phase 3** - Final processing and validation
11. **LLM Marker Generation 2** - Post-Phase3 timeline markers
12. **User Review Gate** - Final marker review if not auto-approved
13. **Marker Import 2** - Import final markers

### 2. Smart Step Detection

#### PDF Conversion Status Detection
- Check for `conversion-summary.json` in destination directory
- Contains:
  ```json
  {
    "timestamp": "2025-01-06T10:00:00Z",
    "filesConverted": ["file1.pdf", "file2.pdf"],
    "metadataCopied": ["trialstyle.json", "overrides/*.json"],
    "sourceDir": "/path/to/source",
    "destDir": "/path/to/dest",
    "complete": true
  }
  ```
- Skip conversion if all source files are present in destination

#### LLM Override Status Detection
- Check for override JSON files in output directory
- Validate `userReviewed` flag in each file:
  ```json
  {
    "metadata": {
      "generatedAt": "2025-01-06T10:00:00Z",
      "llmModel": "gpt-4",
      "userReviewed": false,
      "reviewedAt": null,
      "reviewedBy": null
    },
    "overrides": { ... }
  }
  ```
- If files exist and `userReviewed: true`, skip generation
- If files exist but `userReviewed: false`, pause workflow

#### LLM Marker Status Detection
Similar structure for marker files with user review flags

### 3. User Review Configuration

#### Trial Style Configuration
Add to `trialstyle.json`:
```json
{
  "autoReview": {
    "overrides": false,  // Auto-approve LLM overrides
    "markers1": false,   // Auto-approve post-Phase2 markers
    "markers2": false    // Auto-approve post-Phase3 markers
  }
}
```

Can be overridden at individual trial level in multi-trial config

### 4. Workflow State Management

#### Updated TrialWorkflowState Schema
Remove path-related fields, keep only state information:
```typescript
interface TrialWorkflowState {
  // Identifiers
  id: number
  trialId: number
  
  // Step completion flags
  pdfConvertCompleted: boolean
  llmOverrideCompleted: boolean
  overrideReviewCompleted: boolean
  overrideImportCompleted: boolean
  phase1Completed: boolean
  phase2Completed: boolean
  llmMarker1Completed: boolean
  marker1ReviewCompleted: boolean
  marker1ImportCompleted: boolean
  phase3Completed: boolean
  llmMarker2Completed: boolean
  marker2ReviewCompleted: boolean
  marker2ImportCompleted: boolean
  
  // Timestamps
  pdfConvertedAt?: Date
  llmOverrideGeneratedAt?: Date
  overrideReviewedAt?: Date
  phase1CompletedAt?: Date
  phase2CompletedAt?: Date
  llmMarker1GeneratedAt?: Date
  marker1ReviewedAt?: Date
  phase3CompletedAt?: Date
  llmMarker2GeneratedAt?: Date
  marker2ReviewedAt?: Date
  
  // Status tracking
  currentStatus: WorkflowStatus
  lastError?: string
  lastErrorAt?: Date
  
  // Metadata
  createdAt: Date
  updatedAt: Date
}
```

### 5. Sync Commands

#### Sync Override Files to Source
```bash
npx ts-node src/cli/sync.ts overrides --approve
```
- Copies override JSON from output to source directories
- Sets `userReviewed: true` when `--approve` flag is used
- Creates backups of existing files

#### Sync Marker Files to Source
```bash
npx ts-node src/cli/sync.ts markers --phase 1 --approve
npx ts-node src/cli/sync.ts markers --phase 2 --approve
```
- Copies marker JSON from output to source
- Manages review flags

#### Sync Trial Style Configuration
```bash
npx ts-node src/cli/sync.ts trialstyle --direction to-source
npx ts-node src/cli/sync.ts trialstyle --direction to-dest
```
- Bidirectional sync of configuration files

### 6. Workflow Status Enumerations

```typescript
enum WorkflowStatus {
  NOT_STARTED = 'not_started',
  PDF_CONVERTING = 'pdf_converting',
  GENERATING_OVERRIDES = 'generating_overrides',
  AWAITING_OVERRIDE_REVIEW = 'awaiting_override_review',
  IMPORTING_OVERRIDES = 'importing_overrides',
  PHASE1_PROCESSING = 'phase1_processing',
  PHASE2_PROCESSING = 'phase2_processing',
  GENERATING_MARKERS_1 = 'generating_markers_1',
  AWAITING_MARKER1_REVIEW = 'awaiting_marker1_review',
  IMPORTING_MARKERS_1 = 'importing_markers_1',
  PHASE3_PROCESSING = 'phase3_processing',
  GENERATING_MARKERS_2 = 'generating_markers_2',
  AWAITING_MARKER2_REVIEW = 'awaiting_marker2_review',
  IMPORTING_MARKERS_2 = 'importing_markers_2',
  COMPLETED = 'completed',
  ERROR = 'error',
  PAUSED = 'paused'
}
```

### 7. CLI Workflow Commands

#### Run with Auto-Review
```bash
# Process with automatic approval of all LLM outputs
npx ts-node src/cli/workflow.ts run --phase complete \
  --config config/multi-trial-config.json \
  --auto-review
```

#### Run with Review Gates
```bash
# Process with review pauses at each LLM generation
npx ts-node src/cli/workflow.ts run --phase complete \
  --config config/multi-trial-config.json \
  --require-review
```

#### Resume After Review
```bash
# After manually reviewing and approving files
npx ts-node src/cli/sync.ts overrides --approve
npx ts-node src/cli/workflow.ts resume --trial-id 1
```

#### Check Review Status
```bash
# See which trials are awaiting review
npx ts-node src/cli/workflow.ts status --pending-review
```

## Implementation Details

### Phase Dependencies
- Phase 1 requires: PDF conversion, LLM overrides (if enabled), override review
- Phase 2 requires: Phase 1 completion
- Phase 3 requires: Phase 2, first marker generation (if enabled)
- Complete requires: All phases and reviews

### Error Handling
- Workflow pauses at review gates if `userReviewed: false`
- Clear status messages indicate what action is needed
- Workflow can be resumed after manual review and approval
- Failed LLM generations can be retried or skipped

### File Organization
```
output/
  [trial-name]/
    text/
      *.txt                          # Converted text files
    conversion-summary.json          # Conversion metadata
    Attorney.json                    # LLM override with review flag
    Witness.json                     # LLM override with review flag
    Trial.json                       # LLM override with review flag
    markers-phase2.json              # Post-Phase2 markers
    markers-phase3.json              # Post-Phase3 markers
    trialstyle.json                  # Trial-specific config
```

## Testing Plan
1. Test complete workflow with auto-review enabled
2. Test workflow with review gates and manual approval
3. Test resumption after review approval
4. Test sync commands in both directions
5. Test partial completion detection
6. Test error recovery scenarios

## Migration Steps
1. Update TrialWorkflowState schema (remove path fields)
2. Add review status fields to schema
3. Implement smart detection logic
4. Add LLM generation steps
5. Implement sync commands
6. Update workflow CLI
7. Document all states and commands

## Success Criteria
- Workflow automatically runs LLM override generation before Phase 1
- User review gates pause workflow when configured
- Smart detection prevents redundant processing
- Sync commands properly manage review flags
- Two-phase marker generation is operational
- All workflow states are documented
- Commands are added to COMMANDS-QUICK-REFERENCE.MD