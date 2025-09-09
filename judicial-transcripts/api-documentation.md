# Judicial Transcripts System - API Documentation

## Base URL
```
http://localhost:3000
```

## Available Endpoints

### Health Check

#### `GET /health`
Check if the API server is running.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-08-09T10:00:00.000Z"
}
```

---

### Trials

#### `GET /api/trials`
Get all trials in the system.

**Response:**
```json
[
  {
    "id": 1,
    "caseNumber": "2:19-CV-123-JRG",
    "caseName": "VocalLife vs Amazon",
    "judge": {
      "id": 1,
      "name": "Rodney Gilstrap"
    },
    "_count": {
      "sessions": 12,
      "attorneys": 8,
      "witnesses": 21
    }
  }
]
```

#### `GET /api/trials/:id`
Get detailed information about a specific trial.

**Parameters:**
- `id` (number): Trial ID

**Response:**
```json
{
  "id": 1,
  "caseNumber": "2:19-CV-123-JRG",
  "caseName": "VocalLife vs Amazon",
  "judge": {
    "id": 1,
    "name": "Rodney Gilstrap",
    "title": "Chief United States District Judge"
  },
  "courtReporter": {
    "id": 1,
    "name": "Jane Smith"
  },
  "sessions": [
    {
      "id": 1,
      "sessionDate": "2020-10-01",
      "sessionType": "MORNING",
      "startTime": "09:15:45",
      "endTime": "12:30:00"
    }
  ],
  "attorneys": [
    {
      "attorney": {
        "id": 1,
        "name": "Jennifer Truelove"
      },
      "lawFirm": {
        "id": 1,
        "name": "McKool Smith"
      },
      "role": "PLAINTIFF"
    }
  ],
  "witnesses": [
    {
      "id": 1,
      "name": "Dr. John Expert",
      "type": "EXPERT_WITNESS"
    }
  ],
  "markers": [
    {
      "id": 1,
      "markerType": "JURY_IN",
      "startTime": "09:15:45",
      "endTime": "09:16:00"
    }
  ]
}
```

---

### Reports API (NEW)

#### `GET /api/reports/hierarchy/:trialId`
Generate hierarchical view of trial structure.

**Parameters:**
- `trialId` (number): Trial ID

**Query Parameters:**
- `view` (string): View type - `standard`, `session`, `objections`, `interactions`, `all` (default: `standard`)
- `includeTranscript` (boolean): Include transcript excerpts (default: `false`)
- `maxDepth` (number, optional): Maximum hierarchy depth to return

**Example:**
```
GET /api/reports/hierarchy/1?view=standard&includeTranscript=false
```

**Response:**
```json
{
  "trialId": 1,
  "trialName": "VocalLife vs Amazon",
  "view": "standard",
  "hierarchy": [
    {
      "section": {
        "id": 123,
        "markerSectionType": "TRIAL",
        "name": "Trial Name",
        "startEventId": 1,
        "endEventId": 5000,
        "confidence": 0.95
      },
      "children": [...],
      "stats": {
        "eventCount": 5000,
        "speakerCount": 15,
        "confidence": 0.95
      }
    }
  ],
  "metadata": {
    "generatedAt": "2025-01-09T12:00:00Z",
    "nodeCount": 45,
    "maxDepth": 5
  }
}
```

#### `GET /api/reports/phase3/:trialId`
Get Phase3 processing statistics and results.

**Parameters:**
- `trialId` (number): Trial ID

**Query Parameters:**
- `includeMarkers` (boolean): Include detailed marker list (default: `false`)
- `includeAccumulators` (boolean): Include accumulator results (default: `false`)

**Example:**
```
GET /api/reports/phase3/1?includeMarkers=true
```

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

#### `GET /api/reports/phase3/monitor/:trialId`
Get detailed Phase3 processing progress and monitoring data.

**Parameters:**
- `trialId` (number): Trial ID

**Response:**
```json
{
  "trialId": 1,
  "elasticSearch": {
    "expressions": 50,
    "statements": 10000,
    "expectedResults": 500000,
    "actualResults": 450000,
    "progress": "90.0",
    "matched": 5000,
    "matchedPercentage": "1.11",
    "topMatchingExpressions": [
      {"name": "objection", "matches": 250}
    ]
  },
  "accumulators": {
    "total": 20,
    "results": 180,
    "matched": 75
  },
  "markers": {
    "total": 250,
    "sections": 45,
    "typeBreakdown": {
      "WITNESS_CALLED": 15,
      "OBJECTION": 45
    }
  },
  "witnesses": {
    "total": 12,
    "calledEvents": 24,
    "averageExaminationsPerWitness": "2.0"
  }
}
```

#### `GET /api/reports/status`
Get overall system and available reports status.

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
  },
  "globalStatistics": {
    "markers": 1250,
    "markerSections": 225,
    "accumulatorResults": 900
  }
}
```

---

### Sessions

#### `GET /api/sessions/:id/events`
Get all events for a specific session.

**Parameters:**
- `id` (number): Session ID

**Response:**
```json
[
  {
    "id": 1,
    "sessionId": 1,
    "eventType": "COURT_DIRECTIVE",
    "startTime": "09:15:45",
    "endTime": "09:15:50",
    "startLineNumber": 3,
    "endLineNumber": 3,
    "text": "(Venire panel in.)",
    "courtDirective": {
      "id": 1,
      "directiveTypeId": 1,
      "directiveText": "Venire panel in."
    }
  },
  {
    "id": 2,
    "sessionId": 1,
    "eventType": "STATEMENT",
    "startTime": "09:15:52",
    "endTime": "09:15:53",
    "speaker": "COURT SECURITY OFFICER",
    "text": "All rise.",
    "statement": {
      "id": 1,
      "speakerType": "OTHER",
      "speakerName": "COURT SECURITY OFFICER"
    }
  }
]
```

---

### Markers

#### `GET /api/trials/:id/markers`
Get markers for a trial.

**Parameters:**
- `id` (number): Trial ID

**Query Parameters:**
- `type` (string, optional): Filter by marker type (e.g., "JURY_IN", "OBJECTION")
- `resolved` (boolean, optional): Filter by resolved status

**Example:**
```
GET /api/trials/1/markers?type=OBJECTION&resolved=true
```

**Response:**
```json
[
  {
    "id": 1,
    "trialId": 1,
    "markerType": "OBJECTION",
    "startTime": "10:45:12",
    "endTime": "10:45:45",
    "startLineNumber": 1234,
    "endLineNumber": 1238,
    "isResolved": true,
    "pairedMarkerId": 2,
    "markerTexts": [
      {
        "id": 1,
        "text": "Objection, Your Honor. Relevance.",
        "textHash": "abc123..."
      }
    ]
  }
]
```

---

### Search

#### `POST /api/search` (Legacy)
Basic search across all transcripts.

**Request Body:**
```json
{
  "query": "patent infringement",
  "trialId": 1,
  "sessionIds": [1, 2],
  "limit": 50
}
```

**Response:**
```json
{
  "query": "patent infringement",
  "total": 42,
  "results": [
    {
      "id": "result-1",
      "trialId": 1,
      "trialName": "VocalLife vs Amazon",
      "text": "The patent infringement claim...",
      "highlight": "The <em>patent infringement</em> claim...",
      "score": 0.95
    }
  ]
}
```

#### `POST /api/search/advanced`
Advanced search combining SQL filters with Elasticsearch queries.

**Request Body:**
```json
{
  "trialName": "State v. Smith",
  "sessionDate": ["2024-01-15", "2024-01-16"],
  "sessionType": ["MORNING", "AFTERNOON"],
  "speakerType": "JUDGE",
  "speakerPrefix": ["THE COURT", "JUDGE SMITH"],
  "elasticSearchQueries": [
    {
      "name": "sustained_objection",
      "query": "objection sustained",
      "type": "match_phrase",
      "proximity": 3
    },
    {
      "name": "overruled_objection",
      "query": "objection overruled",
      "type": "match_phrase",
      "proximity": 3
    }
  ],
  "limit": 100,
  "includeFullResults": false
}
```

**Parameters:**
- `trialName` (string | string[]): Filter by trial name(s)
- `sessionDate` (string | string[]): Filter by session date(s) in ISO format
- `sessionType` (string | string[]): Filter by session type (MORNING, AFTERNOON, etc.)
- `speakerType` (string | string[]): Filter by speaker type (JUDGE, ATTORNEY, WITNESS, etc.)
- `speakerPrefix` (string | string[]): Filter by speaker prefix (exact match)
- `elasticSearchQueries` (array): Array of Elasticsearch queries to execute
  - `name` (string): Unique name for the query
  - `query` (string): Search text
  - `type` (string): Query type (match, match_phrase, term, wildcard, regexp, fuzzy)
  - `proximity` (number, optional): For match_phrase, maximum distance between terms
  - `field` (string, optional): Field to search (default: "text")
  - `boost` (number, optional): Query boost factor
- `limit` (number, optional): Maximum results to return (default: 100)
- `includeFullResults` (boolean, optional): Include all results without limit

**Response:**
```json
{
  "success": true,
  "totalStatements": 1606,
  "matchedStatements": 45,
  "elasticSearchSummary": {
    "sustained_objection": {
      "matched": 25,
      "percentage": 56
    },
    "overruled_objection": {
      "matched": 20,
      "percentage": 44
    }
  },
  "results": [
    {
      "statementEventId": 123,
      "elasticSearchId": "statement_123",
      "text": "Objection, Your Honor. Hearsay.",
      "trialId": 1,
      "trialName": "State v. Smith",
      "sessionId": 2,
      "sessionDate": "2024-01-15T00:00:00.000Z",
      "sessionType": "MORNING",
      "speakerId": 5,
      "speakerType": "ATTORNEY",
      "speakerPrefix": "MR. JONES",
      "speakerHandle": "ATTORNEY_5",
      "startTime": "10:45:12",
      "endTime": "10:45:15",
      "startLineNumber": 1234,
      "endLineNumber": 1234,
      "elasticSearchMatches": {
        "sustained_objection": false,
        "overruled_objection": false
      },
      "elasticSearchHighlights": []
    }
  ]
}
```

---

### Upload and Processing

#### `POST /api/trials/upload`
Upload transcript files and trigger processing.

**Request:**
- Content-Type: `multipart/form-data`
- Files: Multiple transcript files (up to 50)

**Form Fields:**
- `files[]`: Transcript files
- `caseName` (string): Name of the case
- `caseNumber` (string): Case number
- `format` (string): File format ("txt" or "pdf")
- `runPhase1` (boolean): Run Phase 1 parsing
- `runPhase2` (boolean): Run Phase 2 line grouping
- `runPhase3` (boolean): Run Phase 3 section markers

**Response:**
```json
{
  "message": "Processing started",
  "trialId": 1,
  "filesProcessed": 12
}
```

---

### Export

#### `POST /api/export`
Export processed transcripts.

**Request Body:**
```json
{
  "trialId": 1,
  "format": "clean",
  "options": {
    "includeTimestamps": true,
    "includeLineNumbers": false,
    "includeSpeakers": true
  },
  "outputPath": "./exports/trial-1-clean.txt"
}
```

**Formats:**
- `clean`: Human-readable transcript
- `abridged`: Transcript with placeholders for repetitive content
- `raw`: Original format with all metadata
- `json`: Structured JSON format

**Response:**
```json
{
  "message": "Export completed successfully",
  "path": "./exports/trial-1-clean.txt"
}
```

---

## Error Responses

All endpoints may return error responses in the following format:

```json
{
  "error": "Error message description",
  "details": "Additional error details (optional)"
}
```

**Common HTTP Status Codes:**
- `200`: Success
- `400`: Bad Request (invalid parameters)
- `404`: Not Found (resource doesn't exist)
- `500`: Internal Server Error

---

## Starting the API Server

```bash
# Start with npm
npm run api

# Or start directly
npm run build
node dist/api/server.js

# With Docker
docker-compose up api
```

The server will start on port 3000 by default (configurable via `PORT` environment variable).

---

## Authentication

**Note:** Authentication is not currently implemented. All endpoints are publicly accessible. In a production environment, you should add:
- JWT authentication
- API key validation
- Rate limiting
- CORS configuration

---

## Future Endpoints (Planned)

### AI Synopsis
- `POST /api/trials/:id/synopsis` - Generate AI summary
- `GET /api/trials/:id/synopsis` - Retrieve generated synopsis

### Analytics
- `GET /api/trials/:id/analytics` - Trial statistics
- `GET /api/analytics/speakers` - Speaker time analysis
- `GET /api/analytics/objections` - Objection patterns

### Batch Operations
- `POST /api/batch/process` - Process multiple trials
- `GET /api/batch/status/:jobId` - Check batch job status

### WebSocket Support
- `/ws/trial/:id` - Real-time updates during processing
- `/ws/search` - Live search results