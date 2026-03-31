# GUI Integration Plan: Sector Scoring Templates

## Overview

This document outlines the integration of sector-specific LLM scoring into the frontend GUI, building on existing prompt template and job enrichment infrastructure.

## Existing Components to Leverage

### 1. Prompt Templates (`PromptTemplatesPage.vue`)
- **Two template types**: FREE_FORM (text) and STRUCTURED (questions)
- **StructuredQuestion editor** with:
  - Field name, question text, answer type
  - Constraints (min/max, maxSentences, options for ENUM)
  - Description field
- **Variable insertion** with clickable chips
- **Delimiter configuration** for field placeholders
- **Preview functionality** via `previewPromptTemplate()` API

**Reuse for**: Scoring template question editing, preview functionality

### 2. Job Queue / Sector Enrichment (`JobQueuePage.vue`)
- **Target types**: tier, super-sector, sector
- **TopN filtering**: Limits scoring to highest-scoring patents (25, 50, 100, 250, 500, 1000)
- **Gap analysis**: Shows what work is needed before job start
- **Real-time monitoring**: Auto-refresh, progress bars, ETA

**Extend for**: Add sub-sector targeting, LLM scoring jobs

### 3. Sector Management (`SectorManagementPage.vue`)
- **Tree navigation**: Super-sector → Sector (expandable)
- **Rules management**: Expressions, priority, scope, match preview
- **3 tabs**: Overview, Rules, Patents

**Extend for**: Add sub-sectors, scoring templates, template preview

---

## Current Backend Capabilities

### Scoring Templates API (`/api/scoring-templates/*`)
- `GET /config` - List all template config files
- `GET /config/merged/:superSectorName` - Get merged questions
- `POST /sync` - Sync templates from JSON config to database
- `POST /llm/score-sector/:sectorName` - Score all patents in a sector
- `GET /llm/sector-preview/:sectorName` - Preview patents ready for scoring
- `GET /scores/patent/:patentId` - Get LLM score for a patent
- `GET /export/:superSector` - Export patents with LLM metrics

### Template Hierarchy (4-tier)
1. **Portfolio-default** - 5 base questions for all patents
2. **Super-sector** - 5+ additional questions per super-sector
3. **Sector** - 3-4 targeted questions per sector (44 sectors defined)
4. **Sub-sector** - 14 templates created (NOT integrated yet)

---

## Phase 1: API Layer

### Add to `frontend/src/services/api.ts`

```typescript
// Scoring Templates API - extends existing PromptTemplate types
export interface ScoringQuestion {
  fieldName: string;
  displayName: string;
  question: string;
  answerType: 'numeric';
  scale: { min: number; max: number };
  weight: number;
  requiresReasoning: boolean;
  reasoningPrompt?: string;
  sourceLevel: 'portfolio' | 'super_sector' | 'sector' | 'sub_sector';
}

export interface ScoringTemplateConfig {
  id: string;
  name: string;
  description: string;
  level: 'portfolio' | 'super_sector' | 'sector' | 'sub_sector';
  questions: ScoringQuestion[];
  scoringGuidance?: string[];
  contextDescription?: string;
}

export interface MergedTemplate {
  level: 'super_sector' | 'sector' | 'sub_sector';
  inheritanceChain: string[];  // ['portfolio-default', 'COMPUTING', 'computing-runtime']
  questionCount: number;
  totalWeight: number;
  questions: ScoringQuestion[];
  availableFields: string[];  // All score + reasoning field names
}

export interface TemplatePreviewContext {
  patentId: string;
  patentTitle: string;
  context: {
    title: string;
    abstract: string;
    claims?: string;
    cpcCodes: string[];
    // ... other context fields
  };
  renderedPrompt: string;  // Full prompt as would be sent to LLM
  estimatedTokens: number;
}

export interface TemplatePreviewResult extends TemplatePreviewContext {
  llmResponse: {
    scores: Record<string, number>;
    reasoning: Record<string, string>;
  };
  actualTokens: { input: number; output: number };
}

export interface SectorScoringProgress {
  level: 'super_sector' | 'sector' | 'sub_sector';
  name: string;
  total: number;
  scored: number;
  remaining: number;
  percentComplete: number;
  lastScoredAt?: string;
}

export interface DynamicColumns {
  baseColumns: string[];           // Always available (patent_id, title, etc.)
  scoreColumns: string[];          // Score fields from selected templates
  reasoningColumns: string[];      // Reasoning fields from selected templates
  availableColumns: string[];      // Union of all
  commonColumns: string[];         // Intersection of all
}

export const scoringTemplatesApi = {
  // Config
  async getConfig(): Promise<{
    portfolioDefault: ScoringTemplateConfig;
    superSectors: Array<{ filename: string; template: ScoringTemplateConfig }>;
    sectors: Array<{ filename: string; template: ScoringTemplateConfig }>;
    subSectors: Array<{ filename: string; template: ScoringTemplateConfig }>;
  }> {
    const { data } = await api.get('/scoring-templates/config');
    return data;
  },

  async getMergedTemplate(
    level: 'super_sector' | 'sector' | 'sub_sector',
    name: string
  ): Promise<MergedTemplate> {
    const { data } = await api.get(`/scoring-templates/config/merged/${level}/${name}`);
    return data;
  },

  // Template Preview & Testing
  async previewTemplate(
    level: 'super_sector' | 'sector' | 'sub_sector',
    name: string,
    patentId: string,
    includeClaims?: boolean
  ): Promise<TemplatePreviewContext> {
    const params = new URLSearchParams();
    if (includeClaims) params.append('includeClaims', 'true');
    const { data } = await api.get(
      `/scoring-templates/preview/${level}/${name}/${patentId}?${params}`
    );
    return data;
  },

  async testTemplate(
    level: 'super_sector' | 'sector' | 'sub_sector',
    name: string,
    patentId: string,
    includeClaims?: boolean
  ): Promise<TemplatePreviewResult> {
    const params = new URLSearchParams();
    if (includeClaims) params.append('includeClaims', 'true');
    const { data } = await api.post(
      `/scoring-templates/test/${level}/${name}/${patentId}?${params}`
    );
    return data;
  },

  // Scoring Jobs
  async scoreSector(
    level: 'super_sector' | 'sector' | 'sub_sector',
    name: string,
    options?: { useClaims?: boolean; rescore?: boolean; minYear?: number; topN?: number }
  ): Promise<{ jobId: string; total: number }> {
    const params = new URLSearchParams();
    if (options?.useClaims) params.append('useClaims', 'true');
    if (options?.rescore) params.append('rescore', 'true');
    if (options?.minYear) params.append('minYear', options.minYear.toString());
    if (options?.topN) params.append('topN', options.topN.toString());
    const { data } = await api.post(`/scoring-templates/llm/score/${level}/${name}?${params}`);
    return data;
  },

  async getProgress(
    level: 'super_sector' | 'sector' | 'sub_sector',
    name: string
  ): Promise<SectorScoringProgress> {
    const { data } = await api.get(`/scoring-templates/progress/${level}/${name}`);
    return data;
  },

  // Dynamic Columns
  async getAvailableColumns(
    selections: Array<{ level: 'super_sector' | 'sector' | 'sub_sector'; name: string }>
  ): Promise<DynamicColumns> {
    const { data } = await api.post('/scoring-templates/columns', { selections });
    return data;
  },

  // Export with dynamic columns
  async exportScores(
    selections: Array<{ level: 'super_sector' | 'sector' | 'sub_sector'; name: string }>,
    options?: {
      format?: 'csv' | 'json';
      columns?: string[];
      columnMode?: 'union' | 'intersection';
      includeReasoning?: boolean;
      minScore?: number;
    }
  ): Promise<void> {
    const { data } = await api.post('/scoring-templates/export',
      { selections, ...options },
      { responseType: 'blob' }
    );
    // Download file
    const blob = new Blob([data], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const levelNames = selections.map(s => s.name).join('-');
    link.download = `${levelNames}-scores.csv`;
    link.click();
    URL.revokeObjectURL(url);
  },

  // Sub-sectors
  async getSubSectors(sectorName: string): Promise<Array<{
    id: string;
    name: string;
    displayName: string;
    cpcPatterns: string[];
    patentCount: number;
    scoredCount: number;
  }>> {
    const { data } = await api.get(`/scoring-templates/sub-sectors/${sectorName}`);
    return data;
  }
};
```

---

## Phase 2: Sector Management Enhancement

### Extend `SectorManagementPage.vue`

```
Sector Management (UPDATED)
├── Left Panel: Tree Navigation (ENHANCED)
│   └── Super-sectors (expandable)
│       └── Sectors (expandable) ← NEW: show child sub-sectors
│           └── Sub-sectors with patent counts
│
├── Overview tab (existing + enhancements)
│   └── Add: Sub-sector count, scoring template info
│
├── Rules tab (existing)
│
├── Patents tab (existing)
│
├── Sub-sectors tab (NEW)
│   ├── Sub-sector List
│   │   └── Table: name, CPC patterns, patent count, scored count
│   ├── Mappings & Expressions
│   │   └── Show CPC pattern → sub-sector mappings
│   │   └── Show any boolean expressions
│   └── Actions
│       └── Add/Edit sub-sector
│       └── Preview CPC matches
│
└── LLM Scoring tab (NEW)
    ├── Template Viewer
    │   ├── Inheritance chain: [portfolio-default → COMPUTING → computing-runtime]
    │   ├── Questions list with source level badges
    │   │   └── Expandable cards: field, weight, question, reasoning prompt
    │   └── Edit template (opens structured question editor)
    │
    ├── Template Preview & Test (KEY FEATURE)
    │   ├── Patent selector (search/select from sector)
    │   ├── [Preview Context] → Shows exactly what would be sent
    │   │   └── Rendered prompt with all fields filled
    │   │   └── Token count estimate
    │   │   └── Claims included indicator
    │   └── [Send & Test] → Actually sends to LLM
    │       └── Shows scores and reasoning response
    │       └── Actual token usage
    │       └── Time taken
    │
    ├── Scoring Progress
    │   ├── Progress bar with auto-refresh
    │   ├── Stats: scored/total, % complete
    │   └── Last scored timestamp
    │
    └── Actions
        ├── [Start Scoring] - with options dialog
        │   └── Include claims toggle
        │   └── Min year filter
        │   └── TopN filter (25, 50, 100, 250, 500, 1000, All)
        │   └── Rescore already-scored toggle
        └── [Export Scores] - CSV with reasoning
```

---

## Phase 3: Sector Scores Viewer (NEW PAGE)

### Create `SectorScoresPage.vue`

This is a dedicated page for viewing and exporting sector-specific LLM scores, separate from the patent summary page to avoid overloading the column selector.

```
Sector Scores Viewer
├── Left Panel: Hierarchical Selector
│   ├── Super-sector multi-select (checkboxes)
│   │   └── Sector multi-select (per super-sector)
│   │       └── Sub-sector multi-select (per sector)
│   └── Selection summary chip row
│
├── Column Configuration
│   ├── Mode toggle: Union | Intersection
│   │   └── Union: Show all columns from any selected level
│   │   └── Intersection: Only columns common to all selected
│   ├── Available columns (computed from selection)
│   │   └── Base columns (always): patent_id, title, sector, sub_sector
│   │   └── Score columns: market_relevance, technical_innovation, etc.
│   │   └── Reasoning columns: market_relevance_reasoning, etc.
│   └── Column picker (drag to reorder)
│
├── Data Table
│   ├── Dynamic columns based on selection + configuration
│   ├── Sortable by any score column
│   ├── Expandable rows for reasoning text
│   └── Pagination
│
└── Export
    ├── Format: CSV | JSON
    ├── Include reasoning toggle
    ├── Min score filter
    └── [Export Selected] button
```

### Column Calculation Logic

```typescript
// When user selects sectors at different levels:
// Selected: VIDEO_STREAMING (super), video-codec (sector), routing (sub-sector)

function calculateAvailableColumns(selections: Selection[]): DynamicColumns {
  const allFields = new Set<string>();
  const fieldSets: Set<string>[] = [];

  for (const sel of selections) {
    const template = await getMergedTemplate(sel.level, sel.name);
    const fields = new Set(template.questions.map(q => q.fieldName));
    const reasoningFields = new Set(
      template.questions
        .filter(q => q.requiresReasoning)
        .map(q => `${q.fieldName}_reasoning`)
    );

    const combined = new Set([...fields, ...reasoningFields]);
    fieldSets.push(combined);
    combined.forEach(f => allFields.add(f));
  }

  // Union: all fields from any template
  const union = [...allFields];

  // Intersection: only fields in ALL templates
  const intersection = [...allFields].filter(f =>
    fieldSets.every(set => set.has(f))
  );

  return {
    baseColumns: ['patent_id', 'patent_title', 'super_sector', 'sector', 'sub_sector'],
    scoreColumns: union.filter(f => !f.endsWith('_reasoning')),
    reasoningColumns: union.filter(f => f.endsWith('_reasoning')),
    availableColumns: union,
    commonColumns: intersection
  };
}
```

---

## Phase 4: Job Queue Enhancement

### Extend `JobQueuePage.vue`

```
Job Queue (UPDATED)
├── Enrichment Overview tab (existing)
│
├── Sector Enrichment tab (ENHANCED)
│   ├── Target Level selector: Super-sector | Sector | Sub-sector ← NEW
│   ├── Coverage Scope (TopN): All | 25 | 50 | 100 | 250 | 500 | 1000
│   ├── Hierarchical navigation
│   │   └── When Sector selected: show sector picker
│   │   └── When Sub-sector selected: show sector → sub-sector picker
│   └── Enrichment types now include: llm_scoring ← NEW
│
├── LLM Scoring tab (NEW)
│   ├── Active Jobs
│   │   └── Table: sector/level, progress bar, rate, ETA, tokens used
│   │   └── Cancel button per job
│   ├── Completed Jobs (last 24h)
│   │   └── Table: sector, patents scored, total tokens, duration
│   └── Rate Limit Monitor
│       └── Current rate vs limit
│       └── Throttle warnings
│
└── Job Queue tab (existing + enhancements)
    └── Add job type: LLM_SCORING with sector level info
```

---

## Phase 5: Template Editor Component

### Create `ScoringTemplateEditor.vue`

Reuses patterns from `PromptTemplatesPage.vue` structured question editor.

```vue
<template>
  <div class="scoring-template-editor">
    <!-- Inheritance Chain Display -->
    <div class="inheritance-chain">
      <q-chip v-for="level in inheritanceChain" :key="level"
              :color="getLevelColor(level)" text-color="white">
        {{ level }}
      </q-chip>
      <q-icon name="arrow_forward" v-if="index < inheritanceChain.length - 1" />
    </div>

    <!-- Questions List -->
    <q-list bordered separator>
      <q-expansion-item v-for="q in questions" :key="q.fieldName"
                        :label="q.displayName"
                        :caption="`Weight: ${q.weight} | Source: ${q.sourceLevel}`">
        <q-card>
          <q-card-section>
            <div class="text-subtitle2">Question</div>
            <div>{{ q.question }}</div>

            <div class="text-subtitle2 q-mt-md">Answer Type</div>
            <div>{{ q.answerType }} ({{ q.scale.min }}-{{ q.scale.max }})</div>

            <div v-if="q.requiresReasoning" class="q-mt-md">
              <div class="text-subtitle2">Reasoning Prompt</div>
              <div class="text-italic">{{ q.reasoningPrompt }}</div>
            </div>
          </q-card-section>

          <q-card-actions v-if="q.sourceLevel === currentLevel">
            <q-btn flat label="Edit" @click="editQuestion(q)" />
            <q-btn flat color="negative" label="Remove" @click="removeQuestion(q)" />
          </q-card-actions>
        </q-card>
      </q-expansion-item>
    </q-list>

    <!-- Add Question (for current level only) -->
    <q-btn label="Add Question" icon="add" @click="addQuestion" />
  </div>
</template>
```

---

## Phase 6: Template Preview Component

### Create `TemplatePreviewPanel.vue`

```vue
<template>
  <div class="template-preview-panel">
    <!-- Patent Selector -->
    <q-select v-model="selectedPatent"
              :options="patentOptions"
              label="Select Patent to Preview"
              option-label="title"
              option-value="id"
              use-input
              @filter="searchPatents">
      <template v-slot:option="{ opt }">
        <q-item>
          <q-item-section>
            <q-item-label>{{ opt.title }}</q-item-label>
            <q-item-label caption>{{ opt.id }}</q-item-label>
          </q-item-section>
        </q-item>
      </template>
    </q-select>

    <q-toggle v-model="includeClaims" label="Include Claims" />

    <!-- Action Buttons -->
    <div class="q-gutter-sm">
      <q-btn label="Preview Context"
             icon="visibility"
             @click="previewContext"
             :loading="previewing" />
      <q-btn label="Send & Test"
             icon="science"
             color="primary"
             @click="sendAndTest"
             :loading="testing" />
    </div>

    <!-- Preview Results -->
    <div v-if="previewResult" class="preview-results q-mt-md">
      <q-card>
        <q-card-section>
          <div class="text-h6">Rendered Prompt</div>
          <div class="text-caption">
            Estimated tokens: {{ previewResult.estimatedTokens }}
          </div>
        </q-card-section>
        <q-separator />
        <q-card-section>
          <pre class="rendered-prompt">{{ previewResult.renderedPrompt }}</pre>
        </q-card-section>
      </q-card>
    </div>

    <!-- Test Results -->
    <div v-if="testResult" class="test-results q-mt-md">
      <q-card>
        <q-card-section>
          <div class="text-h6">LLM Response</div>
          <div class="text-caption">
            Tokens: {{ testResult.actualTokens.input }} in /
            {{ testResult.actualTokens.output }} out
          </div>
        </q-card-section>
        <q-separator />
        <q-card-section>
          <q-list>
            <q-item v-for="(score, field) in testResult.llmResponse.scores" :key="field">
              <q-item-section>
                <q-item-label>{{ field }}</q-item-label>
                <q-item-label caption>
                  {{ testResult.llmResponse.reasoning[field] }}
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-badge :color="getScoreColor(score)">{{ score }}</q-badge>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
      </q-card>
    </div>
  </div>
</template>
```

---

## Backend API Endpoints to Add

### Template Preview & Test
```
GET  /api/scoring-templates/preview/:level/:name/:patentId
     → Returns TemplatePreviewContext (rendered prompt, token estimate)

POST /api/scoring-templates/test/:level/:name/:patentId
     → Actually sends to LLM, returns TemplatePreviewResult with scores
```

### Progress & Columns
```
GET  /api/scoring-templates/progress/:level/:name
     → Returns SectorScoringProgress

POST /api/scoring-templates/columns
     Body: { selections: Array<{level, name}> }
     → Returns DynamicColumns (union/intersection of available fields)
```

### Flexible Export
```
POST /api/scoring-templates/export
     Body: {
       selections: Array<{level, name}>,
       format: 'csv' | 'json',
       columns: string[],
       columnMode: 'union' | 'intersection',
       includeReasoning: boolean,
       minScore: number
     }
     → Returns file download
```

### Sub-sector Management
```
GET  /api/scoring-templates/sub-sectors/:sectorName
     → Returns sub-sectors with CPC patterns and counts

GET  /api/sectors/:sectorId/sub-sectors
     → Returns sub-sectors for sector management page
```

---

## Implementation Priority

### High Priority (Core Functionality)
1. API layer in `api.ts`
2. Sub-sector display in Sector Management
3. LLM Scoring tab with template viewer
4. Template preview & test functionality

### Medium Priority (Usability)
5. Sector Scores Viewer page
6. Dynamic column calculation
7. Job Queue LLM scoring tab
8. Export with flexible columns

### Lower Priority (Polish)
9. Template editing (leverage existing editor)
10. Score history/comparison
11. Rate limit monitoring UI

---

## File Summary

| File | Action |
|------|--------|
| `frontend/src/services/api.ts` | Add scoringTemplatesApi |
| `frontend/src/pages/SectorManagementPage.vue` | Add Sub-sectors + LLM Scoring tabs |
| `frontend/src/pages/SectorScoresPage.vue` | NEW - dedicated scores viewer |
| `frontend/src/pages/JobQueuePage.vue` | Add LLM Scoring tab, sub-sector support |
| `frontend/src/components/ScoringTemplateEditor.vue` | NEW - reuse structured Q patterns |
| `frontend/src/components/TemplatePreviewPanel.vue` | NEW - preview & test |
| `frontend/src/components/HierarchySelector.vue` | NEW - super → sector → sub selector |
| `frontend/src/router/index.ts` | Add route for SectorScoresPage |

---

## Notes

- Scoring templates are an extension of existing structured question templates
- Template preview/test enables GUI-based testing instead of CLI interaction
- Dynamic columns keep sector-specific scores out of the main patent summary page
- Union/intersection modes handle mixed-level selection scenarios
- Sub-sector display fills a gap in current sector management UI
