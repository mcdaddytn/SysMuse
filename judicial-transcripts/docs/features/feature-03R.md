# Feature-03R: Accumulator Facet Enhancement System

## Overview
Enhance the accumulator system to surface additional facets from judicial transcript interactions, enabling more granular filtering and analysis of courtroom dynamics, including emotional states, exhibit handling, and complex interaction patterns.

## Motivation
Current accumulators identify broad patterns (e.g., objections, interactions) but don't capture specific attributes within those patterns. By extracting facets like objection types, judge rulings, emotional states, and interaction categories, we can provide richer search and analysis capabilities.

## Core Concepts

### Facet Definition
A facet is a specific attribute or characteristic extracted from an accumulator match that provides additional context and filtering capability.

### Hybrid Extraction Approach
1. **Primary Filter**: Broad criteria to identify the pattern (existing accumulator functionality)
2. **Pattern-Based Extractors**: Fast, deterministic extraction for clear patterns
3. **LLM-Based Extractors**: Sophisticated extraction for complex facets like emotion, tone, and context

## Target Facets

### Emotion and Tone Facets
- **Judge Emotions**:
  - Annoyed, frustrated, impatient
  - Perfunctory, routine, disengaged
  - Engaged, interested, thoughtful
  - Stern, authoritative, corrective
  - Amused, lighthearted

- **Attorney Emotions**:
  - Agitated, argumentative, combative
  - Conciliatory, apologetic, deferential
  - Confident, assertive
  - Frustrated, exasperated
  - Confused, seeking clarification

- **Witness Emotions**:
  - Defensive, evasive
  - Cooperative, forthcoming
  - Nervous, hesitant
  - Confident, certain
  - Confused, uncertain

### Professional Conduct Facets
- **Apologies**: formal apology, acknowledgment of error, correction
- **Admissions**: admission of mistake, concession, withdrawal
- **Professionalism Issues**: speaking objections, interruptions, personal attacks
- **Courtroom Decorum**: admonishments, warnings, sanctions threats

### Objection Facets
- **Ruling**: sustained, overruled, withdrawn, taken under advisement
- **Type**: leading, speculation, foundation, relevance, hearsay, argumentative, asked and answered, beyond scope, assumes facts not in evidence, compound, vague, calls for legal conclusion
- **Party**: plaintiff, defendant, prosecution, defense
- **Context**: during direct, cross, redirect, recross

### Exhibit and Evidence Facets
- **Exhibit Actions**:
  - Marking for identification
  - Moving for admission
  - Publishing to jury
  - Handling/passing to witness
  - Technical issues with display

- **Exhibit Types**:
  - Document, photograph, video, audio
  - Demonstrative, illustrative
  - Physical evidence
  - Expert demonstratives

- **Video Deposition Management**:
  - Start/stop playback
  - Objections during video
  - Technical issues
  - Time stamps referenced
  - Designations discussed

### Interaction Category Facets
- **Witness Transitions**:
  - Pass the witness
  - May I approach
  - Nothing further
  - Tender the witness
  - Witness excused/recalled

- **Examination Phases**:
  - Direct examination begins
  - Cross examination begins
  - Redirect/Recross
  - Voir dire of witness

- **Court Management**:
  - Recess called/resumed
  - Jury excused/recalled
  - Sidebar requested/concluded
  - Rule invocation (witness exclusion)
  - Bench conferences

- **Time Management**:
  - Opening/closing time limits
  - Examination time remaining
  - Scheduling discussions
  - Day planning/logistics

- **Technical Operations**:
  - Court reporter issues
  - Audio/video problems
  - Exhibit display issues
  - Remote participant problems

## Technical Design

### Hybrid Accumulator Enhancement Structure
```typescript
interface EnhancedAccumulator {
  // Existing fields
  name: string;
  description: string;
  primaryFilter: FilterExpression;

  // Facet extraction methods
  patternExtractors: PatternFacetExtractor[];
  llmExtractors: LLMFacetExtractor[];
  extractionStrategy: 'pattern' | 'llm' | 'hybrid';
}

interface PatternFacetExtractor {
  facetName: string;
  facetType: 'categorical' | 'boolean' | 'text';
  patterns: FacetPattern[];
  priority: number;
}

interface LLMFacetExtractor {
  facetName: string;
  facetType: 'emotion' | 'tone' | 'intent' | 'complex';
  prompt: string;
  model: 'claude-3-haiku' | 'claude-3-sonnet';
  contextWindow: number; // Statements before/after to include
  confidenceThreshold: number;
}

interface FacetPattern {
  pattern: string | RegExp;
  value: string;
  confidence: number;
  negationPatterns?: string[]; // Patterns that negate this match
}

interface AccumulatorResult {
  // Existing fields
  matched: boolean;
  statements: Statement[];

  // Facet results from both extraction methods
  facets: FacetResult[];
  llmAnalysis?: LLMAnalysisResult;
}

interface FacetResult {
  name: string;
  value: string | boolean;
  confidence: number;
  extractionMethod: 'pattern' | 'llm';
  sourceText: string;
  statementIds: number[];
}

interface LLMAnalysisResult {
  emotions: EmotionDetection[];
  tone: ToneAnalysis;
  intent: string[];
  additionalFacets: Record<string, any>;
  confidence: number;
  modelUsed: string;
}

interface EmotionDetection {
  speaker: string;
  speakerRole: 'judge' | 'attorney' | 'witness';
  emotion: string;
  intensity: 'mild' | 'moderate' | 'strong';
  confidence: number;
  indicators: string[]; // Specific words/phrases that indicated emotion
}
```

### Implementation Phases

#### Phase 1: Analysis and Pattern Discovery
1. Analyze existing interaction JSON files using LLM
2. Identify common patterns and facet categories
3. Build initial pattern library
4. Create emotion/tone detection prompts

#### Phase 2: Pattern-Based Extraction
1. Implement deterministic pattern extractors
2. Build pattern library for common facets
3. Add negation and context handling

#### Phase 3: LLM-Based Extraction
1. Implement LLM extraction pipeline
2. Design prompts for emotion/tone detection
3. Add caching for LLM results
4. Implement confidence scoring

#### Phase 4: Hybrid System Integration
1. Combine pattern and LLM results
2. Implement conflict resolution
3. Add result aggregation
4. Store unified facet results

#### Phase 5: UI Integration
1. Add facet-based filtering to search interface
2. Display emotion/tone indicators
3. Enable facet aggregation/statistics
4. Add facet timeline visualization

## Example Accumulator Configurations

### Emotion Detection Accumulator
```json
{
  "name": "judicial_emotion_detection",
  "primaryFilter": {
    "type": "window",
    "windowSize": 10,
    "filters": [
      {
        "speaker": "JUDGE",
        "minStatements": 3
      }
    ]
  },
  "patternExtractors": [
    {
      "facetName": "explicit_frustration",
      "patterns": [
        {"pattern": "I've already ruled", "value": "frustrated", "confidence": 0.8},
        {"pattern": "asked and answered", "value": "impatient", "confidence": 0.7},
        {"pattern": "Move on", "value": "impatient", "confidence": 0.7},
        {"pattern": "We've been over this", "value": "frustrated", "confidence": 0.8}
      ]
    }
  ],
  "llmExtractors": [
    {
      "facetName": "judicial_emotion",
      "facetType": "emotion",
      "prompt": "Analyze the judge's emotional state in this exchange. Identify: 1) Primary emotion (frustrated, patient, engaged, annoyed, neutral), 2) Intensity (mild/moderate/strong), 3) Specific indicators. Context: IP litigation trial.",
      "model": "claude-3-haiku",
      "contextWindow": 5,
      "confidenceThreshold": 0.7
    }
  ],
  "extractionStrategy": "hybrid"
}
```

### Exhibit Handling Accumulator
```json
{
  "name": "exhibit_handling",
  "primaryFilter": {
    "type": "proximity",
    "keywords": ["exhibit", "document", "display", "show", "mark"],
    "proximityWindow": 3
  },
  "patternExtractors": [
    {
      "facetName": "exhibit_action",
      "patterns": [
        {"pattern": "mark.*identification", "value": "marking", "confidence": 1.0},
        {"pattern": "move.*admission|admit.*evidence", "value": "admission_motion", "confidence": 0.9},
        {"pattern": "publish.*jury", "value": "publishing", "confidence": 0.9},
        {"pattern": "hand.*witness|show.*witness", "value": "presenting", "confidence": 0.8},
        {"pattern": "pull up|display|screen", "value": "displaying", "confidence": 0.8}
      ]
    },
    {
      "facetName": "technical_issue",
      "patterns": [
        {"pattern": "can't see|not showing|not working", "value": "display_problem", "confidence": 0.9},
        {"pattern": "technical.*difficult|problem.*display", "value": "technical_issue", "confidence": 0.8}
      ]
    }
  ]
}
```

### Video Deposition Accumulator
```json
{
  "name": "video_deposition",
  "primaryFilter": {
    "type": "keywords",
    "keywords": ["video", "deposition", "playback", "recording", "clip", "designation"]
  },
  "patternExtractors": [
    {
      "facetName": "video_action",
      "patterns": [
        {"pattern": "play.*video|start.*video", "value": "start_playback", "confidence": 0.9},
        {"pattern": "stop.*video|pause", "value": "stop_playback", "confidence": 0.9},
        {"pattern": "counter.*designation", "value": "counter_designation", "confidence": 1.0},
        {"pattern": "time.*stamp|\\d+:\\d+", "value": "timestamp_reference", "confidence": 0.8},
        {"pattern": "objection.*video", "value": "video_objection", "confidence": 0.9}
      ]
    }
  ],
  "llmExtractors": [
    {
      "facetName": "deposition_context",
      "facetType": "complex",
      "prompt": "Identify the video deposition context: whose deposition, what topic, any objections or issues raised.",
      "model": "claude-3-haiku",
      "contextWindow": 10
    }
  ]
}
```

## Database Schema Extensions

```sql
-- Enhanced facet definitions with extraction method
CREATE TABLE accumulator_facets (
  id SERIAL PRIMARY KEY,
  accumulator_id INTEGER REFERENCES accumulators(id),
  facet_name VARCHAR(100) NOT NULL,
  facet_type VARCHAR(50) NOT NULL,
  extraction_method VARCHAR(20) NOT NULL, -- 'pattern' or 'llm'
  configuration JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Facet results with extraction metadata
CREATE TABLE accumulator_facet_results (
  id SERIAL PRIMARY KEY,
  accumulator_result_id INTEGER REFERENCES accumulator_results(id),
  facet_id INTEGER REFERENCES accumulator_facets(id),
  value TEXT NOT NULL,
  confidence DECIMAL(3,2),
  extraction_method VARCHAR(20),
  source_text TEXT,
  statement_ids INTEGER[],
  llm_analysis JSONB, -- Store full LLM response if applicable
  created_at TIMESTAMP DEFAULT NOW()
);

-- Emotion tracking table
CREATE TABLE emotion_detections (
  id SERIAL PRIMARY KEY,
  interaction_id INTEGER REFERENCES interactions(id),
  speaker_id INTEGER REFERENCES speakers(id),
  speaker_role VARCHAR(20),
  emotion VARCHAR(50),
  intensity VARCHAR(20),
  confidence DECIMAL(3,2),
  indicators TEXT[],
  context_statement_ids INTEGER[],
  llm_model_used VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_facet_results_value ON accumulator_facet_results(facet_id, value);
CREATE INDEX idx_facet_results_confidence ON accumulator_facet_results(confidence);
CREATE INDEX idx_emotion_speaker ON emotion_detections(speaker_id, emotion);
CREATE INDEX idx_emotion_intensity ON emotion_detections(intensity);
```

## API Extensions

### Query with Facets and Emotions
```typescript
// GET /api/interactions?facets[emotion]=frustrated&facets[exhibit_action]=marking
interface FacetQuery {
  accumulatorName: string;
  facets: {
    [facetName: string]: string | string[];
  };
  emotions?: {
    speaker?: string;
    emotion?: string;
    minIntensity?: 'mild' | 'moderate' | 'strong';
  };
  includeContext?: boolean; // Include surrounding statements
}

// Response with emotion analysis
interface EnhancedSearchResponse {
  results: InteractionResult[];
  facetAggregations: {
    [facetName: string]: {
      values: Array<{
        value: string;
        count: number;
        avgConfidence: number;
      }>;
    };
  };
  emotionSummary?: {
    dominantEmotions: EmotionSummary[];
    emotionalArc: EmotionTimeline[];
  };
}
```

## LLM Processing Pipeline

### Batch Processing Strategy
```typescript
interface LLMBatchProcessor {
  // Process interactions in batches to optimize API usage
  batchSize: number;
  maxConcurrent: number;

  // Caching strategy
  cacheResults: boolean;
  cacheTTL: number;

  // Fallback for API limits
  rateLimitStrategy: 'queue' | 'skip' | 'fallback-to-pattern';

  // Cost optimization
  modelSelection: {
    simple: 'claude-3-haiku';    // For basic emotion/tone
    complex: 'claude-3-sonnet';   // For nuanced analysis
  };
}
```

## Success Metrics
1. **Coverage**: Percentage of interactions with extracted facets
2. **Emotion Accuracy**: Validation against human review (target: >85%)
3. **Pattern Match Rate**: Percentage caught by patterns vs requiring LLM
4. **Processing Efficiency**: LLM costs per trial analysis
5. **User Engagement**: Facet filter usage in search queries

## Cost Optimization Strategies
1. **Pattern-First Approach**: Use patterns for 80% of common cases
2. **Selective LLM**: Only use LLM for high-value segments
3. **Result Caching**: Cache LLM results for reuse
4. **Batch Processing**: Process multiple segments in single API calls
5. **Model Tiering**: Use cheaper models for simple tasks

## Future Enhancements
1. **Fine-tuned Models**: Train specialized models for legal emotion detection
2. **Cross-Examination Patterns**: Detect adversarial questioning strategies
3. **Credibility Indicators**: Identify potential credibility issues
4. **Narrative Arc Detection**: Track story development through testimony
5. **Multi-Speaker Emotion Dynamics**: Analyze emotional interplay

## Dependencies
- Feature-01: Core accumulator system
- Feature-02: Interaction detection
- LLM API integration (Claude API)
- Existing database schema

## Implementation Priority
High - This enhancement significantly improves the analytical capability of the system, providing deep insights into courtroom dynamics that are valuable for legal research, trial preparation, and judicial behavior analysis.