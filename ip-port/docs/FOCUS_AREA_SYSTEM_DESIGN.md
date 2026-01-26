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
| **Search Scope** | A top-down categorical boundary within which search terms are tested and evaluated. E.g., Portfolio, CPC, Portfolio/Sector. |
| **Patent Family** | A generational citation tree centered on a patent of interest, spanning backward (prior art) and forward (citing patents) across configurable generations. |
| **Emergent Search Term** | A search expression discovered through analysis (word frequency, LLM suggestion, or scope comparison) rather than manual authoring. |
| **Focus Ratio** | The ratio of focus area hits to search scope hits for a given search term — higher means more selective/distinctive. |

---

## Design Philosophy

### Focus Area: Bottom-Up Grouping

A Focus Area is a **bottom-up** grouping created by selecting individual patents (by patent number, keyword search, or facet expressions) and finding commonality among them. The key insight is:

1. **Start small**: Select a handful of seemingly related patents (e.g., 3-20)
2. **Find patterns**: Discover what makes them similar through search terms, CPC overlap, shared keywords, LLM analysis
3. **Test portability**: Apply the discovered patterns (search expressions) to broader or different scopes
4. **Expand or refine**: If a pattern that groups patents within a small scope (e.g., a sector in one portfolio) also works in a different scope (e.g., the entire USPTO or web search for products), the search terms have **universal value**

**Example workflow**: Within a small patent portfolio, patents may be grouped in a patent family or within a sector. If we discover emergent search terms that also group these patents, we can apply those terms to a different scope (e.g., web search for infringing products) to find external connections.

### Search Scope: Top-Down Context

A Search Scope is the **top-down** categorical boundary within which we evaluate search terms. When creating or refining a Focus Area, we always work within a scope to:

- **Limit computation**: Narrower scope = faster search term evaluation
- **Improve signal**: Search terms that distinguish a focus group within a narrow scope (vs. all patents in that scope) are more likely to have discriminating value
- **Enable comparison**: The Focus Ratio (focus area hits / scope hits) measures how selective a term is

### Scope Types

| Scope Type | Definition | Example |
|------------|------------|---------|
| **Portfolio** | All patents assigned to a company or related group | Broadcom portfolio (28,913 patents) |
| **CPC** | All patents within a USPTO CPC category | H04L (Transmission of digital information) |
| **Portfolio/CPC** | Intersection of portfolio membership and CPC | Broadcom + H04L |
| **Super-Sector** | Broad hierarchical technology area | Network Technology |
| **Sector** | Narrower hierarchical technology area (child of Super-Sector) | network-security-core |
| **Portfolio/Sector** | Portfolio constrained to a single sector | Broadcom + network-security-core |
| **Portfolio/(Sector1 OR Sector2)** | Portfolio constrained to union of sectors | Broadcom + (network-security OR network-switching) |
| **Patent Family** | A generational citation tree around a patent | US10123456 ± 2 generations |

### Dynamic Scope Creation

Compound scopes like `Portfolio/(Sector1 OR Sector2)` can be created dynamically:

1. **Auto-detection**: When a user selects patents from the portfolio grid that span two sectors, the system auto-suggests `Portfolio/(Sector1 OR Sector2)` as the scope
2. **Naming**: Prompt the user to name the new scope if they want to save it — this could bootstrap a new sector definition
3. **Expansion**: A dynamically created scope can later be expanded beyond the portfolio as more patents are added to the system

### Scope Auto-Selection Logic

When a user begins creating or editing a Focus Area, the system should auto-select the narrowest applicable scope:

```
1. If all selected patents share one Sector within portfolio → Portfolio/Sector
2. If selected patents span 2-3 sectors within portfolio → Portfolio/(Sector1 OR Sector2 ...)
3. If selected patents share one Super-Sector → Portfolio/Super-Sector
4. If selected patents share one CPC class → Portfolio/CPC
5. Fallback → Portfolio
```

The user can always override the auto-selected scope (broaden or narrow).

### Hierarchical Placement

Both Focus Areas and Search Scopes can participate in hierarchies. When possible, the system should attempt to organize them such that:

- Levels within a hierarchy are **mutually exclusive** and **collectively exhaustive** (MECE)
- Sibling groups can be added to complete a hierarchy level
- A parent group can be created to contain a set of siblings

This is aspirational — not all groupings will fit neatly into hierarchies, and the system should accommodate both hierarchical and free-form groupings.

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

## Search Term Extraction: Word Count Grid

For a small number of patents in a focus area (limit: ~20 patents), display an interactive grid that enables emergent search term discovery.

### Grid Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Word Count Extraction Grid                    [Source: Title ▼] [20 max] │
├──────────────────────────────────────────────────────────────────────────┤
│ Scope: Portfolio/Sector: network-security-core                          │
│                                                                         │
│ Word/Phrase     US100..  US101..  US102..  US103..  US104..  Total  │
│ ────────────────────────────────────────────────────────────────────── │
│ ☑ authentication   3       2       0       4       1       10    │
│ ☑ protocol         2       1       3       0       2        8    │
│ ☑ token            0       3       2       2       0        7    │
│ ☐ network          1       1       2       1       1        6    │
│ ☐ method           1       0       1       1       1        4    │
│ ☐ system           1       1       0       1       0        3    │
│                                                                         │
│ Selected: authentication, protocol, token                               │
│ Combined: authentication AND protocol AND token                          │
│                                                                         │
│ Scope Hits: 47/2,341 (2.0%)  |  Focus Hits: 4/5 (80%)                  │
│ Focus Ratio: 8.51% ████████░░ (good)                                    │
│                                                                         │
│ [Add as Search Term] [Try as OR] [Try as Proximity]                     │
└──────────────────────────────────────────────────────────────────────────┘
```

### Configuration

| Setting | Options | Default |
|---------|---------|---------|
| **Text source** | Title / Abstract / Both | Both |
| **Stop words** | Omit standard English stop words | Enabled |
| **Min frequency** | Minimum total occurrences across patents | 2 |
| **Patents** | Selected focus area patents (max 20) | All in focus area |

### Word Count Caching

For computational efficiency, maintain word counts within various search scopes:

- **Per-scope word counts**: Pre-compute word frequencies for titles and abstracts within each scope (Portfolio, Sector, CPC, etc.)
- **Contrast scoring**: Words that appear frequently in the focus group but rarely in the scope have high discriminating power
- **Auto-suggestion**: Suggest words with high contrast ratios as candidates for multi-word search terms

### Workflow

1. User selects patents (or uses current focus area members)
2. System computes word frequency grid from selected text fields
3. User checks/unchecks words to build a candidate search expression
4. System previews hits against scope and focus group in real-time
5. User adds the expression as a Search Term on the Focus Area

---

## LLM Job System

### Job Types

LLM jobs can operate at two levels:

#### 1. Atomic Patent Jobs (Per-Patent)

Run an LLM prompt independently on each patent to extract facet values:

```
Input:  Single patent (title, abstract, claims, CPC codes — configurable context)
Output: One or more facet values for that patent
Scope:  Run across all patents in a focus area, sector, or portfolio
```

**Example**: "Rate this patent's enforcement clarity from 1-5" → produces a numeric facet value per patent.

#### 2. Comparative Group Jobs (Cross-Patent)

Run an LLM prompt that compares and contrasts a group of patents to extract group-level insights:

```
Input:  Multiple patents (titles, abstracts, key metadata)
Output: Group-level facet values, suggested names, suggested search terms
Scope:  Run on a focus area, patent family, or user-selected group
```

**Example**: "Analyze these 10 patents and suggest a descriptive name for their common technology" → produces a focus area name and description.

### LLM Job Orchestration

Jobs should be schedulable and composable:

1. **Independent jobs**: Run facet extraction on each patent independently (parallelizable)
2. **Dependent jobs**: Run comparative analysis after individual facets are computed
3. **Scope-aware**: LLM context includes scope information to help the model understand the universe of patents
4. **Cost-aware**: Track token usage per job, allow batch scheduling during off-peak

### Focus Area Auto-Naming (Medium-Term Feature)

When a focus group is being formalized into a focus area, offer LLM-generated name and description:

```
Prompt: "Given these patents with the following titles and abstracts,
suggest a concise name (2-4 words) and one-sentence description
for this technology grouping. Also suggest 3-5 search terms
that would identify similar patents."

Context: [patent titles, abstracts, CPC codes]

Output:
- Name: "Secure Container Orchestration"
- Description: "Patents covering security mechanisms for container
  runtime isolation and orchestration in virtualized environments"
- Suggested terms: ["container isolation", "runtime security",
  "orchestration AND security", "namespace protection"]
```

---

## Sector Design Considerations

### Sector Emergence

Sectors are emergent groups established through sector expansion. Currently sector expansion uses hard-coded search terms in code — this should be refactored to use database-driven search terms.

### Sector Properties

| Property | Description |
|----------|-------------|
| **Hierarchy** | Sectors are children of Super-Sectors (one level deep for now) |
| **Exclusivity** | Sectors are mutually exclusive within their Super-Sector |
| **Target size** | 10-500 patents per sector depending on portfolio diversity |
| **Bootstrap** | Can start from CPC codes or combinations of CPC codes |
| **Evolution** | Portfolio-specific initially; can normalize as more companies are added |

### Sector Expansion Refactoring

1. Move sector search term definitions from code to database (SearchTerm model or new SectorDefinition model)
2. Support CPC-based sector bootstrapping: map groups of CPC codes to sectors
3. Support LLM-assisted sector naming: generate modern sector labels from CPC groups
4. Enable sector-specific facet runs (LLM prompts scoped to sector context)

### Sector Reporting

Current Excel spreadsheets include a Top 15 sector ranking report. The GUI should recreate this with:
- Sector name, patent count, average score, top patents
- Sortable and filterable sector grid
- Drill-down from sector to patent list

---

## Patent View Requirements

When viewing patent information (detail page, mouseover popup, or inline preview):

| Element | Priority | Context |
|---------|----------|---------|
| **Title** | Always visible | Every patent display |
| **Abstract** | Visible when available | Critical for search term extraction, detail view, keyword analysis |
| **Patent Number** | Always visible | Linkable to detail page |
| **CPC Codes** | Visible with tooltips | Show description on hover |
| **Grant Date** | Visible | Date context |
| **Assignee/Affiliate** | Visible | Ownership context |

Abstracts are particularly critical when working with search term extraction and focus area refinement — users need to read the patent language to construct effective search terms.

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

### Search Term Selectivity (Future Enhancement)

**Current state**: The hit preview shows a selectivity ratio (focus area hits / portfolio hits). Lower ratio = term is more distinctive to the focus area vs the broader portfolio.

**Planned enhancements**:
- **Persist selectivity ratio** as a saved attribute on each `SearchTerm` record (e.g., `selectivityRatio`, `portfolioHits`, `focusAreaHits`) so it doesn't need to be recomputed each time
- **Combine selectivity across search terms** for a focus group to determine their collective efficacy at distinguishing the group from the portfolio
- **Composite selectivity score** for a focus area: weighted combination of all its search terms' selectivity ratios
- **Auto-suggest term removal**: flag terms with high selectivity ratios (>0.8) as non-distinctive
- **Track selectivity over time** as portfolio composition changes
- **Scope-relative selectivity**: Calculate selectivity relative to the active search scope (not just portfolio), enabling more meaningful ratios when working within narrow scopes
- **Cross-scope comparison**: Show how the same search term performs in different scopes to evaluate its portability

### Search Scope Persistence

Search Scopes should be persistable when they represent useful recurring boundaries:

```typescript
interface SearchScope {
  id: string;
  name: string;                    // e.g., "Broadcom Network Security"
  displayName: string;
  type: 'PORTFOLIO' | 'CPC' | 'SECTOR' | 'SUPER_SECTOR' | 'COMPOUND' | 'PATENT_FAMILY';

  // Definition (depends on type)
  portfolioId?: string;            // For portfolio-based scopes
  cpcCode?: string;                // For CPC-based scopes
  sectorId?: string;               // For sector-based scopes
  superSectorId?: string;          // For super-sector scopes
  compoundExpression?: string;     // For compound scopes like "Portfolio/(Sector1 OR Sector2)"
  patentFamilyRootId?: string;     // For patent family scopes

  // Cached stats
  patentCount: number;
  lastCalculatedAt: Date;

  // Metadata
  createdBy: string;
  isSystem: boolean;               // System-generated vs user-created
  createdAt: Date;
}
```

---

*Last Updated: 2026-01-25 (Session 4 — added Search Scope, Word Count Grid, LLM Jobs, Sector, Patent View sections)*
