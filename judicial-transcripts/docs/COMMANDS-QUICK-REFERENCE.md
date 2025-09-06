# Quick Command Reference

## Most Common Commands - Quick Start
```bash
# 1. Process all trials through Phase 3 (automatic prerequisite handling)
npx ts-node src/cli/workflow.ts run --phase phase3 --config config/multi-trial-config-mac.json --verbose

# 2. Generate ALL reports (run after processing)
npm run run-all-queries

# 3. Check workflow status
npx ts-node src/cli/workflow.ts status --all

# 4. Process specific trial by case number
npx ts-node src/cli/workflow.ts run --phase phase3 --case-number "2:13-CV-1112-JRG" --config config/multi-trial-config-mac.json
```

## Workflow Management (NEW - Recommended)
Automated workflow management with state tracking and prerequisite handling:
```bash
# Run complete workflow (automatically runs all prerequisites)
npx ts-node src/cli/workflow.ts run --phase phase3 --config config/multi-trial-config-mac.json

# Run workflow for specific trial by case number
npx ts-node src/cli/workflow.ts run --phase phase2 --case-number "2:13-CV-1112-JRG" --config config/multi-trial-config-mac.json

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
# Generate Phase 1 reports
npm run run-phase1-reports

# Generate Phase 2 reports  
npm run run-phase2-reports

# Run ALL queries and generate comprehensive reports
npm run run-all-queries

# Alternative individual report commands
npx ts-node src/cli/report.ts generate-all        # Phase 1 reports
npx ts-node src/cli/phase2-report.ts generate-all  # Phase 2 reports

# Analyze trial data
npx ts-node src/scripts/analyzeTrialData.ts

# Analyze witness events
npx ts-node src/scripts/analyzeWitnessEvents.ts
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
npx ts-node src/cli/workflow.ts run --phase phase2 --case-number "2:13-CV-1112-JRG" --config config/multi-trial-config-mac.json

# Or by trial ID if known
npx ts-node src/cli/workflow.ts run --phase phase2 --trial-id 1 --config config/multi-trial-config-mac.json
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

## Comprehensive Reporting Commands

### Run All Reports at Once
```bash
# Run ALL reports and queries (fastest way to get all output)
npm run run-all-queries

# Run phase-specific reports
npm run run-phase1-reports     # All Phase 1 reports
npm run run-phase2-reports     # All Phase 2 reports

# Alternative: Run reports directly
npx ts-node src/cli/report.ts generate-all        # Phase 1 reports
npx ts-node src/cli/phase2-report.ts generate-all  # Phase 2 reports
```

### Analysis and Statistics Reports
```bash
# Analyze trial data comprehensively
npx ts-node src/scripts/analyzeTrialData.ts

# Analyze witness events and testimonies
npx ts-node src/scripts/analyzeWitnessEvents.ts

# Find sustained objection contexts
npx ts-node src/scripts/findSustainedContext.ts

# Get database statistics
npx ts-node src/cli/parse.ts stats

# Get Phase 3 marker statistics
npx ts-node src/cli/phase3.ts stats
```

### Export and Output Reports
```bash
# Export marker data from Phase 3
npx ts-node src/cli/phase3.ts export -t 1 -o markers.json

# Import markers (for corrections/updates)
npx ts-node src/cli/phase3.ts import -t 1 -i markers.json

# Generate comparison report between parser modes
npx ts-node scripts/compare-parsers.ts data-export-legacy data-export-multipass

# Export comparison data
npx ts-node scripts/export-comparison-data.ts
```

### Elasticsearch and Search Reports
```bash
# Run enhanced queries
npx ts-node src/scripts/runEnhancedQueries.ts

# Sync data to Elasticsearch
npx ts-node src/scripts/syncElasticsearch.ts

# Reset Elasticsearch (careful!)
npm run es:reset

# Reset and resync Elasticsearch
npm run es:reset:sync
```

## Common Workflow Examples

### Example 1: Complete Processing and Reporting Pipeline
```bash
# Process all trials through Phase 3
npx ts-node src/cli/workflow.ts run --phase phase3 --config config/multi-trial-config-mac.json --verbose

# Generate all reports
npm run run-all-queries
```

### Example 2: Process a New Trial from PDFs
```bash
# Assuming PDFs are in the configured directory
npx ts-node src/cli/workflow.ts run --phase complete --config config/multi-trial-config-mac.json --verbose

# Check status
npx ts-node src/cli/workflow.ts status --all

# Generate reports
npm run run-all-queries
```

### Example 3: Re-process Phase 2 After Code Changes
```bash
# Reset just the trial you want to re-process
npx ts-node src/cli/workflow.ts reset --case-number "2:13-CV-1112-JRG"

# Run Phase 2 (Phase 1 will run automatically if needed)
npx ts-node src/cli/workflow.ts run --phase phase2 --case-number "2:13-CV-1112-JRG" --config config/multi-trial-config-mac.json

# Generate Phase 2 report to verify changes
npx ts-node src/cli/reports.ts phase2
```

### Example 4: Complete System Reset and Multi-Trial Processing
```bash
# This will reset database and process all trials in config
npx ts-node src/cli/workflow.ts run --phase phase3 --config config/multi-trial-config-mac.json --reset-system --verbose

# Generate all reports for all trials
npm run run-all-queries

# Check final status
npx ts-node src/cli/workflow.ts status --all
```

### Example 5: Quick Trial Analysis
```bash
# Check what trials are available
npx ts-node src/cli/parse.ts stats

# Process specific trial
npx ts-node src/cli/workflow.ts run --phase phase3 --case-number "2:13-CV-1112-JRG" --config config/multi-trial-config-mac.json

# Generate comprehensive reports for that trial
npx ts-node src/cli/reports.ts phase1 && \
npx ts-node src/cli/reports.ts phase2 && \
npx ts-node src/cli/reports.ts phase3 && \
npx ts-node src/scripts/generateSpeakerReport.ts --trial-id 1
```

## Workflow States Documentation

### Workflow Status Values
The workflow system tracks the following states for each trial:

| Status | Description | Next Action |
|--------|-------------|-------------|
| `not_started` | Trial workflow has not begun | Run workflow |
| `pdf_converting` | Converting PDFs to text files | Wait for completion |
| `generating_overrides` | LLM generating entity overrides | Wait for completion |
| `awaiting_override_review` | Override files need user review | Review and approve files |
| `importing_overrides` | Importing approved overrides | Wait for completion |
| `phase1_processing` | Running Phase 1 parsing | Wait for completion |
| `phase2_processing` | Running Phase 2 processing | Wait for completion |
| `generating_markers_1` | LLM generating post-Phase2 markers | Wait for completion |
| `awaiting_marker1_review` | Phase2 markers need review | Review and approve files |
| `importing_markers_1` | Importing Phase2 markers | Wait for completion |
| `phase3_processing` | Running Phase 3 processing | Wait for completion |
| `generating_markers_2` | LLM generating post-Phase3 markers | Wait for completion |
| `awaiting_marker2_review` | Phase3 markers need review | Review and approve files |
| `importing_markers_2` | Importing Phase3 markers | Wait for completion |
| `completed` | All processing complete | Generate reports |
| `error` | Processing failed | Check logs and retry |
| `paused` | Workflow paused for review | Review files and resume |

### Workflow Step Completion Flags
Each trial tracks completion of individual steps:

- `pdfConvertCompleted` - PDF to text conversion done
- `llmOverrideCompleted` - LLM override generation done
- `overrideReviewCompleted` - User reviewed overrides
- `overrideImportCompleted` - Overrides imported to database
- `phase1Completed` - Phase 1 parsing complete
- `phase2Completed` - Phase 2 processing complete
- `llmMarker1Completed` - Post-Phase2 markers generated
- `marker1ReviewCompleted` - Phase2 markers reviewed
- `marker1ImportCompleted` - Phase2 markers imported
- `phase3Completed` - Phase 3 processing complete
- `llmMarker2Completed` - Post-Phase3 markers generated
- `marker2ReviewCompleted` - Phase3 markers reviewed
- `marker2ImportCompleted` - Phase3 markers imported

## Sync Commands for Metadata Management

### Sync Override Files
```bash
# Copy override files from output to source (for version control)
npx ts-node src/cli/sync.ts overrides

# Copy and mark as reviewed/approved
npx ts-node src/cli/sync.ts overrides --approve

# Dry run to see what would be copied
npx ts-node src/cli/sync.ts overrides --dry-run
```

### Sync Marker Files
```bash
# Sync post-Phase2 markers
npx ts-node src/cli/sync.ts markers --phase 1

# Sync post-Phase3 markers with approval
npx ts-node src/cli/sync.ts markers --phase 2 --approve
```

### Sync Trial Style Configuration
```bash
# Copy trialstyle.json from source to destination
npx ts-node src/cli/sync.ts trialstyle --direction to-dest

# Copy modified trialstyle.json back to source
npx ts-node src/cli/sync.ts trialstyle --direction to-source

# Sync all trial configurations
npx ts-node src/cli/sync.ts trialstyle --all
```

### Complete Metadata Sync Workflow
```bash
# 1. After LLM generates overrides, review them
cat output/[trial-name]/Attorney.json

# 2. If satisfied, sync back to source with approval
npx ts-node src/cli/sync.ts overrides --approve

# 3. Resume workflow (will skip override generation)
npx ts-node src/cli/workflow.ts resume --trial-id 1

# 4. After markers are generated, review and sync
npx ts-node src/cli/sync.ts markers --phase 1 --approve
npx ts-node src/cli/sync.ts markers --phase 2 --approve
```

## Important Notes
- **ALWAYS** use the configuration file - command line arguments alone are insufficient
- Primary config: `config/multi-trial-config-mac.json` (supports multiple trials)
- Trial selection: All phases use config's `includedTrials` array - no --trial-id needed
- Parser default: Multi-pass parser is default (omit --parser-mode unless using legacy)
- **NEW**: Workflow commands automatically handle prerequisites - no need to run phases in order manually
- **NEW**: Use `--case-number` instead of `--trial-id` for easier trial identification
- **NEW**: LLM overrides run automatically before Phase 1 when enabled
- **NEW**: User review gates pause workflow when `autoReview: false`
- **NEW**: Sync commands manage metadata between source and destination
- Most concise commands: Just specify --phase1/--phase2 and --config
- Backups are stored in `backups/` directory (not in source control)
- For detailed database operations, see `docs/database-testing-guide.md`