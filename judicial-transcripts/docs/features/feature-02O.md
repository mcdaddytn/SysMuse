# Feature 02O: Multi-Trial Attorney Management and Generic Fallback

## Problem Statement

### 1. Multi-Trial Attorney Identification
When multiple trials exist in the same database:
- Same attorney may appear across different trials
- Attorneys may change law firms between trials
- Need to identify when it's the same attorney vs. different attorneys with similar names
- Speaker handles can incorrectly cross-reference between trials

### 2. Unattributed Q&A in Transcripts
Many transcripts lack explicit attorney attribution:
- Video depositions often omit "BY MR./MS. [NAME]" indicators
- Some trial sessions have bare Q. and A. patterns
- Currently results in unattributed questions in the database

## Requirements

### Part A: Attorney Fingerprinting and Deduplication

#### 1. Attorney Unique Identification
- Generate fingerprint from name components (firstName, lastName, middleInitial, suffix)
- Use Bar number as secondary validation when available
- Handle name variations (with/without middle initial)

#### 2. Database Schema Changes
```sql
ALTER TABLE "Attorney" ADD COLUMN "attorneyFingerprint" VARCHAR(255);
ALTER TABLE "Attorney" ADD INDEX idx_attorney_fingerprint (attorneyFingerprint);
```

#### 3. Cross-Trial Matching Logic
```typescript
interface AttorneyMatcher {
  generateFingerprint(attorneyInfo: AttorneyInfo): string;
  findExistingAttorney(fingerprint: string, barNumber?: string): Attorney | null;
  linkAttorneyAcrossTrials(attorneyId: number, trialId: number, role: string): void;
}
```

### Part B: Generic Attorney Fallback System

#### 1. Generic Speaker Creation
- Add `isGeneric` boolean field to Speaker table
- Create per-trial generic speakers:
  - PLAINTIFF_ATTORNEY (generic plaintiff counsel)
  - DEFENSE_ATTORNEY (generic defense counsel)

#### 2. Examination Context Tracking
Track examination state throughout testimony:
```typescript
interface ExaminationState {
  currentExaminer: 'plaintiff' | 'defense';
  currentExaminationType: ExaminationType;
  lastSpecificAttorney?: AttorneyInfo;
  witnessCalledBy: 'plaintiff' | 'defense';
}
```

#### 3. Attribution Logic
When encountering Q. without attorney context:
1. Check for specific attorney from recent "BY MR." pattern
2. If none, use examination state to determine side
3. Attribute to appropriate generic attorney
4. Mark with flag for potential future correction

### Part C: Enhanced Speaker Handle Management

#### 1. Trial-Scoped Handles
- Speaker handles remain unique within trial (current)
- Attorney records can be shared across trials (new)
- Prevent handle collisions between trials

#### 2. Attorney Association Query Support
Enable queries like:
```sql
-- Find all statements by attorney across all trials
SELECT t.name as trial, se.* 
FROM StatementEvent se
JOIN Speaker s ON se.speakerId = s.id
JOIN Attorney a ON s.attorneyId = a.id
JOIN Trial t ON s.trialId = t.id
WHERE a.attorneyFingerprint = ?
```

## Implementation Plan

### Phase 1: Attorney Fingerprinting
1. Add fingerprint field to Attorney table
2. Create fingerprint generation logic
3. Update AttorneyService to check for existing attorneys
4. Backfill fingerprints for existing attorneys

### Phase 2: Multi-Trial Support
1. Update MultiTrialSpeakerService for deduplication
2. Modify attorney creation to check across trials
3. Ensure proper trial-specific associations
4. Test with multiple trials

### Phase 3: Generic Fallback
1. Add isGeneric field to Speaker table
2. Create generic attorney speakers per trial
3. Implement examination state tracking
4. Add fallback attribution logic
5. Mark generic attributions for review

### Phase 4: Configuration Support
1. Add trialstyle.json support
2. Configure Q&A patterns per transcript
3. Support different examination markers
4. Allow disabling generic fallback

## Testing Requirements

### Multi-Trial Tests
1. Load two trials with overlapping attorneys
2. Verify same attorney is linked across trials
3. Verify different attorneys with same last name are separate
4. Test attorney changing firms between trials
5. Verify cross-trial queries work correctly

### Generic Fallback Tests
1. Process transcript without "BY MR." patterns
2. Verify Q. patterns attributed to generic attorneys
3. Verify correct side attribution based on examination
4. Test examination type transitions
5. Verify generic attribution flagging

### Configuration Tests
1. Test different Q&A pattern configurations
2. Verify pattern matching with various formats
3. Test enabling/disabling generic fallback
4. Verify configuration loading per transcript

## Success Metrics

### Multi-Trial Support
- Zero false-positive attorney matches across trials
- 100% accurate attorney identification within trials
- Successful cross-trial queries for same attorney
- No speaker handle collisions between trials

### Generic Attribution
- 100% of Q. patterns attributed (specific or generic)
- Correct side attribution based on examination type
- All generic attributions properly flagged
- Easy bulk correction of generic attributions

## Dependencies
- Feature 02N must be completed (law firm association)
- Database backup/restore for testing multiple trials
- Sample transcripts with different Q&A formats

## Migration Notes
- Existing attorneys will need fingerprint backfill
- Existing unattributed Q. patterns can be reprocessed
- Generic speakers can be added without breaking existing data

## Configuration Example

### trialstyle.json
```json
{
  "questionPattern": "Q\\.",
  "answerPattern": "A\\.",
  "alternateQuestionPatterns": ["Q:", "QUESTION:"],
  "alternateAnswerPatterns": ["A:", "ANSWER:"],
  "attorneyIntroPattern": "BY (MR\\.|MS\\.|MRS\\.|DR\\.) ([A-Z]+)",
  "enableGenericFallback": true,
  "defaultExaminerSide": "plaintiff"
}
```

## Related Features
- Feature 02N: Attorney association and law firms (prerequisite)
- Feature 03: Elastic Search integration (will use attorney associations)
- Feature 04: Export capabilities (will benefit from complete attribution)