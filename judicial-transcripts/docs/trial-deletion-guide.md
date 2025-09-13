# Trial Deletion Guide

## Overview

The trial deletion functionality provides a comprehensive way to remove a trial and all its associated data from the database while maintaining referential integrity. This is essential for cleaning up failed parsing attempts or removing test data.

## Features

- **Complete Deletion**: Removes all data associated with a trial including:
  - Sessions and pages
  - Trial events and markers
  - Attorneys, witnesses, and speakers
  - Judge and court reporter information
  - Processing status and workflow state
  - All related metadata

- **Phase 3 Only Deletion**: Removes only Phase 3 processing results while preserving Phase 1 and Phase 2 data:
  - All MarkerSection records
  - All Marker records
  - All AccumulatorResult records
  - Preserves original trial structure and parsed data

- **Multiple Identification Methods**: Trials can be identified by:
  - Trial ID (numeric)
  - Case number
  - Short name

- **Safety Features**:
  - Dry run mode to preview what will be deleted
  - Confirmation prompt (can be bypassed with --force)
  - Transaction-based deletion ensures atomicity
  - Detailed deletion statistics

## CLI Commands

### Delete Phase 3 Data Only

The `delete-phase3` command can delete Phase 3 data for a single trial or all trials in the database.

#### Delete Phase 3 Data for ALL Trials

When no trial identifier is specified, the command will delete Phase 3 data for all trials:

```bash
# Delete Phase 3 data for ALL trials (prompts for confirmation)
npx ts-node src/cli/delete-trial.ts delete-phase3

# Dry run - see what would be deleted without actually deleting
npx ts-node src/cli/delete-trial.ts delete-phase3 --dry-run

# Force deletion without confirmation prompt (use with caution!)
npx ts-node src/cli/delete-trial.ts delete-phase3 --force

# Using npm script
npm run delete-trial delete-phase3
```

The command will:
1. List all trials that will be affected
2. Show total Phase 3 data to be deleted (marker sections, markers, accumulator results)
3. Prompt for confirmation (unless --force is used)
4. Delete Phase 3 data for each trial in sequence
5. Display a summary of deleted records

#### Single Trial Phase 3 Deletion

To delete Phase 3 data for a specific trial, provide the trial identifier:

```bash
# Delete Phase 3 data for a specific trial by ID
npm run delete-trial delete-phase3 3

# Delete Phase 3 by case number
npm run delete-trial delete-phase3 "2:14-CV-00033-JRG"

# Delete Phase 3 by short name
npm run delete-trial delete-phase3 "35 Rembrandt V Samsung"

# Dry run for single trial
npx ts-node src/cli/delete-trial.ts delete-phase3 --dry-run "35 Rembrandt V Samsung"

# Force deletion without confirmation
npx ts-node src/cli/delete-trial.ts delete-phase3 --force "35 Rembrandt V Samsung"
```

### Delete a Complete Trial

```bash
# Delete by trial ID
npm run delete-trial delete 3

# Delete by case number
npm run delete-trial delete "2:14-CV-00033-JRG"

# Delete by short name
npm run delete-trial delete "35 Rembrandt V Samsung"

# Dry run (preview without deleting) - IMPORTANT: option must come BEFORE identifier
npm run delete-trial delete -- --dry-run "35 Rembrandt V Samsung"
# OR use npx directly:
npx ts-node src/cli/delete-trial.ts delete --dry-run "35 Rembrandt V Samsung"

# Skip confirmation prompt - IMPORTANT: option must come BEFORE identifier
npm run delete-trial delete -- --force "35 Rembrandt V Samsung"
# OR use npx directly:
npx ts-node src/cli/delete-trial.ts delete --force "35 Rembrandt V Samsung"
```

### List All Trials

```bash
# Display formatted list
npm run delete-trial list

# Output as JSON
npm run delete-trial list --json
```

### Bulk Delete Trials

```bash
# Delete multiple trials by ID
npm run delete-trial bulk-delete --ids "1,2,3"

# Delete trials matching a pattern
npm run delete-trial bulk-delete --pattern "Test.*"

# Dry run for bulk deletion
npm run delete-trial bulk-delete --pattern "Test.*" --dry-run

# Force bulk deletion without confirmation
npm run delete-trial bulk-delete --ids "1,2,3" --force
```

## Typical Workflows

### When Phase 3 Processing Needs Re-running

1. **Identify the trial**:
   ```bash
   npm run delete-trial list
   ```

2. **Delete only Phase 3 data**:
   ```bash
   npm run delete-trial delete "35 Rembrandt V Samsung" --phase3-only
   ```

3. **Re-run Phase 3 with updated parameters**:
   ```bash
   npx ts-node src/cli/phase3.ts process --trial 35
   ```

4. **Regenerate hierarchy views**:
   ```bash
   npx ts-node src/cli/hierarchy-view.ts --trial 35
   ```

### When a Trial Fails During Processing

1. **Identify the failed trial**:
   ```bash
   npm run delete-trial list
   ```

2. **Preview what will be deleted**:
   ```bash
   npm run delete-trial delete "35 Rembrandt V Samsung" --dry-run
   ```

3. **Delete the trial data**:
   ```bash
   npm run delete-trial delete "35 Rembrandt V Samsung"
   ```

4. **Fix the issue** (update metadata, fix parsing logic, etc.)

5. **Re-run the trial processing**:
   ```bash
   npm run workflow phase1 --config config/multi-trial-config-mac.json
   ```

### Testing Phase 3 Algorithm Changes

1. **Backup current state**:
   ```bash
   ./scripts/backupdb.sh phase3_before_changes
   ```

2. **Delete Phase 3 data for all trials**:
   ```bash
   # Simple one-command deletion for all trials
   npx ts-node src/cli/delete-trial.ts delete-phase3 --force
   ```

3. **Run Phase 3 with new algorithm**:
   ```bash
   npx ts-node src/cli/phase3.ts process
   ```

4. **Compare results or restore if needed**:
   ```bash
   # If results are not satisfactory, restore
   ./scripts/restoredb.sh phase3_before_changes
   ```

## Database Referential Integrity

The deletion process respects all foreign key constraints and cascading deletes.

### Phase 3 Only Deletion Order:
1. AccumulatorResult records
2. MarkerSection records (hierarchy structures)
3. Marker records
4. Auto-generated summaries and metadata

### Complete Trial Deletion Order:
1. Phase 3 data (as above)
2. Session-related data (sections, pages, sessions)
3. Trial events and related accumulations
4. Witnesses and anonymous speakers
5. Trial attorneys
6. Judge and court reporter
7. Processing status and workflow state
8. Finally, the trial record itself

Most relationships in the database have `onDelete: Cascade` configured, which means deleting a trial automatically removes related records. However, the service explicitly deletes in order for clarity and to provide accurate deletion counts.

## Error Handling

- If a trial is not found, an appropriate error message is displayed
- Database errors are caught and reported
- The service uses transactions to ensure atomicity - either all data is deleted or none is

## Integration with Workflow

### Understanding Phase 3 Processing Behavior

The `phase3.ts` command behavior depends on whether you specify a trial:

```bash
# Process a specific trial (does NOT delete existing data)
npx ts-node src/cli/phase3.ts process --trial 1

# Process ALL trials in the database (does NOT delete existing data)
npx ts-node src/cli/phase3.ts process

# Process a specific trial with clean (deletes Phase 3 data first, then processes)
npx ts-node src/cli/phase3.ts process --trial 1 --clean

# IMPORTANT: --clean option requires a specific trial to be selected
# This will NOT work for all trials:
npx ts-node src/cli/phase3.ts process --clean  # ❌ Will show warning

# To clean and reprocess ALL trials, you must delete first, then process:
# Step 1: Delete all Phase 3 data (use Method 3 from above)
# Step 2: Process all trials
npx ts-node src/cli/phase3.ts process
```

### After Phase 3 Only Deletion

```bash
# Delete Phase 3 data for single trial
npm run delete-trial delete-phase3 "35 Rembrandt V Samsung"

# Re-run Phase 3 for that trial
npx ts-node src/cli/phase3.ts process --trial 35

# Or use the clean option in Phase 3 (deletes then recreates automatically)
npx ts-node src/cli/phase3.ts process --trial 35 --clean
```

### Processing All Trials After Deletion

```bash
# Step 1: Delete all Phase 3 data (simple command)
npx ts-node src/cli/delete-trial.ts delete-phase3 --force

# Step 2: Process all trials with fresh Phase 3 analysis
npx ts-node src/cli/phase3.ts process

# Alternative: You can also chain the commands
npx ts-node src/cli/delete-trial.ts delete-phase3 --force && npx ts-node src/cli/phase3.ts process
```

### After Complete Trial Deletion

```bash
# Delete failed trial
npm run delete-trial delete "35 Rembrandt V Samsung"

# Re-run with workflow
npm run workflow phase1 --config config/multi-trial-config-mac.json --trial "35 Rembrandt V Samsung"
```

## Safety Considerations

- **Always do a dry run first** to verify what will be deleted
- **Backup your database** before bulk deletions
- The deletion is **permanent** and cannot be undone
- Consider using database snapshots or dumps for recovery options

## Programmatic Usage

The deletion service can also be used programmatically:

```typescript
import { TrialDeletionService } from './services/TrialDeletionService';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const service = new TrialDeletionService(prisma);

// Delete a trial
const result = await service.deleteTrial('35 Rembrandt V Samsung', false);
console.log(result.statistics);

// List all trials
const trials = await service.listTrials();
console.log(trials);

await service.close();
```

## Related Commands

- `npm run prisma:reset` - Reset entire database (deletes ALL data)
- `npm run seed` - Seed database with test data
- `npm run workflow` - Process trials through the workflow
- `npm run prisma:studio` - View database contents in Prisma Studio