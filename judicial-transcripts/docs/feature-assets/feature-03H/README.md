# Feature 03H Assets: Entity Override System

## Directory Contents

### `/samples/`
Sample override JSON files demonstrating the expected format for entity imports:
- `override-attorneys.json` - Attorney, LawFirm, LawFirmOffice relationships
- `override-trial.json` - Trial entity with related metadata
- `override-complete.json` - Complete set of entities for a trial
- `/transcript-headers/` - Sample transcript header pages for LLM testing

### `/schemas/`
JSON Schema definitions for validation:
- `override-schema.json` - Main override file structure
- `entity-schemas.json` - Individual entity schemas

### `/prompts/`
LLM prompt templates and examples:
- `entity-extraction-prompt.md` - Base prompt for entity extraction
- `extraction-examples.json` - Example inputs/outputs for LLM

## Usage Instructions

### Importing Override Files
Place your override JSON files in this directory following the sample formats. The system will:
1. Load all entities into memory
2. Build correlation maps using source IDs
3. Generate new database IDs while preserving relationships
4. Import entities with fresh timestamps

### LLM Extraction
The system will:
1. Read first 2 pages from trial transcripts
2. Send to LLM with schema definitions
3. Generate override JSON in same format
4. Validate and import extracted entities

## File Formats

### Override JSON Structure
```json
{
  "trial": {
    "id": "source-trial-1",
    "caseNumber": "2:16-cv-00123",
    "caseHandle": "Apple v. Samsung",
    ...
  },
  "attorneys": [
    {
      "id": "source-attorney-1",
      "name": "John Smith",
      "lawFirmId": "source-firm-1",
      ...
    }
  ],
  "lawFirms": [...],
  "addresses": [...]
}
```

### Correlation Mapping
Source IDs are used only for relationship mapping:
- `attorney.lawFirmId` → maps to `lawFirm.id` in same file
- `lawFirmOffice.addressId` → maps to `address.id` in same file

Destination database generates new auto-increment IDs.