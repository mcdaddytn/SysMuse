# Accumulator Debug Guide

## Overview

This guide provides workflows for debugging and testing accumulator expressions used in Phase 3 processing. Accumulators identify patterns in transcript data (e.g., objections, interactions) using sliding windows and configurable matching criteria.

## Key Files and Tools

### Configuration Files
- `seed-data/accumulator-expressions.json` - Standard accumulator definitions
- `seed-data/accumulator-expressions-extended.json` - Extended accumulator set

### CLI Tools
- `src/cli/reload-accumulators.ts` - Reload accumulator expressions from JSON
- `src/cli/delete-trial.ts` - Delete trial data (includes phase3-only option)
- `src/cli/phase3.ts` - Run Phase 3 processing

## Common Debugging Workflows

### 1. Investigating Missing Detections

When an expected pattern (e.g., objection) is not detected:

```bash
# Step 1: Export current accumulators to review settings
npx ts-node src/cli/reload-accumulators.ts export --output current-accumulators.json

# Step 2: Review the specific accumulator configuration
# Check parameters like windowSize, maxWords, thresholds in the exported file

# Step 3: Query database to verify the text exists
npx ts-node -e "
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Search for specific text patterns
const results = await prisma.statementEvent.findMany({
  where: {
    event: { trialId: 20 }, // Replace with your trial ID
    text: { contains: 'objection' } // Your search term
  },
  include: { speaker: true, event: true }
});

console.log('Found', results.length, 'matches');
results.forEach(r => {
  console.log('Speaker:', r.speaker?.speakerHandle, 'Words:', r.text.split(/\s+/).length);
});

await prisma.\$disconnect();
"
```

### 2. Modifying Accumulator Parameters

```bash
# Step 1: Edit the accumulator configuration file
# Update parameters in seed-data/accumulator-expressions.json
# Common adjustments:
#   - attorneyMaxWords / judgeMaxWords (word count limits)
#   - windowSize (how many statements to examine)
#   - weights (scoring for specific phrases)
#   - thresholdValue (minimum score to match)

# Step 2: Reload accumulators
npx ts-node src/cli/reload-accumulators.ts reload

# Step 3: Delete Phase 3 data for affected trial(s)
npx ts-node src/cli/delete-trial.ts delete-phase3 <trial-id>
# Or for all trials:
npx ts-node src/cli/delete-trial.ts delete-phase3

# Step 4: Re-run Phase 3
npx ts-node src/cli/phase3.ts process --trial <trial-id>
# Or for all trials:
npx ts-node src/cli/phase3.ts process
```

### 3. Testing New Accumulator Expressions

```bash
# Step 1: Add new accumulator to seed-data/accumulator-expressions.json
{
  "name": "your_new_pattern",
  "description": "Description of what this detects",
  "expressionType": "CONFIDENCE",
  "windowSize": 7,
  "metadata": {
    // Your custom parameters
  }
}

# Step 2: Reload and test
npx ts-node src/cli/reload-accumulators.ts reload
npx ts-node src/cli/delete-trial.ts delete-phase3 <test-trial-id>
npx ts-node src/cli/phase3.ts process --trial <test-trial-id>

# Step 3: Verify results
npx ts-node -e "
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const results = await prisma.accumulatorResult.count({
  where: {
    trialId: <test-trial-id>,
    accumulator: { name: 'your_new_pattern' }
  }
});

console.log('Pattern matched', results, 'times');
await prisma.\$disconnect();
"
```

## Accumulator Types and Parameters

### Common Metadata Fields

- **windowSize**: Number of consecutive statements to examine
- **displaySize**: Number of statements to include in results (can be larger than windowSize)
- **maxStatementWords**: Maximum words allowed in any single statement
- **attorneyMaxWords**: Maximum words for attorney statements (objection patterns)
- **judgeMaxWords**: Maximum words for judge statements (ruling patterns)
- **attorneyPhrases**: Phrases to match in attorney statements
- **judgePhrases**: Phrases to match in judge statements
- **weights**: Scoring weights for different phrases (1.0 = full weight)
- **requiredSpeakers**: Speaker types that must be present
- **minDistinctSpeakers**: Minimum number of different speakers

### Expression Types

- **BOOLEAN**: Simple true/false matching
- **CONFIDENCE**: Returns confidence level (HIGH, MEDIUM, LOW)
- **FLOAT**: Returns numeric score

### Combination Types

- **AND**: All conditions must match
- **OR**: Any condition can match
- **WEIGHTEDAVG**: Weighted average of scores

## Troubleshooting Common Issues

### Issue: Objections Not Detected

**Symptoms**: Known objections in transcript not appearing in results

**Common Causes**:
1. Statement exceeds word count limits (attorneyMaxWords/judgeMaxWords)
2. Window size too small to capture both objection and ruling
3. Speaker type misclassified

**Solution**:
```bash
# Check word counts in problematic statements
# Adjust attorneyMaxWords/judgeMaxWords in JSON
# Typical safe values: 30-50 words
```

### Issue: Too Many False Positives

**Symptoms**: Non-objections being detected as objections

**Common Causes**:
1. Weights too permissive
2. Missing speaker type requirements
3. Window size too large

**Solution**:
```bash
# Increase thresholdValue
# Add speaker type requirements
# Reduce windowSize
```

### Issue: Performance Problems

**Symptoms**: Phase 3 taking too long

**Common Causes**:
1. Too many active accumulators
2. Large window sizes
3. Complex metadata conditions

**Solution**:
```bash
# Disable unused accumulators (set isActive: false)
# Optimize window sizes
# Simplify matching conditions
```

## Database Queries for Analysis

### View Accumulator Results
```sql
SELECT
  ae.name,
  COUNT(*) as matches,
  AVG(ar.floatResult) as avg_score
FROM AccumulatorResult ar
JOIN AccumulatorExpression ae ON ar.accumulatorId = ae.id
WHERE ar.trialId = 20
GROUP BY ae.name;
```

### Find High-Word-Count Statements
```sql
SELECT
  s.speakerHandle,
  LENGTH(se.text) - LENGTH(REPLACE(se.text, ' ', '')) + 1 as word_count,
  SUBSTRING(se.text, 1, 100) as preview
FROM StatementEvent se
JOIN Speaker s ON se.speakerId = s.id
JOIN TrialEvent te ON se.eventId = te.id
WHERE te.trialId = 20
  AND LENGTH(se.text) - LENGTH(REPLACE(se.text, ' ', '')) + 1 > 30
ORDER BY word_count DESC;
```

## Best Practices

1. **Always backup before changes**: Export current accumulators before modifying
2. **Test on single trial first**: Use `--trial` flag to test changes on one trial
3. **Document changes**: Keep notes on what parameters were adjusted and why
4. **Monitor word counts**: Many detection failures are due to word count limits
5. **Use dry-run when available**: Review what will change before executing

## Related Documentation

- Phase 3 Processing: `docs/impl/phase3-implementation.md`
- Pattern Matching: `docs/pattern-abstraction-guide.md`
- Database Guide: `docs/database-testing-guide.md`