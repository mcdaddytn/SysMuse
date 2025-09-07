# Feature-02Z: Enhanced Speaker Extraction and Line Number Tracking for Marker Detection

## Overview
Enhance the parsing system to extract additional speakers (specifically THE FOREPERSON), calculate comprehensive line numbering across different scopes (session and trial), and prepare the data model for sophisticated marker detection and search capabilities.

## Business Value
- Enables identification of critical trial moments (verdict readings) through foreperson speaker recognition
- Provides flexible line number referencing for marker placement and search
- Prepares foundation for automated and manual marker detection systems
- Supports LLM and human operator marker placement through precise location references

## Requirements

### 1. Enhanced Speaker Extraction

#### 1.1 THE FOREPERSON Recognition
- **Parser Enhancement**: Add explicit pattern recognition for "THE FOREPERSON:" in speaker extraction
- **Database Storage**: Store as Juror record with:
  - `alias`: "THE FOREPERSON"
  - `name`: "THE"
  - `lastName`: "FOREPERSON"
  - `speakerType`: JUROR
- **Pattern Priority**: Place THE FOREPERSON pattern before generic capitalized pattern in regex list

#### 1.2 Parser Implementation
- Update `TranscriptParser.extractSpeakerFromText()` method
- Add pattern: `/^\s*(THE FOREPERSON):\s*(.*)$/`
- Ensure pattern is positioned correctly in pattern hierarchy

### 2. Comprehensive Line Numbering

#### 2.1 Session Line Numbers
- **Field**: `sessionLineNumber` (already exists in Line table)
- **Calculation**: Sequential numbering within each session
  - Starts at 1 for each new session
  - Increments across all pages within the session
  - Independent of trial-wide numbering
- **Scope**: Single session (Morning/Afternoon on a given date)

#### 2.2 Trial Line Numbers (Existing)
- **Field**: `trialLineNumber` (already calculated)
- **Scope**: Entire trial across all sessions and pages

#### 2.3 Page Line Numbers (Existing)
- **Field**: `lineNumber` (already calculated)
- **Scope**: Single page

### 3. Session Handle Implementation

#### 3.1 Session Table Enhancement
- **New Field**: `sessionHandle` (string)
- **Format**: `YYYYMMDD_[sessionType]`
- **Example**: `20201009_MORNING` or `20201009_AFTERNOON`
- **Purpose**: Single field selector for sessions within trial

### 4. TrialEvent Line Number Tracking

#### 4.1 New Fields for TrialEvent Table
- `startSessLineNum`: Session line number of event start
- `endSessLineNum`: Session line number of event end
- `startTrialLineNum`: Trial line number of event start
- `endTrialLineNum`: Trial line number of event end

#### 4.2 Calculation Logic
- Pull from corresponding Line records at event boundaries
- Map existing startLineNumber/endLineNumber to new fields
- Maintain consistency across all line number types

## Technical Implementation

### Database Schema Changes

```prisma
// Update Session model
model Session {
  // existing fields...
  sessionHandle  String?  // New field: YYYYMMDD_[sessionType]
}

// Update TrialEvent model
model TrialEvent {
  // existing fields...
  startSessLineNum   Int?  // Session line number at start
  endSessLineNum     Int?  // Session line number at end
  startTrialLineNum  Int?  // Trial line number at start
  endTrialLineNum    Int?  // Trial line number at end
}
```

### Parser Updates

1. **Speaker Extraction** (TranscriptParser.ts)
   - Add THE FOREPERSON pattern to speaker regex list
   - Ensure proper pattern ordering for match priority

2. **Line Number Calculation** (Phase1 and Phase2)
   - Calculate sessionLineNumber during line processing
   - Track line count within session boundaries
   - Reset counter at session transitions

3. **Session Handle Generation**
   - Format date as YYYYMMDD
   - Append sessionType with underscore separator
   - Store during session creation/update

4. **TrialEvent Enhancement**
   - Query Line records at event boundaries
   - Extract all line number types
   - Populate new fields during event creation

## Search Expression Support

### Line Number Reference Types

1. **Trial Line Number Only**
   - Required: `trialLineNumber`
   - Scope: Entire trial
   - Example: Find line 15234 in trial

2. **Session Line Number**
   - Required: `sessionHandle`, `sessionLineNumber`
   - Scope: Specific session
   - Example: Find line 450 in session "20201009_MORNING"

3. **Page Line Number**
   - Required: `sessionHandle`, `pageNumber`, `lineNumber`
   - Scope: Specific page
   - Example: Find line 15 on page 125 of session "20201009_AFTERNOON"

## Testing Requirements

### Validation Queries
```sql
-- Verify foreperson extraction
SELECT * FROM "Juror" WHERE alias = 'THE FOREPERSON';

-- Check session line numbering
SELECT "sessionLineNumber", "trialLineNumber", text 
FROM "Line" 
WHERE "sessionId" = [test_session_id]
ORDER BY "sessionLineNumber";

-- Validate session handles
SELECT id, "sessionHandle", date, "sessionType" 
FROM "Session" 
WHERE "trialId" = [test_trial_id];

-- Verify TrialEvent line numbers
SELECT id, "startLineNumber", "startSessLineNum", "startTrialLineNum"
FROM "TrialEvent" 
WHERE "trialId" = [test_trial_id];
```

## Implementation Order

1. **Schema Updates**
   - Add sessionHandle to Session model
   - Add line number fields to TrialEvent model
   - Run `npx prisma db push --force-reset` (full database rebuild required)

2. **Parser Enhancements**
   - Update speaker extraction patterns for THE FOREPERSON
   - Implement session line number calculation
   - Generate session handles during parsing
   - Update TrialEvent population with all line number fields

3. **Testing and Validation**
   - Reparse sample trials from scratch
   - Run validation queries
   - Verify foreperson extraction and line numbering

## Dependencies
- Existing Line, Session, and TrialEvent tables
- Phase1 and Phase2 processing pipelines
- Speaker extraction system
- Juror management system

## Success Criteria
- THE FOREPERSON successfully extracted as speaker
- All Line records have sessionLineNumber populated
- All Session records have sessionHandle populated
- All TrialEvent records have complete line number fields
- Search expressions can locate events using any line number type
- Marker detection system can reference events precisely

## Future Enhancements
- Additional speaker patterns for other court officials
- Cross-reference validation for line numbers
- Performance optimization for line number queries
- Extended search expression syntax
- Integration with accumulator engine for speaker-based markers