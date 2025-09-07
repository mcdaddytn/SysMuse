# Feature-05D: In-Memory Search Alternative to ElasticSearch for Accumulators

## Overview
Implement an in-memory search alternative to ElasticSearch for evaluating accumulator expressions when ElasticSearch is disabled in the configuration. This provides a simpler, dependency-free approach for text matching within statement windows.

## Background
The current accumulator system relies on ElasticSearch for text matching within statement windows. However:
- ElasticSearch adds infrastructure complexity
- Many deployments disable ElasticSearch (`enableElasticSearch: false`)
- The actual text searches are relatively simple phrase matches
- Most accumulator logic (speaker matching, window evaluation) happens outside ElasticSearch

## Objectives
1. Enable accumulator functionality without ElasticSearch dependency
2. Support simple phrase matching from accumulator-expressions.json
3. Maintain compatibility with existing accumulator evaluation logic
4. Provide transparent fallback when ElasticSearch is disabled

## Functional Requirements

### Core Search Functionality
1. **Phrase Matching**
   - Support exact phrase matching within statement text
   - Case-insensitive matching by default
   - Support phrase variants (e.g., "objection", "I object", "we object")
   - Return match positions and confidence scores

2. **Search Scope**
   - Search within statement text for each window
   - Support searching across multiple statements in a window
   - Match against speaker-specific phrases when configured

3. **Configuration Support**
   - Use existing accumulator-expressions.json format
   - Support phrase weights for confidence scoring
   - Handle metadata configurations (attorneyPhrases, judgePhrases, etc.)

### Integration Requirements
1. **Transparent Fallback**
   - Automatically use in-memory search when `enableElasticSearch: false`
   - No changes required to accumulator expressions
   - Maintain same result structure as ElasticSearch

2. **Performance Considerations**
   - Efficient for typical window sizes (5-20 statements)
   - Cache compiled patterns for repeated searches
   - Optimize for sequential window evaluation

## Technical Design

### Architecture
```
AccumulatorEngine
    ├── SearchStrategy (interface)
    │   ├── ElasticSearchStrategy (existing)
    │   └── InMemorySearchStrategy (new)
    └── SearchStrategyFactory
        └── createStrategy(config) → SearchStrategy
```

### InMemorySearchStrategy Implementation

#### Core Components
1. **PhraseSearcher**
   ```typescript
   interface PhraseSearchResult {
     statementId: number;
     phrase: string;
     positions: number[];
     confidence: number;
     metadata?: any;
   }
   
   class PhraseSearcher {
     searchPhrase(text: string, phrase: string): PhraseSearchResult[]
     searchMultiplePhrases(text: string, phrases: string[]): PhraseSearchResult[]
   }
   ```

2. **StatementSearchService**
   ```typescript
   class StatementSearchService {
     searchStatements(
       statements: StatementEvent[],
       expressions: SearchExpression[]
     ): Map<number, SearchResult[]>
   }
   ```

3. **SearchExpression Parser**
   - Convert accumulator metadata to search expressions
   - Handle speaker-specific phrases
   - Apply phrase weights

### Data Flow
1. AccumulatorEngine evaluates windows
2. For each window, extract statements
3. Parse accumulator metadata into search expressions
4. Execute in-memory search on statement text
5. Return results in same format as ElasticSearch
6. Continue with existing accumulator evaluation

## Implementation Steps

### Phase 1: Core Search Implementation
1. Create `src/services/InMemorySearchService.ts`
2. Implement basic phrase matching
3. Add case-insensitive and exact matching modes
4. Create unit tests for phrase searching

### Phase 2: Integration with AccumulatorEngine
1. Create SearchStrategy interface
2. Refactor existing ElasticSearch code to use strategy pattern
3. Implement InMemorySearchStrategy
4. Add factory for strategy selection based on config

### Phase 3: Expression Support
1. Parse accumulator expression metadata
2. Support speaker-specific phrases
3. Implement confidence scoring with weights
4. Handle phrase variants and alternatives

### Phase 4: Testing and Optimization
1. Test with sample accumulator expressions
2. Compare results with ElasticSearch implementation
3. Optimize for common patterns
4. Add performance benchmarks

## Configuration

### Example Configuration
```json
{
  "enableElasticSearch": false,
  "inMemorySearch": {
    "caseSensitive": false,
    "enableCache": true,
    "maxCacheSize": 1000
  }
}
```

### Accumulator Expression Support
```json
{
  "name": "objection_sustained",
  "metadata": {
    "attorneyPhrases": ["objection", "I object", "we object"],
    "judgePhrases": ["sustained"],
    "weights": {
      "objection": 1.0,
      "I object": 1.0,
      "we object": 0.9,
      "sustained": 1.0
    }
  }
}
```

## Testing Strategy

### Unit Tests
1. Test phrase matching algorithms
2. Test confidence scoring
3. Test speaker-specific matching
4. Test window evaluation

### Integration Tests
1. Test with real accumulator expressions
2. Compare results with ElasticSearch when available
3. Test with multi-trial configurations
4. Validate performance with large transcripts

### Test Data
- Use existing seed-data/accumulator-expressions.json
- Test with sample transcripts from samples/transcripts/
- Create specific test cases for edge cases

## Success Criteria
1. All accumulator expressions work without ElasticSearch
2. Results are consistent with ElasticSearch implementation
3. Performance is acceptable for typical transcript sizes
4. No changes required to existing accumulator expressions
5. Transparent fallback based on configuration

## Future Enhancements
1. Support for regex patterns
2. Fuzzy matching for typos
3. Stemming and lemmatization
4. Advanced scoring algorithms
5. Parallel processing for large windows

## Dependencies
- No external dependencies (pure TypeScript)
- Uses existing Prisma models
- Compatible with existing accumulator structure

## Risks and Mitigations
1. **Risk**: Performance with large transcripts
   - **Mitigation**: Implement caching and optimize algorithms

2. **Risk**: Feature parity with ElasticSearch
   - **Mitigation**: Focus on core features used by accumulators

3. **Risk**: Maintaining two search implementations
   - **Mitigation**: Use strategy pattern for clean separation