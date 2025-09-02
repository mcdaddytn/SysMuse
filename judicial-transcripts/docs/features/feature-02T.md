# Feature-02T: Trial Data Override System

## Overview
Implement a comprehensive override system that allows manual correction of parsed data at various entity levels (Trial, Session, Page, Line) using configuration files. This feature addresses edge cases and outliers in the 60+ trial dataset where manual intervention is more practical than parser improvements.

## Background
During implementation of feature-02S, we identified several trials with unique formatting that would benefit from manual overrides:
- **Packet trial**: Unique file naming without dates (only document IDs)
- **Optis trial**: Multi-line plaintiff with "ET AL" breaking standard parsing
- **ContentGuard trial**: Consolidated cases with multiple defendants

Rather than complicate the parser for < 5% edge cases, we use targeted overrides.

## Requirements

### 1. Override Configuration Structure
Overrides are specified in `trialstyle.json` files within each trial directory:

```json
{
  "overrides": {
    "trial": {
      "name": "string",
      "plaintiff": "string", 
      "defendant": "string",
      "court": "string",
      "alternateCaseNumber": "string"
    },
    "sessions": [
      {
        "fileName": "string",        // Primary key
        "sessionDate": "YYYY-MM-DD",
        "sessionType": "MORNING|AFTERNOON|ALLDAY|EVENING|SPECIAL",
        "startTime": "string",
        "documentNumber": "number"
      }
    ],
    "pages": [
      {
        "sessionFileName": "string",  // Foreign key to session
        "pageNumber": "number",       // Combined key with session
        "pageId": "string",
        "documentNumber": "number"
      }
    ],
    "lines": [
      {
        "sessionFileName": "string",  // Foreign key to session
        "trialLineNumber": "number",  // Primary key within trial
        "speaker": "string",
        "speakerType": "string",
        "text": "string"
      }
    ]
  }
}
```

### 2. Key Selection Strategy

Each entity level requires different keys for record identification:

#### Trial Level
- **Key**: Implicit from trial directory context
- **Use Case**: Fixing consolidated cases, multi-party names
- **Example**: ContentGuard consolidated Samsung/Google cases

#### Session Level  
- **Primary Key**: `fileName` (always unique)
- **Alternative Keys**: `sessionDate` + `sessionType` (if both populated)
- **Use Case**: Correcting dates, session types
- **Example**: Packet trial missing dates in filenames

#### Page Level
- **Keys**: `sessionFileName` + `pageNumber`
- **Use Case**: Correcting pageId extraction
- **Example**: Non-standard PageID formats

#### Line Level
- **Keys**: `sessionFileName` + `trialLineNumber`  
- **Alternative**: `pageNumber` + `lineNumber`
- **Use Case**: Correcting speaker attribution
- **Example**: Misattributed questions/answers

### 3. Override Application Timing

Overrides should be applied at different phases:

1. **Trial overrides**: After trial creation/identification
2. **Session overrides**: After session creation but before parsing
3. **Page overrides**: After page extraction
4. **Line overrides**: After line parsing (Phase 2)

### 4. Implementation Approach

#### Phase 1: Trial and Session Overrides
```typescript
async function applyTrialOverrides(trialId: number, overrides: TrialOverrides) {
  if (overrides.trial) {
    await prisma.trial.update({
      where: { id: trialId },
      data: overrides.trial
    });
  }
}

async function applySessionOverrides(trialId: number, overrides: SessionOverrides[]) {
  for (const override of overrides) {
    const session = await prisma.session.findFirst({
      where: {
        trialId,
        fileName: override.fileName
      }
    });
    
    if (session) {
      await prisma.session.update({
        where: { id: session.id },
        data: {
          sessionDate: override.sessionDate ? new Date(override.sessionDate) : undefined,
          sessionType: override.sessionType,
          startTime: override.startTime,
          documentNumber: override.documentNumber
        }
      });
    }
  }
}
```

#### Phase 2: Page and Line Overrides
To be implemented after Phase 2 parsing improvements.

### 5. Current Implementation Status

#### Completed
- Override structure defined in `trialstyle.json` format
- Trial-level override examples created for Optis and ContentGuard
- Session-level override example created for Packet trial

#### Not Implemented
- Automatic override application during parsing
- Page and Line level overrides
- Override validation and error handling
- Override reporting/logging

### 6. Examples in Use

#### Optis Trial Override
```json
{
  "overrides": {
    "trial": {
      "name": "OPTIS WIRELESS TECHNOLOGY, LLC, ET AL VS. APPLE INC.",
      "plaintiff": "OPTIS WIRELESS TECHNOLOGY, LLC, ET AL",
      "defendant": "APPLE INC."
    }
  }
}
```

#### Packet Trial Override
```json
{
  "overrides": {
    "sessions": [
      {
        "fileName": "US_DIS_TXED_2_16cv230_d74990699e16592_NOTICE_OF_FILING_OF_OFFICIAL_TRANSCRIPT_of_Proceed.txt",
        "sessionDate": "2017-10-10",
        "sessionType": "MORNING"
      },
      // ... additional sessions
    ]
  }
}
```

## Benefits
1. **Simplicity**: Keeps parser logic simple for 95% of cases
2. **Flexibility**: Easy to fix outliers without code changes
3. **Maintainability**: Clear separation of parsing logic and manual corrections
4. **Scalability**: Can handle 60+ trials with minimal manual intervention

## Future Enhancements
1. GUI tool for override creation
2. Validation rules for override data
3. Bulk override import/export
4. Override audit trail
5. Automatic override suggestions based on parsing confidence scores