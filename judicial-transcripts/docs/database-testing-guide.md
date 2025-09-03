# Database Testing and Management Guide

## Overview
This guide documents the correct procedures for database management, data loading, and testing in the Judicial Transcripts system. The production data files are too large to check into source control, but are referenced via configuration files that ARE in source control.

## Docker Container Setup
The system runs with the following Docker containers:
- **PostgreSQL**: Container name: `judicial-postgres` (postgres:15-alpine)
  - Port: 5432
  - Database: `judicial_transcripts`
  - Schema: `public` (NOT `judicial_transcripts` - this is important!)
  - User: `judicial_user`
  - Password: `judicial_pass`
  - Connection: `postgresql://judicial_user:judicial_pass@localhost:5432/judicial_transcripts?schema=public`
- **Elasticsearch**: Container name: `judicial-elasticsearch`
  - Port: 9200
  - URL: `http://localhost:9200`
- **Kibana**: Container name: `judicial-kibana`
  - Port: 5601

### Accessing PostgreSQL Database
```bash
# Via Docker exec (use judicial_user, NOT postgres)
docker exec -it judicial-postgres psql -U judicial_user -d judicial_transcripts

# Direct connection from host (requires psql client)
psql -h localhost -p 5432 -U judicial_user -d judicial_transcripts

# Getting table record counts (IMPORTANT: use schema 'public' not 'judicial_transcripts')
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts -c "SELECT table_name, (xpath('/row/cnt/text()', xml_count))[1]::text::int as row_count FROM (SELECT table_name, table_schema, query_to_xml(format('SELECT count(*) as cnt FROM %I.%I', table_schema, table_name), false, true, '') as xml_count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') t ORDER BY table_name;"
```

## Important Notes
- **NEVER** attempt to check in large transcript data files or backup files
- **ALWAYS** use the documented procedures below for database operations
- Database backups (.sql files) are stored in `backups/` directory (NOT in source control)
- Configuration files pointing to data locations ARE in source control
- All scripts run within Docker containers (including psql)
- We DO NOT use Prisma migrations for development - we rebuild from scratch

## Database Reset and Initialization

### Complete Database Reset Sequence

#### Option 1: Multi-Pass Parser (Recommended - New)
The correct order for a full database reset and data load with the multi-pass parser:

```bash
# 1. Clear the existing database and rebuild schema
npx prisma db push --force-reset

# 2. Regenerate Prisma client code stubs
npx prisma generate

# 3. Load basic seed data from JSON files
npm run seed

# 4. Create backup after seeding
../scripts/db/backupdb.sh seed

# 5. Run Phase 1 with multi-pass parser
npx ts-node src/cli/parse.ts parse --phase1 --config config/example-trial-config-mac.json --parser-mode multi-pass

# 6. Create backup after Phase 1 (multi-pass specific)
../scripts/db/backupdb.sh phase1_mp

# 7. Run Phase 2 to process and enhance the data
npx ts-node src/cli/parse.ts parse --phase2 --config config/example-trial-config-mac.json --trial-id 1

# 8. Create backup after Phase 2 (multi-pass specific)
../scripts/db/backupdb.sh phase2_mp

# 9. Run Phase 3 for marker discovery and accumulator processing
npx ts-node src/cli/phase3.ts process

# 10. Create backup after Phase 3 (multi-pass specific)
../scripts/db/backupdb.sh phase3_mp

# 11. Test queries and output
npm run run-all-queries
```

#### Option 2: Legacy Parser (For Comparison)
The sequence using the legacy parser:

```bash
# 1. Clear the existing database and rebuild schema
npx prisma db push --force-reset

# 2. Regenerate Prisma client code stubs
npx prisma generate

# 3. Load basic seed data from JSON files
npm run seed

# 4. Create backup after seeding
../scripts/db/backupdb.sh seed

# 5. Run Phase 1 with legacy parser
npx ts-node src/cli/parse.ts parse --phase1 --config config/example-trial-config-mac.json --parser-mode legacy

# 6. Create backup after Phase 1 (legacy specific)
../scripts/db/backupdb.sh phase1_legacy

# 7. Run Phase 2 to process and enhance the data
npx ts-node src/cli/parse.ts parse --phase2 --config config/example-trial-config-mac.json --trial-id 1

# 8. Create backup after Phase 2 (legacy specific)
../scripts/db/backupdb.sh phase2_legacy

# 9. Run Phase 3 for marker discovery and accumulator processing
npx ts-node src/cli/phase3.ts process

# 10. Create backup after Phase 3 (legacy specific)
../scripts/db/backupdb.sh phase3_legacy

# 11. Test queries and output
npm run run-all-queries
```

### Using Existing Backups
Before running phases, check if backups already exist:

```bash
# Check for existing backups
ls backups/judicial_transcripts_*.sql

# Multi-pass parser backups:
# - judicial_transcripts_seed.sql
# - judicial_transcripts_phase1_mp.sql  
# - judicial_transcripts_phase2_mp.sql
# - judicial_transcripts_phase3_mp.sql

# Legacy parser backups:
# - judicial_transcripts_phase1_legacy.sql  
# - judicial_transcripts_phase2_legacy.sql
# - judicial_transcripts_phase3_legacy.sql

# Restore directly to desired state (multi-pass)
../scripts/db/restoredb.sh phase1_mp  # Restores judicial_transcripts_phase1_mp.sql
../scripts/db/restoredb.sh phase2_mp  # Restores judicial_transcripts_phase2_mp.sql
../scripts/db/restoredb.sh phase3_mp  # Restores judicial_transcripts_phase3_mp.sql

# Restore directly to desired state (legacy)
../scripts/db/restoredb.sh phase1_legacy  # Restores judicial_transcripts_phase1_legacy.sql
../scripts/db/restoredb.sh phase2_legacy  # Restores judicial_transcripts_phase2_legacy.sql
../scripts/db/restoredb.sh phase3_legacy  # Restores judicial_transcripts_phase3_legacy.sql
```

### Quick Reset Using Scripts
```bash
# For complete reset including Elasticsearch
../scripts/db/reset-all.sh

# For Elasticsearch reset only
../scripts/db/reset-elasticsearch.sh
```

## Data Loading Process

### Configuration Files
**IMPORTANT**: The system REQUIRES configuration JSON files for all operations. Command-line arguments alone are insufficient.

For testing with Claude Code on Mac:
- **Always use**: `config/example-trial-config-mac.json`
- **Required for all phases**: convert, phase1, phase2, phase3

Other configuration files in source control:
- `config/transcripts.json` - Defines transcript file locations
- `config/settings.json` - System-wide settings
- `.env` - Environment variables including data paths

### Phase 1: Initial Data Load
Phase 1 reads raw transcript files and parses them into the database:
```bash
npm run cli parse:phase1 config/example-trial-config-mac.json
```
- Reads transcript files from configured locations
- Parses transcript structure (sessions, pages, lines)
- Identifies speakers, attorneys, witnesses
- Creates initial database records

### Phase 2: Data Enhancement
Phase 2 processes the parsed data to add relationships and metadata:
```bash
npm run cli parse:phase2 config/example-trial-config-mac.json
```
- Links testimonies to witnesses
- Processes examination types
- Builds search indices
- Creates relationship mappings

### Phase 3: Marker Discovery
Phase 3 discovers markers and evaluates accumulators:
```bash
npm run cli parse:phase3 config/example-trial-config-mac.json
```
- Evaluates ElasticSearch expressions against statements
- Processes accumulator expressions (sliding window analysis)
- Discovers witness testimony markers and boundaries
- Creates activity markers for significant trial events
- Handles special cases like video depositions

**Phase 3 Command Options:**
```bash
# Process all trials
npm run phase3 process

# Process specific trial by ID
npm run phase3 process -t 1

# Process specific trial by case number
npm run phase3 process -c "2:19-CV-00123-JRG"

# Clean existing markers before processing
npm run phase3 process --clean

# Export markers to JSON
npm run phase3 export -t 1 -o markers.json

# Import/upsert markers from JSON
npm run phase3 import -t 1 -i markers.json

# View Phase 3 statistics
npm run phase3 stats
```

## Database Backup and Restore

### Backup Naming Convention
The backup scripts use a standard naming convention:
- **Pattern**: `judicial_transcripts_[stage].sql`
- **Stages for Multi-Pass Parser**: 
  - `seed` - After initial seed data load
  - `phase1_mp` - After Phase 1 completion (multi-pass)
  - `phase2_mp` - After Phase 2 completion (multi-pass)
  - `phase3_mp` - After Phase 3 completion (multi-pass)
- **Stages for Legacy Parser**:
  - `phase1_legacy` - After Phase 1 completion (legacy)
  - `phase2_legacy` - After Phase 2 completion (legacy)
  - `phase3_legacy` - After Phase 3 completion (legacy)
- **Custom names** for specific test states

### Creating Backups
```bash
# Multi-pass parser backups
../scripts/db/backupdb.sh seed       # Creates: backups/judicial_transcripts_seed.sql
../scripts/db/backupdb.sh phase1_mp  # Creates: backups/judicial_transcripts_phase1_mp.sql
../scripts/db/backupdb.sh phase2_mp  # Creates: backups/judicial_transcripts_phase2_mp.sql
../scripts/db/backupdb.sh phase3_mp  # Creates: backups/judicial_transcripts_phase3_mp.sql

# Legacy parser backups
../scripts/db/backupdb.sh phase1_legacy  # Creates: backups/judicial_transcripts_phase1_legacy.sql
../scripts/db/backupdb.sh phase2_legacy  # Creates: backups/judicial_transcripts_phase2_legacy.sql
../scripts/db/backupdb.sh phase3_legacy  # Creates: backups/judicial_transcripts_phase3_legacy.sql

# Custom backup for testing
../scripts/db/backupdb.sh my_test_state  # Creates: backups/judicial_transcripts_my_test_state.sql
```

### Restoring from Backups
```bash
# Restore standard backups
../scripts/db/restoredb.sh seed    # Restores from judicial_transcripts_seed.sql
../scripts/db/restoredb.sh phase1  # Restores from judicial_transcripts_phase1.sql
../scripts/db/restoredb.sh phase2  # Restores from judicial_transcripts_phase2.sql
../scripts/db/restoredb.sh phase3  # Restores from judicial_transcripts_phase3.sql

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
    ../scripts/db/restoredb.sh phase2
else
    # Need to build from scratch
    npx prisma db push --force-reset
    npx prisma generate
    npm run seed
    ../scripts/db/backupdb.sh seed
    npm run phase1
    ../scripts/db/backupdb.sh phase1
    npm run phase2
    ../scripts/db/backupdb.sh phase2
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
../scripts/db/restoredb.sh phase2

# Reset Elasticsearch
../scripts/db/reset-elasticsearch.sh

# Sync data to Elasticsearch
npm run sync:elasticsearch

# Run search tests
npm run test:search
```

### Testing Report Generation
```bash
# Restore to known state with full data
../scripts/db/restoredb.sh phase2

# Run report generation
npm run reports:generate
```

### Testing Specific Queries
```bash
# Restore database
../scripts/db/restoredb.sh phase2

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
../scripts/db/restoredb.sh phase2

# If not, check for phase1 and build from there
../scripts/db/restoredb.sh phase1
npm run phase2
../scripts/db/backupdb.sh phase2

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

# Most Concise Commands (Multi-Pass Parser by default)
npm run seed                      # Load seed data
npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json
npx ts-node src/cli/parse.ts parse --phase2 --config config/multi-trial-config-mac.json
npx ts-node src/cli/phase3.ts process

# Data Loading - Legacy Parser (Must Specify Explicitly)
npm run seed                      # Load seed data
npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json --parser-mode legacy
npx ts-node src/cli/parse.ts parse --phase2 --config config/multi-trial-config-mac.json
npx ts-node src/cli/phase3.ts process

# Reporting Commands
npx ts-node src/cli/reports.ts phase1        # Phase 1 parsing report
npx ts-node src/cli/reports.ts phase2        # Phase 2 processing report

# Backup Management - Multi-Pass
../scripts/db/backupdb.sh seed       # Backup after seeding
../scripts/db/backupdb.sh phase1_mp  # Backup after Phase 1 (multi-pass)
../scripts/db/backupdb.sh phase2_mp  # Backup after Phase 2 (multi-pass)
../scripts/db/backupdb.sh phase3_mp  # Backup after Phase 3 (multi-pass)

# Backup Management - Legacy
../scripts/db/backupdb.sh phase1_legacy  # Backup after Phase 1 (legacy)
../scripts/db/backupdb.sh phase2_legacy  # Backup after Phase 2 (legacy)
../scripts/db/backupdb.sh phase3_legacy  # Backup after Phase 3 (legacy)

# Restore from Backups - Multi-Pass
../scripts/db/restoredb.sh seed       # Restore to seed state
../scripts/db/restoredb.sh phase1_mp  # Restore to Phase 1 complete (multi-pass)
../scripts/db/restoredb.sh phase2_mp  # Restore to Phase 2 complete (multi-pass)
../scripts/db/restoredb.sh phase3_mp  # Restore to Phase 3 complete (multi-pass)

# Restore from Backups - Legacy
../scripts/db/restoredb.sh phase1_legacy  # Restore to Phase 1 complete (legacy)
../scripts/db/restoredb.sh phase2_legacy  # Restore to Phase 2 complete (legacy)
../scripts/db/restoredb.sh phase3_legacy  # Restore to Phase 3 complete (legacy)

# Testing & Verification
npm run run-all-queries          # Run all query tests
npx ts-node scripts/compare-parsers.ts data-export-legacy data-export-multipass  # Compare parser outputs

# Elasticsearch
../scripts/db/reset-elasticsearch.sh # Reset Elasticsearch
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