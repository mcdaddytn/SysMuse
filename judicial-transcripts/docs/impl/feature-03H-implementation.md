# Feature 03H Implementation: Entity Override System

## Overview
Implemented comprehensive entity override system with LLM extraction capabilities for importing pre-parsed reference data and extracting entities from transcript headers.

## Implementation Details

### 1. Core Services

#### OverrideImporter (`src/services/override/OverrideImporter.ts`)
- Loads and validates override JSON files
- Manages entity correlation using source IDs
- Creates database records with proper relationships
- Generates consistent speaker handles for attorney/judge matching

#### LLMExtractor (`src/services/llm/LLMExtractor.ts`)
- Extracts first 2 pages from transcript files
- Uses LangChain with OpenAI GPT-4 for entity extraction
- Validates extracted entities against schema
- Supports single trial or batch processing

#### Speaker Utilities (`src/services/speakers/speakerUtils.ts`)
- Generates consistent speaker handles from names
- Ensures matching between reference data and parsed transcripts
- Handles speaker prefix generation

### 2. CLI Commands

```bash
# Import override file
npx ts-node src/cli/override.ts import <file.json> [--validate-only] [--verbose]

# Extract entities using LLM
npx ts-node src/cli/override.ts extract --trial-path <path> [--output <file>] [--import]
npx ts-node src/cli/override.ts extract --all-trials <path> [--output <file>]

# Export existing data
npx ts-node src/cli/override.ts export --trial-id <id> [--output <file>]
```

### 3. Key Design Decisions

#### Speaker Handle Generation
- Consistent handle generation ensures speakers created during parsing match reference data
- Format: Name → uppercase, spaces to underscores, remove special chars
- Example: "MR. JOHN SMITH" → "MR_JOHN_SMITH"

#### Entity Correlation
- Source IDs used as correlation keys (not database IDs)
- Database generates new auto-increment IDs
- Relationships preserved through correlation mapping

#### Reference Data Approach
- Attorneys and Judges imported with placeholder speakers
- Speaker records created with consistent handles
- Actual transcript parsing will match speakers by handle

### 4. Data Flow

1. **Override Import**:
   - Load JSON → Validate → Build correlation map → Import in dependency order
   - Order: Address → Trial → LawFirm → LawFirmOffice → Attorney (with Speaker) → Judge (with Speaker) → CourtReporter → TrialAttorney

2. **LLM Extraction**:
   - Read transcript → Extract header (2 pages) → Send to LLM → Validate response → Save/Import

## Testing Results

Successfully imported sample data:
- 1 Trial
- 4 Attorneys (with matching Speakers)
- 3 Law Firms
- 3 Law Firm Offices
- 3 Addresses
- 1 Judge (with Speaker)
- 1 Court Reporter
- 4 Trial Attorney relationships

Speaker handles properly generated:
- `MR_ALFRED_R_FABRICANT` → "MR. FABRICANT"
- `MR_PETER_LAMBRIANAKOS` → "MR. LAMBRIANAKOS"
- `THE_HONORABLE_JUDGE` → "THE HONORABLE JUDGE"

## Usage Examples

### Import Override File
```bash
npx ts-node src/cli/override.ts import docs/feature-assets/feature-03H/sample-override-complete.json --verbose
```

### Extract with LLM (requires OPENAI_API_KEY)
```bash
export OPENAI_API_KEY="your-key"
npx ts-node src/cli/override.ts extract --trial-path "/path/to/trial/folder" --output extracted.json
```

### Export Existing Data
```bash
npx ts-node src/cli/override.ts export --trial-id 1 --output export.json
```

## Files Created/Modified

### New Files
- `src/services/override/types.ts` - Type definitions
- `src/services/override/OverrideImporter.ts` - Import service
- `src/services/llm/LLMExtractor.ts` - LLM extraction service
- `src/services/speakers/speakerService.ts` - Speaker creation helper
- `src/services/speakers/speakerUtils.ts` - Speaker handle utilities
- `src/cli/override.ts` - CLI commands
- `docs/feature-assets/feature-03H/sample-override-complete.json` - Sample data

### Configuration
- Uses existing Prisma models and database schema
- Requires OPENAI_API_KEY environment variable for LLM extraction
- Compatible with existing multi-pass parser workflow

## Integration Points

- Speakers created with consistent handles will match during transcript parsing
- Attorney fingerprints enable cross-trial matching
- TrialAttorney relationships properly link attorneys to trials with roles
- System ready for integration with main parsing pipeline