# Quick Command Reference

## Workflow Management (NEW - Recommended)
Automated workflow management with state tracking and prerequisite handling:
```bash
# Run complete workflow (automatically runs all prerequisites)
npx ts-node src/cli/workflow.ts run --phase phase3 --config config/multi-trial-config-mac.json

# Run workflow for specific trial by case number
npx ts-node src/cli/workflow.ts run --phase phase2 --case-number "2:13-CV-1112-JRG" --config config/example-trial-config-mac.json

# Check workflow status
npx ts-node src/cli/workflow.ts status --all                    # All trials
npx ts-node src/cli/workflow.ts status --case-number "2:13-CV-1112-JRG"  # Specific trial

# Reset workflow state for retry
npx ts-node src/cli/workflow.ts reset --case-number "2:13-CV-1112-JRG"
```

## Most Concise Commands (Manual Execution)
These are the simplest commands using all defaults when running phases manually:
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

## Workflow Management Commands (Feature 03F)

The workflow system automatically manages trial processing state and executes prerequisite steps as needed.

### Basic Workflow Commands
```bash
# Run workflow to specified phase (automatically runs all prerequisites)
npx ts-node src/cli/workflow.ts run --phase phase3 --config config/multi-trial-config-mac.json

# Available phases: convert, phase1, phase2, phase3, complete
npx ts-node src/cli/workflow.ts run --phase complete --config config/multi-trial-config-mac.json

# Run with verbose output to see each step
npx ts-node src/cli/workflow.ts run --phase phase2 --config config/multi-trial-config-mac.json --verbose

# Force re-run of already completed steps
npx ts-node src/cli/workflow.ts run --phase phase3 --config config/multi-trial-config-mac.json --force-rerun

# Skip optional steps (LLM tasks, cleanup)
npx ts-node src/cli/workflow.ts run --phase phase3 --config config/multi-trial-config-mac.json --skip-optional
```

### Trial-Specific Workflow
```bash
# Run workflow for specific trial by case number (more convenient than ID)
npx ts-node src/cli/workflow.ts run --phase phase2 --case-number "2:13-CV-1112-JRG" --config config/example-trial-config-mac.json

# Or by trial ID if known
npx ts-node src/cli/workflow.ts run --phase phase2 --trial-id 1 --config config/example-trial-config-mac.json
```

### Workflow Status Monitoring
```bash
# Check status of all trials
npx ts-node src/cli/workflow.ts status --all

# Check specific trial by case number
npx ts-node src/cli/workflow.ts status --case-number "2:13-CV-1112-JRG"

# Get status in JSON format for scripting
npx ts-node src/cli/workflow.ts status --case-number "2:13-CV-1112-JRG" --format json

# Get summary view
npx ts-node src/cli/workflow.ts status --all --format summary
```

### Workflow State Management
```bash
# Reset workflow state for a trial (useful for retrying after errors)
npx ts-node src/cli/workflow.ts reset --case-number "2:13-CV-1112-JRG"

# Reset all trials
npx ts-node src/cli/workflow.ts reset --all

# Complete system reset and run
npx ts-node src/cli/workflow.ts run --phase phase3 --config config/multi-trial-config-mac.json --reset-system
```

### Workflow Help
```bash
# Get help on workflow commands
npx ts-node src/cli/workflow.ts --help
npx ts-node src/cli/workflow.ts run --help
npx ts-node src/cli/workflow.ts status --help
npx ts-node src/cli/workflow.ts reset --help
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

## Common Workflow Examples

### Example 1: Process a new trial from PDFs
```bash
# Assuming PDFs are in the configured directory
npx ts-node src/cli/workflow.ts run --phase complete --config config/example-trial-config-mac.json --verbose
```

### Example 2: Re-process Phase 2 after code changes
```bash
# Reset just the trial you want to re-process
npx ts-node src/cli/workflow.ts reset --case-number "2:13-CV-1112-JRG"

# Run Phase 2 (Phase 1 will run automatically if needed)
npx ts-node src/cli/workflow.ts run --phase phase2 --case-number "2:13-CV-1112-JRG" --config config/example-trial-config-mac.json
```

### Example 3: Check progress across all trials
```bash
# Quick status table
npx ts-node src/cli/workflow.ts status --all

# Detailed JSON for specific trial
npx ts-node src/cli/workflow.ts status --case-number "2:13-CV-1112-JRG" --format json
```

### Example 4: Complete reset and process multiple trials
```bash
# This will reset database and process all trials in config
npx ts-node src/cli/workflow.ts run --phase phase3 --config config/multi-trial-config-mac.json --reset-system --verbose
```

## Important Notes
- **ALWAYS** use the configuration file - command line arguments alone are insufficient
- Primary config: `config/multi-trial-config-mac.json` (supports multiple trials)
- Trial selection: All phases use config's `includedTrials` array - no --trial-id needed
- Parser default: Multi-pass parser is default (omit --parser-mode unless using legacy)
- **NEW**: Workflow commands automatically handle prerequisites - no need to run phases in order manually
- **NEW**: Use `--case-number` instead of `--trial-id` for easier trial identification
- Most concise commands: Just specify --phase1/--phase2 and --config
- Backups are stored in `backups/` directory (not in source control)
- For detailed database operations, see `docs/database-testing-guide.md`