# Feature 09C: Trial Hierarchy Viewer GUI - Implementation Guide

## Overview
This document provides a comprehensive guide for the Trial Hierarchy Viewer GUI implementation, including what has been completed, integration details, and future enhancements.

## Implementation Status: ✅ COMPLETE

### Completed Components

#### 1. Frontend Application Structure
- **Framework:** Vue 3 with Composition API + TypeScript
- **UI Library:** Quasar 2.x for Material Design components
- **State Management:** Pinia store for centralized state
- **Build Tool:** Vite for fast development and optimized production builds
- **Location:** `/frontend/` directory

#### 2. Core Components Implemented

##### App.vue (Main Layout)
- Q-Layout with responsive design
- Three layout modes:
  - **Desktop:** 3-column with nested splitters (35%/65% horizontal, 50/50 vertical)
  - **Tablet:** Collapsible drawer + 2-pane view
  - **Mobile:** Tabbed interface with swipeable panels
- Automatic layout switching based on screen size

##### TrialToolbar.vue
- Trial navigation (previous/next buttons)
- Trial selection dropdown
- Summary type selector (abridged, detailed, full, key points)
- Event type selector (objections, exhibits, sidebar, all)
- Export and refresh actions
- Settings placeholder

##### TrialTreeView.vue
- Hierarchical QTree component
- Search/filter functionality
- Context menu with actions:
  - View full text
  - Export section
  - Copy event range
  - Generate summary (placeholder)
  - Navigate to source
- Node icons and colors based on type
- Expandable/collapsible nodes
- View mode toggle (standard/session)

##### SummaryPane.vue
- Dynamic content loading based on selected node
- Speaker-formatted transcript display
- Statistics bar (events, duration, speakers)
- Font size controls
- Copy and export functionality
- Load more pagination for long content
- Loading and error states

##### EventsPane.vue
- Filterable event list
- Confidence score filtering
- Ruling type filtering (for objections)
- Expandable event cards with transcript excerpts
- Pagination for large event sets
- Sort controls (ascending/descending)
- Event statistics display
- Copy and bookmark actions

#### 3. State Management (Pinia Store)
File: `/frontend/src/stores/trials.ts`

**State Properties:**
- `trials`: List of available trials
- `currentTrial`: Currently selected trial
- `currentHierarchy`: Loaded hierarchy tree
- `selectedNode`: Currently selected node
- `currentSummary`: Loaded summary content
- `currentEvents`: Loaded events list
- `summaryType`: Selected summary view type
- `eventType`: Selected event filter type
- `viewType`: Tree view mode (standard/session)
- `loading`: Loading state indicator
- `error`: Error message storage

**Actions:**
- `fetchTrials()`: Load trial list from API
- `loadHierarchy()`: Load trial hierarchy tree
- `loadSummary()`: Load node summary content
- `loadEvents()`: Load overlapping events
- `navigateTrial()`: Navigate between trials
- `exportCurrentView()`: Export current data
- `refreshCurrentData()`: Refresh all loaded data

#### 4. API Service Layer
File: `/frontend/src/services/api.ts`

**Implemented Endpoints:**
```typescript
// Trial Management
GET  /api/trials                                    // List all trials
GET  /api/trials/:id                               // Get trial details

// Hierarchy Navigation
GET  /api/hierarchy/:trialId?viewType=standard     // Get hierarchy tree
GET  /api/hierarchy/:trialId/search?q=query        // Search nodes

// Summary Content
GET  /api/hierarchy/:trialId/node/:nodeId/summary  // Get node summary
GET  /api/hierarchy/:trialId/node/:nodeId/summary/export

// Events
GET  /api/hierarchy/:trialId/node/:nodeId/events   // Get overlapping events

// Export
POST /api/export                                   // Export data
GET  /api/hierarchy/:trialId/node/:nodeId/export   // Export node

// Navigation
GET  /api/trials/:trialId/nodes/:nodeId/fulltext   // Full text view
GET  /api/trials/:trialId/events/:eventId          // Event context
```

## How to Run the Application

### Prerequisites
1. Node.js 18+ and npm installed
2. PostgreSQL database running with schema initialized
3. Trial data loaded in database (use phase1 parsing)

### Starting the Backend API Server
```bash
# From project root
npx ts-node src/api/server.ts

# Or use the compiled version
node dist/api/server.js

# Server runs on http://localhost:3001
```

### Starting the Frontend Development Server
```bash
# Navigate to frontend directory
cd frontend

# Install dependencies (first time only)
npm install

# Start development server
npm run dev

# Application runs on http://localhost:3000
```

### Building for Production
```bash
# Build frontend
cd frontend
npm run build
# Output in frontend/dist/

# Build backend
cd ..
npx tsc
# Output in dist/
```

## Key API Requirements Used by the GUI

### 1. Trial List Endpoint
**Endpoint:** `GET /api/trials`
**Response Format:**
```json
[
  {
    "id": 1,
    "shortName": "01 Genband",
    "fullName": "Genband US LLC v. Metaswitch Networks Corp.",
    "startDate": "2024-01-01",
    "endDate": "2024-01-15"
  }
]
```
**Used by:** Trial dropdown, navigation arrows

### 2. Hierarchy Endpoint
**Endpoint:** `GET /api/hierarchy/:trialId?viewType=standard`
**Response Format:**
```json
{
  "id": 100,
  "label": "Trial Root",
  "type": "TRIAL_ROOT",
  "stats": "15000 events, 2.5M words",
  "startEventId": 1,
  "endEventId": 15000,
  "children": [
    {
      "id": 101,
      "label": "Opening Statements",
      "type": "OPENING_STATEMENTS_PERIOD",
      "children": [...]
    }
  ]
}
```
**Used by:** Tree view component

### 3. Summary Endpoint
**Endpoint:** `GET /api/hierarchy/:trialId/node/:nodeId/summary?type=abridged`
**Query Parameters:**
- `type`: Summary type (abridged, detailed, full, keyPoints)
- `offset`: For pagination
- `limit`: Results per page

**Response Format:**
```json
{
  "content": "MR. JONES: Your Honor, we're here today...",
  "duration": 2700,
  "speakers": ["MR. JONES", "THE COURT", "MR. SMITH"],
  "hasMore": true
}
```
**Used by:** Summary pane

### 4. Events Endpoint
**Endpoint:** `GET /api/hierarchy/:trialId/node/:nodeId/events?type=objections`
**Query Parameters:**
- `type`: Event type filter (objections, exhibits, sidebar, all)

**Response Format:**
```json
[
  {
    "id": 5150,
    "type": "objection",
    "startEventId": 5150,
    "endEventId": 5155,
    "confidence": 0.95,
    "ruling": "SUSTAINED",
    "transcriptLines": [
      { "speaker": "MR. DAVIS", "text": "Objection, Your Honor." },
      { "text": "Calls for speculation." },
      { "speaker": "THE COURT", "text": "Sustained." }
    ]
  }
]
```
**Used by:** Events pane

## Database Requirements

The GUI expects the following database tables to be populated:
- `Trial`: Trial metadata
- `TranscriptEvent`: Event data with speakers and text
- `EventGrouping`: Hierarchy structure
- `EventGroupingStatus`: Processing status
- `EventOverlay`: Objections and other overlay events

## Configuration

### Frontend Configuration (vite.config.ts)
- API proxy configured to forward `/api` requests to `http://localhost:3001`
- Quasar Sass variables disabled (using defaults)
- Source alias `@` points to `src/` directory

### Backend Configuration
- Default port: 3001 (configurable via PORT environment variable)
- CORS enabled for development
- Static file serving for production builds

## Remaining Features for Future Implementation

### Phase 2 Enhancements
1. **LLM Summary Generation**
   - Add "Generate Summary" dialog
   - Batch processing interface
   - Progress tracking
   - Cost estimation display

2. **Advanced Search**
   - Full-text search across summaries
   - Regular expression support
   - Search history
   - Saved searches

3. **Comparison View**
   - Side-by-side trial comparison
   - Synchronized scrolling
   - Diff highlighting
   - Cross-trial analytics

4. **Export Enhancements**
   - PDF generation with formatting
   - DOCX export with styles
   - Batch export functionality
   - Custom export templates

### Phase 3 Features
1. **Annotation System**
   - User notes on nodes
   - Highlighting in summaries
   - Collaborative annotations
   - Version history

2. **Visualizations**
   - Timeline view of events
   - Speaker participation charts
   - Objection pattern heatmaps
   - Word clouds

3. **Performance Optimizations**
   - Virtual scrolling for large trees
   - Lazy loading of child nodes
   - Client-side caching
   - WebSocket for real-time updates

4. **User Management**
   - Authentication/authorization
   - User preferences
   - Saved views
   - Share functionality

## Testing Checklist

### Functional Tests
- [ ] Trial selection and navigation
- [ ] Tree expansion/collapse
- [ ] Node selection updates summaries
- [ ] Event filtering works correctly
- [ ] Export functionality
- [ ] Search within tree
- [ ] Context menu actions
- [ ] Responsive layout switching

### Integration Tests
- [ ] API endpoints return expected data
- [ ] Error handling for failed requests
- [ ] Loading states display correctly
- [ ] Pagination works for long content
- [ ] Cross-component state synchronization

### Performance Tests
- [ ] Large hierarchy trees (10,000+ nodes)
- [ ] Long summaries (100,000+ words)
- [ ] Many events (1,000+ per node)
- [ ] Memory usage remains stable
- [ ] No memory leaks on navigation

## Troubleshooting

### Common Issues

1. **"Cannot connect to API"**
   - Ensure backend server is running on port 3001
   - Check CORS settings if accessing from different domain
   - Verify proxy configuration in vite.config.ts

2. **"No trials found"**
   - Verify database connection
   - Ensure trials are loaded (run phase1 parsing)
   - Check API server logs for errors

3. **"Tree not displaying"**
   - Check hierarchy API response format
   - Verify EventGrouping records exist
   - Check browser console for JavaScript errors

4. **"Summary not loading"**
   - Verify node has associated TranscriptEvents
   - Check summary type parameter
   - Ensure proper text formatting in database

## Development Tips

1. **Hot Module Replacement:** Frontend supports HMR for instant updates
2. **Vue DevTools:** Install browser extension for debugging
3. **Network Tab:** Monitor API calls in browser DevTools
4. **Responsive Mode:** Use browser's device emulation for testing layouts
5. **TypeScript:** Leverage type checking for early error detection

## Contact and Support

For questions or issues with the GUI implementation:
1. Check the feature specification: `docs/features/feature-09C.md`
2. Review API documentation: `docs/features/feature-09B.md`
3. Check database setup: `docs/database-testing-guide.md`
4. Review coding conventions: `docs/coding-conventions.md`