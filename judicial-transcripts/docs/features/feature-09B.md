# Feature 09B: Hierarchy Viewer API Specification

## Overview
RESTful API endpoints to support the Trial Hierarchy Viewer GUI, providing hierarchical trial data, summaries, and interaction events through a Vue/Quasar frontend.

## Implementation Scope

### Phase 1 (Initial Implementation)
- Core hierarchy viewing API endpoints
- Pre-generated standard summaries (Abridged, Abridged2, FullText)
- Event overlay functionality (objections and interactions)
- Basic export capabilities

### Future Phase (Not in Initial Scope)
- Dynamic LLM summary generation requires additional design specification for:
  - Types of summaries to generate
  - Prompt engineering standards
  - Cost management strategies
  - Quality control mechanisms
- The API structure below includes placeholders for these features but they will NOT be implemented in the first version

## API Endpoints

### 1. Trial Management

#### GET /api/hierarchy/trials
Returns list of all trials for dropdown selection.

**Response:**
```json
{
  "trials": [
    {
      "id": 1,
      "shortName": "Genband v Metaswitch",
      "shortNameHandle": "01_Genband",
      "name": "Genband US LLC v. Metaswitch Networks Corp.",
      "caseNumber": "2:14-cv-00033",
      "sessionCount": 8,
      "startDate": "2016-01-25",
      "endDate": "2016-02-03"
    }
  ]
}
```

#### GET /api/hierarchy/trials/:trialId
Returns detailed trial information.

**Response:**
```json
{
  "trial": {
    "id": 1,
    "shortName": "Genband v Metaswitch",
    "shortNameHandle": "01_Genband",
    "name": "Genband US LLC v. Metaswitch Networks Corp.",
    "description": "Patent infringement case regarding VoIP technology",
    "metadata": {
      "judge": "Judge Gilstrap",
      "court": "E.D. Texas",
      "verdict": "Plaintiff verdict - $8.2M"
    }
  }
}
```

### 2. Hierarchy Views

#### GET /api/hierarchy/views/:trialId/:viewType
Returns hierarchical structure for specified view type.

**Parameters:**
- `trialId`: Trial ID
- `viewType`: One of `standard`, `session`, `objections`, `interactions`

**Query Parameters:**
- `includeStats`: Include event statistics (default: true)
- `includeTranscript`: Include transcript excerpts (default: false)
- `maxDepth`: Maximum hierarchy depth (default: unlimited)

**Response:**
```json
{
  "trialId": 1,
  "viewType": "standard",
  "hierarchy": [
    {
      "id": 100,
      "type": "TRIAL",
      "name": "Genband v Metaswitch",
      "startEventId": 1,
      "endEventId": 50000,
      "stats": {
        "eventCount": 50000,
        "wordCount": 425000,
        "speakerCount": 15,
        "duration": "8 days"
      },
      "children": [
        {
          "id": 101,
          "type": "OPENING_STATEMENTS_PERIOD",
          "name": "Opening Statements",
          "startEventId": 100,
          "endEventId": 500,
          "stats": {
            "eventCount": 400,
            "wordCount": 3500,
            "speakerCount": 3
          },
          "children": [
            {
              "id": 102,
              "type": "OPENING_STATEMENT_PLAINTIFF",
              "name": "Plaintiff Opening",
              "startEventId": 100,
              "endEventId": 250,
              "stats": {
                "eventCount": 150,
                "wordCount": 1800,
                "speakerCount": 1
              },
              "children": []
            }
          ]
        }
      ]
    }
  ]
}
```

### 3. Content Summaries

#### GET /api/hierarchy/summaries/:sectionId
Returns available summaries for a hierarchy section.

**Note:** Initial implementation will only support pre-generated standard summaries (abridged, abridged2, fulltext). LLM-generated summaries may be added as static pre-generated options but will NOT be generated on-demand.

**Query Parameters:**
- `summaryType`: One of `abridged`, `abridged2`, `fulltext` (LLM summaries will be added as static options if pre-generated)
- `maxLength`: Maximum text length for response

**Response:**
```json
{
  "sectionId": 102,
  "availableSummaries": ["abridged", "abridged2", "fulltext"],
  "selectedSummary": "abridged",
  "content": {
    "type": "abridged",
    "text": "MR. JONES: Good morning, Your Honor. We're here today to present evidence that the defendant willfully infringed our client's patents...\n\n[150 events, 1800 words, 15 minutes]",
    "metadata": {
      "speaker": "MR. JONES",
      "role": "Plaintiff Attorney",
      "lawFirm": "McKool Smith",
      "startTime": "09:15:00",
      "endTime": "09:30:00"
    }
  }
}
```

#### POST /api/hierarchy/summaries/generate [FUTURE PHASE - NOT IMPLEMENTED]
**Note:** This endpoint is documented for future reference but will NOT be implemented in the initial version. Dynamic LLM summary generation requires additional design work to specify summary types, prompts, and cost management.

### 4. Event Overlays

#### GET /api/hierarchy/events/:sectionId/:eventType
Returns events overlapping with selected section.

**Parameters:**
- `sectionId`: Selected hierarchy section ID
- `eventType`: One of `objections`, `interactions`

**Query Parameters:**
- `minConfidence`: Minimum confidence score (0.0-1.0)
- `limit`: Maximum number of events to return
- `offset`: Pagination offset

**Response:**
```json
{
  "sectionId": 500,
  "eventType": "objections",
  "parentSection": {
    "name": "Cross-Examination of Dr. Smith",
    "startEventId": 5000,
    "endEventId": 6000
  },
  "events": [
    {
      "id": 1,
      "type": "objection",
      "subtype": "sustained",
      "startEventId": 5150,
      "endEventId": 5155,
      "confidence": 0.95,
      "transcript": "MR. DAVIS: Objection, Your Honor. Calls for speculation.\nTHE COURT: Sustained.",
      "metadata": {
        "objectingAttorney": "MR. DAVIS",
        "ruling": "sustained",
        "grounds": "speculation"
      }
    },
    {
      "id": 2,
      "type": "objection",
      "subtype": "overruled",
      "startEventId": 5320,
      "endEventId": 5323,
      "confidence": 0.92,
      "transcript": "MS. CHEN: Objection. Beyond the scope.\nTHE COURT: Overruled. You may answer.",
      "metadata": {
        "objectingAttorney": "MS. CHEN",
        "ruling": "overruled",
        "grounds": "scope"
      }
    }
  ],
  "summary": {
    "totalEvents": 12,
    "sustained": 7,
    "overruled": 5,
    "averageConfidence": 0.91
  }
}
```

### 5. Background Processing [FUTURE PHASE]

**Note:** Background job processing for LLM summaries is NOT included in the initial implementation. The endpoints below are documented for future reference only.

#### GET /api/hierarchy/jobs/:jobId [NOT IMPLEMENTED]
Check status of background summary generation job.

#### DELETE /api/hierarchy/jobs/:jobId [NOT IMPLEMENTED]
Cancel a running background job.

### 6. Export Functionality

#### GET /api/hierarchy/export/:trialId
Export hierarchy data in various formats.

**Query Parameters:**
- `format`: One of `json`, `csv` (PDF and DOCX support may be added later)
- `viewType`: Hierarchy view to export
- `includeSummaries`: Include text summaries (standard summaries only)
- `includeEvents`: Include overlapping events

**Response:** Binary file download or JSON with download URL

### 7. WebSocket Support [OPTIONAL]

WebSocket support for real-time updates may be added in future phases but is not required for initial implementation.

## Error Handling

All endpoints return standard error responses:

```json
{
  "error": {
    "code": "TRIAL_NOT_FOUND",
    "message": "Trial with ID 999 not found",
    "details": {
      "trialId": 999,
      "availableTrials": [1, 2, 3, 4, 5]
    }
  }
}
```

## Authentication & Authorization

Initial implementation:
- Basic API authentication (can start without authentication for development)
- Rate limiting: 100 requests per minute for standard endpoints
- No special permissions required for viewing standard summaries

Future considerations:
- JWT tokens for production deployment
- Role-based access control for sensitive data
- Elevated permissions for LLM operations (when implemented)

## Performance Considerations

1. **Caching Strategy:**
   - Trial lists cached for 5 minutes
   - Hierarchy structures cached for 1 hour
   - Pre-generated summaries served from disk cache
   - Real-time events not cached

2. **Pagination:**
   - Default page size: 50 items
   - Maximum page size: 500 items
   - Cursor-based pagination for large result sets

3. **Response Optimization:**
   - Gzip compression for all responses
   - Conditional ETags for static hierarchies
   - Streaming responses for large exports

## Implementation Notes

1. **Service Layer:**
   - Extend existing `HierarchyViewService`
   - Add new `SummaryService` for standard summary retrieval
   - Implement `EventOverlayService` for objections/interactions
   - LLM summary generation service to be designed separately (future phase)

2. **Database Queries:**
   - Use existing MarkerSection relationships
   - Optimize with selective field loading
   - Implement database-level pagination

3. **Summary Storage:**
   - Standard summaries pre-generated and stored in:
     - `output/markersummary1/` (Abridged)
     - `output/markersummary2/` (Abridged2)
     - `output/markersections/` (FullText)
   - Any pre-generated LLM summaries stored in `output/llm-summaries/`

4. **File Storage:**
   - Export files in `output/exports/`
   - Temporary files cleaned after 24 hours

## Testing Requirements

1. **Unit Tests:**
   - Service method validation
   - Hierarchy building logic
   - Event overlap calculations

2. **Integration Tests:**
   - API endpoint responses
   - Database query performance
   - Cache invalidation

3. **Load Testing:**
   - Concurrent user simulation
   - Large hierarchy handling
   - Standard summary retrieval performance

## Security Considerations

1. **Input Validation:**
   - Sanitize all user inputs
   - Validate trial/section IDs
   - Limit query complexity

2. **Rate Limiting:**
   - Per-IP request limits
   - Export size restrictions

3. **Data Access:**
   - Read-only access for initial implementation
   - Audit logging for exports
   - No sensitive data in standard summaries

## Future Enhancements

The following features are NOT included in the initial implementation but are documented for future consideration:

1. **Dynamic LLM Summary Generation:**
   - Requires detailed specification of summary types
   - Prompt engineering standards needed
   - Cost estimation and budget controls
   - Quality assurance mechanisms
   - User feedback integration

2. **Advanced Export Formats:**
   - PDF generation with formatting
   - DOCX with styles and templates
   - PowerPoint presentations

3. **Real-time Collaboration:**
   - WebSocket support for live updates
   - Multi-user annotation system
   - Shared workspace functionality

4. **Analytics Dashboard:**
   - Usage statistics
   - Performance metrics
   - User behavior tracking