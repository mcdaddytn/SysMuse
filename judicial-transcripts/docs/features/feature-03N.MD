# Feature-03N: Enhanced Trial Metadata Import with Conditional Insert and Selective Import

## Overview
Enhance the trial metadata override system to support conditional insertion of entities, selective import flags, and improved attorney association. This feature provides fine-grained control over what metadata is imported and prevents duplicate entity creation while maintaining proper relationships.

## Background
The current metadata import system has limitations:
1. Always attempts to import all generated metadata (judges, court reporters, attorneys)
2. Uses Upsert which updates existing records even when not desired
3. Cannot selectively import only new entities
4. Attorney association during Phase2 lacks proper scoping
5. No way to prevent cascading inserts of associated entities

## Requirements

### 1. Selective Import Flags
Add boolean flags to control which entity types should be imported from metadata:

**In metadata section of trial-metadata.json:**
```json
{
  "metadata": {
    "userReview": true,
    "importAttorney": true,      // Default: true
    "importJudge": false,         // Default: false
    "importCourtReporter": false  // Default: false
  }
}
```

**Rationale:**
- Most trials share the same judge and court reporters
- Attorneys are more likely to be unique per trial
- Prevents repeated attempts to import already-existing entities

### 2. ConditionalInsert Override Action
New override action that only inserts if the entity doesn't exist:

**Behavior:**
- If entity exists (by fingerprint): Do nothing (no update)
- If entity doesn't exist: Insert new record
- Cascading rule: Don't insert associated entities unless parent is inserted

**Entity Dependencies:**
```
Attorney (ConditionalInsert)
  └─> LawFirm (ConditionalInsert) - only if Attorney inserted
      └─> LawFirmOffice (ConditionalInsert) - only if LawFirm inserted
          └─> Address (ConditionalInsert) - only if Office inserted

CourtReporter (ConditionalInsert)
  └─> Address (ConditionalInsert) - only if CourtReporter inserted
```

### 3. TrialAttorney Pre-Creation in Metadata
Since `speakerId` is optional in TrialAttorney, we can pre-create these associations:

**Benefits:**
- Better scoping when matching attorneys to speakers
- Eliminates ambiguous speakerPrefix matches across trials
- Simplifies Phase2 attorney association logic

**Implementation:**
- Generate TrialAttorney records in LLM metadata extraction
- Import during metadata import (without speakerId)
- Update speakerId when attorney first speaks in Phase2

### 4. Enhanced Attorney Speaker Matching

#### Unique Speaker Prefix Within Trial
When generating metadata, ensure unique speakerPrefix within each trial:
- If two attorneys share same last name: Add first name
- Example: "MR. SMITH" becomes "MR. JOHN SMITH" if another Smith exists

#### Phase2 Attorney Matching Logic
```typescript
// 1. First check for existing TrialAttorney association
const trialAttorney = await tx.trialAttorney.findFirst({
  where: {
    trialId: this.trialId,
    attorney: {
      speakerPrefix: speakerPrefix
    }
  },
  include: { attorney: true }
});

if (trialAttorney) {
  // Use pre-associated attorney
  attorney = trialAttorney.attorney;
} else {
  // 2. Fallback: Search all attorneys with matching prefix
  const attorneys = await tx.attorney.findMany({
    where: { speakerPrefix: speakerPrefix },
    orderBy: { id: 'desc' }  // Latest first
  });
  
  if (attorneys.length > 1) {
    logger.warn(`Multiple attorneys found with prefix ${speakerPrefix}, using latest (id=${attorneys[0].id})`);
  }
  attorney = attorneys[0];
}

// 3. Create speaker and update TrialAttorney with speakerId
```

### 5. Comprehensive Logging
Add detailed logging for attorney resolution:
- Log when multiple attorneys match a prefix
- Log which attorney was selected and why
- Log when TrialAttorney association is created vs updated
- Log ConditionalInsert decisions (inserted vs skipped)

## Implementation Details

### Phase 1: Update LLM Extractor
**File:** `src/services/extractors/LLMExtractor.ts`

Add import flags to metadata section:
```typescript
metadata: {
  userReview: true,
  importAttorney: true,
  importJudge: false,
  importCourtReporter: false,
  ...existing fields
}
```

Generate TrialAttorney records:
```typescript
TrialAttorney: attorneys.map(attorney => ({
  trialId: trial.id,
  attorneyId: attorney.id,
  role: determineRole(attorney),
  lawFirmId: attorney.lawFirmId,
  lawFirmOfficeId: attorney.lawFirmOfficeId,
  overrideAction: "Upsert",
  overrideKey: "trialAttorneyFingerprint"  // trialId_attorneyId
}))
```

### Phase 2: Implement ConditionalInsert in OverrideImporter
**File:** `src/services/override/OverrideImporter.ts`

```typescript
private async handleConditionalInsert(
  tx: any,
  entity: any,
  entityType: string,
  fingerprint: string
): Promise<{ inserted: boolean, id?: number }> {
  
  // Check if entity exists
  const existing = await this.findByFingerprint(tx, entityType, fingerprint);
  
  if (existing) {
    logger.info(`ConditionalInsert: ${entityType} exists (fingerprint=${fingerprint}), skipping`);
    return { inserted: false, id: existing.id };
  }
  
  // Insert new entity
  const created = await this.insertEntity(tx, entityType, entity);
  logger.info(`ConditionalInsert: Created new ${entityType} (id=${created.id})`);
  return { inserted: true, id: created.id };
}
```

### Phase 3: Update Existing trial-metadata.json Files
**Script:** `scripts/update-trial-metadata-flags.ts`

For each trial-metadata.json in output/multi-trial/*/
1. Add import flags to metadata section
2. Change Attorney overrideAction to "ConditionalInsert"
3. Change LawFirm, LawFirmOffice, Address to "ConditionalInsert"
4. Add TrialAttorney records if not present

### Phase 4: Enhanced Phase2 Attorney Association
**File:** `src/parsers/Phase2Processor.ts`

Update attorney matching to prioritize TrialAttorney associations and add comprehensive logging.

## Migration Strategy

### Step 1: Update Existing Metadata Files
1. Run script to update all trial-metadata.json files
2. Review changes manually
3. Sync to source directory using sync.ts

### Step 2: Deploy Code Changes
1. Update LLMExtractor with new fields
2. Implement ConditionalInsert logic
3. Update Phase2 attorney matching

### Step 3: Test with Sample Trials
1. Reset database
2. Import metadata with ConditionalInsert
3. Run Phase1 and Phase2
4. Verify no duplicate entities created
5. Verify proper attorney associations

## Success Criteria
1. Selective import flags control which entities are imported
2. ConditionalInsert prevents updates to existing entities
3. Associated entities only inserted when parent is inserted
4. TrialAttorney pre-creation improves attorney matching accuracy
5. No duplicate attorneys with same speakerPrefix within trial
6. Comprehensive logs show all resolution decisions
7. Existing workflows continue to function

## Benefits
1. **Reduced Duplicates:** ConditionalInsert prevents repeated updates
2. **Better Control:** Selective import flags give user fine-grained control
3. **Improved Accuracy:** Pre-created TrialAttorney associations provide better scoping
4. **Cleaner Data:** Only insert what's needed, when it's needed
5. **Easier Debugging:** Comprehensive logging helps troubleshoot issues

## Testing Requirements
1. Test ConditionalInsert with existing and new entities
2. Test cascading insert prevention
3. Test selective import flags (all combinations)
4. Test attorney matching with pre-created TrialAttorney records
5. Test unique speakerPrefix enforcement within trial
6. Test multi-trial scenarios with shared entities
7. Verify logging captures all decisions

## Dependencies
- Feature-03K: Phase2 Attorney Matching
- Feature-03J: Override System Fixes
- Existing override import system
- Phase2 processing pipeline

## Notes
- This is an enhancement to existing functionality
- Maintains backward compatibility
- Can be rolled out incrementally
- User can manually adjust import flags per trial