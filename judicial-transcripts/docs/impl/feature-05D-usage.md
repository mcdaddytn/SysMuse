# Feature-05D Usage Guide: In-Memory Search for Accumulators

## Overview
Feature-05D provides an in-memory search alternative to ElasticSearch for evaluating accumulator expressions. This allows the system to function without ElasticSearch infrastructure while maintaining accumulator functionality.

## Configuration

### Disable ElasticSearch in Configuration
In your configuration file (e.g., `config/multi-trial-config-mac.json`):

```json
{
  "enableElasticSearch": false,
  // ... other config
}
```

## Usage

### Using the New Phase3 Processor

The system automatically selects the appropriate search strategy based on configuration:

```bash
# Process Phase 3 with in-memory search (when enableElasticSearch: false)
npx ts-node src/cli/phase3-v2.ts process --config config/multi-trial-config-mac.json

# Process specific trial
npx ts-node src/cli/phase3-v2.ts process --config config/multi-trial-config-mac.json --trial-id 1

# Process all trials
npx ts-node src/cli/phase3-v2.ts process --config config/multi-trial-config-mac.json --all

# Check status
npx ts-node src/cli/phase3-v2.ts status
```

### Testing In-Memory Search

Run the test script to verify functionality:

```bash
npx ts-node scripts/test-inmemory-search.ts
```

## How It Works

### Search Strategy Pattern

The system uses a strategy pattern to switch between search implementations:

1. **ElasticSearch Strategy**: Used when `enableElasticSearch: true`
   - Queries ElasticSearch for text matches
   - Uses existing ES infrastructure

2. **In-Memory Strategy**: Used when `enableElasticSearch: false`  
   - Performs text search directly on statement data
   - No external dependencies required

### Accumulator Expression Support

The in-memory search supports all common accumulator patterns:

```json
{
  "name": "objection_sustained",
  "metadata": {
    "attorneyPhrases": ["objection", "I object"],
    "judgePhrases": ["sustained"],
    "weights": {
      "objection": 1.0,
      "sustained": 1.0
    }
  }
}
```

### Processing Flow

1. **Load Configuration**: System reads `enableElasticSearch` setting
2. **Initialize Strategy**: Appropriate search strategy is selected
3. **Process Windows**: For each window of statements:
   - Search for configured phrases
   - Apply speaker filters
   - Calculate confidence scores
4. **Store Results**: Results saved to database

## Performance Considerations

### In-Memory Search
- **Pros**: 
  - No external dependencies
  - Simple deployment
  - Lower latency for small datasets
  
- **Cons**:
  - Higher memory usage for large transcripts
  - Sequential processing
  - Limited to exact/simple phrase matching

### Recommendations
- Use in-memory search for:
  - Development and testing
  - Small to medium transcript sets (<100MB)
  - Simple phrase-based accumulators

- Use ElasticSearch for:
  - Production deployments with large datasets
  - Complex search patterns
  - When advanced text analysis is needed

## API Changes

### AccumulatorEngineV2
New version supports strategy pattern:

```typescript
const engine = new AccumulatorEngineV2(prisma, config);
await engine.initialize();
await engine.evaluateTrialAccumulators(trialId);
```

### Phase3ProcessorV2
Updated processor automatically uses appropriate strategy:

```typescript
const processor = new Phase3ProcessorV2(prisma, config);
await processor.process(trialId);
```

## Migration

To migrate existing Phase 3 processing:

1. Update configuration to set `enableElasticSearch: false`
2. Use `phase3-v2.ts` CLI instead of original `phase3.ts`
3. Existing accumulator expressions work without modification

## Troubleshooting

### Common Issues

1. **No results found**
   - Verify accumulator expressions are active
   - Check that phrases match exact text in transcripts
   - Ensure speaker types are correctly identified

2. **Performance issues**
   - Consider reducing window size
   - Limit number of active accumulators
   - Use ElasticSearch for large datasets

3. **Different results than ElasticSearch**
   - In-memory uses exact matching (case-insensitive)
   - ElasticSearch may use stemming/fuzzy matching
   - Review accumulator expressions for compatibility

## Future Enhancements

Planned improvements for in-memory search:
- Regex pattern support
- Fuzzy matching options
- Parallel processing for large windows
- Caching optimizations
- Stemming and lemmatization