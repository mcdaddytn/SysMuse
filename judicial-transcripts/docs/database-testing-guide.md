# Database Testing and Management Guide

## Overview
This guide documents the correct procedures for database management, data loading, and testing in the Judicial Transcripts system. The production data files are too large to check into source control, but are referenced via configuration files that ARE in source control.

## Important Notes
- **NEVER** attempt to check in large transcript data files
- **ALWAYS** use the documented procedures below for database operations
- Database backups (.sql files) are NOT in source control due to size
- Configuration files pointing to data locations ARE in source control

## Database Reset and Initialization

### Complete Database Reset Sequence
The correct order for a full database reset and data load:

```bash
# 1. Clear the existing database
npx prisma migrate reset --force

# 2. Regenerate Prisma client code stubs
npx prisma generate

# 3. Apply schema migrations
npx prisma migrate deploy

# 4. Load basic seed data from JSON files
npm run seed

# 5. Run Phase 1 to parse and load transcript data
npm run phase1

# 6. Run Phase 2 to process and enhance the data
npm run phase2
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

### Creating Backups
After successfully loading data through phases, create a checkpoint:
```bash
# Create a backup after Phase 1
./scripts/backupdb.sh phase1_complete

# Create a backup after Phase 2
./scripts/backupdb.sh phase2_complete

# Create a backup with custom name
./scripts/backupdb.sh my_test_state
```

Backups are stored in `backups/` directory (not in source control).

### Restoring from Backups
To quickly restore to a known good state:
```bash
# Restore from a specific backup
./scripts/restoredb.sh phase2_complete

# List available backups
ls backups/*.sql
```

## Testing Workflows

### Standard Testing Sequence
1. Restore from known good backup OR run full initialization
2. Run specific feature tests
3. Verify results

### For Feature Development
```bash
# Quick restore to Phase 2 complete state
./scripts/restoredb.sh phase2_complete

# Run your feature
npm run feature:03  # or whatever feature

# Test queries
npm run test:queries
```

### For Debugging Phases
```bash
# Full reset and step-through
npx prisma migrate reset --force
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
./scripts/restoredb.sh phase2_complete

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
./scripts/restoredb.sh phase2_complete

# Run report generation
npm run reports:generate
```

### Testing Specific Queries
```bash
# Restore database
./scripts/restoredb.sh phase2_complete

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
1. Ask about current database state
2. Check if backups are available
3. Restore from appropriate checkpoint

### Before Major Changes
1. Create a backup of current state
2. Document the backup name and purpose
3. Test changes incrementally

### For Debugging
1. Use verbose flags on phase commands
2. Check logs in `logs/` directory
3. Run phases individually to isolate issues

## DO NOT Do These Things
- ❌ Try to load transcript files directly without using phases
- ❌ Skip Phase 1 and go directly to Phase 2
- ❌ Attempt to check in backup files or large data files
- ❌ Run `prisma migrate dev` in production mode
- ❌ Delete backups without confirming they're not needed

## Quick Reference Commands

```bash
# Full reset and load
npm run reset:full

# Just reset database (no data load)  
npx prisma migrate reset --force

# Load through Phase 1
npm run phase1

# Load through Phase 2
npm run phase2

# Backup current state
./scripts/backupdb.sh [backup_name]

# Restore from backup
./scripts/restoredb.sh [backup_name]

# Run all tests
npm run test:all

# Run specific query tests
npm run run-all-queries
```

## Configuration File Locations
- `config/transcripts.json` - Transcript file paths
- `config/settings.json` - System settings
- `.env` - Environment variables
- `prisma/schema.prisma` - Database schema
- `prisma/seed.ts` - Seed data loader

This guide should be consulted whenever working with database operations, testing, or data loading procedures.