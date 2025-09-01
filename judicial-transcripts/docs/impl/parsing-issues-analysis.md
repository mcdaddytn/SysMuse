# Parsing Issues Analysis - Phase 1 Multi-Trial Processing

## Date: September 1, 2025

## Overview
After implementing multi-trial parsing with improved summary parsing (feature-02R), several critical issues remain that affect data quality and completeness. This document analyzes these issues and proposes solutions.

## Critical Issues

### 1. Complex Multi-Party Plaintiff Parsing (Trial ID=4 - Optis)

**Current Result:**
```
Plaintiff: OPTIS WIRELESS TECHNOLOGY, LLC, ET AL
Defendant: 2:19-CV-66-JRG AUGUST 3, 2020 APPLE INC.
```

**Problem:**
- The plaintiff field contains multiple entities separated by commas
- Our VS. delimiter parsing is getting confused by the commas
- The defendant field includes case number and date

**Example Raw Text:**
```
OPTIS WIRELESS TECHNOLOGY, LLC,    )(    2:19-CV-66-JRG
OPTIS CELLULAR TECHNOLOGY, LLC,    )(    
UNWIRED PLANET, LLC,                )(    AUGUST 3, 2020
UNWIRED PLANET INTERNATIONAL       )(
LIMITED, AND                        )(    TYLER, TEXAS
PANOPTIS PATENT MANAGEMENT, LLC    )(    8:30 A.M.
VS.                                 )(
APPLE INC.                          )(
```

**Root Cause:**
- The left side has multiple plaintiff entities on separate lines
- Each entity has a trailing comma except the last
- "ET AL" is being incorrectly added
- The VS. detection happens after aggregation, losing the structure

**Solution:**
- Detect multi-line plaintiff patterns before aggregation
- Preserve entity boundaries during left-side processing
- Handle "AND" as a continuation marker
- Clean up trailing commas per entity, not after aggregation

### 2. Session Date Parsing Failures

**Current State:**
- Many sessions have default/placeholder dates (current date)
- Dates are available in filenames OR summaries but not being extracted

**Filename Date Patterns:**
```
Pattern 1: "held on MM_DD_YY" 
Example: "held on 10_1_20" = October 1, 2020

Pattern 2: Document ID format (harder)
Example: "d74990699e16592" - encoded date

Pattern 3: Date in summary only (50 Packet Netscout)
Example: Summary contains "OCTOBER 10, 2017"
```

**Issues:**
- Filename parser assumes 20XX for YY format, but some are 2015-2017
- Not falling back to summary date when filename parsing fails
- Not updating all sessions with same date from summary

**Solution:**
- Improve filename date parsing with smarter year detection
- Always extract date from summary as fallback
- Update all sessions for a trial day when date is found
- Handle different date formats in summaries

### 3. Missing Start Times

**Current State:**
- Start times are being extracted but not consistently applied
- Some sessions missing times despite being in summary

**Location in Summary:**
```
Right side: "8:36 A.M." or "12:19 P.M."
Sometimes: "Morning Session" without specific time
```

**Solution:**
- Ensure start time extraction happens for every session
- Default morning sessions to 9:00 AM if no specific time
- Default afternoon sessions to 1:30 PM if no specific time
- Parse various time formats (AM/PM, a.m./p.m., etc.)

### 4. Document Number Not Extracted

**Current Location:**
Page headers contain document numbers in various formats:
```
Format 1: "Case 2:16-cv-00230-JRG Document 244 Filed 10/17/17"
Format 2: "Document XXX" 
Format 3: Embedded in longer string
```

**Solution:**
- Extract during page header processing
- Pattern: "Document (\d+)"
- Store in Session.documentNumber or Page metadata

### 5. Page.pageId Not Parsed

**Current State:**
- Page.pageId is null for all pages
- Page number is available in headerText

**Example headerText:**
```
"Case 2:16-cv-00230-JRG Document 244 Filed 10/17/17 Page 2 of 131 PageID #: 16221"
```

**Pattern:**
```
"PageID #: (\d+)" or "PageID#: (\d+)"
```

**Solution:**
- Extract during page creation in MultiPassContentParser
- Simple regex extraction from headerText
- Store as integer in Page.pageId field

## Data Quality Summary

### Current Extraction Success Rates (5 Trials, 64 Sessions)

| Field | Success Rate | Notes |
|-------|--------------|-------|
| Trial.name | 80% | Issues with complex multi-party cases |
| Trial.plaintiff | 80% | Same issues as name |
| Trial.defendant | 80% | Same issues as name |
| Trial.caseNumber | 100% | Working well |
| Session.sessionDate | ~30% | Major issue - many placeholders |
| Session.startTime | ~20% | Extracted but not stored correctly |
| Session.documentNumber | 0% | Not implemented |
| Page.pageId | 0% | Not implemented |

## Proposed Solutions Priority

### High Priority (Data Integrity)
1. **Fix session dates** - Critical for chronological ordering
2. **Fix Optis plaintiff/defendant** - Wrong party names is unacceptable
3. **Implement JSON override system** - Safety net for production deadline

### Medium Priority (Completeness)
4. **Extract document numbers** - Important for legal references
5. **Extract page IDs** - Needed for precise citations
6. **Fix start times** - Useful for session identification

### Implementation Strategy

#### Phase 1: Quick Fixes
- Improve date parsing from filenames
- Fix multi-party plaintiff parsing
- Extract pageId from headers

#### Phase 2: Override System
- Design JSON schema for overrides
- Implement import utility
- Create validation system

#### Phase 3: Refinements
- Document number extraction
- Start time improvements
- Additional validation

## Example Override JSON Structure

```json
{
  "trial": {
    "id": 4,
    "updates": {
      "plaintiff": "OPTIS WIRELESS TECHNOLOGY, LLC, OPTIS CELLULAR TECHNOLOGY, LLC, UNWIRED PLANET, LLC, UNWIRED PLANET INTERNATIONAL LIMITED, AND PANOPTIS PATENT MANAGEMENT, LLC",
      "defendant": "APPLE INC.",
      "name": "OPTIS WIRELESS TECHNOLOGY, LLC, ET AL v. APPLE INC."
    }
  },
  "sessions": [
    {
      "id": 35,
      "updates": {
        "sessionDate": "2020-08-03",
        "startTime": "08:30:00",
        "documentNumber": "1423"
      }
    }
  ],
  "pages": [
    {
      "id": 10234,
      "updates": {
        "pageId": 16221
      }
    }
  ]
}
```

## Testing Requirements

1. Verify all 5 trials have correct party names
2. Confirm session dates are not placeholders
3. Check start times are populated
4. Validate pageId extraction
5. Test override system with sample data

## Success Criteria

- 100% correct party names for all trials
- 95%+ session dates correctly parsed
- 90%+ start times extracted
- 100% pageIds extracted from headers
- Override system can fix any remaining issues

## Next Steps

1. Create feature-02S specification
2. Implement party name parsing fixes
3. Improve date extraction logic
4. Build override import system
5. Test on all 5 trials
6. Prepare for 60+ trial processing