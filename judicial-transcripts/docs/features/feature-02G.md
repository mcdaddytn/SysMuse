# Feature-02G: SessionSection Summary Parsing

## Overview
Implement parsing logic to extract and store structured data from transcript summary sections into the SessionSection model created in feature-02E.

## Background
The SessionSection model was created in feature-02E but the parsing logic was not implemented. Summary sections contain critical metadata about each court session including court information, case details, participants, and session timing that should be extracted and stored in a structured format.

## Current State
- SessionSection model exists with fields: id, sessionId, trialId, sectionType, sectionText, orderIndex, metadata
- Summary lines are currently being skipped during parsing (only PROCEEDINGS lines are stored)
- Summary information is partially extracted for Trial setup but not preserved in database

## Requirements

### 1. Summary Section Detection and Storage

#### 1.1 Section Identification
The parser should identify and extract the following sections from the summary:

**Standard Sections** (in typical order):
1. **Header Section** - Case number and page info (lines 1-2)
2. **Court and Division** - Court location and division info
3. **Case Title** - Plaintiff vs Defendant
4. **Session Info** - Date, time, and session type
5. **Judge Info** - Presiding judge details
6. **Appearances** - Attorney listings for plaintiff/defendant
7. **Court Personnel** - Court reporter, clerk, etc.

**Example Section Detection**:
```
IN THE UNITED STATES DISTRICT COURT        <- Start of Court and Division
FOR THE EASTERN DISTRICT OF TEXAS
MARSHALL DIVISION

VOCALIFE LLC,                              <- Start of Case Title
    PLAINTIFF,
VS.
AMAZON.COM, INC. and
AMAZON.COM LLC,
    DEFENDANTS.

OCTOBER 1, 2020                            <- Start of Session Info
1:41 P.M.

TRANSCRIPT OF JURY TRIAL
AFTERNOON SESSION

BEFORE THE HONORABLE JUDGE RODNEY GILSTRAP <- Start of Judge Info
```

#### 1.2 Section Storage Format
Each identified section should create a SessionSection record with:
- `sectionType`: Standardized name (e.g., "COURT_AND_DIVISION", "CASE_TITLE")
- `sectionText`: Raw text of the section
- `orderIndex`: Sequential order in summary (1, 2, 3...)
- `metadata`: Parsed structured data specific to section type

### 2. Metadata Extraction by Section Type

#### 2.1 Court and Division Section
```json
{
  "court": "United States District Court",
  "district": "Eastern District of Texas",
  "division": "Marshall Division"
}
```

#### 2.2 Case Title Section
```json
{
  "plaintiff": "VOCALIFE LLC",
  "defendant": "AMAZON.COM, INC. and AMAZON.COM LLC",
  "caseNumber": "2:19-CV-00123-JRG",
  "civilAction": true
}
```

#### 2.3 Session Info Section
```json
{
  "date": "2020-10-01",
  "time": "13:41:00",
  "sessionType": "AFTERNOON",
  "transcriptType": "JURY TRIAL"
}
```

#### 2.4 Judge Info Section
```json
{
  "name": "RODNEY GILSTRAP",
  "title": "UNITED STATES CHIEF DISTRICT JUDGE",
  "honorific": "HONORABLE"
}
```

#### 2.5 Appearances Section
```json
{
  "plaintiffAttorneys": [
    {
      "name": "ALFRED R. FABRICANT",
      "firm": "FABRICANT LLP",
      "location": "New York, NY"
    }
  ],
  "defendantAttorneys": [
    {
      "name": "JOSEPH R. RE",
      "firm": "KNOBBE, MARTENS, OLSON & BEAR, LLP",
      "location": "Irvine, CA"
    }
  ]
}
```

#### 2.6 Court Personnel Section
```json
{
  "courtReporter": {
    "name": "Shelly Holmes",
    "credentials": "CSR",
    "location": "Longview, Texas",
    "certNumber": "Texas CSR 13236"
  },
  "courtClerk": {
    "name": "Ms. Lena Smith"
  }
}
```

### 3. Certification Section Parsing

The CERTIFICATION section at the end should also be parsed and stored:

#### 3.1 Certification Detection
- Detect start: Line containing "CERTIFICATION" or "REPORTER'S CERTIFICATE"
- Extract certification text and metadata
- Store as SessionSection with sectionType: "CERTIFICATION"

#### 3.2 Certification Metadata
```json
{
  "certifiedBy": "Shelly Holmes",
  "certificationDate": "2020-10-09",
  "pageCount": 156,
  "certificationText": "I certify that the foregoing is a correct transcript..."
}
```

### 4. Integration Points

#### 4.1 Phase 1 Integration
- Modify TranscriptParser to capture summary lines before "P R O C E E D I N G S"
- Create SessionSectionParser class to handle section identification and metadata extraction
- Store SessionSection records during session creation

#### 4.2 Data Flow
1. Read lines until "P R O C E E D I N G S" detected
2. Pass accumulated summary lines to SessionSectionParser
3. Parser identifies sections and extracts metadata
4. Create SessionSection records linked to session
5. Continue with existing PROCEEDINGS parsing

### 5. Enhanced Line Storage (Optional)

Consider storing ALL lines (including SUMMARY and CERTIFICATION) with appropriate documentSection values:
- Benefits: Complete transcript in database, enables full-text search
- Implementation: Remove skip logic, ensure all lines get documentSection

### 6. Testing Requirements

#### 6.1 Section Detection Tests
- Verify correct identification of all standard sections
- Handle variations in section formatting
- Handle missing sections gracefully

#### 6.2 Metadata Extraction Tests
- Verify accurate extraction of structured data
- Handle variations in data format (e.g., different date formats)
- Validate extracted data (e.g., valid dates, proper names)

#### 6.3 Backward Compatibility
- Ensure existing Phase 1 functionality unchanged
- Verify Phase 2 and 3 continue to work with new data

### 7. Implementation Considerations

#### 7.1 Section Boundary Detection
- Use blank lines and indentation patterns
- Look for keyword markers (e.g., "FOR THE PLAINTIFF:", "BEFORE THE")
- Handle multi-line sections (e.g., long attorney lists)

#### 7.2 Data Normalization
- Standardize attorney names and firms
- Normalize dates and times to consistent format
- Clean and trim extracted text

#### 7.3 Error Handling
- Log warnings for unrecognized sections
- Continue parsing even if section extraction fails
- Provide detailed error messages for debugging

### 8. Database Queries

New queries to implement:
```sql
-- Get all sections for a session
SELECT * FROM "SessionSection" 
WHERE "sessionId" = ? 
ORDER BY "orderIndex";

-- Get specific section type across all sessions
SELECT * FROM "SessionSection" 
WHERE "trialId" = ? AND "sectionType" = 'COURT_AND_DIVISION';

-- Search metadata
SELECT * FROM "SessionSection" 
WHERE "metadata"->>'court' LIKE '%District Court%';
```

### 9. API Endpoints (Future)

Consider adding endpoints to retrieve section data:
- `GET /api/sessions/:id/sections` - All sections for a session
- `GET /api/trials/:id/sections/:type` - Specific section type for trial
- `GET /api/sessions/:id/metadata` - Aggregated metadata from all sections

### 10. Success Criteria

- [ ] All summary sections correctly identified and stored
- [ ] Metadata accurately extracted for each section type
- [ ] Certification sections parsed and stored
- [ ] No regression in existing Phase 1, 2, or 3 functionality
- [ ] Tests pass for section detection and metadata extraction
- [ ] Performance impact minimal (< 10% increase in parsing time)

## Related Files
- `prisma/schema.prisma` - SessionSection model definition
- `src/parsers/TranscriptParser.ts` - Main parsing logic
- `src/types/config.types.ts` - Type definitions

## Notes
- This feature completes the work started in feature-02E
- Consider future enhancement to store all lines (not just PROCEEDINGS)
- Metadata extraction rules may need adjustment based on transcript variations