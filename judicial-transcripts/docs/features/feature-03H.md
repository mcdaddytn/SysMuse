# Feature 03H: Entity Override System with LLM Extraction

## Overview
Implement a comprehensive entity override system that allows importing pre-parsed entity data from JSON files and extracting entity data from transcript headers using LLM analysis.

## Business Requirements
1. Import entity data from external sources (previous parses, manual corrections)
2. Preserve relationships between entities using correlation IDs
3. Extract entity data from transcript headers using LLM
4. Support batch processing of multiple trials
5. Generate consistent, validated entity data

## Technical Specifications

### 1. Override File Format
JSON files containing database entity exports with:
- Full entity structure matching database schema
- Source IDs for relationship correlation
- Optional timestamps (can be regenerated)
- Support for related entities (Attorney → LawFirm → LawFirmOffice → Address)

### 2. Entity Correlation System
- Use source IDs as correlation keys (not database IDs)
- Map relationships between entities during import
- Generate new auto-increment IDs in destination database
- Maintain referential integrity across entities

### 3. Supported Entities
Primary entities for override/extraction:
- **Trial**: caseNumber, caseHandle, name, plaintiff, defendant, court, courtDivision, courtDistrict
- **Judge**: name, title, court association
- **Attorney**: name, bar number, role, trial association
- **LawFirm**: name, type
- **LawFirmOffice**: office name, location
- **Address**: street, city, state, zip
- **CourtReporter**: name, certification, trial association

### 4. LLM Extraction System

#### Input Processing
1. Locate first session transcript for each trial
2. Extract first 2 pages (using page break markers)
3. Construct LLM context with schema definitions
4. Request structured JSON output

#### LLM Integration
- Use LangChain for LLM communication
- Provide schema definitions and examples
- Request JSON in override file format
- Include correlation IDs for related entities

#### Output Validation
- Validate JSON structure against schema
- Verify required fields
- Check relationship consistency
- Generate correction report

## Implementation Components

### 1. Override Import Module (`src/services/override/`)
```typescript
interface OverrideImporter {
  loadOverrideFile(path: string): OverrideData
  validateOverrides(data: OverrideData): ValidationResult
  applyOverrides(data: OverrideData): ImportResult
  correlateEntities(data: OverrideData): CorrelationMap
}
```

### 2. LLM Extraction Module (`src/services/llm/`)
```typescript
interface LLMExtractor {
  extractTranscriptHeader(transcriptPath: string): string
  buildLLMContext(header: string, schema: Schema): LLMContext
  requestEntityExtraction(context: LLMContext): ExtractedEntities
  validateExtraction(entities: ExtractedEntities): ValidationResult
}
```

### 3. CLI Commands
```bash
# Import override file
npx ts-node src/cli/override.ts import <override-file.json>

# Extract entities using LLM
npx ts-node src/cli/override.ts extract --trial-id <id>
npx ts-node src/cli/override.ts extract --all-trials

# Generate override template from existing data
npx ts-node src/cli/override.ts export --trial-id <id> --output <file.json>
```

## File Structure
```
docs/feature-assets/feature-03H/
├── README.md
├── samples/
│   ├── override-attorneys.json
│   ├── override-trial.json
│   ├── override-complete.json
│   └── transcript-headers/
│       └── sample-header-pages.txt
├── schemas/
│   ├── override-schema.json
│   └── entity-schemas.json
└── prompts/
    ├── entity-extraction-prompt.md
    └── extraction-examples.json
```

## Acceptance Criteria
1. [ ] Override files can be imported with relationship preservation
2. [ ] Source IDs correctly map entities without collision
3. [ ] LLM extraction produces valid JSON for all entity types
4. [ ] Batch processing handles multiple trials efficiently
5. [ ] Validation reports identify and log all issues
6. [ ] Generated IDs in destination DB are unique and sequential
7. [ ] Timestamps are regenerated for imported entities
8. [ ] CLI provides clear feedback on import/extraction status

## Testing Requirements
1. Unit tests for correlation mapping
2. Integration tests for database import
3. LLM extraction tests with sample transcripts
4. Validation tests for malformed data
5. Performance tests for batch operations

## Dependencies
- LangChain for LLM integration
- JSON Schema validation library
- Existing database models and services
- Transcript parsing utilities

## Configuration
```json
{
  "override": {
    "preserveSourceIds": false,
    "regenerateTimestamps": true,
    "validateRelationships": true,
    "llm": {
      "model": "gpt-4",
      "temperature": 0.1,
      "maxTokens": 4000,
      "retryAttempts": 3
    }
  }
}
```

## Error Handling
- Invalid JSON structure → Log and reject file
- Missing required fields → Report and skip entity
- Broken relationships → Log correlation failures
- LLM extraction failures → Retry with fallback
- Database conflicts → Transaction rollback

## Performance Considerations
- Load all override data into memory for correlation
- Batch database operations for efficiency
- Cache LLM responses for retry scenarios
- Process trials in parallel where possible

## Security Considerations
- Validate all input JSON against schemas
- Sanitize LLM responses before parsing
- Use parameterized queries for database operations
- Log all override operations for audit trail