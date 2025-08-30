# Feature 02I Implementation Guide

## Overview
Feature 02I addressed critical issues with page parsing, page header text handling, and the interaction between Summary and Page parsing. The implementation focused on properly distinguishing between transcript metadata (page headers, line prefixes) and actual transcript content entered by court reporters.

## What Was Implemented

### 1. Schema Changes
- **Renamed Field**: `Page.parsedTrialLine` → `Page.parsedTrialPage`
  - This field now correctly represents the page number within the entire trial across session transcripts
  - Used for verification against our calculated `trialPageNumber`
  - Generally accurate except for single-line page headers with 3-digit page numbers

### 2. Page Header Parsing Improvements
- **Metadata Extraction**: Page headers are now properly extracted as metadata before parsing document sections
- **Page Creation**: New Page records are created when page headers are detected
- **Line Association**: Lines are correctly associated with their respective pages (max 25 lines per page)
- **Header Storage**: Page headers are stored in `Page.headerText` instead of being duplicated in SessionSection

### 3. Page Number Corrections
- Fixed page numbering so that `Page.pageNumber`, `Page.trialPageNumber`, and `Page.parsedTrialPage` align correctly
- For the first transcript of a trial, all three values should be equal (except for corruption cases)
- Properly handles multi-page summaries with correct page breaks

## Current Design Limitations and Fragility Concerns

### Critical Issues with Current Implementation

#### 1. Intermingled Metadata and Content Parsing
**Problem**: The current design mixes metadata extraction with content parsing, creating fragile dependencies.

**Current Approach**:
- Special handling during SUMMARY parsing for page continuations
- Pre-creation of Page 3 during SUMMARY parsing before PROCEEDINGS
- Ad-hoc solutions for specific test cases

**Why This Is Fragile**:
- Assumes specific document structures that may not hold for all transcripts
- Creates dependencies between document sections
- Makes it difficult to handle variations in transcript formats

#### 2. Sequential Single-Pass Parsing
**Problem**: Trying to parse everything in one pass leads to complex state management and edge cases.

**Issues**:
- Cannot look ahead or back to determine section boundaries accurately
- Must make assumptions about document structure
- Difficult to handle sections that span multiple pages unpredictably

#### 3. Lack of Clear Separation Between Metadata and Content
**Problem**: Page headers and line prefixes (metadata) are processed alongside court reporter content.

**Consequences**:
- Pattern matching becomes complex when metadata bleeds into content
- Special cases multiply as we encounter different transcript variations
- Error-prone when transcript format varies slightly

## Recommended Architecture for Feature-02J (Parsing Refactor)

### Multi-Pass Parsing Strategy

#### Pass 1: Metadata Extraction
1. **Extract All Page Headers**
   - Identify all page break patterns
   - Store page boundaries with file line numbers
   - Create Page records with headerText and metadata

2. **Extract Line Prefixes**
   - Identify all lines with timestamps and line numbers
   - Store line metadata separately from content
   - Map file lines to logical document lines

#### Pass 2: Content Structure Analysis
1. **Identify Document Sections**
   - With metadata stripped, identify SUMMARY, CERTIFICATION, PROCEEDINGS boundaries
   - Use forward/backward scanning to find section starts/ends
   - Handle sections that span multiple pages

2. **Create Section Mappings**
   - Map each content line to its document section
   - Store section boundaries for reference

#### Pass 3: Content Parsing and Storage
1. **Parse Section Content**
   - Process each section with appropriate patterns
   - Content is clean without metadata interference
   - Store parsed content with proper associations

### Benefits of Multi-Pass Approach
- **Robustness**: Handles variations in transcript format
- **Clarity**: Clear separation of concerns
- **Maintainability**: Each pass has a single responsibility
- **Flexibility**: Can add/modify passes without affecting others
- **Debugging**: Easier to identify where parsing fails

### Implementation Considerations
- Can load entire file into memory for small transcripts
- For large files, store intermediate results in temporary tables
- Trade execution speed for accuracy and maintainability
- Use database transactions to ensure consistency

## Testing Continuity

### Critical Information for New Sessions
The following information has been added to CLAUDE.md and relevant documentation:

1. **Configuration File Usage**
   - ALWAYS use `config/example-trial-config-mac.json` for Mac testing
   - Command-line arguments alone are insufficient
   - Configuration file is mandatory for all operations

2. **Database Management**
   - NO migrations during active development
   - Always recreate database when schema changes
   - Use seed data and backup/restore scripts as documented

3. **CLI Phases**
   - Convert: PDF to text conversion
   - Phase1: Initial parsing and database population
   - Phase2: Enhanced parsing with pattern matching
   - Phase3: Final processing and validation

## Next Steps

1. **Feature-02J**: Complete parsing refactor with multi-pass strategy
2. **Feature-08**: CLI redesign for cleaner syntax and better usability
3. **Documentation Updates**: Ensure all testing procedures are clearly documented
4. **Validation**: Test with additional transcript variations

## Lessons Learned

1. **Metadata First**: Always extract metadata before attempting content parsing
2. **Multiple Passes**: Better to sacrifice speed for accuracy and maintainability
3. **Clear Boundaries**: Maintain strict separation between different types of data
4. **Flexibility**: Design for variation in source documents, not specific test cases
5. **Documentation**: Critical testing information must be prominently documented

## Files Modified in Feature-02I

- Database schema changes for Page table
- Parser modules for improved page header detection
- Summary parsing logic for multi-page handling
- Page creation and association logic
- Line-to-page mapping improvements