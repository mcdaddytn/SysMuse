# Feature 02K: Enhanced Speaker Identification with Multi-Trial Support

## Overview
Implement comprehensive speaker identification in the multi-pass parser that:
1. Restores legacy functionality for identifying attorneys, law firms, and court participants
2. Adds support for multiple trials in the same database
3. Handles Q&A format variations commonly found in witness examinations and depositions
4. Provides proper speaker resolution and matching within trial boundaries

## Problem Statement

### Current Issues
1. **Phase 2 Not Matching Speakers**: The multi-pass parser is not properly identifying and matching speakers during phase 2 processing
2. **Missing Court Participant Parsing**: Attorneys, law firms, and other court participants are not being extracted from the summary section
3. **No Multi-Trial Support**: Current speaker identification doesn't segment speakers by trial, causing potential cross-trial contamination
4. **Limited Q&A Format Support**: The parser doesn't handle common Q&A variations found in witness examinations and depositions

### Specific Requirements
- Match speakers like "THE COURT", attorneys, jurors, and witnesses during phase 2
- Parse attorneys and law firms from the summary section (legacy functionality)
- Ensure speakers are matched only within their trial context
- Support Q&A format variations including Q., A., QUESTION:, ANSWER:, etc.
- Handle video deposition formats with THE ATTORNEY: and THE WITNESS:

## Technical Design

### Database Schema Considerations

#### Current Schema
- `Speaker` table has `trialId` field for trial association
- `Attorney`, `Witness`, `Juror` tables all have `trialId` fields
- `TrialAttorney` junction table links attorneys to trials with roles
- All speaker-related entities can be properly segmented by trial

#### Required Updates
- No schema changes needed - existing structure supports multi-trial
- Ensure all speaker lookups include `trialId` in WHERE clauses
- Maintain speaker uniqueness within trial boundaries

### Speaker Identification Pipeline

#### Phase 1: Summary Section Parsing
1. **Attorney Extraction**
   - Parse attorney names from "APPEARANCES:" section
   - Extract law firm associations
   - Identify attorney roles (plaintiff/defendant)
   - Create Speaker and Attorney records with trial association

2. **Judge Identification**
   - Extract judge name from "BEFORE THE HONORABLE" pattern
   - Create Speaker record with type JUDGE
   - Associate with trial

3. **Court Reporter Extraction**
   - Parse court reporter name and credentials
   - Store with trial association

#### Phase 2: Content Processing
1. **Speaker Resolution**
   - Match speaker prefixes to existing speakers within trial
   - Create new speakers as needed with proper trial association
   - Handle contextual speakers (Q., A., etc.)

2. **Q&A Format Handling**
   - Maintain examination context (current witness, examining attorney)
   - Map Q&A variations to appropriate speakers
   - Track examination type changes

### Speaker Pattern Recognition

#### Standard Speakers
```
THE COURT:          -> Judge
MR. SMITH:          -> Attorney (lookup by name within trial)
MS. JONES:          -> Attorney (lookup by name within trial)
JUROR NO. 5:        -> Juror
THE WITNESS:        -> Current witness on stand
```

#### Q&A Variations
```
Q.                  -> Examining attorney
A.                  -> Witness on stand
Q:                  -> Examining attorney
A:                  -> Witness on stand
QUESTION:           -> Examining attorney
ANSWER:             -> Witness on stand
BY MR. SMITH:       -> Specific attorney (sets context)
```

#### Video Deposition Format
```
THE ATTORNEY:       -> Opposing counsel (not the examiner)
THE WITNESS:        -> Deponent
QUESTION:           -> Examining attorney
ANSWER:             -> Deponent
```

### Implementation Components

#### 1. Enhanced Summary Parser
```typescript
interface SummaryParser {
  parseAttorneys(lines: string[], trialId: number): Promise<Attorney[]>
  parseLawFirms(lines: string[], trialId: number): Promise<LawFirm[]>
  parseJudge(lines: string[], trialId: number): Promise<Judge>
  parseCourtReporter(lines: string[], trialId: number): Promise<CourtReporter>
}
```

#### 2. Speaker Registry
```typescript
class SpeakerRegistry {
  private trialId: number
  private speakers: Map<string, Speaker>
  private contextualSpeakers: Map<string, Speaker>
  
  async findOrCreateSpeaker(prefix: string, type: SpeakerType): Promise<Speaker>
  async resolveContextualSpeaker(prefix: string, context: ExaminationContext): Promise<Speaker>
  setCurrentWitness(witness: Witness): void
  setExaminingAttorney(attorney: Attorney): void
}
```

#### 3. Examination Context Manager
```typescript
interface ExaminationContext {
  currentWitness: Witness | null
  examiningAttorney: Attorney | null
  opposingAttorney: Attorney | null
  examinationType: 'DIRECT' | 'CROSS' | 'REDIRECT' | 'RECROSS' | null
  isVideoDeposition: boolean
}

class ExaminationContextManager {
  updateFromLine(line: ParsedLine): void
  resolveQSpeaker(): Speaker | null
  resolveASpeaker(): Speaker | null
  resolveTheAttorney(): Speaker | null
}
```

#### 4. Multi-Trial Speaker Service
```typescript
class MultiTrialSpeakerService {
  async createSpeaker(data: SpeakerData, trialId: number): Promise<Speaker>
  async findSpeaker(prefix: string, trialId: number): Promise<Speaker | null>
  async findAttorneyByName(name: string, trialId: number): Promise<Attorney | null>
  async associateAttorneyWithTrial(attorneyId: number, trialId: number, role: AttorneyRole): Promise<void>
}
```

### Processing Flow

#### Phase 1 Processing
1. Read transcript file
2. Identify summary section
3. Parse court participants:
   - Extract attorneys with law firm associations
   - Identify judge
   - Extract court reporter
4. Create database records with trial association
5. Build initial speaker registry for trial

#### Phase 2 Processing
1. Load speaker registry for specific trial
2. Initialize examination context
3. For each line with speaker prefix:
   - Check for examination markers (BY MR. X:, DIRECT EXAMINATION, etc.)
   - Update examination context
   - Resolve speaker based on prefix and context
   - Create statement event with correct speaker association
4. Handle Q&A format:
   - Map Q variations to examining attorney
   - Map A variations to current witness
   - Handle special cases (THE ATTORNEY in depositions)

### Pattern Definitions

#### Speaker Patterns
```typescript
const SPEAKER_PATTERNS = {
  // Standard speakers with colon
  standard: /^([A-Z][A-Z\s\.,'-]+?):\s*/,
  
  // Q&A variations
  questionShort: /^Q\.\s*/,
  questionLong: /^QUESTION:\s*/,
  answerShort: /^A\.\s*/,
  answerLong: /^ANSWER:\s*/,
  
  // Contextual speakers
  theWitness: /^THE WITNESS:\s*/,
  theCourt: /^THE COURT:\s*/,
  theAttorney: /^THE ATTORNEY:\s*/,
  
  // Attorney introduction
  byAttorney: /^BY\s+(MR\.|MS\.|MRS\.|DR\.)\s+([A-Z]+):\s*/,
  
  // Juror patterns
  juror: /^(JUROR\s+(?:NO\.\s+)?[A-Z0-9]+):\s*/,
}
```

#### Examination Patterns
```typescript
const EXAMINATION_PATTERNS = {
  // Examination type markers
  directExam: /DIRECT\s+EXAMINATION/,
  crossExam: /CROSS[\s-]EXAMINATION/,
  redirectExam: /REDIRECT\s+EXAMINATION/,
  recrossExam: /RECROSS\s+EXAMINATION/,
  
  // Witness markers
  witnessCall: /^([A-Z\s]+),\s+(PLAINTIFF'S|DEFENDANT'S)\s+WITNESS/,
  swornStatus: /(PREVIOUSLY\s+)?SWORN/,
  
  // Deposition markers
  videoDeposition: /VIDEO\s+DEPOSITION|PRESENTED\s+BY\s+VIDEO/,
}
```

### Error Handling

#### Speaker Not Found
- Log warning with speaker prefix and trial ID
- Create anonymous speaker with descriptive handle
- Track unmatched speakers for reporting

#### Ambiguous Q&A Context
- If no current witness: create placeholder witness
- If no examining attorney: use last known attorney or create placeholder
- Log context issues for manual review

#### Cross-Trial Contamination Prevention
- Always include trialId in database queries
- Validate trial association before speaker matching
- Separate speaker registries per trial

## Implementation Steps

### Step 1: Summary Parser Enhancement
1. Implement attorney extraction from APPEARANCES section
2. Add law firm parsing and association
3. Restore judge and court reporter extraction
4. Create proper database records with trial association

### Step 2: Speaker Registry Implementation
1. Create SpeakerRegistry class with trial scoping
2. Implement speaker lookup with trial boundaries
3. Add contextual speaker resolution
4. Build speaker cache for performance

### Step 3: Q&A Format Support
1. Implement ExaminationContextManager
2. Add Q&A pattern recognition
3. Handle video deposition format
4. Map variations to correct speakers

### Step 4: Phase 2 Integration
1. Integrate speaker registry with Phase2Processor
2. Update statement event creation with proper speakers
3. Add examination context tracking
4. Implement witness testimony handling

### Step 5: Multi-Trial Support
1. Update all speaker queries to include trialId
2. Implement trial-scoped speaker services
3. Add trial validation to speaker operations
4. Test with multiple trials in database

## Testing Requirements

### Unit Tests
1. Attorney extraction from various summary formats
2. Q&A pattern recognition and mapping
3. Speaker resolution within trial boundaries
4. Examination context management

### Integration Tests
1. Full summary parsing with database persistence
2. Phase 2 processing with speaker matching
3. Multi-trial speaker isolation
4. Q&A format handling in witness testimony

### Test Scenarios
1. **Standard Trial**: Regular trial with attorneys, judge, witnesses
2. **Video Deposition**: Deposition with THE ATTORNEY/THE WITNESS format
3. **Multiple Trials**: Two trials with overlapping attorney names
4. **Complex Examination**: Mixed Q&A formats within single examination
5. **Anonymous Speakers**: Unidentified speakers and their handling

## Success Criteria

1. **Speaker Matching**: 95% of speakers correctly identified and matched
2. **Q&A Resolution**: All Q&A variations properly mapped to speakers
3. **Trial Isolation**: No cross-trial speaker contamination
4. **Legacy Parity**: All legacy parser speaker features restored
5. **Performance**: Speaker resolution adds < 10% to phase 2 processing time

## Migration Considerations

### From Legacy Parser
1. Ensure all attorney extraction logic is preserved
2. Maintain backward compatibility with existing data
3. Preserve speaker prefix formats

### Database Migration
- No schema changes required
- Existing data compatible with enhanced system
- Can run alongside legacy parser during transition

## Future Enhancements

1. **Machine Learning Speaker Resolution**: Use ML to resolve ambiguous speakers
2. **Speaker Aliases**: Support multiple names/titles for same speaker
3. **Cross-Examination Tracking**: Detailed tracking of examination flow
4. **Speaker Statistics**: Analytics on speaker participation and patterns
5. **Automatic Q&A Detection**: Detect Q&A format without explicit markers