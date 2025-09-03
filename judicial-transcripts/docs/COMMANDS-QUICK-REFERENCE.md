# Quick Command Reference

## Most Concise Commands (Recommended)
These are the simplest commands using all defaults:
```bash
# Complete reset and run (uses multi-pass parser by default)
npx prisma db push --force-reset
npx prisma generate
npm run seed
npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json
npx ts-node src/cli/parse.ts parse --phase2 --config config/multi-trial-config-mac.json
npx ts-node src/cli/phase3.ts process
```

All phases use the configuration file's `includedTrials` array to determine which trials to process. No --trial-id parameter is needed anywhere.

## Minimal Setup and Run Sequence

### From Scratch (No Existing Backups)
```bash
# 1. Reset database and apply schema
npx prisma db push --force-reset

# 2. Generate Prisma client
npx prisma generate

# 3. Load seed data
npm run seed

# 4. Run Phase 1 parsing (defaults to multi-pass)
npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json
# OR for legacy parser (must specify explicitly):
# npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json --parser-mode legacy

# 5. Run Phase 2 processing (uses config's includedTrials)
npx ts-node src/cli/parse.ts parse --phase2 --config config/multi-trial-config-mac.json

# 6. Run Phase 3 marker processing
npx ts-node src/cli/phase3.ts process
```

### Quick Start (With Existing Backups)
```bash
# Check available backups
ls backups/judicial_transcripts_*.sql

# Restore to desired state (example: phase2 complete)
../scripts/db/restoredb.sh phase2_mp

# Continue from there (e.g., run phase3)
npx ts-node src/cli/phase3.ts process
```

## Database Operations
```bash
# Reset database and schema
npx prisma db push --force-reset

# Generate Prisma client
npx prisma generate

# Load seed data
npm run seed

# Open database GUI
npx prisma studio
```

## Parsing Commands

### Phase 1: Initial Parsing
```bash
# Standard command (defaults to multi-pass parser)
npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json

# Legacy Parser (must specify explicitly)
npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json --parser-mode legacy

# With debug output
npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json --debug-output
```

### Phase 2: Enhanced Processing
```bash
# Phase 2 now uses config's includedTrials array - no --trial-id needed
npx ts-node src/cli/parse.ts parse --phase2 --config config/multi-trial-config-mac.json
```

### Reporting Commands
```bash
# View Phase 1 parsing report
npx ts-node src/cli/reports.ts phase1

# View Phase 2 processing report
npx ts-node src/cli/reports.ts phase2
```

### Phase 3: Marker Processing
```bash
npx ts-node src/cli/phase3.ts process

# With specific trial
npx ts-node src/cli/phase3.ts process -t 1

# Clean existing markers first
npx ts-node src/cli/phase3.ts process --clean
```

## Optional: Backup and Restore

### Create Backups at Key Points
```bash
# After seed data
../scripts/db/backupdb.sh seed

# After each phase (multi-pass parser)
../scripts/db/backupdb.sh phase1_mp
../scripts/db/backupdb.sh phase2_mp
../scripts/db/backupdb.sh phase3_mp

# After each phase (legacy parser)
../scripts/db/backupdb.sh phase1_legacy
../scripts/db/backupdb.sh phase2_legacy
../scripts/db/backupdb.sh phase3_legacy
```

### Restore from Backup
```bash
# List available backups
ls backups/judicial_transcripts_*.sql

# Restore to specific state
../scripts/db/restoredb.sh phase2_mp  # Multi-pass phase 2 complete
../scripts/db/restoredb.sh phase2_legacy  # Legacy phase 2 complete
```

## Optional: Additional Commands

### Docker Operations
```bash
# Check running containers
docker ps

# Access PostgreSQL
docker exec -it judicial-postgres psql -U judicial_user -d judicial_transcripts

# Check record counts
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts -c "SELECT 'Sessions' as entity, COUNT(*) FROM \"Session\" UNION ALL SELECT 'Pages', COUNT(*) FROM \"Page\" UNION ALL SELECT 'Lines', COUNT(*) FROM \"Line\";"
```

### Testing and Verification
```bash
# Run all query tests
npm run run-all-queries

# Compare parser outputs
npx ts-node scripts/compare-parsers.ts data-export-legacy data-export-multipass

# Run regression tests
npx ts-node src/scripts/testRegression.ts --trial-id 1 --regression-type phase2
```

### Reports and Export
```bash
# Generate speaker report
npx ts-node src/scripts/generateSpeakerReport.ts --trial-id 1

# Export comparison data
npx ts-node scripts/export-comparison-data.ts
```

## Important Notes
- **ALWAYS** use the configuration file - command line arguments alone are insufficient
- Primary config: `config/multi-trial-config-mac.json` (supports multiple trials)
- Trial selection: All phases use config's `includedTrials` array - no --trial-id needed
- Parser default: Multi-pass parser is default (omit --parser-mode unless using legacy)
- Most concise commands: Just specify --phase1/--phase2 and --config
- Backups are stored in `backups/` directory (not in source control)
- For detailed database operations, see `docs/database-testing-guide.md`