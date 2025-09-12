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

### Delete a Single Trial

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

## Typical Workflow

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

## Database Referential Integrity

The deletion process respects all foreign key constraints and cascading deletes. The deletion order is:

1. Marker-related data (timelines, markers, sections)
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

After deleting a trial, you can re-run it through the workflow:

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