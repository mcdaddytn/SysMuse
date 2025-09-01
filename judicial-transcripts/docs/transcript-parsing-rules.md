# Transcript Parsing Rules

## CRITICAL: Session Ordering
Sessions MUST be processed in the following order:
1. **PRIMARY SORT: By Date** - Earlier dates ALWAYS come before later dates
2. **SECONDARY SORT: By Session Type within same date**:
   - Morning/AM sessions first
   - Afternoon/PM sessions second  
   - Special sessions (Bench Trial, Jury Verdict, etc.) last

**NEVER** process a later date before an earlier date, regardless of session type.

## Document Section Identification

### EXACT MATCH REQUIREMENTS
The following section headers are ALWAYS:
- In ALL CAPS
- On their own line (only whitespace before/after)
- Exact string matches (NO REGEX, NO CASE-INSENSITIVE)

#### CERTIFICATION Section
- **Exact string**: `CERTIFICATION`
- **Location**: Always at the end of the transcript
- **Content**: Contains court reporter's certification statement
- **Example**:
```
                        CERTIFICATION

       I HEREBY CERTIFY that the foregoing is a true and
  correct transcript from the record of proceedings in the
  above-entitled matter.
```

#### PROCEEDINGS Section  
- **Marker**: First timestamp in format `HH:MM:SS` (e.g., `09:24:54`)
- **Location**: After summary/header sections
- **Content**: Main trial transcript with timestamps and line numbers
- **Note**: May not have explicit "PROCEEDINGS" header

## Summary Section Parsing

### Center Delimiter
- **Purpose**: Separates left column (party names) from right column (case info)
- **Common delimiters**: 
  - `)(` - Most common in Lexis Nexis format
  - Must be auto-detected per trial
- **Detection**: Count occurrences in first 100 lines, use most frequent (minimum 5 occurrences)

### Left Side Content
- Plaintiff name(s)
- Defendant name(s)
- Party designations (PLAINTIFF, DEFENDANT)

### Right Side Content
- Civil Action Number (e.g., `2:19-CV-123-JRG`)
- Trial Location (e.g., `MARSHALL, TEXAS`)
- Trial Date (e.g., `OCTOBER 1, 2020`)
- Session Start Time (e.g., `9:24 A.M.`)

## SessionSection Types
The following are created from parsing the summary:
- `CASE_TITLE` - Full case title with parties
- `COURT_AND_DIVISION` - Court name and division
- `APPEARANCES` - Attorney appearances
- `COURT_PERSONNEL` - Court reporter, etc.
- `JUDGE_INFO` - Judge information
- `TRANSCRIPT_INFO` - Transcript type info
- `CIVIL_ACTION_NO` - Case number (from right side)
- `SESSION_START_TIME` - Start time (from right side)
- `TRIAL_DATE` - Date only, no location (from right side)
- `TRIAL_LOCATION` - City, State (from right side)
- `CERTIFICATION` - Reporter certification

**NEVER CREATE**: `PROCEEDINGS` as a SessionSection type

## File Naming Conventions

### DATEMORNAFT Pattern
- Format: `...held on MM_DD_YY (Trial Transcript - [Morning|Afternoon])...`
- Date extraction: `MM_DD_YY` → `20YY-MM-DD`
- Session type: Morning, Afternoon, or Special (for non-standard)

## Important Notes
1. **No vague pattern matching** - Use exact strings for section headers
2. **No case-insensitive matching** for major sections
3. **No regex** for simple string matching
4. **Always preserve original case** (VS. vs V.) in party names
5. **Session ordering by date is paramount** - never violate date order