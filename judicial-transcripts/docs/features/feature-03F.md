# Feature 03F: Trial Transcript State Management

## Overview
This feature defines a comprehensive workflow system for managing the state and processing of trial transcripts. The system enables automatic execution of prerequisite steps, maintains per-trial state tracking, and supports both manual and automated (LLM-driven) data enrichment steps.

## Motivation
Currently, the transcript processing system requires manual execution of each phase in sequence, with no state tracking or automatic dependency resolution. Users must remember to run each step in the correct order and manually manage intermediate files and configurations. This feature will:
- Automate the execution of prerequisite steps
- Track processing state per trial
- Enable parallel processing of multiple trials
- Support LLM integration for automated data extraction
- Maintain trial-specific configurations

## Processing Workflow Steps

### Step 0: System Reset (Optional)
- Clear database: `npx prisma db push --force-reset`
- Seed global data: `npm run seed`
- Only executed when `--reset-system` flag is provided

### Step 1: PDF to Text Conversion
- Convert directory of PDF files to text files
- Directory name becomes `Trial.shortName` (e.g., "01 Generic Plaintiff v Generic Defendant")
- Merge default `config/trialstyle.json` with trial-specific `trialstyle.json` if present
- Copy merged `trialstyle.json` to destination text directory
- Copy any referenced override files to destination

### Step 2: Phase 1 Parsing
- Import text files into database
- Create entities: Trial, Session, Page, Line, SessionSection
- Parse initial structure and metadata

### Step 3: LLM Override Generation (Optional)
- Delegate background task to LLM for override file generation
- Use SUMMARY documentSection as context
- Generate JSON override files for:
  - Case metadata (plaintiff, defendant, court info)
  - Judge information
  - Attorney listings
  - Court reporter details
- Skip if override files already exist or if disabled in trialstyle.json

### Step 4: Override Import
- Import override JSON files referenced in trialstyle.json
- Merge with or replace existing data based on configuration
- Support for entity-specific override files

### Step 5: Phase 2 Processing
- Enhanced parsing with pattern matching
- Build relationships between entities
- Generate StatementEvent records

### Step 6: Phase 2 Elasticsearch Indexing
- Index StatementEvent text for searching
- Create trial-specific index

### Step 7: Phase 3 Processing
- Marker discovery and processing
- AccumulatorExpression evaluation
- MarkerSection creation

### Step 8: LLM Marker Discovery (Optional)
- Delegate task to LLM for additional marker discovery
- Use Phase 1/2 reports as context
- Generate marker override files

### Step 9: Marker Override Import (Optional)
- Import LLM-generated or manually edited marker files
- Add additional markers to the system

### Step 10: Phase 3 Elasticsearch Indexing
- Index MarkerSection aggregated text
- Create permanent searchable index

### Step 11: Phase 2 Cleanup (Optional)
- Remove Phase 2 data from Elasticsearch to save space
- Can be reloaded on-demand with timeout

## Database Schema Enhancements

### TrialWorkflowState Model
```prisma
model TrialWorkflowState {
  id                    Int                    @id @default(autoincrement())
  trialId               Int                    @unique
  trial                 Trial                  @relation(fields: [trialId], references: [id], onDelete: Cascade)
  
  // Workflow step completion tracking
  pdfConvertCompleted   Boolean                @default(false)
  pdfConvertAt          DateTime?
  phase1Completed       Boolean                @default(false)
  phase1CompletedAt     DateTime?
  llmOverrideCompleted  Boolean                @default(false)
  llmOverrideAt         DateTime?
  overrideImportCompleted Boolean              @default(false)
  overrideImportAt      DateTime?
  phase2Completed       Boolean                @default(false)
  phase2CompletedAt     DateTime?
  phase2IndexCompleted  Boolean                @default(false)
  phase2IndexAt         DateTime?
  phase3Completed       Boolean                @default(false)
  phase3CompletedAt     DateTime?
  llmMarkerCompleted    Boolean                @default(false)
  llmMarkerAt           DateTime?
  markerImportCompleted Boolean                @default(false)
  markerImportAt        DateTime?
  phase3IndexCompleted  Boolean                @default(false)
  phase3IndexAt         DateTime?
  phase2CleanupCompleted Boolean               @default(false)
  phase2CleanupAt       DateTime?
  
  // Configuration tracking
  trialStylePath        String?                // Path to trial-specific trialstyle.json
  overrideFilesPath     String?                // Path to override files directory
  sourcePdfPath         String?                // Source PDF directory path
  destinationTxtPath    String?                // Destination text directory path
  
  // LLM task tracking
  llmOverrideTaskId     String?                // Task ID for LLM override generation
  llmOverrideStatus     LLMTaskStatus          @default(PENDING)
  llmMarkerTaskId       String?                // Task ID for LLM marker discovery
  llmMarkerStatus       LLMTaskStatus          @default(PENDING)
  
  // Error tracking
  lastError             String?                @db.Text
  lastErrorAt           DateTime?
  retryCount            Int                    @default(0)
  
  createdAt             DateTime               @default(now())
  updatedAt             DateTime               @updatedAt
  
  @@index([trialId])
  @@index([llmOverrideStatus])
  @@index([llmMarkerStatus])
}

enum LLMTaskStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
  FAILED
  SKIPPED
}
```

### Trial Model Enhancement
```prisma
model Trial {
  // ... existing fields ...
  workflowState        TrialWorkflowState?
  
  // Trial-specific configuration
  trialStyle           Json?                  // Merged trialstyle.json for this trial
}
```

## Configuration: trialstyle.json Enhancement

```json
{
  // ... existing fields ...
  
  "workflow": {
    "enableLLMOverrides": true,
    "enableLLMMarkers": false,
    "cleanupPhase2After": true,
    "phase2RetentionHours": 24,
    
    "overrides": {
      "mode": "merge",  // "merge", "replace", or "manual"
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

## Implementation Approach

### Short-term Implementation (Linear)
1. Create TrialWorkflowService with sequential step execution
2. Add state tracking to existing phase commands
3. Implement prerequisite checking before each phase
4. Add `--auto` flag to commands to enable automatic prerequisite execution

```typescript
class TrialWorkflowService {
  async runToPhase(trialId: number, targetPhase: WorkflowPhase): Promise<void> {
    const state = await this.getTrialState(trialId);
    const steps = this.getRequiredSteps(state, targetPhase);
    
    for (const step of steps) {
      await this.executeStep(trialId, step);
      await this.updateState(trialId, step);
    }
  }
  
  private getRequiredSteps(
    currentState: TrialWorkflowState, 
    targetPhase: WorkflowPhase
  ): WorkflowStep[] {
    // Return list of steps needed to reach target phase
  }
}
```

### Long-term Implementation (Workflow Engine)
1. Implement DAG-based workflow engine
2. Support parallel execution of independent steps
3. Add webhook/event system for external integrations
4. Support custom workflow definitions per trial type

```typescript
interface WorkflowDefinition {
  steps: WorkflowStep[];
  dependencies: Map<string, string[]>;
  parallelizable: boolean;
}

class WorkflowEngine {
  async execute(
    trialId: number, 
    workflow: WorkflowDefinition
  ): Promise<WorkflowResult> {
    const executor = new ParallelExecutor();
    const dag = this.buildDAG(workflow);
    
    return await executor.execute(dag, {
      onStepComplete: async (step) => {
        await this.updateState(trialId, step);
        await this.emitEvent('step.complete', { trialId, step });
      },
      onError: async (step, error) => {
        await this.handleError(trialId, step, error);
      }
    });
  }
}
```

## CLI Command Enhancements

### New Commands
```bash
# Run workflow to specified phase
npx ts-node src/cli/workflow.ts run --phase phase2 --config config/multi-trial-config-mac.json

# Check workflow state
npx ts-node src/cli/workflow.ts status --trial-id 1

# Reset workflow state
npx ts-node src/cli/workflow.ts reset --trial-id 1

# Run with system reset
npx ts-node src/cli/workflow.ts run --phase phase3 --config config/multi-trial-config-mac.json --reset-system
```

### Enhanced Existing Commands
```bash
# Phase commands now check prerequisites
npx ts-node src/cli/parse.ts parse --phase2 --config config/example-trial-config-mac.json --auto

# Reports show workflow state
npx ts-node src/cli/reports.ts workflow --trial-id 1
```

## Multi-Trial Processing
When using multi-trial configuration files, the workflow will:
1. Process each trial in the `includedTrials` array
2. Maintain separate state for each trial
3. Support parallel processing (in long-term implementation)
4. Report aggregate status across all trials

## Benefits
1. **Automation**: Reduces manual intervention and command sequencing
2. **State Tracking**: Always know what phase each trial is in
3. **Error Recovery**: Can resume from last successful step
4. **Flexibility**: Support for optional LLM integration
5. **Scalability**: Foundation for parallel multi-trial processing
6. **Maintainability**: Centralized workflow management

## Testing Requirements
1. Test state transitions for single trial
2. Test multi-trial processing
3. Test error recovery and retry logic
4. Test prerequisite checking
5. Test LLM task delegation (mock)
6. Test override file merging
7. Test cleanup operations
8. Verify idempotency of each step

## Implementation Phases
1. **Phase 1**: Basic state tracking and linear execution
2. **Phase 2**: LLM integration for overrides
3. **Phase 3**: Workflow engine with parallel execution
4. **Phase 4**: Web UI for workflow monitoring

## Open Questions
1. Should workflow state be versioned for rollback capability?
2. How to handle partial failures in multi-trial processing?
3. Should we support workflow templates for different trial types?
4. What metrics should be tracked for workflow performance?

## Dependencies
- Feature-02S: Trial corrections and overrides
- Existing Phase 1, 2, 3 processing
- Elasticsearch integration
- Future: LLM service integration

## Notes
- Each trial maintains independent workflow state
- Workflow steps should be idempotent
- Configuration can disable optional steps
- System reset is a global operation, not per-trial