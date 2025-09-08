# Feature 07F: MarkerSection Text Generation and ElasticSearch Integration

## Overview
This feature implements text generation capabilities for MarkerSections using Mustache templates, enabling clean transcript rendering and ElasticSearch integration. Building on the existing schema fields (`text`, `textTemplate`, `elasticSearchId`), this feature focuses on the template system, text generation process, and search capabilities.

## Objectives
1. Implement text generation using existing MarkerSection fields
2. Create hierarchical Mustache template system
3. Generate clean transcript text without artifacts
4. Enable ElasticSearch indexing and search
5. Provide rich context for template rendering

## Schema Changes (Minimal)

### 1. MarkerSection Model Updates
```prisma
model MarkerSection {
  // ... existing fields (text, textTemplate, elasticSearchId already exist) ...
  
  // Add source tracking
  markerSourceName  String?            // Optional detailed source identifier
  textGenerated     Boolean            @default(false)
  textGeneratedAt   DateTime?
  
  // Remove llmProvider and llmModel (moved to markerSourceName/metadata)
  // ... existing relations ...
}
```

### 2. MarkerTemplate Model Updates
```prisma
model MarkerTemplate {
  // ... existing fields ...
  
  // Template configuration
  textTemplateName  String?            // Mustache template file name
  inheritTemplate   Boolean            @default(true)  // Inherit from parent if not specified
  templatePriority  Int                @default(100)    // Higher priority overrides lower
  
  // ... existing relations ...
}
```

## Template System Design

### 1. Template Hierarchy and Inheritance

```typescript
interface TemplateResolver {
  /**
   * Resolve template for a MarkerSection following hierarchy rules
   */
  async resolveTemplate(section: MarkerSection): Promise<string> {
    // 1. Check section's direct textTemplate override
    if (section.textTemplate) {
      return section.textTemplate;
    }
    
    // 2. Find MarkerTemplate for this section type
    const template = await this.prisma.markerTemplate.findFirst({
      where: {
        sectionType: section.markerSectionType,
        isActive: true
      },
      orderBy: {
        templatePriority: 'desc'
      }
    });
    
    if (template?.textTemplateName) {
      return template.textTemplateName;
    }
    
    // 3. Inherit from parent section if configured
    if (section.parentSectionId) {
      const parentSection = await this.prisma.markerSection.findUnique({
        where: { id: section.parentSectionId }
      });
      if (parentSection) {
        return await this.resolveTemplate(parentSection);
      }
    }
    
    // 4. Use default trial-level template
    return 'default-trial-transcript.mustache';
  }
}
```

### 2. Template Context Data Structure

```typescript
interface MarkerSectionContext {
  // Section metadata
  section: {
    id: number;
    name: string;
    description: string;
    type: string;
    startTime: string;
    endTime: string;
    metadata: any;
    source: string;
    markerSourceName?: string;
  };
  
  // Trial information
  trial: {
    id: number;
    name: string;
    shortName: string;
    caseNumber: string;
    plaintiff: string;
    defendant: string;
  };
  
  // Events within section boundaries
  events: Array<{
    id: number;
    type: 'STATEMENT' | 'WITNESS_CALLED' | 'COURT_DIRECTIVE';
    ordinal: number;
    startTime: string;
    endTime: string;
    
    // Statement event data
    statement?: {
      text: string;
      rawText: string;
      speaker: {
        id: number;
        name: string;
        speakerHandle: string;
        speakerType: string;
        role?: string;
      };
      attorney?: {
        id: number;
        name: string;
        firm: string;
        role: 'PLAINTIFF' | 'DEFENDANT';
      };
      witness?: {
        id: number;
        name: string;
        type: string;
      };
    };
    
    // Witness called event data
    witnessCall?: {
      witness: {
        id: number;
        name: string;
        type: string;
      };
      examinationType: string;
      calledBy: string;
      swornStatus: string;
    };
    
    // Court directive event data
    directive?: {
      type: string;
      description: string;
    };
  }>;
  
  // Summary statistics
  summary: {
    totalEvents: number;
    totalStatements: number;
    totalWords: number;
    speakers: Array<{
      name: string;
      role: string;
      statementCount: number;
      wordCount: number;
    }>;
  };
}
```

## Mustache Templates

### 1. Default Trial Transcript Template
```mustache
{{! templates/default-trial-transcript.mustache }}
{{#section}}
================================================================================
{{name}}
{{#description}}{{description}}{{/description}}
{{startTime}} - {{endTime}}
================================================================================

{{/section}}
{{#events}}
{{#statement}}
{{speaker.name}}: {{text}}

{{/statement}}
{{#witnessCall}}
[WITNESS CALLED: {{witness.name}} - {{examinationType}}]

{{/witnessCall}}
{{#directive}}
[{{type}}: {{description}}]

{{/directive}}
{{/events}}
```

### 2. Clean Transcript Template
```mustache
{{! templates/clean-transcript.mustache }}
{{#events}}
{{#statement}}
{{speaker.name}}: {{text}}

{{/statement}}
{{/events}}
```

### 3. Witness Testimony Template
```mustache
{{! templates/witness-testimony.mustache }}
{{#section}}
WITNESS TESTIMONY: {{section.metadata.witnessName}}
{{#section.metadata.witnessType}}TYPE: {{section.metadata.witnessType}}{{/section.metadata.witnessType}}
{{#section.metadata.calledBy}}CALLED BY: {{section.metadata.calledBy}}{{/section.metadata.calledBy}}
--------------------------------------------------------------------------------

{{/section}}
{{#events}}
{{#statement}}
{{#witness}}
THE WITNESS: {{text}}
{{/witness}}
{{^witness}}
{{speaker.name}}: {{text}}
{{/witness}}

{{/statement}}
{{/events}}
```

### 4. Examination Q&A Template
```mustache
{{! templates/examination-qa.mustache }}
{{#section}}
{{section.metadata.examinationType}} EXAMINATION
{{#section.metadata.attorneyName}}BY {{section.metadata.attorneyName}}{{/section.metadata.attorneyName}}
--------------------------------------------------------------------------------

{{/section}}
{{#events}}
{{#statement}}
{{#attorney}}
Q. {{text}}
{{/attorney}}
{{#witness}}
A. {{text}}
{{/witness}}
{{^attorney}}{{^witness}}
{{speaker.name}}: {{text}}
{{/witness}}{{/attorney}}

{{/statement}}
{{/events}}
```

### 5. Attorney Statement Template
```mustache
{{! templates/attorney-statement.mustache }}
{{#section}}
{{name}}
{{#section.metadata.attorneyName}}By: {{section.metadata.attorneyName}}{{/section.metadata.attorneyName}}
{{#section.metadata.firm}}{{section.metadata.firm}}{{/section.metadata.firm}}
{{#section.metadata.role}}For: {{section.metadata.role}}{{/section.metadata.role}}
================================================================================

{{/section}}
{{#events}}
{{#statement}}
{{text}}

{{/statement}}
{{/events}}
```

## Text Generation Implementation

### 1. Text Generator Service
```typescript
export class MarkerSectionTextGenerator {
  constructor(
    private prisma: PrismaClient,
    private templateResolver: TemplateResolver,
    private mustache: MustacheService
  ) {}
  
  /**
   * Generate text for a MarkerSection
   */
  async generateText(sectionId: number): Promise<string> {
    // 1. Load section with relations
    const section = await this.loadSectionWithRelations(sectionId);
    
    // 2. Resolve appropriate template
    const templateName = await this.templateResolver.resolveTemplate(section);
    
    // 3. Build context from events within section boundaries
    const context = await this.buildContext(section);
    
    // 4. Render template with context
    const text = await this.mustache.render(templateName, context);
    
    // 5. Update section with generated text
    await this.prisma.markerSection.update({
      where: { id: sectionId },
      data: {
        text,
        textGenerated: true,
        textGeneratedAt: new Date()
      }
    });
    
    // 6. Index in ElasticSearch if configured
    if (text) {
      await this.indexInElasticSearch(section, text);
    }
    
    return text;
  }
  
  /**
   * Build context data for template rendering
   */
  private async buildContext(section: MarkerSection): Promise<MarkerSectionContext> {
    // Load all events within section time boundaries
    const events = await this.prisma.trialEvent.findMany({
      where: {
        trialId: section.trialId,
        startTime: {
          gte: section.startTime,
          lte: section.endTime
        }
      },
      include: {
        statementEvent: {
          include: {
            speaker: true,
            attorney: {
              include: {
                trialAttorneys: {
                  where: { trialId: section.trialId }
                }
              }
            },
            witness: true
          }
        },
        witnessCalledEvent: {
          include: {
            witness: {
              include: {
                speaker: true
              }
            }
          }
        },
        courtDirectiveEvent: {
          include: {
            directiveType: true
          }
        }
      },
      orderBy: {
        ordinal: 'asc'
      }
    });
    
    return {
      section: this.transformSection(section),
      trial: await this.loadTrialContext(section.trialId),
      events: this.transformEvents(events),
      summary: this.calculateSummary(events)
    };
  }
}
```

### 2. Batch Generation Service
```typescript
export class MarkerSectionBatchGenerator {
  /**
   * Generate text for all sections in a trial
   */
  async generateAllSectionText(trialId: number): Promise<void> {
    // Process hierarchy top-down for proper inheritance
    const sections = await this.prisma.markerSection.findMany({
      where: {
        trialId,
        OR: [
          { textGenerated: false },
          { text: null }
        ]
      },
      orderBy: [
        { parentSectionId: 'asc' },
        { startTime: 'asc' }
      ]
    });
    
    this.logger.info(`Generating text for ${sections.length} sections in trial ${trialId}`);
    
    for (const section of sections) {
      try {
        await this.generator.generateText(section.id);
      } catch (error) {
        this.logger.error(`Failed to generate text for section ${section.id}:`, error);
      }
    }
  }
  
  /**
   * Regenerate text with optional template override
   */
  async regenerateText(
    sectionId: number, 
    options?: {
      templateOverride?: string;
      force?: boolean;
    }
  ): Promise<void> {
    if (options?.templateOverride) {
      await this.prisma.markerSection.update({
        where: { id: sectionId },
        data: { 
          textTemplate: options.templateOverride,
          textGenerated: false
        }
      });
    }
    
    await this.generator.generateText(sectionId);
  }
}
```

## ElasticSearch Integration

### 1. Index Mapping
```json
{
  "mappings": {
    "properties": {
      "type": { "type": "keyword" },
      "trialId": { "type": "integer" },
      "sectionId": { "type": "integer" },
      "sectionType": { "type": "keyword" },
      "name": { 
        "type": "text",
        "fields": {
          "keyword": { "type": "keyword" }
        }
      },
      "text": { 
        "type": "text",
        "analyzer": "standard"
      },
      "startTime": { "type": "keyword" },
      "endTime": { "type": "keyword" },
      "parentSectionId": { "type": "integer" },
      "source": { "type": "keyword" },
      "markerSourceName": { "type": "keyword" },
      "confidence": { "type": "float" },
      "wordCount": { "type": "integer" },
      "speakers": {
        "type": "nested",
        "properties": {
          "name": { "type": "keyword" },
          "role": { "type": "keyword" },
          "wordCount": { "type": "integer" }
        }
      }
    }
  }
}
```

### 2. Indexing Service
```typescript
export class MarkerSectionElasticSearchService {
  /**
   * Index a MarkerSection in ElasticSearch
   */
  async indexMarkerSection(section: MarkerSection, text: string): Promise<void> {
    const document = {
      type: 'marker_section',
      trialId: section.trialId,
      sectionId: section.id,
      sectionType: section.markerSectionType,
      name: section.name,
      text: text,
      startTime: section.startTime,
      endTime: section.endTime,
      parentSectionId: section.parentSectionId,
      source: section.source,
      markerSourceName: section.markerSourceName,
      confidence: section.confidence,
      wordCount: this.countWords(text),
      speakers: await this.extractSpeakers(section.id)
    };
    
    const response = await this.client.index({
      index: 'marker_sections',
      id: `section_${section.id}`,
      body: document
    });
    
    // Update section with ES ID
    await this.prisma.markerSection.update({
      where: { id: section.id },
      data: { elasticSearchId: response._id }
    });
  }
}
```

## Configuration

### 1. Template Configuration
```json
{
  "markerSectionText": {
    "templateDirectory": "templates/marker-sections",
    "defaultTemplate": "default-trial-transcript.mustache",
    "templateMappings": {
      "TRIAL": "default-trial-transcript.mustache",
      "SESSION": "default-trial-transcript.mustache",
      "WITNESS_TESTIMONY": "witness-testimony.mustache",
      "DIRECT_EXAMINATION": "examination-qa.mustache",
      "CROSS_EXAMINATION": "examination-qa.mustache",
      "REDIRECT_EXAMINATION": "examination-qa.mustache",
      "RECROSS_EXAMINATION": "examination-qa.mustache",
      "OPENING_STATEMENT_PLAINTIFF": "attorney-statement.mustache",
      "OPENING_STATEMENT_DEFENSE": "attorney-statement.mustache",
      "CLOSING_STATEMENT_PLAINTIFF": "attorney-statement.mustache",
      "CLOSING_STATEMENT_DEFENSE": "attorney-statement.mustache",
      "JURY_SELECTION": "clean-transcript.mustache",
      "JURY_VERDICT": "clean-transcript.mustache"
    }
  },
  "elasticsearch": {
    "markerSections": {
      "indexName": "marker_sections",
      "shards": 3,
      "replicas": 1
    }
  }
}
```

## API Endpoints

```typescript
// Generate text for marker section
POST /api/marker-sections/{sectionId}/generate-text
Body: {
  templateOverride?: string,
  force?: boolean
}

// Batch generate for trial
POST /api/trials/{trialId}/marker-sections/generate-text
Body: {
  regenerate?: boolean,
  sectionTypes?: MarkerSectionType[]
}

// Search marker sections
GET /api/marker-sections/search
Query params:
- q: Search query
- trialId: Filter by trial
- sectionTypes: Comma-separated section types
- minConfidence: Minimum confidence

// Get section text
GET /api/marker-sections/{sectionId}/text
Response: {
  text: string,
  template: string,
  generatedAt: Date,
  wordCount: number
}
```

## Implementation Phases

### Phase 1: Core Text Generation
1. Implement TemplateResolver
2. Create MarkerSectionTextGenerator
3. Set up Mustache templates
4. Test with basic sections

### Phase 2: Batch Processing
1. Implement BatchGenerator
2. Add progress tracking
3. Handle error recovery
4. Optimize performance

### Phase 3: ElasticSearch Integration
1. Create index mappings
2. Implement indexing service
3. Add search endpoints
4. Test search capabilities

### Phase 4: Advanced Features (Future)
1. LLM-based summarization (using markerSourceName for tracking)
2. Timeline operation text generation
3. Custom template creation UI
4. Export formats (PDF, Word, HTML)

## Testing Strategy

### Unit Tests
- Template resolution logic
- Context building from events
- Mustache rendering
- Word counting

### Integration Tests
- Text generation for all section types
- Template inheritance
- ElasticSearch indexing
- Batch generation

### End-to-End Tests
- Complete trial text generation
- Search functionality
- Template customization

## Success Criteria

1. **Coverage**: 95% of sections have generated text
2. **Performance**: < 500ms per section generation
3. **Search Speed**: < 100ms for text searches
4. **Template Quality**: Clean, readable output
5. **Reliability**: Graceful handling of missing data

## Dependencies

- Feature-07D: MarkerSection schema
- Feature-07E: Standard Trial Hierarchy
- Mustache template engine
- ElasticSearch 7.x
- Existing StatementEvent text

## Future Enhancements

1. **Advanced Source Tracking**: MarkerTimelineOperation patterns for complex sources
2. **LLM Integration**: Use markerSourceName to track LLM-generated summaries
3. **Template Builder**: Visual template creation tool
4. **Multi-format Export**: Generate various document formats
5. **Real-time Updates**: Auto-regenerate on event changes
6. **Diff Visualization**: Track text changes over time