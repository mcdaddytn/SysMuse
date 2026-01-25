# Focus Area System Design

## Terminology

| Term | Definition |
|------|------------|
| **Focus Group** | A tentative, working selection of patents used to explore and define a potential Focus Area. Mutable, exploratory. |
| **Focus Area** | A formalized patent grouping with defined search terms, constraints, and facet specifications. Stable, calculable. |
| **Search Term** | A query expression (keyword, phrase, proximity, wildcard) that defines membership in a Focus Area. |
| **Atomic Facet** | A single-value attribute on a patent, either from API data, user assignment, or LLM extraction. |
| **Derived Facet** | A calculated value from one or more atomic facets (e.g., score = 0.4*facetA + 0.6*facetB). |
| **Scope** | The hierarchical context: Patent → Focus Area → Primary Sector → Super-Sector → Portfolio. |

---

## Focus Group → Focus Area Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FOCUS GROUP (Exploratory)                       │
│                                                                         │
│  1. Create from grid filters, multi-select, or LLM suggestion          │
│  2. Refine: add/remove patents, extract search terms                   │
│  3. Review hit distribution across scopes                              │
│  4. Exclude outliers → creates sibling/parent structure                │
│                                                                         │
│                              ↓ Formalize                                │
│                                                                         │
│                         FOCUS AREA (Stable)                             │
│                                                                         │
│  - Named with description                                              │
│  - Search terms locked (can be versioned)                              │
│  - Facet definitions attached (LLM questions, calculations)            │
│  - Membership calculated from search terms + constraints               │
│  - Can participate in set operations with other Focus Areas            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Creation Methods

### Method 1: From Grid View Filters

**Flow:**
1. User applies filters in Portfolio Grid (Affiliate, Super-Sector, date range, etc.)
2. Resulting view looks like a coherent grouping
3. User clicks "Create Focus Group from View"
4. System captures current filter state as initial Focus Group definition
5. User can refine, name, and formalize into Focus Area

**UI Action:** Button in filter bar: `[+ Create Focus Group]`

---

### Method 2: Search Term Extraction

**Two sub-methods:**

#### 2a. Keyword Frequency Analysis

1. Multi-select patents in grid
2. Open "Extract Search Terms" panel
3. System analyzes collective abstracts/titles
4. Display keywords ranked by:
   - Frequency in selected patents
   - Contrast ratio vs. corpus (portfolio, sector, etc.)
5. User selects keywords to build search term
6. Preview hits across scopes
7. Create Focus Group or add to existing Focus Area

**UI Components:**
```
┌─────────────────────────────────────────────────────────────────┐
│ Keyword Extraction                           [Selected: 5 patents] │
├─────────────────────────────────────────────────────────────────┤
│ Compare to: [Portfolio ▼]                                        │
│                                                                  │
│ Keyword          Selected  Corpus   Contrast   ☑                │
│ ─────────────────────────────────────────────────────────────── │
│ virtualization      5/5      234     21.4x    [✓]               │
│ container           4/5      156     25.6x    [✓]               │
│ hypervisor          3/5       45     66.7x    [✓]               │
│ memory              5/5     2341      2.1x    [ ]               │
│ network             4/5     1876      2.1x    [ ]               │
│                                                                  │
│ Selected terms: virtualization, container, hypervisor            │
│ Search type: [Keywords ▼] [Proximity ▼] [Wildcards ▼]           │
│                                                                  │
│ Preview Hits:                                                    │
│   Portfolio: 127    Sector: 89    Selected: 5                   │
│                                                                  │
│ [Create Focus Group] [Add to Existing...]                        │
└─────────────────────────────────────────────────────────────────┘
```

#### 2b. Phrase Highlighting (Interactive)

1. View patent abstract/title text
2. Drag to highlight a phrase (selects all words)
3. Click individual words to toggle (refine selection)
4. Right-click or hover menu appears:
   - Create as keyword search
   - Create as phrase search (exact)
   - Create as proximity search (words within N)
   - Create with wildcards (stemming)
5. Selected search term runs against scopes
6. Create Focus Group or add to existing

**UI Interaction:**
```
Abstract text with highlighting:

"A method for [secure container orchestration] in
virtualized environments using [hardware-based isolation]..."

Right-click menu on "container orchestration":
┌────────────────────────────────┐
│ Create Search Term             │
├────────────────────────────────┤
│ ○ Keywords: container OR orch* │
│ ● Phrase: "container orchestr" │
│ ○ Proximity: container W/3 or* │
│ ○ With wildcards: contain* or* │
├────────────────────────────────┤
│ [Preview Hits] [Create Term]   │
└────────────────────────────────┘
```

---

### Method 3: LLM Suggestion

**Flow:**
1. Multi-select patents in grid
2. Click "Suggest Focus Groups"
3. LLM analyzes titles and abstracts
4. Returns suggested groupings with:
   - Proposed Focus Group name
   - Suggested search terms
   - Confidence score
   - Overlap analysis (which patents in multiple suggestions)
5. User reviews, selects, modifies
6. Apply search terms to broader scopes to find related patents
7. Create Focus Group(s)

**LLM Prompt Template:**
```
Analyze these patent titles and abstracts. Suggest 2-4
potential technology groupings. For each:
1. Proposed name
2. 3-5 search terms that would identify similar patents
3. Which patents belong to this group
4. Confidence (high/medium/low)

Patents:
[titles and abstracts]
```

**UI:**
```
┌─────────────────────────────────────────────────────────────────┐
│ LLM Suggested Focus Groups                    [5 patents analyzed] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ ┌─ Suggestion 1: Container Security ──────────────────────────┐ │
│ │ Confidence: High                                             │ │
│ │ Patents: US10378893, US10445123, US10567890                  │ │
│ │ Search terms: container isolation, runtime security,        │ │
│ │               namespace protection                           │ │
│ │                                                              │ │
│ │ [Preview in Portfolio] [Create Focus Group]                  │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─ Suggestion 2: Hypervisor Memory Management ────────────────┐ │
│ │ Confidence: Medium                                           │ │
│ │ Patents: US10234567, US10345678                              │ │
│ │ Search terms: memory virtualization, page table,            │ │
│ │               hypervisor allocation                          │ │
│ │                                                              │ │
│ │ [Preview in Portfolio] [Create Focus Group]                  │ │
│ └──────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Focus Group Refinement

### Excluding Outliers

When patents don't belong in a Focus Group:

1. Select patents to exclude
2. System creates hierarchy:
   - **Parent Focus Group**: Contains all (original + excluded)
   - **Preferred Focus Group**: Original minus excluded (inherits name)
   - **Sibling Focus Group**: The excluded patents

3. Sibling naming convention:
   - If preferred = "Container Security"
   - Sibling = "Container Security - Excluded" or "Container Security Sibling"
   - Parent = "Container Security Parent"

4. Sibling gets "Needs Review" status for later triage

**Data Model:**
```typescript
interface FocusGroup {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'needs_review' | 'archived';
  parentId?: string;           // Reference to parent
  siblingIds?: string[];       // References to siblings
  searchTerms: SearchTerm[];
  constraints: Constraint[];   // Exclusion rules
  patentIds: string[];         // Cached membership (recalculated)
}
```

---

## Search Term Data Model

```typescript
interface SearchTerm {
  id: string;
  focusAreaId: string;

  // The search expression
  type: 'keyword' | 'phrase' | 'proximity' | 'wildcard' | 'boolean';
  expression: string;          // e.g., "container W/3 security"

  // Source tracking
  source: 'manual' | 'frequency_analysis' | 'phrase_highlight' | 'llm_suggestion';
  sourcePatentIds?: string[];  // Patents it was derived from

  // Hit analysis (cached)
  hitCounts: {
    portfolio: number;
    superSector?: Record<string, number>;
    sector?: Record<string, number>;
    affiliate?: Record<string, number>;
  };

  createdAt: Date;
  createdBy: string;
}
```

---

## Focus Area Facet System

### Atomic Facets

Sources of atomic facets:
1. **API Data**: forward_citations, remaining_years, cpc_codes
2. **User Assignment**: manual tagging, ratings
3. **LLM Extraction**: claim_breadth, enforcement_clarity, market_relevance

**LLM Question Attachment:**
```typescript
interface FocusAreaFacetDefinition {
  id: string;
  focusAreaId: string;

  // Facet metadata
  name: string;                // e.g., "Zero Trust Relevance"
  type: 'numeric' | 'categorical' | 'text';
  range?: { min: number; max: number };  // For numeric
  options?: string[];          // For categorical

  // LLM configuration
  llmPrompt: string;           // The question to ask
  llmContextFields: ('title' | 'abstract' | 'claims' | 'description')[];
  llmModel?: string;           // Override default model

  // Execution
  status: 'pending' | 'running' | 'complete' | 'error';
  completedCount: number;
  totalCount: number;
}
```

### Derived Facets

Calculated from atomic facets:

```typescript
interface DerivedFacetDefinition {
  id: string;
  focusAreaId: string;
  name: string;

  // Calculation
  formula: string;             // e.g., "0.4 * claim_breadth + 0.6 * market_relevance"
  inputFacets: string[];       // Facet IDs used in formula

  // Normalization
  normalization?: 'none' | 'minmax' | 'zscore' | 'percentile';
  normalizeWithin?: 'focus_area' | 'sector' | 'portfolio';
}
```

### Scope Inheritance and Promotion

Facets can flow up and down the scope hierarchy:

```
Portfolio
    ↑ promote
Super-Sector
    ↑ promote
Primary Sector
    ↑ promote
Focus Area
    ↑ calculate
Patent (atomic facets)
```

**Promotion Use Cases:**
- Focus Area score becomes representative metric for Sector comparison
- Sector average of a facet becomes portfolio-wide benchmark
- Normalize Focus Area scores relative to Sector peers

**Inheritance Use Cases:**
- Sector-level LLM question applied to all Focus Areas within
- Portfolio-wide facet calculation available in all contexts

---

## Dependency Management

### Execution Order

Facet calculations must respect dependencies:

```typescript
interface FacetExecutionPlan {
  focusAreaId: string;
  steps: FacetExecutionStep[];
}

interface FacetExecutionStep {
  order: number;
  type: 'llm_question' | 'calculation' | 'promotion';
  facetId: string;
  dependsOn: string[];         // Facet IDs that must complete first
  status: 'pending' | 'ready' | 'running' | 'complete' | 'blocked';
}
```

### Circular Dependency Detection

Before adding a derived facet:
1. Build dependency graph
2. Check for cycles using topological sort
3. Reject if cycle detected
4. Display dependency chain for user review

```typescript
function detectCircularDependency(
  newFacet: DerivedFacetDefinition,
  existingFacets: Map<string, DerivedFacetDefinition>
): { hasCycle: boolean; cycle?: string[] } {
  // Kahn's algorithm or DFS-based cycle detection
  // Returns the cycle path if found
}
```

---

## UI Components Needed

| Component | Purpose |
|-----------|---------|
| `FocusGroupPanel.vue` | Side panel for working with Focus Group |
| `SearchTermExtractor.vue` | Keyword frequency analysis UI |
| `PhraseHighlighter.vue` | Interactive text selection |
| `LLMSuggestionDialog.vue` | Display LLM-generated groupings |
| `FocusAreaManager.vue` | CRUD for Focus Areas |
| `FacetDefinitionEditor.vue` | Define atomic/derived facets |
| `FacetExecutionQueue.vue` | View/manage facet calculation jobs |
| `ScopeHierarchyViewer.vue` | Visualize scope inheritance |

---

## API Endpoints Needed

```
# Focus Groups (working/draft)
POST   /api/focus-groups                    - Create from filters or selection
GET    /api/focus-groups                    - List all
GET    /api/focus-groups/:id                - Get details
PUT    /api/focus-groups/:id                - Update
DELETE /api/focus-groups/:id                - Delete
POST   /api/focus-groups/:id/formalize      - Convert to Focus Area

# Focus Areas (stable)
POST   /api/focus-areas                     - Create
GET    /api/focus-areas                     - List all
GET    /api/focus-areas/:id                 - Get details with stats
PUT    /api/focus-areas/:id                 - Update
DELETE /api/focus-areas/:id                 - Delete (archive)
GET    /api/focus-areas/:id/patents         - Get member patents
POST   /api/focus-areas/:id/recalculate     - Recalculate membership

# Search Terms
POST   /api/search-terms/extract            - Extract from text
POST   /api/search-terms/preview            - Preview hits across scopes
POST   /api/focus-areas/:id/search-terms    - Add term to Focus Area
DELETE /api/focus-areas/:id/search-terms/:termId

# Facets
GET    /api/focus-areas/:id/facets          - List facet definitions
POST   /api/focus-areas/:id/facets          - Add facet definition
PUT    /api/focus-areas/:id/facets/:facetId - Update
DELETE /api/focus-areas/:id/facets/:facetId - Delete
POST   /api/focus-areas/:id/facets/:facetId/execute - Run LLM/calculation

# LLM Suggestions
POST   /api/llm/suggest-focus-groups        - Analyze patents, suggest groupings
```

---

## Implementation Phases

### Phase 1: Core Focus Area CRUD
- Focus Group/Area data models
- Basic CRUD API endpoints
- Simple management UI
- Manual patent assignment

### Phase 2: Search Term System
- Search term extraction (keyword frequency)
- Phrase highlighting UX
- Hit preview across scopes
- Search term attachment to Focus Areas

### Phase 3: LLM Integration
- LLM suggestion endpoint
- Suggestion review UI
- Search term generation from LLM

### Phase 4: Facet System
- Atomic facet definitions
- LLM question attachment
- Job queue integration for facet extraction
- Derived facet calculations

### Phase 5: Scope & Hierarchy
- Parent/sibling relationships
- Facet promotion up scope
- Normalization across scopes
- Dependency management

---

## Design Decisions

### Search Term Syntax
- **Use Elasticsearch** for search execution (already integrated)
- Present logical variations based on keyword selection:
  - Keywords only (OR search)
  - Phrase with wildcards for omitted words
  - Proximity search (W/N)
  - Boolean combinations
- User selects from suggested options in UI

### Membership Calculation
- Operations scoped for performance (narrower scope = faster)
- Some operations may be limited by scope (e.g., can't do full portfolio proximity search)
- Recalculation triggered on:
  - Search term change
  - Manual request
  - Scheduled refresh (for active Focus Areas)

### Versioning (Future Enhancement)
- Track **definition changes** primarily (search terms, constraints)
- Membership snapshots secondary (derived from definition)
- Each definition change creates new version
- Can compare versions, rollback

### Collaboration
- **Phase 1**: Single owner per Focus Area
- **Future**: Multi-user editing with voting
  - Vote on patent inclusion/exclusion
  - Vote on weights (like v3 consensus scoring)
  - Conflict resolution via consensus

---

*Last Updated: 2026-01-25*
