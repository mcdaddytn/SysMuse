# Feature-07H Implementation Guide: Enhanced Opening and Closing Argument Detection

## Current Implementation Status

### Completed Components

#### 1. LongStatementsAccumulatorV2
**Location**: `src/phase3/LongStatementsAccumulatorV2.ts`

**Key Enhancements**:
- Team attorney aggregation support
- Multiple search strategies (high-word-team, high-word-individual, traditional)
- Improved ratio calculations for team-based statements
- Smart extension to capture complete arguments including judge interruptions

**Core Methods**:
```typescript
findLongestStatement(params: LongStatementParams): Promise<StatementResult | null>
- aggregateTeam: boolean flag for team aggregation
- Tries multiple strategies in order of preference
```

#### 2. ArgumentFinder
**Location**: `src/phase3/ArgumentFinder.ts`

**Features**:
- Multi-strategy orchestration
- Validation for speaker types (excludes witness/juror statements)
- Chronological order verification
- Confidence and validation scoring

**Search Strategies**:
- `defense-first`: Find defense argument first, then narrow search for plaintiff
- `plaintiff-first`: Find plaintiff first, then search for defense
- `parallel`: Search both independently
- `chronological`: Find all high-word events and assign by position

#### 3. Integration with StandardTrialHierarchyBuilder
**Location**: `src/phase3/StandardTrialHierarchyBuilder.ts`

**Flags**:
- `useV2Accumulator`: Enable V2 accumulator
- `useArgumentFinder`: Enable ArgumentFinder (currently true by default)

## Test Results and Findings

### Test Case: 01 Genband

#### Expected Closing Arguments (Chronological Order):
1. **Event 5658**: MR. KUBEHL (Plaintiff) - 2246 words - Main closing
2. **Event 5662**: MR. VERHOEVEN (Defense) - 3167 words - Defense closing
3. **Event 5672**: MR. DACUS (Plaintiff) - 1362 words - Plaintiff rebuttal

#### Current Detection Results:
```
✅ Defense Closing: Events 5662-5671 (MR. VERHOEVEN)
❌ Plaintiff Closing: Events 5672-5676 (MR. DACUS) - Should be 5658
✅ Plaintiff Rebuttal: Events 5672-5702 (MR. DACUS)
```

**Issue**: System correctly finds defense closing but misidentifies the rebuttal as the main plaintiff closing, missing MR. KUBEHL's statement at 5658.

### Root Cause Analysis

1. **Search Window Issue**: The defense-first strategy successfully finds MR. VERHOEVEN at 5662, but then searches for plaintiff closing BEFORE 5662, which should find event 5658.

2. **Strategy Selection**: The system is using different strategies for different arguments:
   - Defense closing: Found with defense-first strategy (confidence 1.0)
   - Plaintiff closing: Found with plaintiff-first strategy (confidence 1.0)
   - This suggests the defense-first strategy isn't properly finding the plaintiff closing

3. **Chronological Strategy Limitation**: The chronological strategy has a `take: 20` limit which might miss some statements if there are many high-word events.

## Known Issues and Refinements Needed

### Issue 1: Missing Plaintiff Closing Before Defense
**Problem**: Event 5658 (MR. KUBEHL) not captured as plaintiff closing

**Proposed Fix**:
```typescript
// In ArgumentFinder.searchClosingDefenseFirst()
// After finding defense closing, search MORE CAREFULLY for plaintiff before it
const plaintiffClosing = await accumulator.findLongestStatement({
  trialId,
  speakerType: 'ATTORNEY',
  attorneyRole: 'PLAINTIFF',
  searchStartEvent,
  searchEndEvent: defenseClosing.startEvent.id - 1,
  minWords: config?.minWords || 500,
  maxInterruptionRatio: config?.maxInterruptionRatio || 0.25,
  ratioMode: 'SMART_EXTEND',
  ratioThreshold: config?.ratioThreshold || 0.5,
  aggregateTeam: true
});
```

### Issue 2: Rebuttal Identification
**Problem**: Same event range identified as both main closing and rebuttal

**Proposed Fix**:
- Enforce mutual exclusivity: if an event range is already assigned as main closing, it cannot also be rebuttal
- Check chronological order: rebuttal must come AFTER defense closing

### Issue 3: Split Arguments Not Fully Tested
**Status**: Team aggregation implemented but needs testing with trials having split arguments

## Validation Rules Implementation

### Current Validation
```typescript
// In ArgumentFinder.validateAndScoreCandidates()
- Penalize for witness statements (-0.5 score)
- Penalize for juror statements (-0.5 score)
- Bonus for attorney dominance (+0.2 max)
- Penalty for excessive judge interruptions
```

### Additional Validation Needed
1. **Continuity Check**: Ensure argument is continuous, not fragmented
2. **Context Validation**: Check for opening/closing keywords in surrounding context
3. **Length Validation**: Minimum duration/word count for valid arguments

## Testing Commands

### Delete and Regenerate Phase3 Data
```bash
# Delete phase3 data for a trial
npx ts-node -e "
const prisma = new PrismaClient();
await prisma.markerSection.deleteMany({
  where: {
    trial: { shortName: '01 Genband' },
    source: { in: ['PHASE3_HIERARCHY', 'PHASE3_DISCOVERY', 'PHASE3_ZEROLENGTH'] }
  }
});"

# Regenerate phase3
npx ts-node src/cli/phase3.ts process --trial 1
```

### Debug Specific Statements
```bash
npx ts-node scripts/test-closing-search.ts
npx ts-node scripts/debug-closing-search.ts
```

## Configuration Tuning

### Current Defaults
```typescript
// Opening statements
{
  minWords: 400,
  maxInterruptionRatio: 0.4,
  ratioMode: 'WEIGHTED_SQRT2',
  ratioThreshold: 0.4
}

// Closing arguments
{
  minWords: 400,  // Reduced from 500
  maxInterruptionRatio: 0.25,
  ratioMode: 'SMART_EXTEND',
  ratioThreshold: 0.6
}
```

### Recommended Adjustments
1. **Lower minWords threshold** for catching shorter arguments (300-400)
2. **Increase search window** for chronological strategy
3. **Add fallback** to search without role filtering if no results

## Next Steps

1. **Fix Chronological Ordering**
   - Ensure first plaintiff statement after testimony = main closing
   - Plaintiff statement after defense = rebuttal

2. **Improve Defense-First Strategy**
   - Debug why it's not finding plaintiff closing before defense
   - Add logging to trace search windows

3. **Test Additional Cases**
   - 28 Implicit V Netscout (defense opening issue)
   - 36 Salazar V Htc (chronological order issue)

4. **Add Contextual Hints**
   - Search for phrases like "opening statement", "closing argument"
   - Use judge announcements as anchors

5. **Implement Confidence Boosting**
   - Higher confidence when chronological order is correct
   - Lower confidence for out-of-order arguments

## Database Queries for Verification

```sql
-- Check detected arguments for a trial
SELECT
  markerSectionType,
  startEventId,
  endEventId,
  confidence,
  metadata->>'strategy' as strategy,
  metadata->>'validationScore' as validation_score
FROM MarkerSection
WHERE trialId = 1
  AND markerSectionType IN (
    'OPENING_STATEMENT_PLAINTIFF',
    'OPENING_STATEMENT_DEFENSE',
    'CLOSING_STATEMENT_PLAINTIFF',
    'CLOSING_STATEMENT_DEFENSE',
    'CLOSING_REBUTTAL_PLAINTIFF'
  )
ORDER BY startEventId;

-- Find high-word attorney statements
SELECT
  te.id,
  te.wordCount,
  s.speakerHandle,
  ta.role
FROM TrialEvent te
JOIN StatementEvent se ON se.eventId = te.id
JOIN Speaker s ON s.id = se.speakerId
LEFT JOIN TrialAttorney ta ON ta.speakerId = s.id
WHERE te.trialId = 1
  AND te.wordCount > 1000
  AND s.speakerType = 'ATTORNEY'
  AND te.id BETWEEN 5100 AND 5700
ORDER BY te.id;
```

## Success Criteria Validation

- [ ] Detect plaintiff closing at 5658 (01 Genband)
- [x] Detect defense closing at 5662 (01 Genband)
- [x] Detect plaintiff rebuttal at 5672 (01 Genband)
- [ ] Correct chronological ordering for all arguments
- [x] No witness/juror statements in detected arguments
- [ ] Handle split arguments correctly
- [ ] 95%+ detection rate across all trials