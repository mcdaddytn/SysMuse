# Accumulator System Documentation

## Overview

The Accumulator System is a powerful pattern-matching engine designed to identify significant events and interactions within judicial transcripts. It uses a sliding window approach to analyze sequences of statements and detect patterns that indicate important courtroom activities like objections, sidebar requests, and multi-party interactions.

## Core Concepts

### What are Accumulators?

Accumulators are configurable pattern detectors that:
- Scan through trial transcripts using a sliding window of consecutive statements
- Evaluate multiple conditions within each window
- Generate scores, confidence levels, and boolean matches
- Store results for downstream marker generation and analysis

### Key Components

1. **AccumulatorExpression**: The main configuration entity that defines what patterns to look for
2. **AccumulatorEngine**: The processing engine that evaluates accumulators against trial data
3. **ElasticSearchExpression**: Text pattern matchers that can be used as accumulator components
4. **AccumulatorResult**: Stored matches with metadata about where patterns were found

## Architecture

### Data Flow

```
Trial Events → Statement Windows → Pattern Evaluation → Score Calculation → Result Storage
                                           ↑
                                    ES Expressions
                                    Speaker Analysis
                                    Custom Conditions
```

### Window Processing

The system uses a sliding window approach:
1. For each accumulator with window size N
2. Slide through all statement events
3. Evaluate conditions for each window of N consecutive statements
4. Store results when patterns match or scores exceed thresholds

## Configuration Options

### AccumulatorExpression Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `name` | String | Unique identifier | "objection_sustained" |
| `description` | String | Human-readable description | "Attorney objects and judge sustains" |
| `expressionType` | Enum | Type of result produced | BOOLEAN, CONFIDENCE, FLOAT |
| `windowSize` | Integer | Number of statements to analyze | 5 (default) |
| `thresholdValue` | Float | Minimum score to trigger match | 0.7 |
| `minConfidenceLevel` | Enum | Minimum confidence for boolean true | MEDIUM |
| `combinationType` | Enum | How to combine multiple scores | ADD, MULTIPLY, OR, AND |
| `metadata` | JSON | Additional configuration | See metadata section |
| `isActive` | Boolean | Whether to process this accumulator | true |

### Expression Types

#### BOOLEAN
- Returns true/false based on threshold conditions
- Used for definitive pattern detection
- Example: "Did 3+ distinct speakers interact?"

#### CONFIDENCE
- Returns confidence levels: HIGH, MEDIUM, LOW, NONE
- Useful for fuzzy matching with uncertainty
- Example: "How confident are we this is an objection?"

#### FLOAT
- Returns numeric scores
- Allows for fine-grained scoring and ranking
- Example: "Score of interaction intensity"

### Combination Types

#### AND
- All conditions must be met (minimum of all scores)
- Used for strict pattern requirements
- Example: Judge AND 2+ attorneys must speak

#### OR
- Any condition can be met (maximum of all scores)
- Used for alternative patterns
- Example: "sidebar" OR "approach the bench"

#### ADD
- Sum all component scores
- Used for cumulative scoring
- Example: Total interaction points

#### MULTIPLY
- Product of all scores
- Used for confidence calculations
- Example: 0.8 (attorney phrase) × 0.9 (judge phrase) = 0.72

### Metadata Configuration

The metadata field allows extensive customization:

```json
{
  "requiredSpeakers": ["JUDGE"],           // Must have these speaker types
  "minDistinctSpeakers": 3,                // Minimum unique speakers
  "minAttorneys": 2,                       // Minimum attorney count
  "requirePlaintiffAttorney": true,        // Must have plaintiff counsel
  "requireDefenseAttorney": true,          // Must have defense counsel
  "attorneyPhrases": ["objection"],        // Phrases to look for from attorneys
  "judgePhrases": ["sustained"],           // Phrases to look for from judge
  "weights": {                             // Scoring weights for phrases
    "objection": 1.0,
    "I object": 1.0,
    "sustained": 1.0,
    "overruled": 1.0,
    "I'll allow it": 0.7
  }
}
```

## Current Accumulator Library

### 1. Judge-Attorney Interaction (judge_attorney_interaction)
- **Purpose**: Detect multi-party discussions involving the judge
- **Window Size**: 10 statements
- **Requirements**: 
  - Judge must speak
  - At least 2 attorneys must speak
  - Minimum 3 distinct speakers total
- **Use Case**: Identifying heated discussions or important rulings

### 2. Opposing Counsel Interaction (opposing_counsel_interaction)
- **Purpose**: Find confrontations between opposing attorneys with judge involvement
- **Window Size**: 8 statements
- **Requirements**:
  - Judge must speak
  - Plaintiff attorney must speak
  - Defense attorney must speak
- **Use Case**: Detecting disputes requiring judicial intervention

### 3. Objection Sustained (objection_sustained)
- **Purpose**: Detect successful objections
- **Window Size**: 5 statements
- **Type**: CONFIDENCE
- **Pattern**: Attorney says "objection" AND judge says "sustained"
- **Threshold**: 0.7
- **Use Case**: Tracking successful objections for appeal analysis

### 4. Objection Overruled (objection_overruled)
- **Purpose**: Detect rejected objections
- **Window Size**: 5 statements
- **Type**: CONFIDENCE
- **Pattern**: Attorney says "objection" AND judge says "overruled" or "I'll allow it"
- **Weights**: "overruled" = 1.0, "I'll allow it" = 0.7
- **Use Case**: Tracking unsuccessful objections

### 5. Sidebar Request (sidebar_request)
- **Purpose**: Identify requests for private bench conferences
- **Window Size**: 3 statements
- **Type**: BOOLEAN
- **Pattern**: Any speaker says "sidebar", "approach the bench", "may we approach"
- **Use Case**: Marking potential jury-excluded discussions

### 6. Witness Examination Transition (witness_examination_transition)
- **Purpose**: Detect transitions between examination phases
- **Window Size**: 5 statements
- **Type**: BOOLEAN
- **Pattern**: Attorney says "pass the witness", "cross-examination", "redirect", "no further questions"
- **Use Case**: Segmenting witness testimony

## Creating New Accumulators

### Step 1: Define the Pattern

Identify what you want to detect:
- What speakers are involved?
- What phrases indicate the pattern?
- How many statements should be analyzed together?
- What confidence level is needed?

### Step 2: Choose Configuration

Select appropriate settings:
- **Expression Type**: BOOLEAN for yes/no, CONFIDENCE for uncertainty, FLOAT for scoring
- **Window Size**: Smaller for tight interactions (3-5), larger for extended exchanges (8-10)
- **Combination Type**: AND for all conditions, OR for alternatives, MULTIPLY for confidence
- **Threshold**: Higher for precision (0.8+), lower for recall (0.5+)

### Step 3: Create JSON Configuration

```json
{
  "name": "your_accumulator_name",
  "description": "What this accumulator detects",
  "expressionType": "CONFIDENCE",
  "windowSize": 5,
  "thresholdValue": 0.7,
  "minConfidenceLevel": "MEDIUM",
  "combinationType": "MULTIPLY",
  "metadata": {
    // Your custom configuration
  },
  "isActive": true
}
```

### Step 4: Test and Refine

1. Add to seed-data/accumulator-expressions.json
2. Run accumulator evaluation: `npm run phase3:accumulators`
3. Review debug output: `npm run phase3:accumulator-debug`
4. Examine CSV output in output/csv/accumulator_debug.csv
5. Adjust thresholds and window size based on results

## Advanced Features

### ElasticSearch Integration

Accumulators can use pre-computed ElasticSearch results:
1. Define ES expressions for text patterns
2. Run ES evaluation to populate results
3. Reference ES expressions in accumulator configuration
4. Engine automatically uses cached ES results

### Window Skipping

To prevent overlapping matches:
- After a match is found, the engine skips ahead by window size
- Prevents duplicate detection of the same event
- Improves performance on large transcripts

### Debug Mode

The testAccumulatorDebug tool provides:
- CSV output with all accumulator scores per event
- Detailed match metadata
- Window skip indicators
- Performance metrics

## Performance Considerations

### Optimization Strategies

1. **Selective Storage**: Only store positive matches (score > 0)
2. **Batch Processing**: Insert results in batches of 100
3. **Window Skipping**: Skip evaluation near recent matches
4. **Active Flag**: Disable unused accumulators
5. **Indexed Fields**: Database indexes on commonly queried fields

### Performance Metrics

- Typical processing: ~1000 windows/second
- Memory usage: Proportional to window size
- Storage: ~1-5% of windows produce stored results

## Troubleshooting

### Common Issues

1. **No matches found**
   - Check if accumulator is active
   - Verify ES expressions are evaluated first
   - Lower threshold values
   - Increase window size

2. **Too many false positives**
   - Increase threshold value
   - Use AND combination instead of OR
   - Add more specific requirements
   - Reduce window size

3. **Performance issues**
   - Reduce window size
   - Disable unused accumulators
   - Increase batch size
   - Add database indexes

## API Usage

### Evaluate Accumulators

```typescript
const engine = new AccumulatorEngine(prisma);

// Evaluate ES expressions first (if using)
await engine.evaluateESExpressions(trialId);

// Run accumulator evaluation
await engine.evaluateTrialAccumulators(trialId);
```

### Query Results

```typescript
// Find all objection interactions
const objections = await prisma.accumulatorResult.findMany({
  where: {
    accumulator: {
      name: 'objection_sustained'
    },
    booleanResult: true
  },
  include: {
    startEvent: true,
    endEvent: true
  }
});
```

### Debug Analysis

```typescript
const debugger = new AccumulatorDebugger();
await debugger.debugAccumulators(trialId);
// Check output/csv/accumulator_debug.csv
```

## Future Enhancements

Planned improvements include:
- Machine learning-based pattern detection
- Real-time accumulator evaluation during parsing
- Visual timeline generation from accumulator results
- Automated threshold optimization
- Cross-trial pattern analysis
- Custom accumulator scripting language