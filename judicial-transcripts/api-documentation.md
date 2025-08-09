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

#### `POST /api/search`
Search across all transcripts.

**Request Body:**
```json
{
  "query": "patent infringement",
  "filters": {
    "trialId": 1,
    "sessionId": 1,
    "speakerType": "ATTORNEY",
    "dateRange": {
      "start": "2020-10-01",
      "end": "2020-10-05"
    }
  },
  "options": {
    "includeContext": true,
    "contextLines": 5,
    "limit": 20,
    "offset": 0
  }
}
```

**Response:**
```json
{
  "results": [
    {
      "trialId": 1,
      "sessionId": 1,
      "eventId": 123,
      "score": 0.95,
      "highlight": "The <em>patent infringement</em> claim is based on...",
      "context": {
        "before": ["Previous line 1", "Previous line 2"],
        "match": "The patent infringement claim is based on...",
        "after": ["Next line 1", "Next line 2"]
      },
      "metadata": {
        "speaker": "MR. HADDEN",
        "timestamp": "10:30:15",
        "lineNumber": 456
      }
    }
  ],
  "total": 42,
  "facets": {
    "speakers": {
      "THE COURT": 10,
      "MR. HADDEN": 15,
      "MS. TRUELOVE": 17
    },
    "sessions": {
      "2020-10-01 MORNING": 25,
      "2020-10-01 AFTERNOON": 17
    }
  }
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