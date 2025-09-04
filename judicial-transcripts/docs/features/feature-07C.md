# Feature 07C: Enhanced Marker System with LLM Integration

## Overview
Enhance the Marker and MarkerSection system to support LLM-based extraction, override imports, ElasticSearch integration, and hierarchical marker structures. This feature enables both automated inline parsing and asynchronous human-in-the-loop marker generation for complex trial sections like opening statements, closing statements, and jury phases.

## Background
Current marker generation relies on explicit events (e.g., witness called events). Many important trial sections require fuzzy logic and context analysis to identify exact boundaries. This feature adds:
- LLM-based marker extraction for complex sections
- Override system for manual marker specification
- ElasticSearch integration for MarkerSection queries
- Hierarchical marker relationships

## Requirements

### 1. MarkerSection Enhancement

#### 1.1 Database Schema Updates
```typescript
// Add to MarkerSection model
model MarkerSection {
  // ... existing fields ...
  text            String?        @db.Text  // Aggregated text content
  elasticSearchId String?        // ElasticSearch document ID
  parentSectionId Int?           // For hierarchical sections
  parentSection   MarkerSection? @relation("ParentChild", fields: [parentSectionId], references: [id])
  childSections   MarkerSection[] @relation("ParentChild")
  sectionType     MarkerSectionType  // Enum for section types
}

enum MarkerSectionType {
  CASE_INTRO
  JURY_SELECTION
  OPENING_STATEMENTS_PERIOD
  OPENING_STATEMENT_PLAINTIFF
  OPENING_STATEMENT_DEFENSE
  WITNESS_TESTIMONY_PERIOD
  WITNESS_TESTIMONY_PLAINTIFF
  WITNESS_TESTIMONY_DEFENSE
  WITNESS_EXAMINATION
  DIRECT_EXAMINATION
  CROSS_EXAMINATION
  REDIRECT_EXAMINATION
  RECROSS_EXAMINATION
  CLOSING_STATEMENTS_PERIOD
  CLOSING_STATEMENT_PLAINTIFF
  CLOSING_STATEMENT_DEFENSE
  JURY_DELIBERATION
  JURY_VERDICT
  CASE_WRAPUP
  CUSTOM
}
```

#### 1.2 Text Aggregation
- Aggregate text from all StatementEvents within MarkerSection boundaries
- Use Mustache templates for customizable text formatting
- Support configurable aggregation strategies

### 2. Trial Structure Hierarchy

#### 2.1 Standard Trial Sequence
```
1. Case Intro
2. Jury Selection
3. Opening Statements Period
   ├── Plaintiff Opening Statement
   └── Defense Opening Statement
4. Witness Testimony Period
   ├── Plaintiff Called Witnesses
   │   └── Individual Witness Testimony
   │       ├── Direct Examination (Plaintiff)
   │       ├── Cross Examination (Defense - optional)
   │       ├── Redirect Examination (Plaintiff - optional)
   │       ├── Recross Examination (Defense - optional)
   │       └── [Additional Redirect/Recross cycles possible]
   └── Defense Called Witnesses
       └── Individual Witness Testimony
           ├── Direct Examination (Defense)
           ├── Cross Examination (Plaintiff - optional)
           ├── Redirect Examination (Defense - optional)
           ├── Recross Examination (Plaintiff - optional)
           └── [Additional Redirect/Recross cycles possible]
5. Closing Statements Period
   ├── Plaintiff Closing Statement
   └── Defense Closing Statement
6. Jury Deliberation
7. Jury Verdict
8. Case Wrapup
```

#### 2.1.1 Witness Examination Sequences
The examination sequence follows a predictable pattern based on who called the witness:

**Plaintiff Called Witness:**
- Direct Examination (Plaintiff attorney)
- Cross Examination (Defense attorney - optional)
- Redirect Examination (Plaintiff attorney - optional)
- Recross Examination (Defense attorney - optional)
- [Additional cycles possible but rare]

**Defense Called Witness:**
- Direct Examination (Defense attorney)
- Cross Examination (Plaintiff attorney - optional)
- Redirect Examination (Defense attorney - optional)
- Recross Examination (Plaintiff attorney - optional)
- [Additional cycles possible but rare]

**Common Examination Patterns:**
```
1. Direct → Cross (minimal)
2. Direct → Cross → Redirect (common)
3. Direct → Cross → Redirect → Recross (full standard)
4. Direct → Cross → Redirect → Recross → Redirect (extended)
5. Direct → Cross → Redirect → Recross → Redirect → Recross (rare, judge may limit)
6. Direct → Cross → Redirect → Recross → Redirect → Recross → Redirect (very rare)
```

Note: While procedurally possible to continue alternating redirect/recross examinations, judges typically intervene to limit excessive back-and-forth. The system should support these extended sequences but flag them as unusual.

#### 2.2 Hierarchy Rules
- MarkerSections can be nested within other MarkerSections
- Enforce parent-child relationships based on sectionType
- Support loose enforcement for exceptional cases
- Use existing markers to constrain search space for missing markers

### 3. LLM-Based Marker Extraction

#### 3.1 Extraction Strategy
```typescript
interface MarkerExtractionContext {
  trialId: number;
  targetSectionType: MarkerSectionType;
  searchBoundaries: {
    startMarker?: Marker;  // Constraint: search after this
    endMarker?: Marker;    // Constraint: search before this
    existingMarkers: Marker[];  // Known markers for reference
  };
  transcriptExcerpt: string;  // Relevant portion of transcript
  contextWindow: number;  // Lines before/after to include
}
```

#### 3.2 LLM Prompts
- Generate targeted prompts based on section type
- Include trial context and existing markers
- Request structured JSON output matching override format
- Support iterative refinement with human feedback

#### 3.3 Search Heuristics
- **Opening Statements**: Before first witness testimony
- **Closing Statements**: After last witness testimony
- **Jury Selection**: Near beginning, before opening statements
- **Jury Deliberation/Verdict**: Near end, after closing statements
- Use existing witness markers as anchors
- **Examination Sequences**: Apply tactical patterns by witness type:
  - Technical experts: Expect extended redirect/recross cycles
  - Damages experts: Cross-examination typically longest segment
  - Fact witnesses: Usually limited to direct and cross
  - Consider party strategy (plaintiff as risk manager, defense as opportunist)

### 4. Override System

#### 4.1 Override JSON Format
```json
{
  "markers": [
    {
      "name": "Opening Statement - Plaintiff Begin",
      "markerType": "OPENING_BEGIN",
      "location": {
        // Option 1: Trial + session + line number
        "caseNumber": "2:19-CV-00123-JRG",
        "sessionShortName": "20210315AM",
        "sessionLineNumber": 234,
        
        // Option 2: Trial + trial line number
        "caseNumber": "2:19-CV-00123-JRG",
        "trialLineNumber": 1234,
        
        // Option 3: Trial + session + page + line
        "caseNumber": "2:19-CV-00123-JRG",
        "sessionShortName": "20210315AM",
        "pageNumber": 45,
        "lineNumber": 12
      },
      "confidence": 0.95,
      "notes": "Plaintiff attorney begins opening statement"
    }
  ],
  "markerSections": [
    {
      "name": "Plaintiff Opening Statement",
      "sectionType": "OPENING_STATEMENT_PLAINTIFF",
      "startMarker": "Opening Statement - Plaintiff Begin",
      "endMarker": "Opening Statement - Plaintiff End",
      "parentSection": "Opening Statements Period",
      "metadata": {
        "attorney": "Mr. Smith",
        "duration": "45 minutes"
      }
    }
  ]
}
```

#### 4.2 Location Resolution
- Support multiple location specification methods
- Resolve to Line.id for marker creation
- Validate location against database
- Handle ambiguous references with warnings

### 5. ElasticSearch Integration

#### 5.1 MarkerSection Indexing
```typescript
interface MarkerSectionDocument {
  id: string;
  trialId: number;
  caseNumber: string;
  sectionType: string;
  name: string;
  text: string;  // Aggregated content
  startTime: Date;
  endTime: Date;
  metadata: Record<string, any>;
  parentSectionId?: string;
  childSectionIds: string[];
}
```

#### 5.2 Lifecycle Management
- **Phase 2 (StatementEvents)**: Short-lived, offload after use
- **Phase 3 (MarkerSections)**: Long-lived, persist for corpus analysis
- Dynamic reloading from database when needed
- Configurable retention policies

#### 5.3 Query Capabilities
- Full-text search within marker sections
- Filter by section type, trial, time range
- Aggregate queries across trials
- Support complex boolean queries

### 6. API Enhancements

#### 6.1 MarkerSection Endpoints
```typescript
// Search marker sections
GET /api/marker-sections/search
Query params:
- q: ElasticSearch query string
- trialId: Filter by trial
- sectionType: Filter by type
- includeChildren: Include nested sections

// Get marker section hierarchy
GET /api/trials/{trialId}/marker-hierarchy

// Import marker overrides
POST /api/markers/override
Body: Override JSON

// Generate markers with LLM
POST /api/markers/generate
Body: {
  trialId: number,
  sectionTypes: MarkerSectionType[],
  provider: 'openai' | 'anthropic' | 'google',
  model: string
}
```

### 7. Automated Marker Generation

#### 7.1 Inline Generation (During Parsing)
- Witness called events → Witness testimony markers
- Session boundaries → Potential section boundaries
- Speaker patterns → Examination type changes

#### 7.2 Post-Processing Generation
- LLM analysis for complex sections
- Pattern matching for standard phrases
- Statistical analysis of speech patterns
- Tactical pattern recognition based on witness type and party strategy

#### 7.3 Human-in-the-Loop Workflow
1. Run automated marker generation
2. Review and validate generated markers
3. Identify gaps in coverage
4. Use LLM to find missing sections
5. Manual override for corrections
6. Iterative refinement

### 8. Implementation Approach

#### 8.1 Reusable Components
- Leverage existing LLM integration from Feature 03H
- Reuse override system patterns
- Extend ElasticSearch service for MarkerSections
- Adapt reporting templates for marker data

#### 8.2 New Components
- MarkerExtractor service for LLM-based extraction
- MarkerOverrideImporter for override handling
- MarkerSectionAggregator for text compilation
- MarkerHierarchyValidator for structure validation

### 9. Success Criteria

1. **Coverage**: 90% of major trial sections automatically identified
2. **Accuracy**: 95% accuracy for witness testimony markers
3. **Performance**: < 30 seconds for LLM marker extraction per trial
4. **Search**: Sub-second ElasticSearch queries across corpus
5. **Hierarchy**: Proper nesting of all standard section types

### 10. Testing Strategy

1. **Unit Tests**
   - Location resolution from various formats
   - Hierarchy validation logic
   - Text aggregation accuracy

2. **Integration Tests**
   - LLM extraction with mock responses
   - Override import with complex hierarchies
   - ElasticSearch indexing and queries

3. **End-to-End Tests**
   - Complete marker generation workflow
   - Human-in-the-loop simulation
   - Cross-trial marker analysis

### 11. Future Enhancements

1. **Marker Constraints System**
   - Define allowed sequential relationships
   - Enforce enclosure rules
   - Validate temporal consistency

2. **Machine Learning Integration**
   - Train custom models for marker detection
   - Learn from human corrections
   - Improve accuracy over time

3. **Advanced Visualizations**
   - Timeline view with hierarchical markers
   - Cross-trial marker comparison
   - Statistical analysis dashboards

## Dependencies

- Feature 03H: LLM integration and override system
- Feature 07A/B: Existing marker implementation
- ElasticSearch 7.x
- LangChain for LLM orchestration

## Configuration

```json
{
  "markers": {
    "llm": {
      "defaultProvider": "openai",
      "defaultModel": "gpt-4",
      "contextWindow": 100,
      "temperature": 0.1
    },
    "elasticsearch": {
      "markerSectionIndex": "marker_sections",
      "retentionDays": 90,
      "offloadPhase2": true
    },
    "generation": {
      "autoGenerateWitness": true,
      "requireHumanValidation": true,
      "confidenceThreshold": 0.8
    }
  }
}
```

## Security Considerations

1. **Access Control**: Marker overrides require authentication
2. **Audit Trail**: Log all manual marker modifications
3. **Data Validation**: Sanitize LLM responses before database insertion
4. **Rate Limiting**: Control LLM API usage

## Performance Considerations

1. **Batch Processing**: Process multiple sections in single LLM call
2. **Caching**: Cache LLM responses for similar contexts
3. **Indexing**: Optimize database indexes for location queries
4. **Async Processing**: Use job queue for large-scale generation

## Documentation Requirements

1. **User Guide**: How to use marker override system
2. **API Documentation**: Complete endpoint specifications
3. **LLM Prompt Templates**: Document and version control
4. **Marker Type Definitions**: Comprehensive type glossary