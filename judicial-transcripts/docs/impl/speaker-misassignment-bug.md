# Speaker Misassignment Bug Analysis

## Issue Summary
Witness speakers are incorrectly assigned to court procedural statements and session boundary text, causing:
1. Witness testimony periods to extend incorrectly to end of trial
2. Session summaries showing wrong speakers (e.g., witnesses saying "All rise")
3. Closing statements not being properly detected
4. Hierarchy views showing incorrect text snippets

## Root Cause Analysis

### Primary Issue: Witness State Persistence Across Sessions
**Location**: `src/parsers/Phase2Processor.ts`, lines 558 and 586

When processing a new session, the Phase2Processor:
1. **Initializes** with the previous session's witness context (line 558):
   ```typescript
   currentWitness: this.witnessJurorService.getCurrentWitness()
   ```
2. **Persists** the witness state at session end (line 586):
   ```typescript
   this.witnessJurorService.setCurrentWitness(state.currentWitness)
   ```

This causes the witness from the previous session to remain "current" when the new session begins.

### Secondary Issue: Line Attribution Logic
**Location**: `src/parsers/Phase2Processor.ts`, lines 641-654

When a line has no explicit speaker prefix, it gets appended to the current event. If the current event has a witness as the speaker, all subsequent lines without prefixes are attributed to that witness.

## Specific Examples

### Trial 1: 01 Genband - Mark Lanning
- **Witness Called**: Event 5155 (Session 6)
- **Last Actual Testimony**: Event 5455 ("I don't know. I'd have to do some arithmetic...")
- **Misattributed Events**: 5461-5753
  - Event 5482: "All right. Mr. Verhoeven, are you going to be doing the entire closing..." (should be THE_COURT)
  - Event 5491: "All rise." (should be COURT_SECURITY_OFFICER)
  - Event 5494: "All rise." (Session 7 start, should be COURT_SECURITY_OFFICER)
  - Events 5499-5753: Various court procedural statements

### Trial 2: 02 Contentguard
Similar pattern with multiple witnesses incorrectly speaking "All rise." at session boundaries.

## Data Flow

### Session Transition Example
```
Session 6 End:
- Event 5490: THE_COURT speaks (correct)
- Event 5491: "All rise." → Attributed to WITNESS_MARK_LANNING (WRONG)
- Event 5492: Empty

Session 7 Start:
- Event 5493: Empty
- Event 5494: "All rise." → Attributed to WITNESS_MARK_LANNING (WRONG)
- Event 5495: THE_COURT speaks (correct)
```

## Impact Analysis

### Database Records Affected
- **StatementEvent**: Incorrect speakerId for hundreds of events
- **Speaker**: Witness speakers have inflated statement counts
- **MarkerSection**: Witness testimony sections extend too far
- **Session**: Text summaries show wrong speakers

### Downstream Effects
1. **Phase3 Processing**:
   - Witness testimony period detection fails
   - Closing statements placed at wrong location
   - Session hierarchies show incorrect representative text

2. **Search/Analysis**:
   - Witnesses appear to speak court procedural language
   - Attorney statements may be attributed to witnesses
   - Statistical analysis of speaker participation is skewed

## Detection Pattern

### Indicators of the Bug
1. Witnesses speaking "All rise" or similar court commands
2. Witnesses speaking after their examination clearly ends
3. Court procedural statements during non-testimony periods attributed to last witness
4. Session-starting text attributed to non-court personnel

### Query to Detect Issue
```sql
-- Find witnesses speaking typical court phrases
SELECT e.id, s.text, sp."speakerHandle", sp."speakerType"
FROM "TrialEvent" e 
JOIN "StatementEvent" s ON s."eventId" = e.id 
JOIN "Speaker" sp ON sp.id = s."speakerId"
WHERE sp."speakerType" = 'WITNESS'
  AND (s.text LIKE 'All rise%' 
    OR s.text LIKE 'All right.%'
    OR s.text LIKE 'Be seated%'
    OR s.text LIKE '%approach the bench%'
    OR s.text LIKE '%verdict form%');
```

## Proposed Solutions

### Solution 1: Reset Witness State at Session Boundaries
Clear witness context when certain patterns indicate session start:
- "All rise"
- "Court will come to order"
- "Be seated"
- When COURT_SECURITY_OFFICER speaks

### Solution 2: Validate Speaker Context
Before attributing lines to current witness:
1. Check if line content matches typical witness testimony patterns
2. Verify we're still in examination context
3. Validate that no court procedural keywords are present

### Solution 3: Session Boundary Detection
Add explicit session boundary handling:
1. Detect session-ending patterns
2. Clear witness/attorney state
3. Require explicit re-establishment of witness context in new session

## Testing Requirements

### Unit Tests Needed
1. Test witness state doesn't persist across sessions
2. Test "All rise" is attributed to COURT_SECURITY_OFFICER
3. Test court procedural statements aren't attributed to witnesses

### Integration Tests
1. Process multi-session trial with witness spanning sessions
2. Verify witness testimony ends appropriately
3. Verify closing statements detected after witness testimony

## Related Files
- `src/parsers/Phase2Processor.ts` - Main issue location
- `src/services/WitnessJurorService.ts` - Witness state management
- `src/phase3/StandardTrialHierarchyBuilder.ts` - Affected by incorrect data
- `src/phase3/WitnessMarkerDiscovery.ts` - Relies on correct speaker assignment