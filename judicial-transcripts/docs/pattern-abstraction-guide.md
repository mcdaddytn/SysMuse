# Pattern Abstraction System Documentation

## Overview
The Judicial Transcripts system implements a flexible pattern abstraction layer that allows parsing logic to be configured via JSON files rather than hardcoded in the application. This system supports both regex patterns and custom parsing implementations through a common interface.

## Architecture

### Core Components

1. **IParser Interface** (`src/parsers/interfaces/IParser.ts`)
   - Common interface for all parsers (regex and custom)
   - Standardized ParseResult structure
   - Support for single and multiple matches

2. **ParserManager** (`src/parsers/ParserManager.ts`)
   - Loads parser configurations from JSON
   - Factory for creating parser instances
   - Maps parser names to implementations

3. **RegexParser** (`src/parsers/RegexParser.ts`)
   - Implements IParser for regex-based patterns
   - Supports multiple pattern variations
   - Handles capture groups and flags

4. **Custom Parsers** (`src/parsers/custom/`)
   - LawFirmDetector - Example custom implementation
   - Can implement complex logic beyond regex

## Configuration Files

### Primary Configuration
- **Location**: `config/parser-patterns.json`
- **Purpose**: Defines all parsing patterns for transcript processing
- **Structure**: JSON with parser definitions including type, patterns, and capture groups

### Legacy Pattern Files (TypeScript)
- `src/config/patterns.ts` - Hardcoded patterns (being phased out)
- `src/types/patterns.types.ts` - TypeScript interfaces for patterns

## Pattern Types

### 1. REGEX Patterns
Standard regular expression patterns with optional flags and capture groups.

```json
{
  "type": "REGEX",
  "pattern": "^(\\d{1,2}:\\d{2}:\\d{2})\\s*",
  "flags": "",
  "captures": {
    "1": "time"
  }
}
```

### 2. CUSTOM Patterns
Custom parser implementations for complex logic that can't be expressed as regex.

```json
{
  "type": "CUSTOM",
  "implementation": "LawFirmDetector",
  "indicators": ["LLP", "LLC", "LAW FIRM", ...]
}
```

### 3. Multi-Pattern Support
Parsers can have multiple pattern variations for flexibility:

```json
{
  "type": "REGEX",
  "patterns": [
    {
      "pattern": "DIRECT\\s+EXAMINATION",
      "flags": "i",
      "value": "DIRECT_EXAMINATION"
    },
    {
      "pattern": "CROSS[\\s-]EXAMINATION",
      "flags": "i",
      "value": "CROSS_EXAMINATION"
    }
  ]
}
```

## Interface Definition

### IParser Interface
```typescript
interface IParser {
  name: string;
  type: 'REGEX' | 'CUSTOM';
  parse(text: string): ParseResult;
  parseAll(text: string): ParseResult[];
}
```

### ParseResult Structure
```typescript
interface ParseResult {
  matched: boolean;
  value?: string;
  captures?: Record<string, string>;
  position?: {
    start: number;
    end: number;
  };
}
```

## Configured Parsers

### Document Structure Parsers
- `court` - Court name extraction
- `courtDivision` - Division identification
- `courtDistrict` - District extraction
- `caseNumber` - Case number patterns (multiple formats)
- `judge` - Judge name and title
- `judgeTitle` - Judge title extraction

### Attorney/Law Firm Parsers
- `attorneyTitle` - Attorney name with title (Mr./Ms./etc.)
- `lawFirmIndicators` - Custom parser for law firm detection
- `address` - Address parsing (city, state, zip)

### Speaker Identification
- `speakerWithColon` - Speaker followed by colon
- `contextualSpeaker` - Q/A format, THE COURT, etc.
- `byAttorney` - "BY MR/MS..." format
- `jurorSpeaker` - Juror identification

### Witness Parsers
- `witnessName` - Witness with side (plaintiff/defendant)
- `witnessNameAlternate` - Alternative witness format
- `witnessWithNickname` - Names with nicknames
- `examinationType` - Direct/Cross/Redirect/Recross
- `swornStatus` - Sworn/Previously sworn detection

### Metadata Parsers
- `courtReporter` - Court reporter information
- `pageHeader` - Page numbers
- `timestamp` - Time stamps (HH:MM:SS)
- `lineNumber` - Line numbering

## Usage Examples

### Loading and Using Parsers
```typescript
// Initialize ParserManager
const parserManager = new ParserManager(prisma);

// Get a specific parser
const parser = parserManager.getParser('caseNumber');

// Parse text
const result = parser.parse('CIVIL ACTION NO. 4:20-CV-01234');
// result: { matched: true, captures: { caseNumber: '4:20-CV-01234' } }
```

### Adding New Patterns
1. Edit `config/parser-patterns.json`
2. Add new parser definition
3. Restart application to reload

### Creating Custom Parsers
1. Create new class implementing IParser in `src/parsers/custom/`
2. Add implementation mapping in ParserManager
3. Reference in parser-patterns.json with type: 'CUSTOM'

## Benefits

1. **Maintainability**: Patterns can be modified without code changes
2. **Flexibility**: Support for both regex and custom logic
3. **Testability**: Patterns can be tested independently
4. **Extensibility**: New parser types can be added easily
5. **Configuration**: Non-developers can modify patterns via JSON

## Migration Path

The system is transitioning from hardcoded patterns to JSON configuration:
- Phase 1: ✅ Implement abstraction layer
- Phase 2: ✅ Create JSON configuration
- Phase 3: 🔄 Migrate existing code to use ParserManager
- Phase 4: ⏳ Remove hardcoded patterns from codebase

## Best Practices

1. **Pattern Organization**: Group related patterns in the JSON file
2. **Naming Convention**: Use descriptive, consistent names
3. **Documentation**: Comment complex patterns in the JSON
4. **Testing**: Test patterns with sample data before deployment
5. **Version Control**: Track pattern changes in git

## Future Enhancements

- Database storage of patterns for runtime modification
- Pattern validation and testing UI
- Performance metrics for pattern matching
- Machine learning-based pattern discovery
- Pattern inheritance and composition