# Accumulator Library Catalog

## Overview
This document provides a comprehensive catalog of all available accumulators in the Judicial Transcripts system, organized by category and use case.

## Categories

### 1. Multi-Party Interactions
Detect complex interactions between multiple trial participants.

| Accumulator | Window | Type | Description | Key Patterns |
|------------|--------|------|-------------|--------------|
| `judge_attorney_interaction` | 10 | BOOLEAN | Judge + 2+ attorneys speaking | 3+ distinct speakers including judge |
| `opposing_counsel_interaction` | 8 | BOOLEAN | Plaintiff vs defense with judge | Both sides + judge present |
| `bench_conference` | 10 | BOOLEAN | Extended sidebar discussions | Multiple attorneys at bench |

### 2. Objections & Rulings
Track objections and judicial rulings on various grounds.

| Accumulator | Window | Type | Description | Key Patterns |
|------------|--------|------|-------------|--------------|
| `objection_sustained` | 5 | CONFIDENCE | Successful objections | "objection" → "sustained" |
| `objection_overruled` | 5 | CONFIDENCE | Rejected objections | "objection" → "overruled" |
| `foundation_objection` | 5 | CONFIDENCE | Lack of foundation | "foundation" objections |
| `hearsay_objection` | 5 | CONFIDENCE | Hearsay objections | "hearsay" → ruling |
| `leading_question_objection` | 4 | CONFIDENCE | Leading questions | "leading" → response |
| `speculation_objection` | 5 | CONFIDENCE | Speculation objections | "speculation" → ruling |
| `relevance_objection` | 5 | CONFIDENCE | Relevance challenges | "irrelevant" → ruling |
| `argumentative_objection` | 5 | CONFIDENCE | Argumentative questions | "argumentative" → ruling |
| `compound_question_objection` | 4 | CONFIDENCE | Compound questions | "compound" → "break it down" |
| `asked_and_answered` | 5 | CONFIDENCE | Repetitive questions | "asked and answered" → ruling |

### 3. Procedural Requests
Track procedural motions and requests during trial.

| Accumulator | Window | Type | Description | Key Patterns |
|------------|--------|------|-------------|--------------|
| `sidebar_request` | 3 | BOOLEAN | Request for sidebar | "sidebar", "approach" |
| `permission_to_approach` | 3 | BOOLEAN | Approach witness/bench | "permission to approach" |
| `motion_to_strike` | 4 | BOOLEAN | Strike testimony | "move to strike" → ruling |
| `mistrial_motion` | 8 | BOOLEAN | Motion for mistrial | "mistrial" + judge response |

### 4. Witness Management
Track witness examination phases and issues.

| Accumulator | Window | Type | Description | Key Patterns |
|------------|--------|------|-------------|--------------|
| `witness_examination_transition` | 5 | BOOLEAN | Exam phase changes | "pass the witness", "redirect" |
| `witness_hostile` | 8 | CONFIDENCE | Hostile witness declaration | "hostile witness" |
| `witness_memory_issue` | 3 | CONFIDENCE | Memory problems | "don't recall", "can't remember" |
| `refresh_recollection` | 6 | CONFIDENCE | Memory refresh attempts | "refresh your recollection" |
| `witness_unresponsive` | 6 | CONFIDENCE | Non-responsive witness | "answer the question" |
| `expert_qualification` | 10 | CONFIDENCE | Expert qualification | "qualify as expert" |
| `voir_dire_expert` | 8 | BOOLEAN | Expert voir dire | "voir dire" + qualifications |

### 5. Evidence & Exhibits
Track evidence introduction and handling.

| Accumulator | Window | Type | Description | Key Patterns |
|------------|--------|------|-------------|--------------|
| `exhibit_introduction` | 6 | CONFIDENCE | Exhibit introduction | "exhibit", "mark", "introduce" |
| `video_deposition` | 5 | BOOLEAN | Video deposition playback | "video deposition", "play" |
| `stipulation` | 6 | CONFIDENCE | Fact stipulations | "stipulate", "parties agree" |

### 6. Judicial Control
Track judicial management and control of proceedings.

| Accumulator | Window | Type | Description | Key Patterns |
|------------|--------|------|-------------|--------------|
| `court_admonishment` | 6 | CONFIDENCE | Judge admonishing | "admonish", "improper" |
| `contempt_threat` | 6 | CONFIDENCE | Contempt warnings | "contempt", "sanctions" |
| `limiting_instruction` | 8 | BOOLEAN | Limiting instructions | "limited purpose", "disregard" |
| `jury_instruction_discussion` | 8 | BOOLEAN | Jury instruction talks | "jury instruction", "charge" |
| `recess_break` | 3 | BOOLEAN | Court breaks | "take a recess", "reconvene" |

### 7. Legal Disputes
Track legal arguments and disputes.

| Accumulator | Window | Type | Description | Key Patterns |
|------------|--------|------|-------------|--------------|
| `discovery_dispute` | 10 | CONFIDENCE | Discovery issues | "discovery violation", "compel" |
| `plea_discussion` | 8 | CONFIDENCE | Plea negotiations | "plea agreement", "plea deal" |

## Usage Examples

### Finding All Objections in a Trial
```typescript
// Get all objection-related accumulators
const objectionAccumulators = [
  'objection_sustained',
  'objection_overruled',
  'foundation_objection',
  'hearsay_objection',
  'leading_question_objection',
  'speculation_objection',
  'relevance_objection',
  'argumentative_objection',
  'compound_question_objection',
  'asked_and_answered'
];

const results = await prisma.accumulatorResult.findMany({
  where: {
    trialId: trialId,
    accumulator: {
      name: { in: objectionAccumulators }
    },
    booleanResult: true
  },
  include: {
    accumulator: true,
    startEvent: true,
    endEvent: true
  },
  orderBy: { startEventId: 'asc' }
});
```

### Identifying High-Activity Periods
```typescript
// Find periods with multiple types of activity
const activityResults = await prisma.accumulatorResult.findMany({
  where: {
    trialId: trialId,
    confidenceLevel: { in: ['HIGH', 'MEDIUM'] }
  },
  orderBy: { startEventId: 'asc' }
});

// Group by time windows to find clusters
const clusters = groupByTimeWindow(activityResults, 20); // 20 statement window
```

### Tracking Witness Performance
```typescript
// Analyze witness issues
const witnessIssues = await prisma.accumulatorResult.findMany({
  where: {
    trialId: trialId,
    accumulator: {
      name: { in: ['witness_memory_issue', 'witness_unresponsive', 'witness_hostile'] }
    }
  },
  include: {
    startEvent: { include: { statement: { include: { speaker: true } } } }
  }
});
```

## Configuration Best Practices

### Window Size Guidelines
- **3-4 statements**: Tight interactions (permission requests, simple objections)
- **5-6 statements**: Standard objection-ruling patterns
- **8-10 statements**: Extended discussions, complex interactions
- **10+ statements**: Multi-phase procedures (expert qualification, bench conferences)

### Threshold Settings
- **High Precision (0.8-1.0)**: Critical legal moments requiring accuracy
- **Balanced (0.6-0.8)**: General pattern detection
- **High Recall (0.4-0.6)**: Exploratory analysis, finding potential matches

### Confidence Levels
- **HIGH**: Definitive matches for legal significance
- **MEDIUM**: Probable matches for analysis
- **LOW**: Possible matches for review
- **NONE**: No match

## Performance Metrics

### Processing Speed
| Accumulator Type | Avg Processing Time | Typical Match Rate |
|-----------------|--------------------|--------------------|
| Simple Boolean | ~0.5ms/window | 1-2% |
| Confidence-based | ~1ms/window | 2-5% |
| Complex Multi-condition | ~2ms/window | 0.5-1% |

### Storage Requirements
- Average result size: ~500 bytes
- Typical trial (10,000 statements): 
  - 30 active accumulators
  - ~500-1500 matches
  - ~250KB-750KB storage

## Extending the Library

### Adding New Accumulators
1. Identify the pattern to detect
2. Choose appropriate window size
3. Select expression type (BOOLEAN/CONFIDENCE/FLOAT)
4. Define metadata configuration
5. Test with sample data
6. Adjust thresholds based on results

### Custom Accumulator Template
```json
{
  "name": "your_pattern_name",
  "description": "Clear description of what this detects",
  "expressionType": "CONFIDENCE",
  "windowSize": 5,
  "thresholdValue": 0.7,
  "minConfidenceLevel": "MEDIUM",
  "combinationType": "MULTIPLY",
  "metadata": {
    "phrases": ["key", "phrases"],
    "weights": {
      "key": 1.0,
      "phrases": 0.8
    },
    "requiredSpeakers": ["ATTORNEY", "JUDGE"]
  },
  "isActive": true
}
```

## Maintenance

### Regular Review
- Monitor match rates monthly
- Adjust thresholds based on false positive/negative rates
- Deactivate unused accumulators
- Add new patterns based on user feedback

### Version Control
- Document changes to accumulator configurations
- Test changes on sample data before deployment
- Maintain backward compatibility for stored results

## Integration with Markers

Accumulators feed into the marker system:
1. **Activity Markers**: Created from high-confidence accumulator matches
2. **Witness Markers**: Enhanced with examination transition detections
3. **Procedural Markers**: Generated from sidebar/recess patterns
4. **Evidence Markers**: Created from exhibit introduction patterns

## Future Enhancements

### Planned Features
- Machine learning confidence adjustment
- Cross-trial pattern analysis
- Real-time accumulator evaluation
- Custom user-defined accumulators
- Visual timeline generation
- Automated report generation

### Research Areas
- Natural language understanding for context
- Speaker role inference
- Emotion and tension detection
- Argument quality scoring
- Outcome prediction models