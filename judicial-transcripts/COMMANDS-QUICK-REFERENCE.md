# Commands Quick Reference

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

## Override Management

### Import Override Files
```bash
# Import single override file
npx ts-node src/cli/override.ts import <file.json> --verbose

# Validate without importing
npx ts-node src/cli/override.ts import <file.json> --validate-only

# Import all Attorney.json files for active trials
npx ts-node scripts/import-attorney-overrides.ts

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
# Single trial with configuration file
npx ts-node src/cli/parse.ts parse --phase1 --config config/example-trial-config-mac.json

# Multi-trial processing
npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json --parser-mode multi-pass

# Legacy parser mode
npx ts-node src/cli/parse.ts parse --phase1 --config config/example-trial-config-mac.json --parser-mode legacy
```

### Phase 2: Enhanced Processing
```bash
# Process specific trial
npx ts-node src/cli/parse.ts parse --phase2 --config config/example-trial-config-mac.json --trial-id 1
```

### Phase 3: Final Processing
```bash
npx ts-node src/cli/phase3.ts process
```

### PDF to Text Conversion
```bash
# Convert PDFs to text for processing
npm run convert-pdf config/multi-trial-config-mac.json
```

## Configuration Files

### Main Configuration Files
- `config/multi-trial-config-mac.json` - Main multi-trial configuration
- `config/example-trial-config-mac.json` - Single trial example
- `config/pdftotext.json` - PDF conversion settings
- `config/trialstyle.json` - Default parsing style settings
- `config/system-config.json` - System-wide settings

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
  "parserMode": "multi-pass"
}
```

## Workflow Examples

### Complete Attorney Override Workflow
```bash
# 1. Generate attorney data using LLM
npx ts-node src/cli/generate.ts attorney --config config/multi-trial-config-mac.json --provider openai --model gpt-4

# 2. Import generated overrides into database
npx ts-node scripts/import-attorney-overrides.ts

# 3. Run Phase 1 parsing with pre-populated attorneys
npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json --parser-mode multi-pass
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

# 4. Import attorney overrides
npx ts-node scripts/import-attorney-overrides.ts

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

- **Upsert Mode**: Generated overrides use `overrideAction: "Upsert"` with fingerprint matching
- **Fingerprints**: Format is `lastName_firstName` for persons, normalized name for firms
- **Speaker Handles**: Generated consistently to match between override data and parsed transcripts
- **Trial Selection**: Use `includedTrials` in config to specify which trials to process
- **Parser Modes**: `multi-pass` is recommended for better extraction accuracy