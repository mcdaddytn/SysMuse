# Commands Quick Reference

## PRIMARY WORKFLOW COMMANDS (Recommended)

### Complete Workflow - All Phases
```bash
# Run complete workflow (convert + phase1 + phase2 + phase3)
npx ts-node src/cli/workflow.ts run --phase complete --config config/multi-trial-config-mac.json

# Or using npm script
npm run workflow run --phase complete --config config/multi-trial-config-mac.json
```

### Individual Phase Workflow Commands
```bash
# Convert PDFs to text
npx ts-node src/cli/workflow.ts run --phase convert --config config/multi-trial-config-mac.json

# Phase 1: Initial parsing (creates trials, speakers, lines)
npx ts-node src/cli/workflow.ts run --phase phase1 --config config/multi-trial-config-mac.json

# Phase 2: Event processing (witness events, examinations)
npx ts-node src/cli/workflow.ts run --phase phase2 --config config/multi-trial-config-mac.json

# Phase 3: Marker discovery and analysis
npx ts-node src/cli/workflow.ts run --phase phase3 --config config/multi-trial-config-mac.json
```

### Common Workflow Variations
```bash
# RESET DATABASE before running (clears all data, reloads seed)
npx ts-node src/cli/workflow.ts run --phase complete --config config/multi-trial-config-mac.json --reset-system

# Run Phase 1 with database reset
npx ts-node src/cli/workflow.ts run --phase phase1 --config config/multi-trial-config-mac.json --reset-system

# Run Phase 2 adding option for continue
npx ts-node src/cli/workflow.ts run --phase phase2 --config config/multi-trial-config-mac.json --continue-on-error

# Run WITHOUT config file (processes all trials in database), adding option for continue
npx ts-node src/cli/workflow.ts run --phase phase2 --continue-on-error

# Run for SPECIFIC TRIAL by ID (no config needed)
npx ts-node src/cli/workflow.ts run --phase phase2 --trial-id 1

# Run for SPECIFIC TRIAL by case number (no config needed)
npx ts-node src/cli/workflow.ts run --phase phase2 --case-number "2:13-CV-1112-JRG"

# Note: To run specific trials by shortName, use the config file with includedTrials:
# Edit config to have: "includedTrials": ["01 Genband", "02 Contentguard"]
```

### Workflow Options
```bash
# Verbose output for debugging
npx ts-node src/cli/workflow.ts run --phase phase2 --config config/multi-trial-config-mac.json --verbose

# Force rerun even if already completed
npx ts-node src/cli/workflow.ts run --phase phase1 --config config/multi-trial-config-mac.json --force-rerun

# Continue on error (don't stop if one trial fails)
npx ts-node src/cli/workflow.ts run --phase phase2 --config config/multi-trial-config-mac.json --continue-on-error

# Skip optional steps (LLM processing, cleanup)
npx ts-node src/cli/workflow.ts run --phase phase3 --config config/multi-trial-config-mac.json --skip-optional

# Combine multiple options
npx ts-node src/cli/workflow.ts run --phase complete --config config/multi-trial-config-mac.json --reset-system --verbose --continue-on-error
```

### Workflow Status and Management
```bash
# Check status of all trials
npx ts-node src/cli/workflow.ts status --all

# Check status of specific trial
npx ts-node src/cli/workflow.ts status --case-number "2:13-CV-1112-JRG"

# Reset workflow state for a trial
npx ts-node src/cli/workflow.ts reset --case-number "2:13-CV-1112-JRG"

# Kill stuck workflow processes
npm run workflow:kill
```

## Alternative Direct Commands (Legacy)

### Manual Pipeline Execution
```bash
# 1. Convert PDFs to text
npm run convert-pdf config/multi-trial-config-mac.json

# 2. Run Phase 1 parsing (uses multi-pass parser by default)
npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json

# 3. Run Phase 2 processing
npx ts-node src/cli/parse.ts parse --phase2 --config config/multi-trial-config-mac.json

# 4. Run Phase 3 processing
npx ts-node src/cli/phase3.ts process

# 5. Generate all reports
npm run run-all-reports -- --config config/multi-trial-config-mac.json
```

## Database Management

### Initialize and Seed Database
```bash
# Reset database (recreate from scratch)
npx prisma db push --force-reset

# Generate Prisma client
npx prisma generate

# Seed with sample data
npm run seed

# Backup database
./scripts/db/backupdb.sh

# Restore database
./scripts/db/restoredb.sh <backup-file>
```

## LLM Entity Generation

### Generate Attorney Overrides
```bash
# Generate for trials in config (uses includedTrials)
npx ts-node src/cli/generate.ts attorney --config config/multi-trial-config-mac.json --provider openai --model gpt-4

# Alternative entity name formats (all work the same)
npx ts-node src/cli/generate.ts Attorney --config config/multi-trial-config-mac.json --provider openai --model gpt-4

# Dry run (preview without saving)
npx ts-node src/cli/generate.ts attorney --config config/multi-trial-config-mac.json --provider openai --model gpt-4 --dry-run

# Without backup of existing files
npx ts-node src/cli/generate.ts attorney --config config/multi-trial-config-mac.json --provider openai --model gpt-4 --no-backup

# Different LLM providers
# OpenAI (requires OPENAI_API_KEY in .env)
npx ts-node src/cli/generate.ts attorney --config config/multi-trial-config-mac.json --provider openai --model gpt-4

# Anthropic (requires ANTHROPIC_API_KEY in .env)
npx ts-node src/cli/generate.ts attorney --config config/multi-trial-config-mac.json --provider anthropic --model claude-3-opus

# Google Gemini (requires GOOGLE_API_KEY in .env)
npx ts-node src/cli/generate.ts attorney --config config/multi-trial-config-mac.json --provider google --model gemini-pro
```

### Generate Other Entity Types (placeholders for future implementation)
```bash
# Judge extraction (not yet implemented)
npx ts-node src/cli/generate.ts judge --config config/multi-trial-config-mac.json

# Court Reporter extraction (not yet implemented)
npx ts-node src/cli/generate.ts courtreporter --config config/multi-trial-config-mac.json

# Generate all entity types
npx ts-node src/cli/generate.ts all --config config/multi-trial-config-mac.json --provider openai --model gpt-4
```

## Attorney Metadata Management

### Import Attorney Metadata (NOT to Database)
```bash
# Import attorney metadata from generated files
# This creates attorney-metadata.json WITHOUT creating database records
npx ts-node scripts/import-attorney-metadata.ts

# The metadata will be used during Phase 1 parsing to enhance attorney records
```

### Legacy Override Import (DEPRECATED - Do Not Use)
```bash
# ⚠️ DEPRECATED - Creates database records incorrectly
# npx ts-node scripts/import-attorney-overrides.ts  # DO NOT USE

# For single override files (future implementation)
npx ts-node src/cli/override.ts import <file.json> --verbose

# Validate without importing
npx ts-node src/cli/override.ts import <file.json> --validate-only

# Export existing data to override format
npx ts-node src/cli/override.ts export --trial-id 1 --output export.json
```

### Sync Configurations and Overrides
```bash
# Sync configs and overrides from output to input directories
npx ts-node src/cli/sync.ts configs --input-dir ./output/multi-trial --output-dir ./trial-configs/custom

# Sync with backup
npx ts-node src/cli/sync.ts configs --input-dir ./output/multi-trial --output-dir ./trial-configs/custom --backup

# Dry run (preview changes)
npx ts-node src/cli/sync.ts configs --input-dir ./output/multi-trial --output-dir ./trial-configs/custom --dry-run
```

### Restore Overrides
```bash
# Restore overrides from input to output for processing
npx ts-node src/cli/restore.ts overrides --input-dir ./trial-configs/custom --output-dir ./output/multi-trial

# Restore with backup of existing files
npx ts-node src/cli/restore.ts overrides --input-dir ./trial-configs/custom --output-dir ./output/multi-trial --backup

# Dry run (preview what would be restored)
npx ts-node src/cli/restore.ts overrides --input-dir ./trial-configs/custom --output-dir ./output/multi-trial --dry-run
```

## Transcript Processing

### Phase 1: Initial Parse
```bash
# Multi-trial processing (uses multi-pass parser by default)
npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json

# Single trial with configuration file
npx ts-node src/cli/parse.ts parse --phase1 --config config/example-trial-config-mac.json

# With debug output
npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json --debug-output

# Force legacy parser mode (DEPRECATED - not recommended)
npx ts-node src/cli/parse.ts parse --phase1 --config config/example-trial-config-mac.json --parser-mode legacy
```

### Phase 2: Enhanced Processing
```bash
# Process all trials in config
npx ts-node src/cli/parse.ts parse --phase2 --config config/multi-trial-config-mac.json

# Process specific trial by ID
npx ts-node src/cli/parse.ts parse --phase2 --config config/example-trial-config-mac.json --trial-id 1
```

### Phase 3: Marker Discovery and Processing
```bash
# Process Phase 3 for all trials
npx ts-node src/cli/phase3.ts process

# Process specific trial by ID
npx ts-node src/cli/phase3.ts process --trial 1

# Process specific trial by case number
npx ts-node src/cli/phase3.ts process --case "2_14-CV-00033-JRG"

# Clean existing markers before processing
npx ts-node src/cli/phase3.ts process --trial 1 --clean

# View Phase 3 statistics
npx ts-node src/cli/phase3.ts stats --trial 1

# Export markers to JSON
npx ts-node src/cli/phase3.ts export --trial 1 --output ./markers.json

# Monitor Phase 3 progress
npx ts-node src/cli/phase3-monitor.ts --trial 1
```

### Hierarchy View Reports
```bash
# Standard trial structure view
npx ts-node src/cli/hierarchy-view.ts --trial 1 --view standard --format json --output ./output/hierview/genband_std.json

# Session breakdown view
npx ts-node src/cli/hierarchy-view.ts --trial 1 --view session --format json --output ./output/hierview/genband_sess.json

# Objections sequences view
npx ts-node src/cli/hierarchy-view.ts --trial 1 --view objections --format json --output ./output/hierview/genband_obj.json

# Judge-attorney interactions view
npx ts-node src/cli/hierarchy-view.ts --trial 1 --view interactions --format json --output ./output/hierview/genband_int.json

# All views combined
npx ts-node src/cli/hierarchy-view.ts --trial 1 --all --format json --output ./output/hierview/genband_all.json

# Text format output (for console viewing)
npx ts-node src/cli/hierarchy-view.ts --trial 1 --view standard --format text
```

### Phase 1 Reports
```bash
# Generate all Phase 1 reports
npx ts-node src/cli/report.ts generate-all --trial-id 1 --output ./output/phase1

# Session sections report
npx ts-node src/cli/report.ts session-sections --trial-id 1

# Summary lines report
npx ts-node src/cli/report.ts summary-lines --trial-id 1

# Full lines report
npx ts-node src/cli/report.ts full-lines --trial-id 1

# Statistics report
npx ts-node src/cli/report.ts statistics --trial-id 1

# List all trials
npx ts-node src/cli/report.ts list-trials
```

### Phase 2 Diagnostic Reports

#### Available Report Types
```bash
# 1. SPEAKER DISTRIBUTION REPORTS (Individual speakers like Q., A., MR. SMITH)
#    Generates BOTH CSV and TXT formats automatically
npx ts-node src/cli/phase2-report.ts speaker-distribution --trial-id 1

# 2. SPEAKER TYPE DISTRIBUTION REPORTS (Aggregated by type: ATTORNEY, WITNESS, JUDGE, JUROR)
#    Generates THREE types of files:
#    - Session-level reports: [trial]_[date]_[session]_speaker_type_distribution.csv/.txt
#    - Trial-level summary: [trial]_speaker_type_summary.csv/.txt (all types rolled up)
npx ts-node src/cli/phase2-report.ts speaker-type-distribution --trial-id 1

# 3. EVENT TIMELINE REPORTS (Chronological event sequence)
npx ts-node src/cli/phase2-report.ts event-timeline --trial-id 1

# 4. EXAMINATION REPORTS (Witness examination summary)
npx ts-node src/cli/phase2-report.ts examinations --trial-id 1

# 5. GENERATE ALL REPORTS AT ONCE
npx ts-node src/cli/phase2-report.ts generate-all --trial-id 1
```

#### Report Output Details
- **Speaker Distribution** (`_speaker_distribution.csv/.txt`):
  - Shows each individual speaker (Q., A., MR. DACUS, MS. TRUELOVE, etc.)
  - Includes statement counts, line statistics, word statistics
  - Sorted by total statements descending

- **Speaker Type Summary** (`_speaker_type_summary.csv/.txt`):
  - Aggregates all speakers by type (ATTORNEY includes Q. and all attorneys)
  - Shows total statements, lines, words per type
  - Perfect for high-level analysis

- **Both CSV and TXT formats** are generated automatically:
  - CSV: For data analysis and Excel import
  - TXT: Nicely formatted tables for console viewing

#### List Available Trials
```bash
# See all trials in the database with their IDs
npx ts-node src/cli/phase2-report.ts list-trials
```

#### Legacy Commands (Deprecated)
```bash
# Old speaker report script (NO LONGER EXISTS)
# npx ts-node src/scripts/generateSpeakerReport.ts --trial-id 1  # DEPRECATED
```

## Report Generation

### Consolidated Report Commands (RECOMMENDED)
```bash
# Run Phase 1 reports for all trials in config
npm run run-phase1-reports -- --config config/multi-trial-config-mac.json

# Run Phase 2 reports for all trials in config
npm run run-phase2-reports -- --config config/multi-trial-config-mac.json

# Run Phase 3 reports for all trials in config (includes hierarchy views)
npm run run-phase3-reports -- --config config/multi-trial-config-mac.json

# Run ALL reports (Phase 1, 2, and 3) for all trials in config
npm run run-all-reports -- --config config/multi-trial-config-mac.json

# Custom output directory
npm run run-phase3-reports -- --config config/multi-trial-config-mac.json --output ./custom-reports

# If config file exists at default location (config/multi-trial-config-mac.json), can omit --config
npm run run-phase3-reports

# Select specific views for Phase 3
npx ts-node src/cli/run-reports.ts phase3 --config config/multi-trial-config-mac.json --views standard,objections
```

### PDF to Text Conversion
```bash
# Convert PDFs to text for processing
npm run convert-pdf config/multi-trial-config-mac.json
```

## Configuration Files

### Main Configuration Files
- `config/multi-trial-config-mac.json` - Main multi-trial configuration for Mac
- `config/multi-trial-config-win.json` - Main multi-trial configuration for Windows
- `config/example-trial-config-mac.json` - Single trial example
- `config/pdftotext.json` - PDF conversion settings
- `config/trialstyle.json` - Default parsing style settings

### Configuration Structure
```json
{
  "inputDir": "/path/to/transcripts/pdf",
  "outputDir": "./output/multi-trial",
  "includedTrials": [
    "01 Genband",
    "02 Contentguard"
  ],
  "trialSelectionMode": "INCLUDE",
  "parserMode": "multi-pass",
  "logging": {
    "profile": "AppendDatetime",
    "profiles": {
      "Default": {
        "appendTimestamp": false,
        "logLevel": "info",
        "enableWarningLog": true
      },
      "AppendDatetime": {
        "appendTimestamp": true,
        "timestampFormat": "YYYY-MM-DD-HHmmss",
        "logLevel": "info",
        "enableWarningLog": true
      }
    }
  }
}

**Note:** The `includedTrials` list uses folder names (Trial.shortName) like "01 Genband".
```

### Trial Selection in Configuration

The system uses a standard `TrialResolver` utility to match trials from configuration:

- **includedTrials**: List of trials to process (uses Trial.shortName)
- **excludedTrials**: List of trials to skip
- **activeTrials**: Alternative list of active trials
- **trialSelectionMode**: 
  - `"INCLUDE"` - Process only trials in includedTrials
  - `"EXCLUDE"` - Process all trials except those in excludedTrials  
  - `"ACTIVE"` - Process trials in activeTrials list

### Logging Configuration

- **Default Profile**: Creates static log files (combined.log, error.log, warning.log)
- **AppendDatetime Profile**: Creates timestamped log files (combined-2025-01-09-143022.log)
- To switch profiles, change `"profile": "AppendDatetime"` to `"profile": "Default"`

## Workflow Examples

### Complete Attorney Metadata Workflow
```bash
# 1. Generate attorney data using LLM
npx ts-node src/cli/generate.ts attorney --config config/multi-trial-config-mac.json --provider openai --model gpt-4

# 2. Import attorney metadata (NOT to database, only to JSON file)
npx ts-node scripts/import-attorney-metadata.ts

# 3. Run Phase 1 parsing (attorneys enhanced with metadata during creation)
npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json
```

### Configuration Management Workflow
```bash
# 1. Process trials and generate custom configs
npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json

# 2. Sync custom configs to version control
npx ts-node src/cli/sync.ts configs --input-dir ./output/multi-trial --output-dir ./trial-configs/custom

# 3. Later, restore configs for processing
npx ts-node src/cli/restore.ts overrides --input-dir ./trial-configs/custom --output-dir ./output/multi-trial
```

### Database Reset and Re-import
```bash
# 1. Backup current database
./scripts/db/backupdb.sh

# 2. Reset database
npx prisma db push --force-reset

# 3. Seed with base data
npm run seed

# 4. Import attorney metadata (if using LLM-generated data)
npx ts-node scripts/import-attorney-metadata.ts

# 5. Fix speaker prefixes (if needed)
npx ts-node scripts/fix-speaker-prefixes.ts

# 6. Fix null speaker prefixes (generate from name)
npx ts-node scripts/fix-null-speaker-prefixes.ts

# 7. Process transcripts
npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json
```

## Environment Variables

Required in `.env` file:
```bash
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/judicial_transcripts"

# LLM Providers (at least one required for entity generation)
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="sk-ant-..."
GOOGLE_API_KEY="..."

# Elasticsearch (optional)
ELASTICSEARCH_HOST="localhost"
ELASTICSEARCH_PORT="9200"
```

## File Locations

### Input
- Source PDFs: `/Users/gmac/GrassLabel Dropbox/Grass Label Home/docs/transcripts/pdf/`
- Trial configs: `./trial-configs/custom/`
- Override files: `./trial-configs/custom/*/Attorney.json`

### Output
- Parsed transcripts: `./output/multi-trial/*/`
- Generated overrides: `./output/multi-trial/*/Attorney.json`
- Transcript headers: `./output/multi-trial/*/transcript_header.txt`
- Trial-specific configs: `./output/multi-trial/*/trialstyle-with-overrides.json`

### Temporary
- Processing logs: `./logs/`
- LLM prompts/responses: `./output/llm/`

## Database Cleanup

### Remove Incorrectly Created Records
```bash
# Check what would be deleted (safe preview)
npx ts-node scripts/cleanup-incorrect-records.ts

# Actually delete incorrect records
npx ts-node scripts/cleanup-incorrect-records.ts --force
```

## Troubleshooting

### Common Issues

#### LLM Generation Timeout
```bash
# Use shorter config with fewer trials
echo '{"includedTrials": ["01 Genband"]}' > config/single-trial-test.json
npx ts-node src/cli/generate.ts attorney --config config/single-trial-test.json
```

#### Database Connection Issues
```bash
# Check connection
psql $DATABASE_URL -c "SELECT 1"

# Reset if corrupted
npx prisma db push --force-reset
```

#### Missing Attorney Speakers
```bash
# Verify attorneys imported
psql $DATABASE_URL -c "SELECT COUNT(*) FROM attorney"

# Check speaker correlation
psql $DATABASE_URL -c "SELECT a.name, s.speakerHandle FROM attorney a JOIN speaker s ON a.speakerId = s.id"
```

#### Fix Speaker Prefix Issues
```bash
# Fix incorrect speaker prefixes (e.g., "Mr. Smith" → "MR. SMITH")
npx ts-node scripts/fix-speaker-prefixes.ts

# Fix null speaker prefixes (generates from title + lastName)
npx ts-node scripts/fix-null-speaker-prefixes.ts

# Check for problematic prefixes
npx ts-node -e "
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.speaker.findMany({
  where: {
    OR: [
      { speakerPrefix: { contains: 'Mr.' } },
      { speakerPrefix: { contains: 'Ms.' } }
    ],
    speakerType: 'ATTORNEY'
  }
}).then(s => console.log('Problems:', s.length))
  .finally(() => prisma.\$disconnect());
"
```

## Notes

- **Attorney Metadata**: Stored in JSON files and loaded during Phase 1 parsing (NOT imported to database)
- **Configuration**: Set `useAttorneyMetadata: true` in `config/trialstyle.json` to enable (default: true)
- **No Database Records During Import**: Trials and Speakers are ONLY created during Phase 1 parsing
- **Upsert Mode**: Generated overrides use `overrideAction: "Upsert"` with fingerprint matching
- **Fingerprints**: Format is `lastName_firstName` for persons, normalized name for firms
- **Speaker Handles**: Generated consistently to match between override data and parsed transcripts
- **Trial Selection**: Use `includedTrials` in config to specify which trials to process
- **Parser Mode**: The default `multi-pass` parser provides better extraction accuracy than the deprecated legacy parser