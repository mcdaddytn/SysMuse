# Feature 02N: Attorney Association and Multi-Trial Support

## Problem Statement

### 1. Law Firm and Office Association
Attorney parsing currently identifies attorneys but doesn't consistently:
- Parse and associate law firm information from transcript headers
- Associate attorneys with their law firm offices
- Maintain these associations in the database

### 2. Unattributed Q&A Exchanges
In many transcripts, especially video depositions and some trial sessions, we don't always have explicit "BY MR./MS. [NAME]" indicators to identify which attorney is conducting the examination. This leads to unattributed Q&A exchanges where we cannot determine the specific attorney asking questions.

### 3. Multi-Trial Attorney Management
With multiple trials in the same database:
- Need to correctly identify if same attorney appears across trials
- Must maintain trial-specific law firm/office associations (attorneys may change firms)
- Ensure speaker handles don't cross-reference incorrectly between trials
- Enable cross-trial queries for same attorney (e.g., "all opening statements by Attorney X")

## Proposed Solution

### Part A: Law Firm and Office Parsing

#### 1. Enhanced Header Parsing
- Parse law firm names from transcript headers using existing `LawFirmDetector`
- Extract office locations when specified
- Associate parsed firms/offices with attorneys during initial parsing

#### 2. Attorney-Firm Association
- Store law firm and office per `TrialAttorney` record (already in schema)
- Maintain historical associations (attorney at Firm A for Trial 1, Firm B for Trial 2)
- Update `AttorneyService` to consistently save these associations

### Part B: Multi-Trial Attorney Identification

#### 1. Attorney Unique Identification
- Primary key: combination of name components (firstName, lastName, middleInitial, suffix)
- Secondary validation: Bar number when available
- Create `attorneyFingerprint` for cross-trial matching

#### 2. Speaker Handle Scoping
- Speaker handles remain trial-scoped (current behavior)
- Attorney records can be shared across trials
- `TrialAttorney` junction maintains trial-specific details:
  - Law firm at time of trial
  - Office location
  - Role in that specific trial

#### 3. Cross-Trial Query Support
```sql
-- Find all statements by attorney across trials
SELECT * FROM StatementEvent se
JOIN Speaker s ON se.speakerId = s.id
JOIN Attorney a ON s.attorneyId = a.id
WHERE a.id = ? -- Same attorney, different trials
```

### Part C: Generic Attorney Fallback (Original Feature)

### 1. Generic Attorney Speakers
Create two generic attorney speakers for each trial:
- `PLAINTIFF_ATTORNEY` - Generic placeholder for any plaintiff's attorney
- `DEFENSE_ATTORNEY` - Generic placeholder for any defense attorney

These would be created as special speakers in the database with:
- `speakerType`: ATTORNEY
- `isGeneric`: true (new field)
- Associated with the appropriate party side

### 2. Examination Context Tracking
Track which side is conducting direct examination throughout the trial:
- When a witness is called by PLAINTIFF, assume plaintiff's attorney conducts direct
- When a witness is called by DEFENDANT, assume defense attorney conducts direct
- Cross-examination switches to the opposing side
- Redirect returns to the original side
- Recross switches back to opposing side

### 3. Fallback Logic
When encountering Q. or QUESTION: patterns without a specific attorney context:
1. Check if we have a specific attorney set (from "BY MR." pattern)
2. If not, use the examination context to determine which side is questioning
3. Assign to the appropriate generic attorney (PLAINTIFF_ATTORNEY or DEFENSE_ATTORNEY)

### 4. Pattern Configuration
Support configurable Q&A patterns per transcript style:
- Current transcript: `Q.` and `A.`
- Alternative formats: `Q:` and `A:`
- Full words: `QUESTION:` and `ANSWER:`
- Configurable via `trialstyle.json` in the transcript folder

Example `trialstyle.json`:
```json
{
  "questionPattern": "Q.",
  "answerPattern": "A.",
  "attorneyIntroPattern": "BY (MR\\.|MS\\.|MRS\\.|DR\\.) ([A-Z]+)",
  "defaultExaminerSide": "plaintiff"
}
```

### 5. State Management
Maintain examination state throughout the trial:
```typescript
interface ExaminationState {
  currentExaminer: 'plaintiff' | 'defense';
  currentExaminationType: ExaminationType;
  lastSpecificAttorney?: AttorneyInfo;
  witnessCalledBy: 'plaintiff' | 'defense';
}
```

### 6. Side Switching Logic
```
Witness called by PLAINTIFF:
  - Direct: PLAINTIFF_ATTORNEY
  - Cross: DEFENSE_ATTORNEY
  - Redirect: PLAINTIFF_ATTORNEY
  - Recross: DEFENSE_ATTORNEY

Witness called by DEFENDANT:
  - Direct: DEFENSE_ATTORNEY
  - Cross: PLAINTIFF_ATTORNEY
  - Redirect: DEFENSE_ATTORNEY
  - Recross: PLAINTIFF_ATTORNEY
```

### 7. Human Correction Support
- All generic attorney attributions should be marked with a flag
- Support bulk reassignment of generic attorney statements to specific attorneys
- Maintain audit trail of original vs corrected attributions

## Implementation Notes

### Phase 1: Law Firm Association (Immediate Fix)
1. **Update Phase 1 Parsing**:
   - Use `LawFirmDetector` during header parsing
   - Extract firm names and office locations
   - Pass to `AttorneyService.createOrUpdateAttorney()`

2. **Fix `AttorneyService`**:
   - Ensure law firm/office IDs are properly saved to `TrialAttorney`
   - Add logging to verify associations

### Phase 2: Multi-Trial Support
1. **Database Changes**:
   - Add `attorneyFingerprint` field to Attorney table
   - Add index on fingerprint for fast lookups
   - Add `isGeneric` boolean field to Speaker table
   - Add `originalSpeakerId` to StatementEvent for audit trail
   - Add `partySide` enum to TrialAttorney table ('plaintiff', 'defense', 'other')

2. **Attorney Matching Logic**:
   ```typescript
   interface AttorneyMatcher {
     findOrCreateAttorney(trialId: number, attorneyInfo: AttorneyInfo): Attorney;
     matchAcrossTrials(attorney: Attorney): Attorney[];
     generateFingerprint(attorneyInfo: AttorneyInfo): string;
   }
   ```

3. **Update `MultiTrialSpeakerService`**:
   - Implement attorney deduplication logic
   - Maintain trial-specific associations
   - Prevent cross-trial speaker handle collisions

### Phase 3: Generic Attorney Fallback

4. **Phase 2 Processing Updates**:
   - Initialize generic attorneys at start of processing
   - Track examination state throughout session
   - Apply fallback logic when specific attorney not found
   - Maintain law firm associations throughout

3. **Configuration Loading**:
   - Check for `trialstyle.json` in transcript directory
   - Use defaults if not found
   - Validate pattern configurations

4. **Backwards Compatibility**:
   - Existing specific attorney detection remains primary
   - Generic fallback only used when specific detection fails
   - Can be disabled via configuration flag

## Benefits

1. **Complete Attribution**: Every Q&A exchange gets attributed to someone
2. **Logical Consistency**: Follows trial procedure rules for examination order
3. **Future Correction**: Easy to correct with human review
4. **Flexibility**: Handles different transcript formats via configuration
5. **Video Depositions**: Works for transcripts without "BY MR." patterns

## Testing Scenarios

### Law Firm Association
1. Transcript with law firms in header
2. Multiple attorneys from same firm
3. Attorney with firm and office location
4. Attorney without firm information

### Multi-Trial Support
1. Same attorney in multiple trials, same firm
2. Same attorney in multiple trials, different firms
3. Different attorneys with same last name
4. Attorney name variations (with/without middle initial)
5. Cross-trial queries for specific attorney

### Generic Attorney Fallback
1. Trial transcript with complete "BY MR." patterns (current case)
2. Video deposition without attorney indicators
3. Mixed transcript with some sessions having indicators, others not
4. Transcript with different Q&A patterns (Q: vs Q. etc.)
5. Multiple attorneys per side switching examination

## Success Metrics

### Law Firm Association
- 100% of attorneys have law firm when present in transcript
- Correct office association when specified
- Associations maintained in TrialAttorney records

### Multi-Trial Support  
- Zero false-positive attorney matches across trials
- 100% accurate attorney identification within trials
- Successful cross-trial queries for same attorney
- No speaker handle collisions between trials

### Generic Attribution
- 100% of Q. patterns attributed to an attorney (specific or generic)
- 100% of A. patterns attributed to a witness
- Correct side attribution based on examination type
- Easy bulk correction of generic attributions

## Future Enhancements

1. **ML-based Attorney Recognition**: Use writing style analysis to identify specific attorneys
2. **Cross-reference with Attorney Lists**: Match generic attributions to known attorneys post-processing
3. **Interactive Correction UI**: Web interface for human review and correction
4. **Confidence Scoring**: Rate confidence of attributions for review prioritization
5. **Attorney Profile Management**: UI for managing attorney profiles across trials
6. **Elastic Search Integration**: Index MarkerSection text with attorney associations for advanced search
7. **Attorney Analytics**: Track attorney performance metrics across trials

## Implementation Priority

1. **Immediate** (Before Feature 02N implementation):
   - Fix law firm/office parsing and association
   - Verify existing `AttorneyService` saves associations correctly
   - Test with existing transcripts that have firm information

2. **Phase 1** (Core Feature 02N):
   - Implement multi-trial attorney support
   - Add attorney fingerprinting and matching
   - Update speaker handle scoping

3. **Phase 2** (Enhancement):
   - Generic attorney fallback system
   - Examination state tracking
   - Configurable Q&A patterns

## Related Features
- Feature 02M: Regression fixes (completed)
- Feature 03: Elastic Search integration (will use attorney associations)
- Feature 04: Export capabilities (will need cross-trial attorney queries)