# Feature 09C: Trial Hierarchy Viewer GUI Specification

## Overview
Vue 3 + Quasar-based single-page application for viewing and navigating trial hierarchies with synchronized panes showing trial structure, summaries, and overlapping events.

## Technology Stack
- **Frontend Framework:** Vue 3 with Composition API
- **UI Framework:** Quasar 2.x
- **State Management:** Pinia
- **HTTP Client:** Axios
- **Tree Component:** Quasar QTree
- **Build Tool:** Vite

## Application Layout

### Overall Structure
```
┌─────────────────────────────────────────────────────────────────┐
│                         Toolbar                                 │
│ [◄][►] [Trial Dropdown ▼] [Summary Type ▼] [Event Type ▼]      │
├────────────────┬────────────────────────────────────────────────┤
│                │                Top Right Pane                  │
│                │         Selected Node Summary                  │
│  Left Pane     │            (Scrollable)                        │
│                ├────────────────────────────────────────────────┤
│  Trial Tree    │            Bottom Right Pane                   │
│  (Scrollable)  │         Overlapping Events List                │
│                │            (Scrollable)                        │
└────────────────┴────────────────────────────────────────────────┘
```

### Responsive Breakpoints
- **Desktop:** 3-column layout (35% / 65% split, right pane 50/50 vertical)
- **Tablet:** Collapsible left panel with hamburger menu
- **Mobile:** Stacked layout with tabs for different views

## Component Architecture

### 1. Main Application Component (`App.vue`)
```vue
<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated>
      <TrialToolbar
        v-model:selectedTrial="selectedTrial"
        v-model:summaryType="summaryType"
        v-model:eventType="eventType"
        @navigate="handleNavigation"
      />
    </q-header>

    <q-page-container>
      <q-splitter
        v-model="splitterModel"
        :limits="[25, 45]"
        :model-value="35"
      >
        <template v-slot:before>
          <TrialTreeView
            :trial="selectedTrial"
            :viewType="treeViewType"
            v-model:selected="selectedNode"
            @nodeClick="handleNodeSelection"
          />
        </template>

        <template v-slot:after>
          <q-splitter
            horizontal
            v-model="verticalSplitter"
            :limits="[30, 70]"
          >
            <template v-slot:before>
              <SummaryPane
                :node="selectedNode"
                :summaryType="summaryType"
              />
            </template>

            <template v-slot:after>
              <EventsPane
                :node="selectedNode"
                :eventType="eventType"
              />
            </template>
          </q-splitter>
        </template>
      </q-splitter>
    </q-page-container>
  </q-layout>
</template>
```

### 2. Toolbar Component (`TrialToolbar.vue`)

#### Features:
- **Trial Navigation:** Previous/Next arrows with dropdown
- **View Controls:** Summary type and event type dropdowns
- **Quick Actions:** Export, refresh, settings buttons

#### Implementation:
```vue
<template>
  <q-toolbar>
    <!-- Trial Navigation -->
    <q-btn flat round icon="chevron_left" @click="previousTrial" />
    <q-select
      v-model="trial"
      :options="trialOptions"
      option-label="shortName"
      option-value="id"
      style="min-width: 250px"
      dense
      outlined
    />
    <q-btn flat round icon="chevron_right" @click="nextTrial" />

    <q-space />

    <!-- View Controls -->
    <q-select
      v-model="summary"
      :options="summaryOptions"
      label="Summary"
      dense
      outlined
      style="min-width: 150px"
    />

    <q-select
      v-model="events"
      :options="eventOptions"
      label="Events"
      dense
      outlined
      style="min-width: 150px"
      class="q-ml-sm"
    />

    <!-- Actions -->
    <q-btn flat round icon="download" @click="exportData">
      <q-tooltip>Export</q-tooltip>
    </q-btn>
    <q-btn flat round icon="refresh" @click="refreshData">
      <q-tooltip>Refresh</q-tooltip>
    </q-btn>
  </q-toolbar>
</template>
```

### 3. Trial Tree View Component (`TrialTreeView.vue`)

#### Features:
- **Hierarchical Display:** Expandable/collapsible tree nodes
- **Node Information:** Display type, name, and stats inline
- **Context Menu:** Right-click actions on nodes
- **Search:** Filter tree nodes by text
- **View Modes:** Standard or Session view toggle

#### Tree Node Structure:
```javascript
{
  label: 'Opening Statements',
  icon: 'gavel',
  id: 101,
  stats: '400 events, 3,500 words',
  type: 'OPENING_STATEMENTS_PERIOD',
  expandable: true,
  children: [
    {
      label: 'Plaintiff Opening - MR. JONES',
      icon: 'person',
      id: 102,
      stats: '150 events, 1,800 words',
      type: 'OPENING_STATEMENT_PLAINTIFF'
    }
  ]
}
```

#### Context Menu Actions:
- **View Full Text:** Open in new tab/window
- **Export Section:** Download as JSON/TXT
- **Copy Event Range:** Copy start-end event IDs
- **Generate Summary:** (Future) Request LLM summary
- **Navigate to Source:** Jump to original transcript

### 4. Summary Pane Component (`SummaryPane.vue`)

#### Features:
- **Dynamic Content:** Load based on selected node and summary type
- **Text Formatting:** Preserve transcript formatting with speaker labels
- **Statistics Bar:** Show word count, duration, speakers
- **Copy/Export:** Allow text selection and export

#### Display Format:
```
┌─────────────────────────────────────────────┐
│ Cross-Examination of Dr. Smith              │
│ Events: 5000-6000 | 45 minutes | 3 speakers │
├─────────────────────────────────────────────┤
│                                             │
│ MR. DAVIS: Dr. Smith, you testified        │
│ earlier about the patent claims...          │
│                                             │
│ DR. SMITH: Yes, that's correct.            │
│                                             │
│ MR. DAVIS: Can you explain...              │
│                                             │
│ [Showing excerpt, 1000 more words...]      │
│                                             │
└─────────────────────────────────────────────┘
```

### 5. Events Pane Component (`EventsPane.vue`)

#### Features:
- **Event List:** Scrollable list of objections or interactions
- **Event Details:** Expandable cards showing transcript excerpts
- **Filtering:** By confidence score, ruling type
- **Statistics:** Summary counts and distribution

#### Objection Display:
```
┌─────────────────────────────────────────────┐
│ Objections (12 total: 7 sustained, 5 over) │
├─────────────────────────────────────────────┤
│ ▼ Objection - SUSTAINED (95% confidence)    │
│   Events: 5150-5155                         │
│   MR. DAVIS: Objection, Your Honor.        │
│   Calls for speculation.                    │
│   THE COURT: Sustained.                     │
├─────────────────────────────────────────────┤
│ ▶ Objection - OVERRULED (92% confidence)    │
│   Events: 5320-5323                         │
└─────────────────────────────────────────────┘
```

## State Management (Pinia Store)

### TrialStore
```javascript
export const useTrialStore = defineStore('trials', {
  state: () => ({
    trials: [],
    currentTrial: null,
    currentHierarchy: null,
    selectedNode: null,
    summaryType: 'abridged',
    eventType: 'objections',
    viewType: 'standard',
    loading: false,
    error: null
  }),

  actions: {
    async fetchTrials() { },
    async loadHierarchy(trialId, viewType) { },
    async loadSummary(nodeId, summaryType) { },
    async loadEvents(nodeId, eventType) { },
    selectNode(node) { },
    navigateTrial(direction) { }
  },

  getters: {
    trialOptions: (state) => state.trials,
    availableSummaries: (state) => { },
    nodeById: (state) => (id) => { }
  }
})
```

## User Interactions

### 1. Initial Load
1. Application loads, fetches trial list
2. Selects first trial by default (or from URL params)
3. Loads standard hierarchy view
4. Displays trial root node summary

### 2. Trial Selection
1. User selects trial from dropdown or uses navigation arrows
2. System loads hierarchy for selected trial
3. Tree view updates with new hierarchy
4. Root node auto-selected, summary displayed

### 3. Node Selection
1. User clicks node in tree
2. Summary pane loads appropriate content
3. Events pane queries overlapping events
4. URL updates for deep linking

### 4. View Type Changes
1. User changes summary type dropdown
2. Summary pane refreshes with new format
3. Cached if previously loaded

### 5. Right-Click Context Menu
1. User right-clicks tree node
2. Context menu appears with actions
3. Actions execute based on node context

## Advanced Features (Phase 1)

### 1. Deep Linking
- URL format: `/trial/:trialId/view/:viewType/node/:nodeId`
- Bookmarkable states
- Browser back/forward navigation

### 2. Keyboard Shortcuts
- `Arrow Keys`: Navigate tree
- `Enter`: Expand/collapse node
- `Ctrl+C`: Copy selected text
- `Ctrl+E`: Export current view
- `/`: Focus search box

### 3. Search and Filter
- Tree node search with highlighting
- Event filtering by confidence/type
- Summary text search with highlighting

### 4. Export Options
- **Current View:** Export visible data as JSON
- **Full Hierarchy:** Export complete tree structure
- **Selected Section:** Export node with children
- **Reports:** Generate formatted PDF/DOCX

## Future Enhancements (Not in Phase 1)

### 1. LLM Summary Management
- "Add New Summary" button in dropdown
- Modal with tree selection for batch processing
- Progress tracking for generation
- Cost estimation display

### 2. Comparison View
- Side-by-side trial comparison
- Synchronized scrolling
- Diff highlighting

### 3. Annotation System
- User notes on nodes
- Highlighting in summaries
- Collaborative annotations

### 4. Advanced Visualizations
- Timeline view of events
- Speaker participation charts
- Objection patterns heat map

## Performance Optimizations

### 1. Data Loading
- Lazy load tree children on expand
- Virtual scrolling for long lists
- Progressive summary loading

### 2. Caching Strategy
- Cache hierarchies in localStorage
- Cache summaries for session
- Invalidate on data changes

### 3. Rendering
- Virtual tree for large hierarchies
- Debounced search inputs
- Memoized computed properties

## Accessibility Requirements

1. **Keyboard Navigation:** Full keyboard support
2. **Screen Readers:** ARIA labels and roles
3. **High Contrast:** Support system preferences
4. **Focus Management:** Logical tab order
5. **Responsive Text:** Scalable fonts

## Browser Support
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Development Setup

### Project Structure
```
frontend/
├── src/
│   ├── components/
│   │   ├── TrialToolbar.vue
│   │   ├── TrialTreeView.vue
│   │   ├── SummaryPane.vue
│   │   └── EventsPane.vue
│   ├── stores/
│   │   └── trials.js
│   ├── services/
│   │   └── api.js
│   ├── utils/
│   │   └── formatters.js
│   ├── App.vue
│   └── main.js
├── package.json
└── quasar.config.js
```

### Installation Commands
```bash
# Create Quasar project
npm init quasar

# Install dependencies
cd frontend
npm install axios pinia

# Run development server
npm run dev

# Build for production
npm run build
```

## Testing Requirements

### Unit Tests
- Component isolation tests
- Store action tests
- API service mocking

### Integration Tests
- User flow scenarios
- API integration
- State synchronization

### E2E Tests
- Full application workflows
- Cross-browser testing
- Performance benchmarks