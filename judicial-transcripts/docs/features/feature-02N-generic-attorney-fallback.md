# Feature 02N: Generic Attorney Fallback for Q&A Attribution

## Problem Statement
In many transcripts, especially video depositions and some trial sessions, we don't always have explicit "BY MR./MS. [NAME]" indicators to identify which attorney is conducting the examination. This leads to unattributed Q&A exchanges where we cannot determine the specific attorney asking questions.

## Proposed Solution

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

1. **Database Changes**:
   - Add `isGeneric` boolean field to Speaker table
   - Add `originalSpeakerId` to StatementEvent for audit trail
   - Add `partySide` enum to Attorney table ('plaintiff', 'defense', 'other')

2. **Phase 2 Processing Updates**:
   - Initialize generic attorneys at start of processing
   - Track examination state throughout session
   - Apply fallback logic when specific attorney not found

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

1. Trial transcript with complete "BY MR." patterns (current case)
2. Video deposition without attorney indicators
3. Mixed transcript with some sessions having indicators, others not
4. Transcript with different Q&A patterns (Q: vs Q. etc.)
5. Multiple attorneys per side switching examination

## Success Metrics

- 100% of Q. patterns attributed to an attorney (specific or generic)
- 100% of A. patterns attributed to a witness
- Correct side attribution based on examination type
- Easy bulk correction of generic attributions

## Future Enhancements

1. **ML-based Attorney Recognition**: Use writing style analysis to identify specific attorneys
2. **Cross-reference with Attorney Lists**: Match generic attributions to known attorneys post-processing
3. **Interactive Correction UI**: Web interface for human review and correction
4. **Confidence Scoring**: Rate confidence of attributions for review prioritization