# Feature 03D: Elasticsearch Data Lifecycle Management for Multi-Trial Processing

## Overview
Implement a data lifecycle management system for Elasticsearch to optimize storage and performance when processing multiple trials through phases 2 and 3. The system will maintain Elasticsearch data for only one trial at a time, cleaning up after phase 3 completion while preserving essential indexed data in MarkerSection records.

## Problem Statement
- Processing 60+ trials through phase 2 creates massive Elasticsearch indices
- Each trial's StatementEvent records consume significant storage
- Cross-trial search is not required for phase 2/3 processing
- Only MarkerSection text needs to be permanently searchable across trials
- Current system retains all Elasticsearch data indefinitely

## Solution Architecture

### 1. Trial-Scoped Elasticsearch Processing
- Maintain Elasticsearch data for only one trial at a time during phase 2/3
- Clear previous trial's ES data before processing next trial
- Preserve extracted insights in MarkerSection records

### 2. Processing Flow
```
For each trial:
  1. Run Phase 2 → Creates StatementEvent records with ES IDs
  2. Run Phase 3 → Creates MarkerSection records with indexed text
  3. Clear ES data → Remove trial's documents from Elasticsearch
  4. Update database → Set StatementEvent.elasticsearchId to null
  5. Proceed to next trial
```

### 3. Data Retention Strategy

#### Temporary (Per-Trial) Data:
- StatementEvent Elasticsearch documents
- Accumulator expression results
- Temporary search indices

#### Permanent Data:
- MarkerSection.text (database field)
- MarkerSection.metadata (preserves key insights)
- Marker records (testimony boundaries, events)
- All database records remain intact

## Implementation Requirements

### 1. Elasticsearch Index Management

```typescript
interface ElasticsearchManager {
  // Create trial-specific index
  createTrialIndex(trialId: number): Promise<string>;
  
  // Delete all documents for a trial
  deleteTrialDocuments(trialId: number): Promise<void>;
  
  // Update StatementEvent records
  clearElasticsearchReferences(trialId: number): Promise<void>;
}
```

### 2. Phase 2 Modifications

```typescript
// Add trial isolation to phase 2
async function runPhase2(trialId: number) {
  // Check if previous trial data exists
  await checkAndClearPreviousTrial();
  
  // Create trial-specific index or clear existing
  const indexName = await createOrClearTrialIndex(trialId);
  
  // Process normally
  await processPhase2(trialId, indexName);
}
```

### 3. Phase 3 Modifications

```typescript
// Add cleanup after phase 3
async function runPhase3(trialId: number) {
  // Normal phase 3 processing
  await processPhase3(trialId);
  
  // Extract and preserve key data
  await preserveMarkerSections(trialId);
  
  // Clear Elasticsearch data
  await clearTrialElasticsearch(trialId);
}
```

### 4. Database Schema Updates

```sql
-- Add tracking fields to Trial table
ALTER TABLE "Trial" ADD COLUMN IF NOT EXISTS "phase2CompletedAt" TIMESTAMP;
ALTER TABLE "Trial" ADD COLUMN IF NOT EXISTS "phase3CompletedAt" TIMESTAMP;
ALTER TABLE "Trial" ADD COLUMN IF NOT EXISTS "elasticsearchCleared" BOOLEAN DEFAULT FALSE;

-- Add index for efficient cleanup queries
CREATE INDEX IF NOT EXISTS idx_statement_event_trial_es 
ON "StatementEvent"("trialId", "elasticsearchId");
```

### 5. Cleanup Operations

```typescript
class ElasticsearchCleaner {
  async clearTrialData(trialId: number): Promise<void> {
    // 1. Delete from Elasticsearch
    await this.deleteFromElasticsearch(trialId);
    
    // 2. Update database records
    await prisma.statementEvent.updateMany({
      where: { trialId },
      data: { elasticsearchId: null }
    });
    
    // 3. Mark trial as cleared
    await prisma.trial.update({
      where: { id: trialId },
      data: { elasticsearchCleared: true }
    });
  }
}
```

## CLI Commands

### New Commands
```bash
# Process trial with automatic cleanup
npx ts-node src/cli/parse.ts process-trial --trial-id 1 --with-cleanup

# Manual cleanup for a trial
npx ts-node src/cli/parse.ts cleanup-es --trial-id 1

# Batch processing with cleanup
npx ts-node src/cli/parse.ts batch-process --start-trial 1 --end-trial 60

# Check Elasticsearch storage status
npx ts-node src/cli/parse.ts es-status
```

### Modified Commands
```bash
# Phase 2 with auto-cleanup of previous trial
npx ts-node src/cli/parse.ts parse --phase2 --trial-id 1 --auto-cleanup

# Phase 3 with post-processing cleanup
npx ts-node src/cli/parse.ts parse --phase3 --trial-id 1 --cleanup-after
```

## Benefits

1. **Storage Optimization**: Reduces Elasticsearch storage by ~98% (keeps only active trial)
2. **Performance**: Faster searches within single trial context
3. **Scalability**: Can process unlimited trials without storage concerns
4. **Data Preservation**: All insights preserved in database
5. **Flexibility**: Can reprocess any trial independently

## Migration Strategy

### For Existing Data
1. Export MarkerSection data for all completed trials
2. Clear all Elasticsearch indices
3. Update StatementEvent records to remove ES references
4. Mark trials as ES-cleared

### Going Forward
1. Implement cleanup hooks in phase 3
2. Add configuration option for auto-cleanup
3. Provide manual cleanup commands
4. Monitor and log cleanup operations

## Configuration

```json
{
  "elasticsearch": {
    "lifecycle": {
      "enabled": true,
      "autoCleanup": true,
      "cleanupDelay": 0,
      "preserveMarkerSections": true,
      "indexPrefix": "trial_temp_",
      "maxConcurrentTrials": 1
    }
  }
}
```

## Testing Requirements

1. Verify cleanup removes all ES documents for trial
2. Confirm StatementEvent updates work correctly
3. Test MarkerSection preservation
4. Validate phase 2 → phase 3 → cleanup pipeline
5. Test recovery from interrupted cleanup
6. Verify cross-trial MarkerSection search still works

## Success Criteria

- [ ] Elasticsearch storage remains constant during batch processing
- [ ] Phase 2/3 processing time not significantly impacted
- [ ] All MarkerSection data preserved and searchable
- [ ] Clean rollback on failure
- [ ] Clear audit trail of cleared data
- [ ] No data loss for database records

## Future Enhancements

1. **Parallel Processing**: Process multiple trials with isolated indices
2. **Archival System**: Option to archive ES data to S3/disk
3. **Selective Retention**: Keep ES data for specific important trials
4. **Incremental Cleanup**: Clean as you go within phases
5. **Smart Caching**: Keep frequently accessed trial data longer

## Notes

- This is a non-breaking change - existing workflows continue to work
- Cleanup is optional and can be disabled
- Database remains the source of truth
- Elasticsearch becomes truly temporary storage
- MarkerSection.text provides permanent searchability