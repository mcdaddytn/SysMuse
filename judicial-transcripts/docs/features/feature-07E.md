# Feature 07E: Standard Trial Marker Hierarchies

## Overview
This feature implements the automatic discovery and creation of the Standard Trial Sequence hierarchy during Phase 3 processing. Building on the marker schema from Feature-07D, this establishes a complete hierarchical structure for trials, enabling comprehensive timeline analysis and navigation.

## Objectives
1. Automatically discover and create the complete Standard Trial Sequence hierarchy
2. Implement multi-pass marker discovery algorithms
3. Create the LongStatementsAccumulator for opening/closing statement detection
4. Establish both Trial/Session and Standard Trial Sequence hierarchies
5. Provide fallback mechanisms for incomplete trials

## Standard Trial Sequence Hierarchy

### Complete Hierarchy Structure
```
TRIAL
├── CASE_INTRO
├── JURY_SELECTION
├── OPENING_STATEMENTS_PERIOD
│   ├── OPENING_STATEMENT_PLAINTIFF
│   └── OPENING_STATEMENT_DEFENSE
├── WITNESS_TESTIMONY_PERIOD
│   ├── WITNESS_TESTIMONY_PLAINTIFF
│   │   └── WITNESS_TESTIMONY (per witness)
│   │       ├── DIRECT_EXAMINATION
│   │       ├── CROSS_EXAMINATION
│   │       ├── REDIRECT_EXAMINATION (optional)
│   │       └── RECROSS_EXAMINATION (optional)
│   └── WITNESS_TESTIMONY_DEFENSE
│       └── WITNESS_TESTIMONY (per witness)
│           ├── DIRECT_EXAMINATION
│           ├── CROSS_EXAMINATION
│           ├── REDIRECT_EXAMINATION (optional)
│           └── RECROSS_EXAMINATION (optional)
├── CLOSING_STATEMENTS_PERIOD
│   ├── CLOSING_STATEMENT_PLAINTIFF
│   ├── CLOSING_STATEMENT_DEFENSE
│   └── CLOSING_REBUTTAL_PLAINTIFF (optional)
├── JURY_DELIBERATION
├── JURY_VERDICT
└── CASE_WRAPUP
```

### Parallel Session Hierarchy
```
TRIAL
└── SESSION (multiple)
```

## Implementation Steps

### Step 1: Witness Testimony Hierarchy (Bottom-Up)

#### 1.1 Examination-Level Markers
```typescript
// For each WitnessCalledEvent
interface ExaminationMarkerDiscovery {
  // Create DIRECT_EXAMINATION markers based on WitnessCalledEvent
  createDirectExaminationMarker(event: WitnessCalledEvent): Promise<MarkerSection>;
  
  // Find subsequent examinations using speaker patterns
  findCrossExamination(afterDirect: TrialEvent): Promise<MarkerSection | null>;
  findRedirectExamination(afterCross: TrialEvent): Promise<MarkerSection | null>;
  findRecrossExamination(afterRedirect: TrialEvent): Promise<MarkerSection | null>;
}
```

#### 1.2 Individual Witness Markers
```typescript
// Group examinations by witness
interface WitnessTestimonyBuilder {
  // Create WITNESS_TESTIMONY section encompassing all examinations
  buildWitnessTestimony(witnessId: number, examinations: MarkerSection[]): Promise<MarkerSection>;
}
```

#### 1.3 Plaintiff/Defense Witness Groups
```typescript
// Group witnesses by calling party
interface WitnessGroupBuilder {
  // Create WITNESS_TESTIMONY_PLAINTIFF section
  buildPlaintiffWitnesses(witnesses: MarkerSection[]): Promise<MarkerSection>;
  
  // Create WITNESS_TESTIMONY_DEFENSE section
  buildDefenseWitnesses(witnesses: MarkerSection[]): Promise<MarkerSection>;
}
```

#### 1.4 Complete Witness Testimony Period
```typescript
// Create overarching witness testimony period
interface TestimonyPeriodBuilder {
  // Create WITNESS_TESTIMONY_PERIOD encompassing all witness testimony
  buildTestimonyPeriod(plaintiffSection: MarkerSection, defenseSection: MarkerSection): Promise<MarkerSection>;
}
```

### Step 2: Opening and Closing Statements

#### 2.1 LongStatementsAccumulator Algorithm
```typescript
interface LongStatementsAccumulator {
  /**
   * Find the longest continuous statement by a speaker or speaker type
   * within a given time period
   */
  findLongestStatement(params: {
    trialId: number;
    speakerType: 'ATTORNEY';
    attorneyRole?: 'PLAINTIFF' | 'DEFENDANT';
    searchStartEvent?: number;  // Event ID to start search
    searchEndEvent?: number;    // Event ID to end search
    minWords: number;           // Minimum word threshold (e.g., 500)
    maxInterruptionRatio: number; // Max ratio of other speakers (e.g., 0.1)
  }): Promise<{
    startEvent: TrialEvent;
    endEvent: TrialEvent;
    totalWords: number;
    speakerWords: number;
    interruptionWords: number;
    speakerRatio: number;
    confidence: number;
  }>;

  /**
   * Optimize boundaries to maximize speaker ratio
   */
  optimizeBoundaries(params: {
    initialStart: TrialEvent;
    initialEnd: TrialEvent;
    targetSpeaker: string;
    minWords: number;
  }): Promise<{
    optimizedStart: TrialEvent;
    optimizedEnd: TrialEvent;
    speakerRatio: number;
  }>;
}
```

#### 2.2 Opening Statement Discovery
```typescript
// Search before WITNESS_TESTIMONY_PERIOD
interface OpeningStatementDiscovery {
  // Find plaintiff opening statement
  findPlaintiffOpening(beforeWitnesses: TrialEvent): Promise<MarkerSection>;
  
  // Find defense opening statement
  findDefenseOpening(beforeWitnesses: TrialEvent): Promise<MarkerSection>;
  
  // Create OPENING_STATEMENTS_PERIOD
  buildOpeningPeriod(statements: MarkerSection[]): Promise<MarkerSection>;
}
```

#### 2.3 Closing Statement Discovery
```typescript
// Search after WITNESS_TESTIMONY_PERIOD
interface ClosingStatementDiscovery {
  // Find plaintiff closing statement
  findPlaintiffClosing(afterWitnesses: TrialEvent): Promise<MarkerSection>;
  
  // Find defense closing statement
  findDefenseClosing(afterWitnesses: TrialEvent): Promise<MarkerSection>;
  
  // Find optional plaintiff rebuttal
  findPlaintiffRebuttal(afterDefenseClosing: TrialEvent): Promise<MarkerSection | null>;
  
  // Create CLOSING_STATEMENTS_PERIOD
  buildClosingPeriod(statements: MarkerSection[]): Promise<MarkerSection>;
}
```

### Step 3: Jury-Related Sections

#### 3.1 Jury Selection
```typescript
interface JurySelectionDiscovery {
  // Find jury selection period by juror speech
  findJurySelection(params: {
    beforeOpening: TrialEvent;
    trialId: number;
  }): Promise<{
    firstJurorSpeech: TrialEvent | null;
    lastJurorSpeech: TrialEvent | null;
    section: MarkerSection | null;
  }>;
}
```

#### 3.2 Case Introduction
```typescript
interface CaseIntroDiscovery {
  // Everything before jury selection (or opening if no jury)
  findCaseIntro(params: {
    trialStart: TrialEvent;
    beforeSection: MarkerSection; // JURY_SELECTION or OPENING_STATEMENTS_PERIOD
  }): Promise<MarkerSection>;
}
```

### Step 4: Verdict and Conclusion

#### 4.1 Jury Verdict
```typescript
interface JuryVerdictDiscovery {
  // Find verdict by foreperson speech
  findJuryVerdict(params: {
    afterClosing: TrialEvent;
    trialId: number;
  }): Promise<{
    firstForepersonSpeech: TrialEvent | null;
    lastForepersonSpeech: TrialEvent | null;
    section: MarkerSection | null;
  }>;
}
```

#### 4.2 Jury Deliberation and Case Wrapup
```typescript
interface TrialConclusionDiscovery {
  // Between closing and verdict
  findJuryDeliberation(params: {
    afterClosing: MarkerSection;
    beforeVerdict: MarkerSection;
  }): Promise<MarkerSection>;
  
  // After verdict to trial end
  findCaseWrapup(params: {
    afterVerdict: MarkerSection;
    trialEnd: TrialEvent;
  }): Promise<MarkerSection>;
}
```

### Step 5: Zero-Length Section Handling

```typescript
interface ZeroLengthSectionHandler {
  /**
   * Create zero-length sections for missing components
   * Places them at logical points in the sequence
   */
  createZeroLengthSection(params: {
    sectionType: MarkerSectionType;
    insertionPoint: TrialEvent;  // Where to place the zero-length section
    reason: string;               // Why it's zero-length
  }): Promise<MarkerSection>;
}
```

## Main Processing Class

```typescript
export class StandardTrialHierarchyBuilder {
  constructor(
    private prisma: PrismaClient,
    private logger: Logger
  ) {}

  /**
   * Build complete Standard Trial Sequence hierarchy
   */
  async buildStandardHierarchy(trialId: number): Promise<void> {
    this.logger.info(`Building Standard Trial Hierarchy for trial ${trialId}`);
    
    // Step 1: Build witness testimony hierarchy (bottom-up)
    const testimonyPeriod = await this.buildWitnessTestimonyHierarchy(trialId);
    
    // Step 2: Find opening and closing statements
    const openingPeriod = await this.findOpeningStatements(trialId, testimonyPeriod);
    const closingPeriod = await this.findClosingStatements(trialId, testimonyPeriod);
    
    // Step 3: Find jury-related sections
    const jurySelection = await this.findJurySelection(trialId, openingPeriod);
    const caseIntro = await this.findCaseIntro(trialId, jurySelection || openingPeriod);
    
    // Step 4: Find verdict and conclusion
    const juryVerdict = await this.findJuryVerdict(trialId, closingPeriod);
    const juryDeliberation = await this.findJuryDeliberation(closingPeriod, juryVerdict);
    const caseWrapup = await this.findCaseWrapup(juryVerdict, trialId);
    
    // Step 5: Create TRIAL marker encompassing everything
    await this.createTrialMarker(trialId);
    
    // Step 6: Create Session hierarchy
    await this.createSessionHierarchy(trialId);
    
    this.logger.info(`Completed Standard Trial Hierarchy for trial ${trialId}`);
  }
}
```

## Marker Template Configuration

### Seed Data Structure
```json
{
  "markerTemplates": [
    {
      "sectionType": "TRIAL",
      "namePattern": "{{trial.shortName}} - Complete Trial",
      "descPattern": "Complete trial proceedings for {{trial.caseNumber}}",
      "hierarchyLevel": 0
    },
    {
      "sectionType": "CASE_INTRO",
      "namePattern": "Case Introduction",
      "descPattern": "Pre-trial proceedings and case introduction",
      "hierarchyLevel": 1,
      "parentSectionType": "TRIAL"
    },
    {
      "sectionType": "JURY_SELECTION",
      "namePattern": "Jury Selection",
      "descPattern": "Voir dire and jury selection process",
      "hierarchyLevel": 1,
      "parentSectionType": "TRIAL"
    },
    {
      "sectionType": "OPENING_STATEMENTS_PERIOD",
      "namePattern": "Opening Statements",
      "descPattern": "Opening statements from all parties",
      "hierarchyLevel": 1,
      "parentSectionType": "TRIAL"
    },
    {
      "sectionType": "OPENING_STATEMENT_PLAINTIFF",
      "namePattern": "Plaintiff Opening Statement",
      "descPattern": "Opening statement by plaintiff counsel",
      "hierarchyLevel": 2,
      "parentSectionType": "OPENING_STATEMENTS_PERIOD"
    },
    // ... additional templates for complete hierarchy
  ]
}
```

## Algorithm Details

### LongStatementsAccumulator Implementation

```typescript
class LongStatementsAccumulator {
  /**
   * Core algorithm for finding long attorney statements
   */
  async findLongestStatement(params: LongStatementParams): Promise<StatementResult> {
    // 1. Load all statement events in search range
    const events = await this.loadEventsInRange(params);
    
    // 2. Group consecutive statements by speaker
    const speakerBlocks = this.groupBySpeaker(events);
    
    // 3. Find blocks matching speaker criteria
    const candidateBlocks = this.filterBySpeakerType(speakerBlocks, params);
    
    // 4. Calculate word counts and ratios for each block
    const scoredBlocks = candidateBlocks.map(block => ({
      ...block,
      totalWords: this.countWords(block.events),
      speakerWords: this.countSpeakerWords(block.events, params.speakerType),
      ratio: this.calculateSpeakerRatio(block.events, params.speakerType)
    }));
    
    // 5. Filter by minimum word threshold
    const qualifyingBlocks = scoredBlocks.filter(b => b.speakerWords >= params.minWords);
    
    // 6. Sort by speaker ratio (descending)
    qualifyingBlocks.sort((a, b) => b.ratio - a.ratio);
    
    // 7. Return the best match or optimize boundaries
    if (qualifyingBlocks.length > 0) {
      const best = qualifyingBlocks[0];
      return await this.optimizeBoundaries(best, params);
    }
    
    return null;
  }
  
  /**
   * Optimize boundaries to maximize speaker ratio
   */
  private async optimizeBoundaries(
    initialBlock: SpeakerBlock,
    params: LongStatementParams
  ): Promise<StatementResult> {
    let bestStart = initialBlock.startEvent;
    let bestEnd = initialBlock.endEvent;
    let bestRatio = initialBlock.ratio;
    
    // Try expanding boundaries
    const expanded = await this.tryExpandBoundaries(initialBlock, params);
    if (expanded.ratio > bestRatio) {
      bestStart = expanded.startEvent;
      bestEnd = expanded.endEvent;
      bestRatio = expanded.ratio;
    }
    
    // Try contracting boundaries to remove interruptions
    const contracted = await this.tryContractBoundaries(initialBlock, params);
    if (contracted.ratio > bestRatio) {
      bestStart = contracted.startEvent;
      bestEnd = contracted.endEvent;
      bestRatio = contracted.ratio;
    }
    
    return {
      startEvent: bestStart,
      endEvent: bestEnd,
      speakerRatio: bestRatio,
      confidence: this.calculateConfidence(bestRatio, params)
    };
  }
}
```

## Success Criteria

1. **Coverage**: 95% of trials have complete Standard Trial Sequence hierarchy
2. **Accuracy**: 90% accuracy in identifying major trial sections
3. **Performance**: < 30 seconds to build complete hierarchy per trial
4. **Robustness**: Graceful handling of incomplete or non-standard trials
5. **Zero-Length Handling**: All missing sections properly represented

## Testing Strategy

### Unit Tests
- LongStatementsAccumulator algorithm
- Hierarchy building logic
- Zero-length section placement
- Speaker ratio calculations

### Integration Tests
- Complete hierarchy building for sample trials
- Handling of incomplete trials
- Session hierarchy creation
- Marker template application

### End-to-End Tests
- Phase 3 processing with hierarchy building
- Timeline generation from hierarchies
- Cross-trial hierarchy comparison

## Configuration

```json
{
  "standardTrialHierarchy": {
    "enabled": true,
    "longStatements": {
      "minWords": 500,
      "maxInterruptionRatio": 0.15,
      "boundaryOptimization": true
    },
    "zeroLengthSections": {
      "createMissing": true,
      "markAsEstimated": true
    },
    "confidence": {
      "minimumForSection": 0.6,
      "highConfidence": 0.8
    }
  }
}
```

## Implementation Priority

### Phase 1: Core Infrastructure
1. Implement WitnessTestimonyHierarchyBuilder
2. Create marker template seed data
3. Build hierarchy validation logic

### Phase 2: Statement Discovery
1. Implement LongStatementsAccumulator
2. Create OpeningStatementDiscovery
3. Create ClosingStatementDiscovery

### Phase 3: Jury Sections
1. Implement JurySelectionDiscovery
2. Implement JuryVerdictDiscovery
3. Create zero-length section handler

### Phase 4: Integration
1. Implement StandardTrialHierarchyBuilder
2. Integrate with Phase 3 processing
3. Add configuration and monitoring

## Dependencies

- Feature-07D: Marker schema and timeline infrastructure
- WitnessCalledEvent processing
- Speaker identification system
- Phase 3 processing framework

## Future Enhancements

1. **Machine Learning Enhancement**
   - Train models to identify section boundaries
   - Improve confidence scoring
   - Learn from manual corrections

2. **Template Customization**
   - Court-specific templates
   - Case-type specific hierarchies
   - Custom section types

3. **Advanced Discovery**
   - Objection sequence detection
   - Sidebar identification
   - Exhibit admission tracking

4. **Visualization**
   - Interactive hierarchy explorer
   - Timeline view with drill-down
   - Cross-trial comparison tools

## API Endpoints

```typescript
// Get trial hierarchy
GET /api/trials/{trialId}/hierarchy
Response: {
  trial: MarkerSection,
  children: MarkerSection[],
  coverage: number,  // Percentage of trial covered
  confidence: number
}

// Rebuild hierarchy
POST /api/trials/{trialId}/hierarchy/rebuild
Body: {
  force: boolean,
  options: {
    includeZeroLength: boolean,
    minConfidence: number
  }
}

// Get hierarchy statistics
GET /api/trials/{trialId}/hierarchy/stats
Response: {
  totalSections: number,
  completedSections: number,
  zeroLengthSections: number,
  averageConfidence: number,
  coverage: {
    timesCovered: number,
    totalTime: number,
    percentage: number
  }
}
```

## Error Handling

1. **Missing WitnessCalledEvents**: Create estimated witness sections from speaker patterns
2. **No Jury Speakers**: Skip jury-related sections or create zero-length
3. **Overlapping Sections**: Resolve based on confidence scores
4. **Incomplete Trials**: Build partial hierarchy with available data
5. **Invalid Hierarchies**: Validation and correction mechanisms