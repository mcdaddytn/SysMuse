# Feature 07F: Marker Section Diagnostic Output

## Status: IMPLEMENTED ✅
- Auto-summary generation fixed: All 407 MarkerSections now have summaries
- Created `src/cli/regenerate-summaries.ts` for batch summary generation
- Created `src/cli/hierarchy-view.ts` with all four view types
- All views tested and working with real data

## Overview
Create comprehensive diagnostic output capabilities for MarkerSection hierarchies, allowing multiple views of trial structure and interactions. This feature builds on the existing MarkerSection infrastructure to provide insights into trial organization and dynamics.

## Objectives
1. Provide multiple hierarchical views of trial structure
2. Fix auto-summary generation for all MarkerSections
3. Identify and visualize interaction patterns (objections, judge-attorney dialogues)
4. Create reusable diagnostic scripts for trial analysis

## Requirements

### 1. Multiple Hierarchy Views
Create a persisted script that can display different hierarchical views:

#### A. Trial/Session Hierarchy
- Show only Trial → Session structure
- Display session numbers, date/time, event ranges
- Show session-level statistics (duration, event count)

#### B. Trial/Standard Sequence Hierarchy  
- Show Trial → Major Sections → Subsections
- Include: Opening Statements Period → Individual Openings
- Include: Witness Testimony Period → Plaintiff/Defense Witnesses → Individual Witnesses → Examinations
- Include: Closing Statements Period → Individual Closings
- Display confidence scores and event coverage

#### C. Trial/Objection Sequences
- Identify sequences of objections within the trial
- Group related objections (sustained/overruled patterns)
- Show objection context (which attorney, during which witness)
- Display objection statistics (success rate, frequency)

#### D. Trial/Judge-Attorney Interactions
- Identify back-and-forth sequences between judge and attorneys
- Distinguish sidebar conferences from open court interactions
- Group by interaction type (procedural, evidentiary, administrative)
- Show both-sides interactions (judge with plaintiff AND defense counsel)

### 2. Auto-Summary Bug Fix
**Current Issue**: Not all MarkerSections have auto-summaries generated despite having enclosed statements.

**Fix Requirements**:
- Ensure ALL MarkerSections with event ranges get auto-summaries
- Generate summaries even for sections with few events
- Handle edge cases (single event sections, zero-length sections)
- Include meaningful statistics in summary (event count, word count, speaker breakdown)

**Summary Format**:
```
[First 3-5 lines of rendered transcript]
...
[Summary: X events, Y speakers, Z words, Duration: MM:SS]
```

### 3. Interaction Pattern Detection

#### Objection Sequences
- Use existing OBJECTION markers from Phase 2
- Group objections within temporal windows (30-60 seconds)
- Identify patterns:
  - Single objection → ruling
  - Multiple objections → argument → ruling
  - Objection chains during testimony
- Create MarkerSections for significant objection sequences

#### Judge-Attorney Interactions
- Adapt existing accumulator patterns:
  - `judge_attorney_interaction` pattern
  - `opposing_counsel_interaction` pattern
- Adjust parameters:
  - Reduce window size (current may be too large)
  - Fine-tune minimum exchange count
  - Consider interaction density
- Create MarkerSections for significant interactions

### 4. Diagnostic Output Script

Create `src/cli/hierarchy-view.ts` with options:

```bash
# Show specific hierarchy
npx ts-node src/cli/hierarchy-view.ts --trial 7 --view session
npx ts-node src/cli/hierarchy-view.ts --trial 7 --view standard
npx ts-node src/cli/hierarchy-view.ts --trial 7 --view objections
npx ts-node src/cli/hierarchy-view.ts --trial 7 --view interactions

# Show all hierarchies
npx ts-node src/cli/hierarchy-view.ts --trial 7 --all

# Export options
npx ts-node src/cli/hierarchy-view.ts --trial 7 --view standard --format json
npx ts-node src/cli/hierarchy-view.ts --trial 7 --view standard --output report.txt
```

Output format features:
- Indented tree structure
- Event ranges for each section
- Auto-summary preview (first line)
- Statistics (event count, confidence)
- Color coding for section types (if terminal supports)

## Implementation Plan

### Phase 1: Fix Auto-Summary Generation
1. Review TranscriptRenderer.generateAutoSummaries()
2. Ensure it processes ALL sections with event ranges
3. Handle edge cases properly
4. Add summary statistics

### Phase 2: Create Hierarchy View Script
1. Implement base hierarchy traversal logic
2. Add view-specific formatters
3. Implement output options (console, file, JSON)
4. Add statistics and coverage calculations

### Phase 3: Implement Objection Sequences
1. Query existing OBJECTION markers
2. Group into sequences using temporal windows
3. Create MarkerSections for significant sequences
4. Add to hierarchy view

### Phase 4: Implement Judge-Attorney Interactions
1. Adapt existing accumulator patterns
2. Tune parameters for appropriate sensitivity
3. Create MarkerSections for interactions
4. Add to hierarchy view

## Success Criteria
1. All MarkerSections with event ranges have auto-summaries
2. Multiple hierarchy views available via CLI
3. Objection sequences properly identified and grouped
4. Judge-attorney interactions detected with appropriate sensitivity
5. Diagnostic output provides actionable insights into trial structure

## Technical Considerations

### Pattern Tuning
Current accumulator patterns may need adjustment:
- `windowSize`: Reduce from current values to avoid over-grouping
- `minExchanges`: Adjust based on interaction type
- `maxGapEvents`: Consider tightening for better sequence cohesion

### Performance
- Cache rendered summaries to avoid regeneration
- Implement lazy loading for large trials
- Consider pagination for very long hierarchies

### Data Model
No schema changes required - uses existing MarkerSection structure:
- Different `markerSectionType` values for different hierarchies
- Parent-child relationships for nesting
- `metadata` field for pattern-specific data
- `text` field for auto-summaries

## Example Output

### Session Hierarchy View
```
TRIAL: Personalized Media v. Zynga [32000-41000]
├─ SESSION: Session 48 (Day 1 Morning) [32000-33500]
│  1500 events, 3.5 hours
├─ SESSION: Session 49 (Day 1 Afternoon) [33501-35000]
│  1499 events, 3.2 hours
└─ SESSION: Session 50 (Day 2 Morning) [35001-36500]
   1500 events, 3.4 hours
```

### Standard Hierarchy View  
```
TRIAL: Personalized Media v. Zynga [32000-41000]
├─ OPENING_STATEMENTS_PERIOD [32810-32818] (conf: 80%)
│  ├─ OPENING_STATEMENT_PLAINTIFF [32810-32812]
│  │  "MR. GOVETT: Good afternoon, Ladies and Gentlemen..."
│  └─ OPENING_STATEMENT_DEFENSE [32818-32818]
│     "MR. ZAGER: Good afternoon. My name is Steve Zager..."
├─ WITNESS_TESTIMONY_PERIOD [32900-40500] (conf: 95%)
│  ├─ WITNESS_TESTIMONY_PLAINTIFF [32900-37000]
│  └─ WITNESS_TESTIMONY_DEFENSE [37001-40500]
└─ CLOSING_STATEMENTS_PERIOD [40594-40605] (conf: 80%)
```

### Objection Sequences View
```
TRIAL: Personalized Media v. Zynga - Objection Sequences
├─ OBJECTION_SEQUENCE_1 [33421-33425] 
│  During: Witness Smith Cross-Examination
│  Attorney: MR. GOVETT (Plaintiff)
│  Result: SUSTAINED (3), OVERRULED (1)
├─ OBJECTION_SEQUENCE_2 [35102-35110]
│  During: Witness Jones Direct Examination  
│  Attorney: MR. ZAGER (Defense)
│  Result: OVERRULED (2)
```

## Dependencies
- Existing MarkerSection infrastructure (Feature 07D)
- TranscriptRenderer service
- Accumulator patterns from Phase 2
- Standard Trial Hierarchy Builder

## Related Features
- Feature 07D: Schema for Advanced Markers and Sections
- Feature 07E: Standard Trial Sequence Implementation
- Feature 02Y: Pattern detection and accumulation