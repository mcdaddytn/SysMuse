# Feature 03E: MarkerSection Text Aggregation and Elasticsearch Integration

## Overview
MarkerSection is a generic construct that defines a region of the transcript bounded by two Markers. This feature will implement text aggregation for MarkerSections and integrate them with Elasticsearch for permanent searchable storage across all trials.

## Current State

### Marker
- **Purpose**: Identifies a single TrialEvent using expressions/patterns
- **Structure**: 
  - Links to a single `eventId`
  - Has a `markerType` (e.g., WITNESS_TESTIMONY_START, ACTIVITY_START)
  - Stores flexible data in `metadata` JSON field
  - Does NOT contain transcript text directly

### MarkerSection  
- **Purpose**: Defines a region between two Markers (start and end)
- **Structure**:
  - Has `startMarkerId` and `endMarkerId` to define boundaries
  - Has `startEventId` and `endEventId` for direct event references
  - Currently does NOT have aggregated text
  - Uses `metadata` JSON for flexible data storage

### Current Gap
MarkerSections define regions but don't contain the actual transcript text from those regions. The text exists in the individual Line records between the start and end events.

## Proposed Implementation

### 1. Text Aggregation Service
Create a service to aggregate transcript text for a MarkerSection:

```typescript
class MarkerSectionTextAggregator {
  async aggregateText(markerSection: MarkerSection): Promise<string> {
    // 1. Get all Lines between startEventId and endEventId
    // 2. Order by page number and line number
    // 3. Concatenate text preserving structure
    // 4. Return aggregated text
  }
  
  async aggregateTextWithMetadata(markerSection: MarkerSection): Promise<{
    text: string;
    pageRange: { start: number; end: number };
    lineRange: { start: number; end: number };
    wordCount: number;
    speakerBreakdown: Map<string, number>;
  }> {
    // Enhanced aggregation with metadata
  }
}
```

### 2. Database Schema Enhancement
Add text storage to MarkerSection:

```prisma
model MarkerSection {
  // ... existing fields ...
  
  // New fields for text aggregation
  aggregatedText    String?     @db.Text  // Full text of the section
  textMetadata      Json?       // Metadata about the text
  elasticsearchId   String?     // ES document ID
  lastAggregatedAt  DateTime?   // When text was last aggregated
  
  @@index([elasticsearchId])
}
```

### 3. Elasticsearch Integration

#### Phase 3 Permanent Index Structure
```json
{
  "mappings": {
    "properties": {
      // Trial identification
      "trialId": { "type": "integer" },
      "trialName": { "type": "keyword" },
      "caseNumber": { "type": "keyword" },
      
      // MarkerSection identification
      "markerSectionId": { "type": "integer" },
      "markerSectionType": { "type": "keyword" },
      
      // Marker information
      "startMarkerType": { "type": "keyword" },
      "endMarkerType": { "type": "keyword" },
      
      // Aggregated content
      "text": { 
        "type": "text",
        "analyzer": "standard",
        "fields": {
          "keyword": { "type": "keyword", "ignore_above": 256 }
        }
      },
      
      // Position information
      "pageRange": {
        "properties": {
          "start": { "type": "integer" },
          "end": { "type": "integer" }
        }
      },
      "lineRange": {
        "properties": {
          "start": { "type": "integer" },
          "end": { "type": "integer" }
        }
      },
      
      // Witness-specific fields (from metadata)
      "witnessName": { "type": "keyword" },
      "witnessId": { "type": "integer" },
      "examinationType": { "type": "keyword" },
      "attorneyName": { "type": "keyword" },
      
      // Metadata
      "wordCount": { "type": "integer" },
      "speakerCount": { "type": "integer" },
      "metadata": { "type": "object", "enabled": false },
      
      // Timestamps
      "createdAt": { "type": "date" },
      "aggregatedAt": { "type": "date" }
    }
  }
}
```

### 4. Processing Pipeline

#### Phase 3 Enhancement
```typescript
class Phase3Processor {
  async process(trialId: number) {
    // ... existing marker discovery ...
    
    // NEW: Aggregate text for all MarkerSections
    await this.aggregateMarkerSectionTexts(trialId);
    
    // NEW: Index to permanent Elasticsearch
    await this.indexMarkerSectionsToElasticsearch(trialId);
    
    // Optional: Clean up Phase 2 data
    if (options.cleanupAfter) {
      await this.cleanupPhase2Data(trialId);
    }
  }
}
```

### 5. Search Integration
Enable searching across all trials' MarkerSections:

```typescript
class MarkerSectionSearchService {
  async searchAcrossTrials(query: string, filters?: {
    trialIds?: number[];
    markerTypes?: string[];
    witnessNames?: string[];
    dateRange?: { start: Date; end: Date };
  }): Promise<MarkerSectionSearchResult[]> {
    // Search the permanent Phase 3 index
  }
  
  async searchWitnessTestimony(
    witnessName: string,
    searchTerms: string[]
  ): Promise<WitnessTestimonyResult[]> {
    // Specialized witness testimony search
  }
}
```

## Benefits

1. **Permanent Searchability**: MarkerSections remain searchable after Phase 2 cleanup
2. **Efficient Storage**: Only meaningful sections are stored, not raw events
3. **Rich Context**: Aggregated text includes full context of the section
4. **Cross-Trial Search**: Can search witness testimony across all trials
5. **Structured Data**: Metadata enables filtering and analytics

## Implementation Steps

1. [ ] Create MarkerSectionTextAggregator service
2. [ ] Add aggregatedText fields to MarkerSection model
3. [ ] Run migration to update database schema
4. [ ] Implement text aggregation in Phase 3
5. [ ] Create permanent Elasticsearch index mapping
6. [ ] Implement MarkerSection indexing to ES
7. [ ] Create MarkerSectionSearchService
8. [ ] Update API endpoints to use new search
9. [ ] Add CLI commands for text aggregation
10. [ ] Document API changes

## Testing Requirements

1. Verify text aggregation preserves order and structure
2. Test aggregation of large sections (performance)
3. Verify ES indexing handles special characters
4. Test cross-trial search functionality
5. Verify cleanup doesn't affect permanent index
6. Test search result relevance and ranking

## Open Questions

1. Should we aggregate text on-demand or pre-compute during Phase 3?
2. What's the maximum size for aggregatedText field?
3. Should we store formatted text (with speaker labels) or raw text?
4. How to handle overlapping MarkerSections?
5. Should we version the aggregated text if markers change?

## Notes

- MarkerSection is a generic abstraction, not specific to witnesses
- The aggregated text should preserve speaker transitions
- Consider memory usage when aggregating very large sections
- May need pagination for sections spanning hundreds of pages