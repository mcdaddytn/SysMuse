# Feature 02X: Human-Readable Reporting System for Phase 1 Data

## Overview
This feature implements a comprehensive reporting system that generates human-readable output from Phase 1 parsed data using hierarchical queries and flexible report generation. The reports provide structured, formatted output suitable for both human review and LLM context feeding for subsequent processing (Feature 02W).

## Purpose
- Generate well-formatted, human-readable reports from Phase 1 parsing output
- Create structured data exports suitable for LLM context in Feature 02W
- Provide validation and quality assurance reports for parsed trial data
- Enable flexible report generation using hierarchical queries

## Implementation Status
✅ Completed - All core functionality implemented

## Implemented Components

### 1. Hierarchical Queries (`src/services/Phase1ReportQueries.ts`)

#### Query 1: TrialSessionSectionQuery
- **Purpose**: Hierarchical Trial/Session/SessionSection query
- **Returns**: All SessionSections for each trial and session
- **Use Case**: Report 1 - SessionSection export
- **Structure**:
  ```
  Trial
    └── Session
          └── SessionSection[]
  ```

#### Query 2: TrialSessionPageLineQuery  
- **Purpose**: Hierarchical Trial/Session/Page/Line query
- **Returns**: All Lines for each trial, session, and page
- **Filters**: Can filter by documentSection (SUMMARY, PROCEEDINGS, etc.)
- **Use Case**: Report 2 - Clean text extraction
- **Structure**:
  ```
  Trial
    └── Session
          └── Page[]
                └── Line[]
  ```

#### Query 3: SummaryLinesQuery
- **Purpose**: Extract clean summary text
- **Returns**: Summary lines without artifacts (headers, prefixes, etc.)
- **Built on**: TrialSessionPageLineQuery with documentSection='SUMMARY'

#### Query 4: SessionStatisticsQuery
- **Purpose**: Generate session-level statistics
- **Returns**: Page counts, line counts, statement counts, speaker counts

### 2. Report Generator (`src/services/Phase1ReportGenerator.ts`)

#### Report 1: SessionSection Reports
- **Output**: One file per Trial/Session combination
- **Filename Format**: `TrialName_SessionDate_SessionType_sections.txt`
- **Content**: All SessionSection records with sectionType and sectionText
- **Location**: `/output/reports/phase1/[trial-name]/`

#### Report 2: Summary Line Reports
- **Output**: Clean text without parsing artifacts
- **Filename Format**: `TrialName_SessionDate_SessionType_summary.txt`
- **Content**: Line text only from SUMMARY sections
- **Location**: `/output/reports/phase1/[trial-name]/`

#### Report 3: Full Line Reports
- **Output**: All lines with metadata for debugging
- **Filename Format**: `TrialName_SessionDate_SessionType_[section]_lines.txt`
- **Content**: Lines with numbers, document sections, prefixes, continuation markers
- **Filters**: Can filter by document section

#### Report 4: Session Statistics
- **Output**: Markdown table with session metrics
- **Filename Format**: `TrialName_statistics.md`
- **Content**: Page/line/statement counts, speaker counts, section types

### 3. CLI Commands (`src/cli/report.ts`)

```bash
# Generate all reports for all trials
npx ts-node src/cli/report.ts generate-all

# Generate all reports for specific trial
npx ts-node src/cli/report.ts generate-all --trial-id 1

# Generate specific report types
npx ts-node src/cli/report.ts session-sections --trial-id 1
npx ts-node src/cli/report.ts summary-lines --trial-id 1
npx ts-node src/cli/report.ts full-lines --trial-id 1 --section SUMMARY
npx ts-node src/cli/report.ts statistics --trial-id 1

# List available trials
npx ts-node src/cli/report.ts list-trials

# Custom output directory
npx ts-node src/cli/report.ts generate-all --output ./custom/output/dir
```

## Output Structure

```
/output/reports/phase1/
  /01_Genband/
    01_Genband_2016-01-11_morning_sections.txt
    01_Genband_2016-01-11_morning_summary.txt
    01_Genband_2016-01-11_morning_summary_lines.txt
    01_Genband_2016-01-11_morning_proceedings_lines.txt
    01_Genband_2016-01-11_afternoon_sections.txt
    01_Genband_2016-01-11_afternoon_summary.txt
    01_Genband_2016-01-11_afternoon_summary_lines.txt
    01_Genband_2016-01-11_afternoon_proceedings_lines.txt
    01_Genband_statistics.md
  /02_Contentguard/
    [similar structure]
  /[other trials]/
    [similar structure]
```

## Database Schema Used

### Phase 1 Tables
- `Trial` - Trial metadata
- `Session` - Court sessions with dates and types
- `SessionSection` - Parsed sections (summary, proceedings, etc.)
- `Page` - Page boundaries
- `Line` - Individual lines with text and metadata
- `Statement` - Parsed statements with speaker attribution
- `Speaker` - Identified speakers

## Sample Output

### SessionSection Report Sample
```
Trial: 01 Genband (2:14-CV-00033-JRG)
Session: 2016-01-11 - MORNING
File: Genband_January 11, 2016 AM.txt
================================================================================

Section Type: SUMMARY
----------------------------------------
IN THE UNITED STATES DISTRICT COURT
FOR THE EASTERN DISTRICT OF TEXAS
MARSHALL DIVISION

GENBAND US LLC,
    Plaintiff,
v.
METASWITCH NETWORKS CORP., et al.,
    Defendants.

Case No. 2:14-CV-00033-JRG

================================================================================
```

### Summary Lines Report Sample (Clean Text)
```
IN THE UNITED STATES DISTRICT COURT
FOR THE EASTERN DISTRICT OF TEXAS
MARSHALL DIVISION
GENBAND US LLC,
Plaintiff,
v.
METASWITCH NETWORKS CORP., et al.,
Defendants.
Case No. 2:14-CV-00033-JRG
TRANSCRIPT OF JURY VOIR DIRE
BEFORE THE HONORABLE J. RODNEY GILSTRAP
UNITED STATES DISTRICT JUDGE
```

### Statistics Report Sample
```markdown
# Trial Statistics: 01 Genband
Case Number: 2:14-CV-00033-JRG

## Session Summary

| Date | Type | Pages | Lines | Statements | Speakers | Sections |
|------|------|-------|-------|------------|----------|----------|
| 2016-01-11 | MORNING | 126 | 3207 | 245 | 18 | SUMMARY, PROCEEDINGS, CERTIFICATION |
| 2016-01-11 | AFTERNOON | 178 | 4521 | 412 | 22 | SUMMARY, PROCEEDINGS, CERTIFICATION |

## Totals
- Sessions: 2
- Total Pages: 304
- Total Lines: 7728
- Total Statements: 657
- Average Lines/Page: 25
```

## Integration with Feature 02W

The reporting system provides structured output optimized for LLM processing:

1. **Clean Text Extraction**: Summary reports remove all parsing artifacts
2. **Structured Metadata**: Full reports maintain line numbers and sections for reference
3. **Session Segmentation**: Natural boundaries for context windowing
4. **Speaker Attribution**: Preserved in database for dialogue extraction

## Phase 2 Report Specifications

### Phase 2 Data Model
Phase 2 processes trial events and enriches the data with:
- **TrialEvent** - Base event table for all trial activities
- **StatementEvent** - Q&A exchanges, objections, statements
- **CourtDirectiveEvent** - Judge instructions and rulings
- **Speaker** - Resolved speakers from Q&A patterns
- **Witness** - Identified witnesses with examination tracking
- **Attorney** - Attorneys with roles and associations
- **Judge** - Presiding judge information

### Phase 2 Reports

#### 1. Event Timeline Report
**Purpose**: Chronological view of all trial events
**Content**:
- Event type, time, duration
- Speaker identification
- Event content summary
- Session and page references

#### 2. Speaker Activity Report
**Purpose**: Analysis of speaker participation
**Content**:
- Total speaking events per speaker
- Speaking time distribution
- Q&A interaction patterns
- Role-based breakdown (Attorney, Witness, Judge)

#### 3. Examination Report
**Purpose**: Witness examination tracking
**Content**:
- Witness called events
- Direct/Cross examination sequences
- Examining attorney identification
- Q&A pairs with speaker attribution

#### 4. StatementEvent Distribution by Speaker (Trial-Level)
**Purpose**: Statistical analysis of speaking patterns per individual speaker across entire trial
**Filename Format**: `{caseHandle}_speaker_distribution.csv`
**Content**: For each speakerAlias:
- Speaker name/alias
- Line count statistics (max, min, mean, median)
- Word count statistics (max, min, mean, median)
- Total statements
- Speaker role/type

#### 5. StatementEvent Distribution by Speaker Type (Session-Level)
**Purpose**: Statistical analysis of speaking patterns by speaker type per session
**Filename Format**: `{caseHandle}_{sessionDate}_{sessionType}_speaker_type_distribution.csv`
**Content**: For each speakerType (ATTORNEY, WITNESS, JUDGE, COURT_REPORTER, etc.):
- Speaker type
- Line count statistics (max, min, mean, median)
- Word count statistics (max, min, mean, median)
- Total statements by type
- Number of unique speakers in type

## Testing the Implementation

```bash
# 1. Ensure database is populated with Phase 1 data
# (Already done - 5 trials loaded)

# 2. List available trials
npx ts-node src/cli/report.ts list-trials

# 3. Generate reports for first trial
npx ts-node src/cli/report.ts generate-all --trial-id 1

# 4. Generate reports for all trials
npx ts-node src/cli/report.ts generate-all

# 5. Check output directory
ls -la output/reports/phase1/
```

## Success Criteria
✅ Hierarchical queries retrieve Phase 1 data accurately
✅ Reports generate unique files per Trial/Session
✅ Clean text extraction removes artifacts
✅ Statistics provide accurate counts
✅ CLI commands work for single and batch processing
✅ Output suitable for Feature 02W LLM processing

## Dependencies
- Phase 1 database schema and data
- Prisma ORM for database queries
- Commander for CLI interface
- fs-extra for file operations

## Next Steps for Feature 02W
1. Use clean summary text as LLM input
2. Process session sections for structured analysis
3. Extract speaker dialogues for conversation analysis
4. Apply LLM enhancement to improve data quality