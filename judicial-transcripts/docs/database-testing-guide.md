# Database Testing and Management Guide

## Overview
This guide documents the correct procedures for database management, data loading, and testing in the Judicial Transcripts system. The production data files are too large to check into source control, but are referenced via configuration files that ARE in source control.

## Important Notes
- **NEVER** attempt to check in large transcript data files or backup files
- **ALWAYS** use the documented procedures below for database operations
- Database backups (.sql files) are stored in `backups/` directory (NOT in source control)
- Configuration files pointing to data locations ARE in source control
- All scripts run within Docker containers (including psql)
- We DO NOT use Prisma migrations for development - we rebuild from scratch

## Database Reset and Initialization

### Complete Database Reset Sequence
The correct order for a full database reset and data load:

```bash
# 1. Clear the existing database and rebuild schema
npx prisma db push --force-reset

# 2. Regenerate Prisma client code stubs
npx prisma generate

# 3. Load basic seed data from JSON files
npm run seed

# 4. Create backup after seeding
./scripts/backupdb.sh seed

# 5. Run Phase 1 to parse and load transcript data
npm run phase1

# 6. Create backup after Phase 1
./scripts/backupdb.sh phase1

# 7. Run Phase 2 to process and enhance the data
npm run phase2

# 8. Create backup after Phase 2
./scripts/backupdb.sh phase2
```

### Using Existing Backups
Before running phases, check if backups already exist:

```bash
# Check for existing backups
ls backups/judicial_transcripts_*.sql

# If backups exist and code hasn't changed:
# - judicial_transcripts_seed.sql
# - judicial_transcripts_phase1.sql  
# - judicial_transcripts_phase2.sql

# Restore directly to desired state
./scripts/restoredb.sh phase2  # Restores judicial_transcripts_phase2.sql
```

### Quick Reset Using Scripts
```bash
# For complete reset including Elasticsearch
./scripts/reset-all.sh

# For Elasticsearch reset only
./scripts/reset-elasticsearch.sh
```

## Data Loading Process

### Configuration Files
The system uses configuration files (in source control) that reference the actual data files:
- `config/transcripts.json` - Defines transcript file locations
- `config/settings.json` - System-wide settings
- `.env` - Environment variables including data paths

### Phase 1: Initial Data Load
Phase 1 reads raw transcript files and parses them into the database:
```bash
npm run phase1
```
- Reads transcript files from configured locations
- Parses transcript structure (sessions, pages, lines)
- Identifies speakers, attorneys, witnesses
- Creates initial database records

### Phase 2: Data Enhancement
Phase 2 processes the parsed data to add relationships and metadata:
```bash
npm run phase2
```
- Links testimonies to witnesses
- Processes examination types
- Builds search indices
- Creates relationship mappings

## Database Backup and Restore

### Backup Naming Convention
The backup scripts use a standard naming convention:
- **Pattern**: `judicial_transcripts_[stage].sql`
- **Stages**: 
  - `seed` - After initial seed data load
  - `phase1` - After Phase 1 completion
  - `phase2` - After Phase 2 completion
  - Custom names for specific test states

### Creating Backups
```bash
# Standard backups (following naming convention)
./scripts/backupdb.sh seed    # Creates: backups/judicial_transcripts_seed.sql
./scripts/backupdb.sh phase1  # Creates: backups/judicial_transcripts_phase1.sql
./scripts/backupdb.sh phase2  # Creates: backups/judicial_transcripts_phase2.sql

# Custom backup for testing
./scripts/backupdb.sh my_test_state  # Creates: backups/judicial_transcripts_my_test_state.sql
```

### Restoring from Backups
```bash
# Restore standard backups
./scripts/restoredb.sh seed    # Restores from judicial_transcripts_seed.sql
./scripts/restoredb.sh phase1  # Restores from judicial_transcripts_phase1.sql
./scripts/restoredb.sh phase2  # Restores from judicial_transcripts_phase2.sql

# List available backups
ls -la backups/judicial_transcripts_*.sql
```

### Windows Users
Use the `.bat` versions of scripts:
```bash
scripts\backupdb.bat phase1
scripts\restoredb.bat phase2
```

## Testing Workflows

### Standard Testing Sequence
1. Restore from known good backup OR run full initialization
2. Run specific feature tests
3. Verify results

### For Feature Development
```bash
# Check if backup exists
if [ -f "backups/judicial_transcripts_phase2.sql" ]; then
    # Quick restore to Phase 2 complete state
    ./scripts/restoredb.sh phase2
else
    # Need to build from scratch
    npx prisma db push --force-reset
    npx prisma generate
    npm run seed
    ./scripts/backupdb.sh seed
    npm run phase1
    ./scripts/backupdb.sh phase1
    npm run phase2
    ./scripts/backupdb.sh phase2
fi

# Run your feature
npm run feature:03  # or whatever feature

# Test queries
npm run run-all-queries
```

### For Debugging Phases
```bash
# Full reset and step-through
npx prisma db push --force-reset
npx prisma generate
npm run seed
npm run phase1 -- --verbose  # with debug output
# Check Phase 1 results
npm run phase2 -- --verbose
# Check Phase 2 results
```

## Common Testing Scenarios

### Testing Search Functionality
```bash
# Ensure database is at Phase 2 complete
./scripts/restoredb.sh phase2

# Reset Elasticsearch
./scripts/reset-elasticsearch.sh

# Sync data to Elasticsearch
npm run sync:elasticsearch

# Run search tests
npm run test:search
```

### Testing Report Generation
```bash
# Restore to known state with full data
./scripts/restoredb.sh phase2

# Run report generation
npm run reports:generate
```

### Testing Specific Queries
```bash
# Restore database
./scripts/restoredb.sh phase2

# Run query tests
npm run run-all-queries
```

## Troubleshooting

### If Phase 1 Fails
1. Check transcript file paths in configuration
2. Verify file permissions
3. Check database connection
4. Review logs in `logs/phase1.log`

### If Phase 2 Fails
1. Ensure Phase 1 completed successfully
2. Check for data integrity issues
3. Review logs in `logs/phase2.log`

### If Restore Fails
1. Check backup file exists
2. Verify database permissions
3. Ensure database is not in use
4. Check disk space

## Best Practices for Claude Sessions

### Starting a New Session
1. Check for existing backups: `ls backups/judicial_transcripts_*.sql`
2. If standard backups exist (seed, phase1, phase2), use them
3. If not, build from scratch following the initialization sequence
4. Always verify current database state before making changes

### Efficient Testing Workflow
```bash
# First, check what backups are available
ls -la backups/judicial_transcripts_*.sql

# If phase2 backup exists, use it
./scripts/restoredb.sh phase2

# If not, check for phase1 and build from there
./scripts/restoredb.sh phase1
npm run phase2
./scripts/backupdb.sh phase2

# Always create backups after successful operations
```

### Before Major Changes
1. Create a backup of current state
2. Use descriptive names for custom backups
3. Test changes incrementally

### For Debugging
1. Use verbose flags on phase commands
2. Check logs in `logs/` directory
3. Run phases individually to isolate issues

## DO NOT Do These Things
- ❌ Try to load transcript files directly without using phases
- ❌ Skip Phase 1 and go directly to Phase 2
- ❌ Attempt to check in backup files or large data files
- ❌ Use `prisma migrate` commands (we use `prisma db push` instead)
- ❌ Delete backups without confirming they're not needed
- ❌ Recreate backups if they already exist and code hasn't changed

## Quick Reference Commands

```bash
# Database Schema Management
npx prisma db push --force-reset  # Reset database and apply schema
npx prisma generate               # Generate Prisma client

# Data Loading Sequence
npm run seed                      # Load seed data
npm run phase1                    # Parse and load transcripts
npm run phase2                    # Process and enhance data

# Backup Management (creates backups/judicial_transcripts_[name].sql)
./scripts/backupdb.sh seed       # Backup after seeding
./scripts/backupdb.sh phase1     # Backup after Phase 1
./scripts/backupdb.sh phase2     # Backup after Phase 2

# Restore from Backups
./scripts/restoredb.sh seed      # Restore to seed state
./scripts/restoredb.sh phase1    # Restore to Phase 1 complete
./scripts/restoredb.sh phase2    # Restore to Phase 2 complete

# Testing
npm run run-all-queries          # Run all query tests

# Elasticsearch
./scripts/reset-elasticsearch.sh # Reset Elasticsearch
npm run sync:elasticsearch       # Sync data to Elasticsearch

# Check Available Backups
ls -la backups/judicial_transcripts_*.sql
```

## Configuration File Locations
- `config/transcripts.json` - Transcript file paths
- `config/settings.json` - System settings
- `.env` - Environment variables
- `prisma/schema.prisma` - Database schema
- `prisma/seed.ts` - Seed data loader

This guide should be consulted whenever working with database operations, testing, or data loading procedures.