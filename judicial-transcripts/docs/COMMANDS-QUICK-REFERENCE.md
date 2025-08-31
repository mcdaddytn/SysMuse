# Quick Command Reference

## Minimal Setup and Run Sequence

### From Scratch (No Existing Backups)
```bash
# 1. Reset database and apply schema
npx prisma db push --force-reset

# 2. Generate Prisma client
npx prisma generate

# 3. Load seed data
npm run seed

# 4. Run Phase 1 parsing (choose one parser mode)
npx ts-node src/cli/parse.ts parse --phase1 --config config/example-trial-config-mac.json --parser-mode multi-pass
# OR for legacy parser:
# npx ts-node src/cli/parse.ts parse --phase1 --config config/example-trial-config-mac.json --parser-mode legacy

# 5. Run Phase 2 processing
npx ts-node src/cli/parse.ts parse --phase2 --config config/example-trial-config-mac.json --trial-id 1

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
# Multi-Pass Parser (recommended, new modular architecture)
npx ts-node src/cli/parse.ts parse --phase1 --config config/example-trial-config-mac.json --parser-mode multi-pass

# Legacy Parser (well-tested, for comparison)
npx ts-node src/cli/parse.ts parse --phase1 --config config/example-trial-config-mac.json --parser-mode legacy

# With debug output (multi-pass only)
npx ts-node src/cli/parse.ts parse --phase1 --config config/example-trial-config-mac.json --parser-mode multi-pass --debug-output
```

### Phase 2: Enhanced Processing
```bash
npx ts-node src/cli/parse.ts parse --phase2 --config config/example-trial-config-mac.json --trial-id 1
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
- Default config for Mac testing: `config/example-trial-config-mac.json`
- Parser modes: `multi-pass` (recommended) or `legacy` (for comparison)
- Trial ID is usually 1 for phase 2 and phase 3
- Backups are stored in `backups/` directory (not in source control)
- For detailed database operations, see `docs/database-testing-guide.md`