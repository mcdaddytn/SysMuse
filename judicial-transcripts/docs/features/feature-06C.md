# Feature-06C: Enhanced Reporting API

## Overview
Enhance the reporting API to include hierarchy views and phase3 reports, providing comprehensive JSON output for integration testing and external consumers.

## Requirements

### 1. Hierarchy View API Endpoints
Add API endpoints that mirror the CLI hierarchy-view functionality:
- **Standard view**: Complete trial structure hierarchy
- **Session view**: Trial → Sessions breakdown
- **Objections view**: Objection sequences and rulings
- **Interactions view**: Judge-attorney and opposing counsel interactions

### 2. Phase3 Statistics API
Expose phase3 processing statistics through the API:
- Marker counts by type
- Accumulator results summary
- Processing completion status

### 3. Unified Reporting Interface
Create a consistent API interface for all reports:
- Standardized request/response format
- Support for JSON and optional CSV export
- Pagination for large result sets

## API Endpoints

### Hierarchy Views

#### GET /api/reports/hierarchy/:trialId
Retrieve hierarchy view for a specific trial

**Query Parameters:**
- `view`: Type of hierarchy view (`standard`, `session`, `objections`, `interactions`, `all`)
- `format`: Output format (`json`, `csv`) - default: `json`
- `includeTranscript`: Include transcript excerpts (boolean) - default: `false`
- `maxDepth`: Maximum hierarchy depth to return (number) - optional

**Response:**
```json
{
  "trialId": 1,
  "trialName": "Case Name",
  "view": "standard",
  "hierarchy": [
    {
      "id": 123,
      "type": "TRIAL",
      "name": "Trial Name",
      "description": "Description",
      "eventRange": [1, 5000],
      "confidence": 0.95,
      "stats": {
        "eventCount": 5000,
        "speakerCount": 15,
        "wordCount": 50000
      },
      "children": [...]
    }
  ],
  "metadata": {
    "generatedAt": "2025-01-09T12:00:00Z",
    "nodeCount": 45,
    "maxDepth": 5
  }
}
```

### Phase3 Reports

#### GET /api/reports/phase3/:trialId
Retrieve phase3 processing statistics and results

**Query Parameters:**
- `includeMarkers`: Include detailed marker list (boolean) - default: `false`
- `includeAccumulators`: Include accumulator results (boolean) - default: `false`

**Response:**
```json
{
  "trialId": 1,
  "phase3Status": {
    "completed": true,
    "completedAt": "2025-01-09T10:00:00Z",
    "markersIndexed": true
  },
  "statistics": {
    "markers": 250,
    "markerSections": 45,
    "accumulatorResults": 180,
    "elasticSearchResults": 1200
  },
  "markersByType": {
    "WITNESS_CALLED": 15,
    "OBJECTION": 45,
    "SIDEBAR": 12
  },
  "accumulatorSummary": {
    "objection_sustained": 23,
    "objection_overruled": 22,
    "judge_attorney_interaction": 8
  }
}
```

### Current Reports Status

#### GET /api/reports/status
List all available reports and their processing status

**Response:**
```json
{
  "availableReports": [
    {
      "type": "hierarchy",
      "views": ["standard", "session", "objections", "interactions"],
      "description": "Hierarchical trial structure views"
    },
    {
      "type": "phase3",
      "description": "Phase 3 processing statistics and marker analysis"
    },
    {
      "type": "export",
      "formats": ["txt", "json", "csv"],
      "description": "Full transcript export with annotations"
    }
  ],
  "systemStatus": {
    "totalTrials": 5,
    "phase3Completed": 3,
    "indexedTrials": 3
  }
}
```

## CLI Commands Documentation

### Hierarchy View Commands
```bash
# Standard trial structure view
npx ts-node src/cli/hierarchy-view.ts --trial 1 --view standard --format json --output ./output/standard.json

# Session breakdown view
npx ts-node src/cli/hierarchy-view.ts --trial 1 --view session --format json --output ./output/session.json

# Objection sequences view
npx ts-node src/cli/hierarchy-view.ts --trial 1 --view objections --format json --output ./output/objections.json

# Judge-attorney interactions view
npx ts-node src/cli/hierarchy-view.ts --trial 1 --view interactions --format json --output ./output/interactions.json

# All views combined
npx ts-node src/cli/hierarchy-view.ts --trial 1 --all --format json --output ./output/all-views.json
```

### Phase3 Commands
```bash
# Process phase3 for specific trial
npx ts-node src/cli/phase3.ts process --trial 1

# Export markers
npx ts-node src/cli/phase3.ts export --trial 1 --output ./markers.json

# View statistics
npx ts-node src/cli/phase3.ts stats --trial 1
```

## Implementation Plan

### Phase 1: Core API Structure
1. Create `/api/reports` router module
2. Implement base report service class
3. Add error handling and validation

### Phase 2: Hierarchy View Integration
1. Extract HierarchyViewer logic into service class
2. Create API endpoints for each view type
3. Add response formatting and pagination

### Phase 3: Phase3 Report Integration
1. Create Phase3ReportService
2. Implement statistics aggregation
3. Add marker and accumulator summaries

### Phase 4: Testing & Documentation
1. Add API tests for all endpoints
2. Update API documentation
3. Create integration test suite

## Success Criteria
- All hierarchy views accessible via API with same output as CLI
- Phase3 statistics available through API
- Consistent response format across all report endpoints
- API documentation complete and accurate
- All endpoints tested and verified

## Technical Considerations
- Reuse existing HierarchyViewer class logic
- Implement proper caching for expensive operations
- Consider pagination for large hierarchies
- Ensure proper error handling and status codes
- Add request validation middleware

## Dependencies
- Existing HierarchyViewer implementation
- Phase3ProcessorV2 for statistics
- TranscriptRenderer for formatting
- Express router for API endpoints