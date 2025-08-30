# Feature 02J: Multi-Pass Parsing Refactor for Robust Transcript Processing

## Overview
Refactor the transcript parsing system to use a multi-pass approach that cleanly separates metadata extraction from content parsing, addressing the fragility issues identified in Feature-02I implementation.

## Background

### Current Problems
The current single-pass parsing approach has several critical issues:

1. **Intermingled Parsing**: Metadata (page headers, line prefixes) is extracted simultaneously with content parsing, causing:
   - Pattern matching complexity when metadata bleeds into content
   - Special-case handling for specific transcript variations
   - Fragile code that breaks with format variations

2. **Sequential Dependencies**: Current implementation has problematic behaviors:
   - Pre-creating Page 3 during SUMMARY parsing before PROCEEDINGS
   - Special handling for summary continuations across pages
   - Assumptions about document structure that may not hold

3. **Limited Look-ahead/Look-back**: Single-pass parsing cannot:
   - Determine section boundaries accurately
   - Handle sections that span pages unpredictably
   - Validate parsing decisions against broader context

## Requirements

### 1. Multi-Pass Architecture

#### Pass 1: Metadata Extraction
**Purpose**: Extract all transcript metadata before any content parsing

**Implementation**:
- Scan entire file for page headers using reliable patterns
- Extract all line prefixes (timestamps, line numbers)
- Create Page records with proper boundaries
- Store metadata separately from content
- Build file line to document structure mapping

**Output**:
- Complete Page records with headerText
- Line metadata (timestamps, numbers) stored separately
- Mapping of file lines to pages

#### Pass 2: Structure Analysis
**Purpose**: Identify document sections with metadata already removed

**Implementation**:
- Work with clean content (metadata stripped)
- Identify SUMMARY, PROCEEDINGS, CERTIFICATION boundaries
- Use forward/backward scanning for section detection
- Handle multi-page sections correctly
- Create section boundary mappings

**Output**:
- Document section boundaries
- Line-to-section mappings
- Section metadata (type, start/end lines)

#### Pass 3: Content Parsing
**Purpose**: Parse actual transcript content within identified structures

**Implementation**:
- Process each section with appropriate patterns
- Parse speaker identifications
- Extract testimonies and examinations
- Process court activities
- Store parsed content with proper associations

**Output**:
- Complete Line records with parsed content
- Speaker, Attorney, Witness associations
- Testimony and examination records

### 2. Implementation Strategy

#### Memory vs. Database Approach
- **Small files (<1000 pages)**: Load entire file into memory
- **Large files**: Use temporary database tables for intermediate results
- **Configurable**: Allow configuration to choose approach

#### Data Structures
```typescript
interface ParsedMetadata {
  pages: Map<number, PageMetadata>;
  lines: Map<number, LineMetadata>;
  fileLineMapping: Map<number, DocumentLocation>;
}

interface PageMetadata {
  pageNumber: number;
  trialPageNumber: number;
  parsedTrialPage: number;
  headerText: string;
  startFileLine: number;
  endFileLine: number;
}

interface LineMetadata {
  lineNumber: number;
  timestamp?: string;
  prefix: string;
  contentStart: number; // character position where content begins
}

interface DocumentLocation {
  pageNumber: number;
  lineNumber: number;
  section?: DocumentSection;
}
```

### 3. Specific Improvements

#### Metadata Extraction Patterns
- **Page Headers**: Robust multi-line pattern matching
- **Line Prefixes**: Clear separation of timestamp/number from content
- **Clean Content**: Method to strip all metadata cleanly

#### Section Detection
- **SUMMARY**: Detect start and end, handle multi-page
- **PROCEEDINGS**: Identify boundaries accurately
- **CERTIFICATION**: Parse complete section

#### Error Handling
- Validate each pass before proceeding
- Log detailed information about parsing decisions
- Provide clear error messages for debugging

### 4. Testing Requirements

#### Unit Tests
- Test each pass independently
- Mock data for edge cases
- Validate metadata extraction accuracy

#### Integration Tests
- Test with current sample transcript
- Test with variations (single-line headers, 3-digit pages)
- Ensure backward compatibility

#### Performance Tests
- Measure parsing time for each pass
- Compare with current implementation
- Ensure acceptable performance

## Benefits

### Robustness
- Handles transcript format variations
- No assumptions about document structure
- Clean separation of concerns

### Maintainability
- Each pass has single responsibility
- Easy to debug specific issues
- Clear data flow between passes

### Extensibility
- Easy to add new passes
- Can modify passes independently
- Supports different transcript formats

## Implementation Notes

### Phase 1 Considerations
- Can implement incrementally
- Start with Pass 1 (metadata extraction)
- Validate against current parsing results

### Migration Path
1. Implement new parser alongside current
2. Compare results for validation
3. Switch to new parser when stable
4. Remove old parser code

### Configuration
Add configuration options:
```json
{
  "parsing": {
    "mode": "multi-pass",
    "loadInMemory": true,
    "validatePasses": true,
    "debugOutput": false
  }
}
```

## Success Criteria

1. **Accuracy**: Parse current test transcript without errors
2. **Robustness**: Handle format variations gracefully
3. **Performance**: Complete parsing within acceptable time
4. **Maintainability**: Clear, documented code structure
5. **Testing**: Comprehensive test coverage

## Dependencies

- Current parser code for reference
- Test transcripts with variations
- Database schema (no changes needed)

## Future Considerations

- Support for different transcript formats
- Parallel processing for large files
- Machine learning for pattern detection
- Real-time parsing progress reporting