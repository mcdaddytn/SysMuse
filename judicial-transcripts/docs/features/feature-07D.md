# Feature 07D: Advanced Marker System with Timeline Operations

## Overview
This feature extends Feature-07C with a comprehensive marker hierarchy, simplified marker types, and introduces the MarkerTimeline system for advanced timeline operations including flattening, superimposition, and summarization of trial markers.

## Objectives
1. Establish a comprehensive and stable schema for the marker system
2. Simplify MarkerType enum while expanding MarkerSectionType coverage
3. Support multiple parallel hierarchies for trial analysis
4. Enable timeline operations for flexible trial visualization
5. Provide foundation for LLM-enhanced marker discovery and summarization

## Schema Enhancements

### 1. Simplified MarkerType with Expanded MarkerSectionType

#### 1.1 MarkerType Enum (Simplified)
```prisma
enum MarkerType {
  SECTION_START      // Marks the beginning of a section
  SECTION_END        // Marks the end of a section
  SECTION_LOCATOR    // Marks a point within a section (for searching boundaries)
  SEARCH_LOCATOR     // General search marker (not section-specific)
  CUSTOM             // User-defined marker
}
```

**Key Design Principle**: MarkerType is now simplified to describe the *function* of the marker, while MarkerSectionType describes the *content* of what is being marked. When MarkerType is SECTION_START or SECTION_END, the Marker record must include a corresponding MarkerSectionType value.

#### 1.2 MarkerSectionType Enum (Comprehensive)
```prisma
enum MarkerSectionType {
  // Top Level Hierarchy
  TRIAL                          // Root level
  SESSION                        // Session level (under TRIAL)
  
  // Standard Trial Sequence (under TRIAL)
  CASE_INTRO
  JURY_SELECTION
  OPENING_STATEMENTS_PERIOD
  OPENING_STATEMENT_PLAINTIFF
  OPENING_STATEMENT_DEFENSE
  WITNESS_TESTIMONY_PERIOD
  WITNESS_TESTIMONY_PLAINTIFF    // All plaintiff witnesses
  WITNESS_TESTIMONY_DEFENSE      // All defense witnesses
  CLOSING_STATEMENTS_PERIOD
  CLOSING_STATEMENT_PLAINTIFF
  CLOSING_STATEMENT_DEFENSE
  CLOSING_REBUTTAL_PLAINTIFF
  JURY_DELIBERATION
  JURY_VERDICT
  CASE_WRAPUP
  
  // Witness Level (under WITNESS_TESTIMONY_PLAINTIFF/DEFENSE)
  WITNESS_TESTIMONY              // Individual witness
  COMPLETE_WITNESS_TESTIMONY     // Legacy compatibility
  
  // Examination Level (under WITNESS_TESTIMONY)
  WITNESS_EXAMINATION            // Generic examination
  DIRECT_EXAMINATION
  CROSS_EXAMINATION
  REDIRECT_EXAMINATION
  RECROSS_EXAMINATION
  
  // Special Sections
  OBJECTION_SEQUENCE
  SIDEBAR
  BENCH_CONFERENCE
  RECESS
  BREAK
  HOUSEKEEPING
  EXHIBIT_ADMISSION
  DEPOSITION_READING
  VIDEO_PLAYBACK
  
  // Administrative
  OPENING_ARGUMENT              // Legacy compatibility
  CLOSING_ARGUMENT              // Legacy compatibility
  VERDICT                        // Legacy compatibility
  ACTIVITY                       // Legacy compatibility
  CUSTOM                         // User-defined sections
  
  // Timeline Operations (generated sections)
  TIMELINE_GAP                   // Auto-generated gap filler
  TIMELINE_INTRO                 // Auto-generated intro
  TIMELINE_CONCLUSION            // Auto-generated conclusion
  TIMELINE_TRANSITION            // Auto-generated transition
}
```

### 2. Database Schema Updates

#### 2.1 Enhanced Marker Model
```prisma
model Marker {
  id               Int                @id @default(autoincrement())
  trialId          Int
  markerType       MarkerType
  sectionType      MarkerSectionType? // Required when markerType is SECTION_START/END
  eventId          Int?
  name             String?
  description      String?
  metadata         Json?
  
  // Source tracking
  source           MarkerSource       @default(MANUAL)
  confidence       Float?             // 0.0 to 1.0
  
  createdAt        DateTime           @default(now())
  updatedAt        DateTime           @updatedAt
  
  // Relations
  event            TrialEvent?        @relation(fields: [eventId], references: [id])
  trial            Trial              @relation(fields: [trialId], references: [id], onDelete: Cascade)
  endingSections   MarkerSection[]    @relation("EndMarker")
  startingSections MarkerSection[]    @relation("StartMarker")
  
  @@index([trialId, markerType])
  @@index([trialId, sectionType])
}
```

#### 2.2 Enhanced MarkerSection Model
```prisma
model MarkerSection {
  id                Int                @id @default(autoincrement())
  trialId           Int
  markerSectionType MarkerSectionType
  startMarkerId     Int?
  endMarkerId       Int?
  startEventId      Int?
  endEventId        Int?
  startTime         String?
  endTime           String?
  name              String?
  description       String?
  metadata          Json?
  
  // Hierarchical relationships
  parentSectionId   Int?
  parentSection     MarkerSection?     @relation("ParentChild", fields: [parentSectionId], references: [id])
  childSections     MarkerSection[]    @relation("ParentChild")
  
  // Text aggregation
  text              String?            @db.Text
  textTemplate      String?            // Mustache template for text generation
  
  // ElasticSearch integration
  elasticSearchId   String?
  
  // Source tracking
  source            MarkerSource       @default(MANUAL)
  confidence        Float?             // 0.0 to 1.0
  llmProvider       String?            // e.g., "openai", "anthropic"
  llmModel          String?            // e.g., "gpt-4", "claude-3"
  
  // Timeline membership
  timelineMembers   MarkerTimelineMember[]
  
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt
  
  // Relations
  endEvent          TrialEvent?        @relation("SectionEnd", fields: [endEventId], references: [id])
  endMarker         Marker?            @relation("EndMarker", fields: [endMarkerId], references: [id])
  startEvent        TrialEvent?        @relation("SectionStart", fields: [startEventId], references: [id])
  startMarker       Marker?            @relation("StartMarker", fields: [startMarkerId], references: [id])
  trial             Trial              @relation(fields: [trialId], references: [id], onDelete: Cascade)
  
  @@index([trialId, markerSectionType])
  @@index([parentSectionId])
  @@index([source])
}
```

#### 2.3 New MarkerTimeline Model
```prisma
model MarkerTimeline {
  id                    Int                      @id @default(autoincrement())
  trialId               Int
  name                  String
  description           String?
  timelineType          MarkerTimelineType
  
  // Timeline configuration
  continuousSections    Boolean                  @default(false)
  gapFillingStrategy    GapFillingStrategy?      @default(NONE)
  
  // Source timeline references (for derived timelines)
  sourceTimelineId      Int?
  sourceTimeline        MarkerTimeline?          @relation("DerivedTimelines", fields: [sourceTimelineId], references: [id])
  derivedTimelines      MarkerTimeline[]         @relation("DerivedTimelines")
  
  // Timeline metadata
  metadata              Json?
  operationSpec         Json?                    // Specification of how timeline was created
  
  createdAt             DateTime                 @default(now())
  updatedAt             DateTime                 @updatedAt
  
  // Relations
  trial                 Trial                    @relation(fields: [trialId], references: [id], onDelete: Cascade)
  members               MarkerTimelineMember[]
  templates             MarkerTimelineTemplate[]
  
  @@index([trialId])
  @@index([timelineType])
}
```

#### 2.4 MarkerTimelineMember Model (Junction Table)
```prisma
model MarkerTimelineMember {
  id                Int              @id @default(autoincrement())
  timelineId        Int
  sectionId         Int
  sequenceOrder     Int              // Order within timeline
  
  // For generated sections
  isGenerated       Boolean          @default(false)
  generationType    GenerationType?
  
  createdAt         DateTime         @default(now())
  
  // Relations
  timeline          MarkerTimeline   @relation(fields: [timelineId], references: [id], onDelete: Cascade)
  section           MarkerSection    @relation(fields: [sectionId], references: [id], onDelete: Cascade)
  
  @@unique([timelineId, sequenceOrder])
  @@index([timelineId])
  @@index([sectionId])
}
```

#### 2.5 MarkerTimelineTemplate Model
```prisma
model MarkerTimelineTemplate {
  id                    Int                @id @default(autoincrement())
  timelineId            Int?
  templateType          TimelineTemplateType
  
  // Templates for different gap types
  gapTemplate           String?            // Mustache template for gaps
  introTemplate         String?            // Mustache template for intro
  conclusionTemplate    String?            // Mustache template for conclusion
  transitionTemplate    String?            // Mustache template for transitions
  
  // Naming patterns
  namePattern           String
  descriptionPattern    String?
  
  isActive              Boolean            @default(true)
  createdAt             DateTime           @default(now())
  updatedAt             DateTime           @updatedAt
  
  // Relations
  timeline              MarkerTimeline?    @relation(fields: [timelineId], references: [id])
  
  @@index([templateType])
}
```

### 3. New Enum Types

```prisma
enum MarkerSource {
  MANUAL              // User-created
  AUTO_EVENT          // Generated from events (e.g., witness called)
  AUTO_PATTERN        // Generated from pattern matching
  LLM_EXTRACTION      // Generated by LLM
  IMPORT              // Imported from override file
  TIMELINE_GENERATED  // Generated by timeline operations
}

enum MarkerTimelineType {
  STANDARD_TRIAL      // Standard trial sequence
  SESSION_BASED       // Session-based timeline
  WITNESS_BASED       // Witness testimony timeline
  EXAMINATION_BASED   // Examination sequence timeline
  OBJECTION_BASED     // Objection sequence timeline
  FLATTENED           // Derived from flattening operation
  SUPERIMPOSED        // Derived from superimposition
  SUMMARIZED          // Derived from summarization
  CUSTOM              // User-defined timeline
}

enum GapFillingStrategy {
  NONE                // No gap filling
  SIMPLE              // Simple numbered gaps
  CONTEXTUAL          // Context-aware naming
  LLM_GENERATED       // LLM-generated descriptions
}

enum GenerationType {
  GAP_FILLER          // Fills gap between sections
  INTRO_FILLER        // Fills beginning before first section
  CONCLUSION_FILLER   // Fills end after last section
  TRANSITION          // Transition between major sections
}

enum TimelineTemplateType {
  GAP                 // Template for gaps
  INTRO               // Template for introduction
  CONCLUSION          // Template for conclusion
  TRANSITION          // Template for transitions
  SECTION_NAME        // Template for section naming
}
```

## Migration of Existing Markers

### Mapping Current MarkerType Values to New System

| Current MarkerType | New MarkerType | New MarkerSectionType | Notes |
|-------------------|----------------|----------------------|-------|
| ACTIVITY_START | SECTION_START | ACTIVITY | Legacy support |
| ACTIVITY_END | SECTION_END | ACTIVITY | Legacy support |
| WITNESS_TESTIMONY_START | SECTION_START | WITNESS_TESTIMONY | Individual witness |
| WITNESS_TESTIMONY_END | SECTION_END | WITNESS_TESTIMONY | Individual witness |
| WITNESS_EXAMINATION_START | SECTION_START | WITNESS_EXAMINATION | Generic examination |
| WITNESS_EXAMINATION_END | SECTION_END | WITNESS_EXAMINATION | Generic examination |

### Auto-Generation Rules for Easy-to-Establish Markers

```typescript
// Trial markers (easiest to establish)
const firstEvent = await getFirstTrialEvent(trialId);
const lastEvent = await getLastTrialEvent(trialId);

await createMarker({
  markerType: 'SECTION_START',
  sectionType: 'TRIAL',
  name: `${trial.shortName} - Start`,
  eventId: firstEvent.id,
  source: 'AUTO_EVENT'
});

await createMarker({
  markerType: 'SECTION_END',
  sectionType: 'TRIAL',
  name: `${trial.shortName} - End`,
  eventId: lastEvent.id,
  source: 'AUTO_EVENT'
});

// Session markers (easy to establish)
for (const session of sessions) {
  const firstSessionEvent = await getFirstSessionEvent(session.id);
  const lastSessionEvent = await getLastSessionEvent(session.id);
  
  await createMarker({
    markerType: 'SECTION_START',
    sectionType: 'SESSION',
    name: `${session.sessionHandle} - Start`,
    eventId: firstSessionEvent.id,
    source: 'AUTO_EVENT'
  });
  
  await createMarker({
    markerType: 'SECTION_END',
    sectionType: 'SESSION',
    name: `${session.sessionHandle} - End`,
    eventId: lastSessionEvent.id,
    source: 'AUTO_EVENT'
  });
}

// Witness testimony markers (from WitnessCalledEvent)
for (const witnessEvent of witnessCalledEvents) {
  await createMarker({
    markerType: 'SECTION_START',
    sectionType: 'WITNESS_TESTIMONY',
    name: `${witnessEvent.witnessName} - Testimony Start`,
    eventId: witnessEvent.id,
    source: 'AUTO_EVENT'
  });
  
  // End marker found by next witness or section change
  const endEvent = await findWitnessTestimonyEnd(witnessEvent);
  if (endEvent) {
    await createMarker({
      markerType: 'SECTION_END',
      sectionType: 'WITNESS_TESTIMONY',
      name: `${witnessEvent.witnessName} - Testimony End`,
      eventId: endEvent.id,
      source: 'AUTO_EVENT'
    });
  }
}
```

### Using Locator Markers for Discovery

```typescript
// SECTION_LOCATOR example: Finding opening statement boundaries
const openingLocator = await findPhraseInTranscript(
  trialId,
  "Your Honor, ladies and gentlemen of the jury"
);

if (openingLocator) {
  await createMarker({
    markerType: 'SECTION_LOCATOR',
    sectionType: 'OPENING_STATEMENT_PLAINTIFF',
    name: 'Possible Opening Statement Location',
    eventId: openingLocator.eventId,
    source: 'AUTO_PATTERN',
    confidence: 0.7
  });
  
  // Use locator to search for actual boundaries
  const boundaries = await searchSectionBoundaries(openingLocator);
  if (boundaries.start && boundaries.end) {
    await createMarker({
      markerType: 'SECTION_START',
      sectionType: 'OPENING_STATEMENT_PLAINTIFF',
      eventId: boundaries.start.eventId,
      source: 'LLM_EXTRACTION',
      confidence: boundaries.confidence
    });
    
    await createMarker({
      markerType: 'SECTION_END',
      sectionType: 'OPENING_STATEMENT_PLAINTIFF',
      eventId: boundaries.end.eventId,
      source: 'LLM_EXTRACTION',
      confidence: boundaries.confidence
    });
  }
}

// SEARCH_LOCATOR example: General search markers
const objectionMarkers = await findAllObjections(trialId);
for (const objection of objectionMarkers) {
  await createMarker({
    markerType: 'SEARCH_LOCATOR',
    name: `Objection at line ${objection.lineNumber}`,
    eventId: objection.eventId,
    source: 'AUTO_PATTERN',
    metadata: { searchTerm: 'objection', context: objection.context }
  });
}
```

## Timeline Operations

### 1. FLATTEN Operation
Converts a hierarchical marker structure into a flat timeline at a specified level.

```typescript
interface FlattenSpec {
  sourceSection: MarkerSection;  // Must be type TRIAL
  targetLevel: MarkerSectionType;  // e.g., SESSION, WITNESS_TESTIMONY
  continuousSections: boolean;
  gapFillingStrategy: GapFillingStrategy;
}
```

### 2. SUPERIMPOSE Operation
Combines two timelines, creating new sections from overlaps.

```typescript
interface SuperimposeSpec {
  timeline1: MarkerTimeline;
  timeline2: MarkerTimeline;
  namingStrategy: 'CONCATENATE' | 'PRIMARY' | 'TEMPLATE';
  preserveOriginals: boolean;
}
```

### 3. SUMMARIZE Operation
Creates a summarized version of a timeline using LLM.

```typescript
interface SummarizeSpec {
  sourceTimeline: MarkerTimeline;
  llmProvider: string;
  llmModel: string;
  summaryTemplate: string;  // Mustache template
  maxSummaryLength: number;
}
```

## Implementation Priority

### Phase 1: Immediate Schema Updates and Migration
1. Update Prisma schema with simplified MarkerType
2. Add comprehensive MarkerSectionType values
3. Migrate existing markers to new schema
4. Update code to compile with new enums

### Phase 2: Auto-Generation of Easy Markers
1. Auto-generate TRIAL start/end markers
2. Auto-generate SESSION start/end markers
3. Convert WitnessCalledEvents to proper markers
4. Map existing markers to CUSTOM or SEARCH_LOCATOR

### Phase 3: Timeline Infrastructure
1. Implement MarkerTimeline models
2. Create FLATTEN operation
3. Add gap filling for continuous timelines

### Phase 4: Advanced Features
1. Implement SUPERIMPOSE operation
2. Add SUMMARIZE operation with LLM
3. Create locator-based boundary search

## API Design (For Parallel Development)

### Marker Management
```typescript
// Create marker with simplified type
POST /api/markers
Body: {
  trialId: number,
  markerType: MarkerType,
  sectionType?: MarkerSectionType,  // Required for SECTION_START/END
  eventId?: number,
  name?: string,
  source?: MarkerSource
}

// Search for section boundaries using locator
POST /api/markers/find-boundaries
Body: {
  locatorMarkerId: number,
  sectionType: MarkerSectionType,
  searchRadius: number  // Events before/after to search
}

// Convert search locators to section markers
POST /api/markers/promote-locator
Body: {
  locatorMarkerId: number,
  toMarkerType: 'SECTION_START' | 'SECTION_END',
  sectionType: MarkerSectionType
}
```

### Timeline Operations
```typescript
// Create timeline from markers
POST /api/timelines/create
Body: {
  trialId: number,
  operation: 'FLATTEN' | 'SUPERIMPOSE' | 'SUMMARIZE',
  spec: FlattenSpec | SuperimposeSpec | SummarizeSpec
}

// Get timeline with sections
GET /api/timelines/{timelineId}

// Export timeline for visualization
GET /api/timelines/{timelineId}/export?format=json
```

## GUI Specification Concepts

### Timeline Viewer Component
- Hierarchical tree view of marker sections
- Timeline visualization with drag-and-drop marker adjustment
- Search interface for locator markers
- Confidence indicators for auto-generated markers

### Marker Discovery Interface
- List of SECTION_LOCATOR markers awaiting boundary detection
- LLM-assisted boundary search with preview
- Batch conversion of locators to section markers
- Manual override and adjustment tools

### Timeline Operations Builder
- Visual interface for FLATTEN/SUPERIMPOSE operations
- Preview of resulting timeline before creation
- Template editor for gap filling and naming
- Export options for different formats

## Migration Strategy

### Database Migration Steps
```bash
# 1. Backup current database
../scripts/db/backupdb.sh pre_feature_07d

# 2. Update schema.prisma with new enums and models

# 3. Push schema changes (will require data migration)
npx prisma db push

# 4. Run migration script to update existing markers
npx ts-node scripts/migrate-markers-07d.ts

# 5. Verify migration
npx ts-node scripts/verify-marker-migration.ts

# 6. Backup post-migration
../scripts/db/backupdb.sh post_feature_07d
```

### Code Updates Required
1. Update all references to old MarkerType enum values
2. Add sectionType field where creating SECTION_START/END markers
3. Update marker queries to include sectionType
4. Modify marker display logic to show section type

## Testing Considerations

### Unit Tests
- Marker type/section type validation
- Timeline operation logic
- Gap detection algorithms
- Migration script correctness

### Integration Tests
- Auto-generation of trial/session markers
- Locator to section marker conversion
- Timeline creation and manipulation
- ElasticSearch indexing

### End-to-End Tests
- Complete marker discovery workflow
- Timeline generation and export
- GUI interaction flows

## Configuration

```json
{
  "markers": {
    "autoGenerate": {
      "trial": true,
      "session": true,
      "witnessTestimony": true
    },
    "locatorSearch": {
      "defaultRadius": 50,
      "confidenceThreshold": 0.7
    },
    "timeline": {
      "defaultGapFilling": "SIMPLE",
      "continuousByDefault": false
    }
  }
}
```

## Success Metrics

1. **Schema Stability**: < 5% schema changes after implementation
2. **Code Compilation**: All existing code compiles with new schema
3. **Auto-Generation**: 100% of trials have TRIAL/SESSION markers
4. **Migration Success**: 100% of existing markers properly migrated
5. **API Response Time**: < 1 second for marker operations

## Dependencies

- Feature-07C: Base marker system implementation
- Existing WitnessCalledEvent processing
- ElasticSearch for marker search
- Mustache for template rendering