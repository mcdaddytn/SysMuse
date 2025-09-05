# Attorney Metadata Implementation Guide

## Overview
This implementation allows LLM-generated attorney metadata to be loaded during Phase 1 parsing to enhance attorney records without creating database records prematurely.

## Key Changes

### 1. Metadata Storage Approach
- Attorney metadata is stored in JSON files (`./output/multi-trial/attorney-metadata.json`)
- Metadata is loaded by AttorneyService during Phase 1 parsing
- NO database records are created during import - only metadata storage

### 2. Configuration
Added to `config/trialstyle.json`:
```json
{
  "useAttorneyMetadata": true,
  "attorneyMetadataFile": "./output/multi-trial/attorney-metadata.json"
}
```

### 3. AttorneyService Enhancement
- Loads metadata on initialization if enabled in config
- Enhances attorney records during creation with metadata
- Matches attorneys by fingerprint and trial name

### 4. Parser Updates
- MultiPassTranscriptParser passes trialStyleConfig to ContentParser
- ContentParser passes config to AttorneyService
- AttorneyService uses config to determine metadata loading

## Workflow

1. **Generate Attorney Metadata**
   ```bash
   npx ts-node src/cli/generate.ts attorney --config config/multi-trial-config-mac.json --provider openai --model gpt-4
   ```

2. **Import Metadata (NOT to database)**
   ```bash
   npx ts-node scripts/import-attorney-metadata.ts
   ```
   This creates `./output/multi-trial/attorney-metadata.json`

3. **Run Phase 1 Parsing**
   ```bash
   npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json --parser-mode multi-pass
   ```
   During parsing:
   - Trials are created from transcript headers
   - Speakers are created from transcript text
   - Attorneys are enhanced with metadata when matched by fingerprint

## Outstanding Tasks

### Legacy Parser Update
**TODO**: The legacy TranscriptParser needs to be updated to pass trialStyleConfig to AttorneyService:
- File: `/src/parsers/TranscriptParser.ts`
- Line 57: `this.attorneyService = new AttorneyService(this.prisma);`
- Should be: `this.attorneyService = new AttorneyService(this.prisma, trialStyleConfig);`
- This requires tracing the config through the legacy parser initialization chain

### Phase 2 Processor Update
**TODO**: Phase2Processor also needs updating:
- File: `/src/parsers/Phase2Processor.ts`
- Line 112: `this.attorneyService = new AttorneyService(this.prisma);`
- Should receive and pass trialStyleConfig

## Important Notes

1. **No Database Records During Import**: The import process should NEVER create Trial or Speaker records
2. **Metadata Only**: Import stores metadata in JSON for use during parsing
3. **Phase 1 Creation**: All database records are created during Phase 1 parsing from transcript content
4. **Configuration Control**: Metadata loading can be disabled by setting `useAttorneyMetadata: false`

## Files Modified
- `/src/services/AttorneyService.ts` - Added metadata loading and enhancement
- `/src/parsers/MultiPassTranscriptParser.ts` - Pass trialStyleConfig through
- `/src/parsers/MultiPassContentParser.ts` - Pass config to AttorneyService
- `/src/cli/parse.ts` - Pass trialStyleConfig to parser
- `/config/trialstyle.json` - Added metadata configuration flags
- `/scripts/import-attorney-metadata.ts` - New metadata-only import script

## Files Removed/Deprecated
- `/scripts/import-attorney-overrides.ts` - Should not be used as it creates database records