# Feature 07C Assets: Enhanced Marker System

This directory contains supporting assets for Feature 07C implementation.

## Contents

### Sample Files
- `sample-marker-override.json` - Example marker override file with various location formats
- `marker-hierarchy-example.json` - Example of hierarchical marker structure with examination sequences

### LLM Prompt Templates
- `llm-prompt-template-opening.md` - Opening statements detection
- `llm-prompt-template-closing.md` - Closing statements detection  
- `llm-prompt-template-examination.md` - Witness examination phase detection with tactical analysis

### Strategic Documentation
- `examination-sequence-rules.md` - Procedural rules for examination sequences
- `tactical-examination-patterns.md` - Strategic patterns and attorney decision-making in examinations
  - Incorporates insights from IP litigation tactics
  - Party-specific strategies (plaintiff vs. defense)
  - Witness type patterns (expert vs. fact)
  - Detection confidence scoring based on tactical context

### Implementation References
- Reuses LLM integration from Feature 03H (`src/services/llm/`)
- Extends override pattern from Feature 03H (`src/services/override/`)
- Builds on existing marker implementation from Feature 07A/B

## Key Implementation Notes

### 1. MarkerSection Text Field
- Similar to StatementEvent.text implementation
- Aggregated from enclosed StatementEvents
- Indexed in ElasticSearch for full-text search

### 2. Location Resolution Priority
The system supports three ways to specify marker locations:
1. **Trial + Session + Line Number** (most specific)
2. **Trial + Trial Line Number** (cross-session reference)
3. **Trial + Session + Page + Line** (page-based reference)

### 3. LLM Context Generation
For each target marker type, generate context including:
- Relevant transcript excerpt (with configurable window)
- Existing markers as reference points
- Trial metadata for context
- Section-specific search heuristics

### 4. Hierarchy Enforcement
- Soft enforcement by default (warnings for violations)
- Configurable strict mode for validation
- Parent-child relationships stored in database

### 5. ElasticSearch Strategy
- MarkerSections have longer lifecycle than StatementEvents
- Persist for entire corpus analysis period
- Dynamic reloading when needed
- Separate index from phase 2 data

## Testing Data

### Standard Trial Structure
```
Trial: VOCALIFE LLC VS. AMAZON.COM, INC.
Case: 2:19-CV-00123-JRG

Expected Marker Sections:
1. Case Intro (Lines 1-50)
2. Jury Selection (Lines 51-500)
3. Opening Statements (Lines 501-800)
   - Plaintiff Opening (Lines 501-650)
   - Defense Opening (Lines 651-800)
4. Witness Testimony (Lines 801-5000)
   - Multiple witness sections
5. Closing Statements (Lines 5001-5400)
   - Plaintiff Closing (Lines 5001-5200)
   - Defense Closing (Lines 5201-5400)
6. Jury Instructions (Lines 5401-5600)
7. Jury Verdict (Lines 5601-5650)
8. Case Wrapup (Lines 5651-5700)
```

## Integration Points

### With Existing Systems
1. **Parser**: Hooks for inline marker generation
2. **API**: Extended endpoints for marker queries
3. **Reporting**: Templates for marker-based reports
4. **ElasticSearch**: Shared service with configuration

### With New Components
1. **MarkerExtractor**: LLM-based extraction service
2. **MarkerOverrideImporter**: Import override files
3. **MarkerSectionAggregator**: Text compilation
4. **MarkerHierarchyValidator**: Structure validation

## Development Workflow

1. **Phase 1**: Database schema updates and basic CRUD
2. **Phase 2**: Override system implementation
3. **Phase 3**: LLM extraction integration
4. **Phase 4**: ElasticSearch integration
5. **Phase 5**: API and UI enhancements

## Performance Targets

- Marker extraction: < 30 seconds per trial
- Override import: < 5 seconds for 100 markers
- ElasticSearch query: < 1 second for corpus-wide search
- Text aggregation: < 10 seconds per trial

## Known Challenges

1. **Ambiguous Boundaries**: Some sections don't have clear start/end
2. **Variations**: Trials may not follow standard structure
3. **Context Windows**: LLM token limits for large excerpts
4. **Performance**: Balancing accuracy vs. processing time