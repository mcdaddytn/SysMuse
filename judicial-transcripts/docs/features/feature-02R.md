# Feature 02R: Phase 1 Parser Corrections and Metadata Enhancement

## Overview
Address critical issues discovered in Phase 1 parsing including improper speaker resolution, missing trial metadata extraction, page number handling, and add new fields for better trial and session identification.

## Issues to Address

### 1. Speaker Resolution in Wrong Phase
**Current Problem**: 
- Phase 1 (Pass 3 - Content Parsing) attempts Q&A speaker resolution
- Generates numerous "Unable to resolve Q/A speaker" warnings
- ExaminationContextManager is being invoked during Phase 1

**Solution**:
- Phase 1 should only extract basic speaker prefixes (THE COURT, MR. SMITH, etc.)
- Move Q&A resolution logic entirely to Phase 2
- Phase 1 should store raw speaker prefixes without resolution

### 2. Page Numbers as Content Lines
**Current Problem**:
- Standalone page numbers (e.g., "126") are stored as regular text lines
- These are PDF page markers that shouldn't be content

**Solution**:
- Filter out lines that contain only numbers during parsing
- Optionally store as page markers in metadata
- Add validation to detect and handle page number patterns

### 3. Trial Metadata Not Populated
**Current Problem**:
- Trial table shows "Unknown Plaintiff", "Unknown Defendant", "UNKNOWN COURT"
- Metadata IS extracted into SessionSection table but not used to update Trial
- Trial name is using folder name instead of parsed case title

**Solution**:
- After parsing SessionSections, update Trial record with extracted metadata
- Parse plaintiff/defendant from CASE_TITLE section
- Extract court information from COURT_AND_DIVISION section
- Parse case number from CASE_TITLE section

### 4. Phase Responsibility Clarification
**Current State**:
- Phase 1 does too much (speaker resolution that belongs in Phase 2)
- Phase boundaries are blurred

**Target State**:
- **Phase 1**: Parse structure, extract metadata, store raw text with basic speaker prefixes
- **Phase 2**: Resolve speakers, handle Q&A context, create events
- **Phase 3**: Marker discovery and accumulator processing

## New Fields Required

### Trial Table Additions
```typescript
{
  shortName: string;  // Folder name from configuration (e.g., "42 Vocalife Amazon")
  // Existing 'name' field will contain full parsed trial name from transcript
}
```

### Session Table Additions
```typescript
{
  shortName: string;  // Parsed identifier from filename (e.g., "Afternoon")
  metadata: JSON;     // Store all parsed file convention data
  // Existing 'sessionType' continues to store MORNING/AFTERNOON/etc.
}
```

## Implementation Tasks

### Task 1: Add New Database Fields
1. Update Prisma schema with Trial.shortName and Session.shortName
2. Add Session.metadata as JSON field if not present
3. Run migrations

### Task 2: Fix Phase 1 Speaker Resolution
1. Modify MultiPassContentParser.identifySpeaker() to only extract prefixes
2. Remove ExaminationContext calls from Phase 1
3. Store raw speaker prefixes without attempting resolution

### Task 3: Filter Page Number Lines
1. Add pattern detection for standalone numbers
2. Filter during line processing in MultiPassContentParser
3. Optionally store as metadata

### Task 4: Extract Trial Metadata from SessionSections
1. After SessionSection parsing, query for CASE_TITLE section
2. Parse plaintiff/defendant names from case title
3. Query COURT_AND_DIVISION section for court info
4. Update Trial record with extracted data

### Task 5: Populate New Fields
1. Set Trial.shortName from folder name during trial creation
2. Parse Session.shortName from filename using file convention
3. Store parsed file metadata in Session.metadata

## Expected Outcomes

### After Phase 1
- Trial table fully populated with:
  - shortName: "42 Vocalife Amazon" (from folder)
  - name: "VOCALIFE LLC v. AMAZON.COM, INC. and AMAZON.COM LLC" (parsed)
  - plaintiff: "VOCALIFE LLC"
  - defendant: "AMAZON.COM, INC. and AMAZON.COM LLC"
  - caseNumber: "2:19-CV-123-JRG"
  - court: "UNITED STATES DISTRICT COURT"
  
- Session table contains:
  - shortName: "Afternoon" (from filename)
  - sessionType: "AFTERNOON"
  - metadata: { originalFileName, dateStr, sessionIndicator, etc. }

- No Q/A speaker resolution warnings in Phase 1
- Page numbers filtered from content
- Clean separation of phase responsibilities

## Testing Requirements
1. Verify no speaker resolution warnings in Phase 1
2. Confirm Trial metadata properly extracted
3. Validate page numbers filtered
4. Check new fields populated correctly
5. Ensure Phase 2 handles speaker resolution properly

## Migration Notes
- Existing trials will need reprocessing to populate new fields
- Phase 2 code may need adjustment to handle new Phase 1 output format
- Backward compatibility considerations for existing data