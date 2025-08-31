# Feature 02P: Multi-Trial Configuration and Generic Attorney Fallback

## Overview
Enable processing of multiple trials with trial-specific configurations, including Q&A pattern variations, speaker handle differences, and generic attorney fallback for unattributed questions.

## Current State
- **Existing**: PDF conversion phase generates `trialstyle.json` in output directories
- **Existing**: `fileConvention` parameter supports AUTO, DATEAMPM, DATEMORNAFT, DOCID patterns
- **Existing**: Attorney fingerprinting for cross-trial matching (Feature 02O)
- **Missing**: Q&A pattern configuration and variation support
- **Missing**: Generic attorney fallback implementation
- **Missing**: Multi-directory batch processing with trial isolation

## Requirements

### Part A: Enhanced Trial Configuration

#### 1. Q&A Pattern Configuration
Add to `trialstyle.json`:
```json
{
  "fileConvention": "AUTO",
  "questionPatterns": ["Q.", "Q:", "Q", "QUESTION:", "QUESTION"],
  "answerPatterns": ["A.", "A:", "A", "ANSWER:", "ANSWER"],
  "attorneyIndicatorPatterns": [
    "BY MR\\. ([A-Z]+)",
    "BY MS\\. ([A-Z]+)",
    "BY MRS\\. ([A-Z]+)",
    "BY DR\\. ([A-Z]+)",
    "^([A-Z]+):",  // For transcripts using "SMITH:" format
    "EXAMINATION BY ([A-Z]+)"
  ],
  "speakerHandleVariations": {
    "MR": ["MR.", "MR", "Mr.", "Mr"],
    "MS": ["MS.", "MS", "Ms.", "Ms"],
    "THE COURT": ["THE COURT", "COURT", "Judge"],
    "THE WITNESS": ["THE WITNESS", "WITNESS", "W"]
  },
  "enableGenericFallback": true,
  "genericFallbackConfig": {
    "plaintiffGenericName": "PLAINTIFF COUNSEL",
    "defenseGenericName": "DEFENSE COUNSEL",
    "assumeExaminerFromContext": true
  }
}
```

#### 2. Multi-Directory Processing
Command structure:
```bash
# Convert multiple trial directories
npm run convert-pdf-batch config/batch-trial-config.json

# Process with subdirectories
npm run convert-pdf config/trial-config.json --process-subdirs

# Each subdirectory gets its own trialstyle.json
```

#### 3. Trial Isolation
- Each trial's configuration only affects its own parsing
- Speaker handle variations are trial-scoped
- Q&A patterns are trial-specific
- No cross-contamination between trials

### Part B: Generic Attorney Fallback Implementation

#### 1. Generic Speaker Creation
During Phase 1 initialization:
```typescript
interface GenericSpeakers {
  plaintiffAttorney: Speaker;  // isGeneric = true
  defenseAttorney: Speaker;    // isGeneric = true
}

async function createGenericSpeakers(trialId: number): Promise<GenericSpeakers> {
  // Create PLAINTIFF_COUNSEL and DEFENSE_COUNSEL
  // Mark with isGeneric = true
}
```

#### 2. Q Pattern Detection and Attribution
```typescript
interface QADetector {
  isQuestionPattern(line: string, patterns: string[]): boolean;
  isAnswerPattern(line: string, patterns: string[]): boolean;
  getLastKnownAttorney(): Attorney | null;
  getCurrentExaminationType(): ExaminationType;
  attributeToGeneric(side: 'plaintiff' | 'defense'): Speaker;
}
```

#### 3. Examination Context Tracking
Enhanced from existing `ExaminationContextManager`:
```typescript
interface ExaminationState {
  currentWitness: Speaker | null;
  currentExaminer: Speaker | null;
  examinationType: ExaminationType;
  witnessCalledBy: 'plaintiff' | 'defense';
  lastSpecificAttorney: Attorney | null;
  usingGenericFallback: boolean;
}
```

#### 4. Attribution Logic Flow
1. Detect Q. pattern (using trial-specific patterns)
2. Look for recent "BY MR." attribution
3. If found → use specific attorney
4. If not found → check examination context:
   - Direct exam → use side that called witness
   - Cross exam → use opposite side
   - Redirect → use side that called witness
5. Mark with `originalSpeakerId` for audit trail

### Part C: Testing Configuration

#### 1. Test Trial Directories
Structure:
```
/test-trials/
  /trial-001-standard/    # Standard Q. and A. patterns
    trialstyle.json       # Generated, then modified
    *.txt                 # Converted transcripts
  /trial-002-colon/       # Uses Q: and A: patterns
    trialstyle.json
    *.txt
  /trial-003-mixed/       # Mixed patterns
    trialstyle.json
    *.txt
  /trial-004-no-by/       # No "BY MR." indicators
    trialstyle.json
    *.txt
```

#### 2. Pattern Testing Matrix
| Trial | Question | Answer | Attorney | Generic Needed |
|-------|----------|--------|----------|----------------|
| 001   | Q.       | A.     | BY MR.   | No             |
| 002   | Q:       | A:     | BY MS.   | No             |
| 003   | Q        | A      | SMITH:   | Sometimes      |
| 004   | QUESTION | ANSWER | None     | Yes            |

#### 3. Verification Queries
```sql
-- Check generic attorney usage
SELECT t.name as trial, s.speakerHandle, s.isGeneric, 
       COUNT(*) as statement_count
FROM Speaker s
JOIN StatementEvent se ON s.id = se.speakerId
JOIN Session sess ON se.eventId IN (
  SELECT id FROM TrialEvent WHERE sessionId = sess.id
)
JOIN Trial t ON sess.trialId = t.id
WHERE s.isGeneric = true
GROUP BY t.name, s.speakerHandle, s.isGeneric;

-- Check pattern recognition
SELECT DISTINCT 
  LEFT(se.text, 10) as pattern_start,
  s.speakerHandle,
  s.isGeneric
FROM StatementEvent se
JOIN Speaker s ON se.speakerId = s.id
WHERE se.text LIKE 'Q%' OR se.text LIKE 'A%'
ORDER BY pattern_start;
```

## Implementation Plan

### Phase 1: Configuration Enhancement
1. Update `trialstyle.json` schema with Q&A patterns
2. Add pattern configuration to PDF conversion phase
3. Implement pattern detection in file ordering logic
4. Generate trial-specific configs in output directories

### Phase 2: Pattern Detection
1. Create `QAPatternDetector` service
2. Update `LineParser` to use trial-specific patterns
3. Add pattern validation and AUTO detection
4. Test with various transcript formats

### Phase 3: Generic Attorney Implementation
1. Create generic speakers during trial initialization
2. Implement examination context tracking
3. Add fallback attribution logic
4. Mark generic attributions for review

### Phase 4: Multi-Trial Processing
1. Update convert-pdf for batch processing
2. Implement subdirectory iteration
3. Ensure trial isolation
4. Add progress reporting for batch operations

### Phase 5: Testing and Validation
1. Create test trial directories
2. Test each pattern variation
3. Verify generic fallback accuracy
4. Test cross-trial attorney matching

## File Changes Required

### New Files
- `src/services/QAPatternDetector.ts`
- `src/services/GenericSpeakerService.ts`
- `src/config/trialstyle-schema.json` (JSON schema for validation)

### Modified Files
- `src/cli/convert-pdf.ts` - Add batch processing
- `src/parsers/LineParser.ts` - Use trial-specific patterns
- `src/parsers/EnhancedLineParser.ts` - Pattern detection
- `src/parsers/Phase2Processor.ts` - Generic fallback logic
- `src/services/ExaminationContextManager.ts` - Enhanced tracking
- `config/trialstyle.json` - Add Q&A pattern fields

## Configuration Examples

### Trial with Q: patterns
```json
{
  "fileConvention": "DATEAMPM",
  "questionPatterns": ["Q:", "Question:"],
  "answerPatterns": ["A:", "Answer:"],
  "enableGenericFallback": false
}
```

### Video deposition without attorney indicators
```json
{
  "fileConvention": "DOCID",
  "questionPatterns": ["Q.", "Q"],
  "answerPatterns": ["A.", "A"],
  "attorneyIndicatorPatterns": [],
  "enableGenericFallback": true,
  "genericFallbackConfig": {
    "assumeExaminerFromContext": true
  }
}
```

### Mixed format trial
```json
{
  "fileConvention": "AUTO",
  "questionPatterns": ["Q.", "Q:", "QUESTION"],
  "answerPatterns": ["A.", "A:", "ANSWER"],
  "enableGenericFallback": true,
  "speakerHandleVariations": {
    "MR": ["MR.", "MR", "Mr"],
    "MS": ["MS.", "Ms", "MS"]
  }
}
```

## Success Criteria

### Configuration
- ✓ Each trial has isolated configuration
- ✓ Q&A patterns correctly detected per trial
- ✓ No pattern cross-contamination between trials

### Generic Fallback
- ✓ 100% of Q patterns attributed (specific or generic)
- ✓ Correct side attribution based on examination
- ✓ Generic attributions clearly marked
- ✓ Original speaker preserved for audit

### Multi-Trial
- ✓ Batch processing of multiple directories
- ✓ Attorney fingerprints match across trials
- ✓ Trial-specific patterns respected
- ✓ Progress reporting for batch operations

## Testing Plan

### Unit Tests
1. Pattern detection with various formats
2. Generic speaker creation
3. Examination context state machine
4. Configuration validation

### Integration Tests
1. Multi-trial batch processing
2. Attorney cross-trial matching
3. Generic fallback with context
4. Pattern isolation between trials

### End-to-End Tests
1. Process 4+ different trial formats
2. Verify attorney associations
3. Check generic attributions
4. Export and review results

## Risk Mitigation

### Pattern Conflicts
- Risk: Overlapping patterns cause misidentification
- Mitigation: Order patterns by specificity, test thoroughly

### Generic Over-Attribution
- Risk: Too many statements attributed to generic
- Mitigation: Preserve original text, mark for review

### Performance with Large Batches
- Risk: Memory/performance issues with many trials
- Mitigation: Process trials sequentially, not in parallel

## Future Enhancements

1. **ML Pattern Learning**: Learn Q&A patterns from examples
2. **Attorney Style Recognition**: Identify attorney from language patterns
3. **Interactive Configuration Builder**: UI for building trialstyle.json
4. **Pattern Library**: Shared repository of transcript patterns
5. **Automatic Pattern Suggestion**: Suggest patterns based on analysis