# Patent Family Explorer - Implementation Guide

**Status**: Phases 1-4 Complete | Phase 5 Pending
**Last Updated**: 2026-02-14

---

## Overview

The Patent Family Explorer enables users to create Focus Areas from curated patent family explorations. Starting from high-value seed patents (e.g., top-scoring patents from V2/V3 scoring, attorney-identified targets), users expand via citation relationships to discover related patents for prosecution, IPR, or litigation analysis.

This document covers the implementation details. For conceptual design and terminology, see [PATENT_FAMILIES_DESIGN.md](./PATENT_FAMILIES_DESIGN.md).

---

## What's Implemented

### Phase 1: Core Workflow

**Multi-Seed Exploration with Preview**

Users can provide multiple seed patents (e.g., a curated set of litigation targets or related high-value patents) and explore their combined family using BFS traversal.

**Key Features:**
- Multi-seed input with parsing (comma/newline separated, handles US prefix)
- Preview estimation before full exploration
- Configurable expansion depths (0-3 generations for ancestors/descendants)
- Sibling and cousin inclusion toggles
- INTERSECTION or UNION merge strategies for multi-seed results
- Competitor and affiliate classification during traversal

**API Endpoints:**
```
POST /api/patent-families/explorations/preview
POST /api/patent-families/explorations/multi-seed
POST /api/patent-families/explorations/:id/create-focus-area
POST /api/patent-families/create-focus-area
GET  /api/patent-families/filter-options
```

### Phase 2: Entry Point Integration

**Jump-off Points:**
1. **Portfolio Summary Page** - "Explore Families" bulk action on selected patents
2. **Focus Area Detail Page** - "Explore Families" in Quick Actions (useful for attorney-curated sets)
3. **Direct Input** - Paste patent list on `/patent-families` page
4. **URL Parameters** - Navigate with `?seeds=10123456,10234567`

### Phase 3: Constraint System

**Available Constraints:**
- **Generation Limits**: Max ancestor/descendant depth (0-3)
- **Relationship Types**: Toggle siblings, cousins
- **Competitor Filter**: Limit to specific competitors
- **Affiliate Filter**: Limit to specific affiliates (useful for focusing on one business unit)
- **Portfolio Requirement**: Only include portfolio patents
- **Filing Year Minimum**: Contemporary focus (e.g., only patents filed after 2015)

### Phase 4: Prosecution/IPR Enrichment

**Patent Detail Fetching:**
- External patents (not in portfolio) need basic details (title, assignee, etc.)
- Enrichment automatically fetches missing patent details from PatentsView API
- Details are cached locally for future use

**Litigation Data Fetching:**
- IPR proceedings from PTAB API (via `odp-ptab-client.ts`)
- Prosecution history from File Wrapper API (via `odp-file-wrapper-client.ts`)
- "Enrich Litigation Data" button fetches both details AND litigation data
- IPR column shows indicators with counts and tooltips
- Summary chip shows IPR statistics

**API Endpoints:**
```
POST /api/patent-families/fetch-details              # Fetch basic patent details only
POST /api/patent-families/enrich-with-details        # Fetch details AND litigation (recommended)
POST /api/patent-families/enrich-litigation          # Fetch litigation only (legacy)
GET  /api/patent-families/litigation-status
GET  /api/patent-families/ipr/:patentId
GET  /api/patent-families/prosecution/:patentId
POST /api/patent-families/explorations/:id/enrich-litigation
```

---

## Using the Feature

### Basic Workflow

1. **Select Seeds**: Navigate to `/patent-families` and enter seed patent IDs
   - Paste from spreadsheet, scoring results, or attorney lists
   - Use "Explore Families" action from Portfolio or Focus Area pages

2. **Configure Expansion**:
   - Set ancestor/descendant depth (1 generation each is typical)
   - Enable siblings for parallel technology discovery
   - Choose merge strategy (INTERSECTION for convergent results)

3. **Apply Constraints** (optional):
   - Filter to specific competitors for competitive analysis
   - Filter to specific affiliates for focused portfolio analysis
   - Require portfolio membership for internal analysis

4. **Preview**: Review estimated counts before full exploration

5. **Explore**: Execute the exploration to see all discovered patents

6. **Enrich** (optional): Click "Enrich Litigation Data" to:
   - **Fetch patent details** (title, assignee, etc.) for external patents not yet in the system
   - **Fetch IPR/prosecution history** for all patents
   - Results table updates to show enriched data

7. **Select & Create**: Select relevant patents and create a Focus Area

### Merge Strategies

| Strategy | Behavior | Best For |
|----------|----------|----------|
| INTERSECTION | Only patents connected to ALL seeds | Finding convergent technology across related patents |
| UNION | Patents connected to ANY seed | Broader discovery, coverage analysis |

### Entry Points

**From Portfolio Summary:**
1. Select patents in the table (checkbox column)
2. Click "Explore Families" in bulk actions
3. Navigates to `/patent-families` with seeds pre-populated

**From Focus Area Detail:**
1. Open a Focus Area (especially attorney-curated ones)
2. Click "Explore Families" in Quick Actions
3. Uses focus area patents as seeds

---

## File Reference

| File | Purpose |
|------|---------|
| `frontend/src/pages/PatentFamilyExplorerPage.vue` | Main exploration UI |
| `frontend/src/services/api.ts` | API types and methods |
| `src/api/routes/patent-families.routes.ts` | REST endpoints |
| `src/api/services/patent-family-service.ts` | Core BFS traversal and enrichment |
| `services/competitor-config.ts` | Competitor matching |
| `services/affiliate-normalizer.ts` | Affiliate classification |
| `clients/odp-ptab-client.ts` | PTAB API for IPR data |
| `clients/odp-file-wrapper-client.ts` | File Wrapper API for prosecution |

---

## Phase 5: LLM Prompt Templates (Planned)

### Overview

Phase 5 extends the prompt template system to support patent family analysis with multi-stage templates, grounded facts, and cross-patent synthesis.

### Key Design Principles

1. **Ground in API Data**: All prosecution/IPR facts MUST come from enriched API data (Phase 4), not LLM generation. Templates reference cached prosecution history rather than asking the LLM to "analyze prosecution history" without providing it.

2. **Multi-Stage Summarization**: Large families exceed context limits. Use staged summarization:
   - Stage 1: Per-patent analysis (grounded in data)
   - Stage 2: Chunk-level synthesis
   - Stage 3: Cross-family synthesis

3. **Hallucination Safeguards**:
   - Separate "grounded facts" (API data) from "LLM analysis" sections in prompts
   - Require citations to specific patent IDs in responses
   - Cross-validate LLM claims against cached data where possible

4. **Focused Roundtrips**: Don't overload single prompts. Better to have 5 focused stages than 1 complex prompt.

### Template Input Patterns

The current system supports `objectType: 'patent'` for single-patent analysis. Phase 5 adds:

| Pattern | Description | Use Case |
|---------|-------------|----------|
| **Single Patent** | Existing per-patent analysis | Current functionality |
| **Multiple Peer Patents** | Comparison/ranking (tournament-style) | Identifying strongest/weakest in family |
| **Primary + Related Patents** | Main patent with related context | Family head with children context |
| **Tree Structure** | Full family hierarchy with relationships | Comprehensive family analysis |
| **Multi-Stage Chains** | Linked templates feeding into each other | Complex analysis workflows |

### Linked Template Groups

Templates can be organized into groups that execute in sequence:

```typescript
interface LinkedTemplateGroup {
  id: string;
  name: string;
  description: string;
  objectType: 'patent_family';
  stages: {
    order: number;
    templateId: string;
    inputType: 'per_patent' | 'chunk' | 'synthesis';
    outputFeed: 'next_stage' | 'final' | 'both';
  }[];
}
```

### Planned Templates

**1. Patent Family Prosecution Analysis** (MULTI-STAGE)
- Stage 1: Per-patent prosecution summary (grounded in File Wrapper data)
- Stage 2: Pattern identification across family
- Stage 3: Risk synthesis

**2. Family IPR Risk Assessment** (MULTI-STAGE)
- Stage 1: Per-patent IPR history (grounded in PTAB data)
- Stage 2: Vulnerability pattern analysis
- Stage 3: Mitigation recommendations

**3. Competitor Landscape in Family** (COLLECTIVE with grounding)
- Input: Enriched patent data with competitor classifications
- Analysis: Competitive positioning, blocking patents, threat levels

**4. Family Litigation History** (MULTI-STAGE)
- Stage 1: Per-patent litigation facts (grounded)
- Stage 2: Cross-patent implications (collateral estoppel, precedents)
- Stage 3: Forward-looking risk assessment

### Service Changes Needed

**`prompt-template-service.ts` enhancements:**
- Add `objectType: 'patent_family'` support
- Support linked template groups with stage ordering
- Multi-stage execution with intermediate result storage
- Context chunking for large families
- Grounding validation (compare LLM output to source data)
- Provenance tracking through stages

### Schema Changes (Potential)

```prisma
model PromptTemplate {
  // Existing fields...

  objectType        String   @default("patent")  // Add 'patent_family'

  // New fields for multi-stage
  linkedGroupId     String?
  stageOrder        Int?
  inputPattern      String?  // 'per_patent' | 'chunk' | 'synthesis'
  outputPattern     String?  // 'next_stage' | 'final' | 'both'

  linkedGroup       LinkedTemplateGroup? @relation(fields: [linkedGroupId], references: [id])
}

model LinkedTemplateGroup {
  id           String   @id @default(uuid())
  name         String
  description  String?
  objectType   String   // 'patent_family'

  stages       PromptTemplate[]

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

### Grounding Strategy

For each template that references factual data:

```typescript
interface GroundedPromptContext {
  // Facts from APIs (Phase 4 enrichment)
  grounded: {
    prosecutionHistory?: {
      patentId: string;
      officeActions: number;
      rejectionTypes: string[];
      finalDisposition: string;
      // Actual data from File Wrapper API
    }[];
    iprProceedings?: {
      patentId: string;
      proceedingId: string;
      petitioner: string;
      status: string;
      // Actual data from PTAB API
    }[];
  };

  // Analysis request (what we want LLM to do)
  analysisRequest: string;
}
```

The template system ensures grounded facts are clearly separated from analysis requests, preventing the LLM from hallucinating factual claims.

### Context Window Management

For large families (100+ patents):

1. **Chunking**: Divide patents into groups of 10-20 for per-patent analysis
2. **Summarization**: Generate chunk summaries (e.g., "15 patents analyzed, 3 have IPR history")
3. **Synthesis**: Final stage receives chunk summaries, not raw data
4. **Provenance**: Track which patents contributed to each conclusion

```
Family (127 patents)
    ↓
Chunk 1 (20 patents) → Summary 1
Chunk 2 (20 patents) → Summary 2
...
Chunk 7 (7 patents)  → Summary 7
    ↓
Synthesis Stage → Final Analysis
```

---

## Current Prompt Template System Reference

The existing prompt template system (for reference when implementing Phase 5):

**Key Files:**
- `src/api/services/prompt-template-service.ts` - Template execution
- `src/api/routes/prompt-templates.routes.ts` - REST endpoints
- `prisma/schema.prisma` - PromptTemplate model

**Current objectTypes:**
- `patent` - Single patent analysis
- `sector` - Sector-level analysis

**Current facetTypes:**
- Various per-patent facets (strength, licensing, etc.)

Phase 5 extends this to support `patent_family` with multi-stage execution.

---

## Testing Checklist

### Phase 1-4 Verification

- [ ] Navigate to `/patent-families`
- [ ] Enter 2-3 seed patent IDs (try patents known to have citations)
- [ ] Verify preview shows estimated counts
- [ ] Execute exploration with different configurations:
  - [ ] INTERSECTION vs UNION merge
  - [ ] Siblings on/off
  - [ ] Different depth settings
- [ ] Verify results table shows:
  - [ ] Relation column (parent/child/sibling/seed)
  - [ ] Portfolio indicator
  - [ ] Competitor badges
  - [ ] IPR column (after enrichment)
  - [ ] Patent ID tooltip with rich patent details popup
  - [ ] Data status icons (warning for not_found, help for not_attempted)
- [ ] Click "Enrich Data" (processes up to 200 patents)
- [ ] Verify IPR indicators appear
- [ ] Hover on patent ID and verify tooltip shows:
  - [ ] Patent title and assignee badges
  - [ ] Relation type and portfolio status badges
  - [ ] Competitor badge (if applicable)
  - [ ] IPR status section with trial details (after enrichment)
  - [ ] Prosecution status with office action counts (after enrichment)
- [ ] Select patents and create Focus Area
- [ ] Verify Focus Area is created and navigable
- [ ] Test entry from Portfolio page (bulk action)
- [ ] Test entry from Focus Area page (Quick Actions)

### Edge Cases

- [ ] No citations found for seed
- [ ] Very large family (hundreds of patents) - verify constraints limit size
- [ ] External patents (not in portfolio) - verify marked correctly
- [ ] Seeds not in database - verify graceful handling

---

## Future Considerations

### Advanced Relationship Calculations

**Current Implementation (Siblings):**
- Via parents (if ancestors > 0): Find children of seed's parents (other patents citing same prior art)
- Via children (if descendants > 0): Find other parents of seed's children (co-cited patents)
- Automatically uses available direction based on config

**Cousin Implementation (Not Yet Implemented):**
- First cousins: Children of siblings
- Second cousins: Children of first cousins (or grandchildren of seed's parents' siblings)
- Should use same bidirectional logic as siblings
- Need filters to prevent explosion (sector, CPC, competitor constraints)

**Advanced: Patent Distance Calculation:**

Instead of rigid relationship categories, calculate a "citation distance" between patents:

```typescript
interface PatentDistance {
  patentA: string;
  patentB: string;
  distance: number;           // Lower = more related
  pathTypes: string[];        // ['shared_parent', 'sibling', 'co_cited']
  sharedCitations: number;    // Patents that cite both
  sharedPriorArt: number;     // Prior art cited by both
  cpcOverlap: number;         // 0-1 similarity in CPC codes
}
```

Use cases:
- Prioritize patents with multiple relationship paths over single-link relations
- Rank family members by relevance rather than just generation depth
- Identify "bridge" patents that connect different technology areas
- Weight siblings/cousins discovered through multiple paths higher

### Application Citations

Current backward citations now include both:
- `us_patent_citations` - cited granted patents
- `us_application_citations` - cited applications (some may have granted)

Future: Option to control whether applications are included in family expansion.

### Company Abstraction Layer

Currently, competitor/affiliate matching uses pattern-based services. Future enhancement could add:

- Group assignee name variants under canonical company
- Track affiliate relationships (parent/subsidiary/foreign entities)
- Allow classification to evolve as analysis reveals new relationships
- Historical tracking of M&A events affecting classification

### Interactive Family Graph

Phase 5 focuses on LLM templates, but future work could add:
- Zoomable citation tree visualization
- Interactive exploration (click to expand)
- Visual highlighting of competitors, IPR patents, etc.

---

## Design Considerations (In Progress)

### Exploration Persistence & Naming

**Current State:**
- Explorations are transient - run, view results, optionally create Focus Area
- Citation data is cached (reused across explorations)
- No way to name/save an exploration before creating Focus Area

**Desired Workflow:**
1. Run initial exploration with seed patents
2. Name and save the exploration (e.g., "SDN Security Family")
3. Iteratively refine:
   - Add/remove filters (sectors, competitors)
   - Expand generations incrementally
   - Mark patents as interesting/excluded
   - Enrich with IPR/prosecution
4. Eventually: Create Focus Area from refined subset

**Implementation Options:**
- Save exploration to database with name, config, current member list
- Track which patents have been reviewed/marked
- Allow re-running with modified parameters
- Show history of explorations (recent, named)

### Enrichment Strategy

**Current:** 200 patents per request (max 500 via API)

**Options for larger families:**
1. **Paginated enrichment** - "Enrich current page" vs "Enrich all (N patents)"
2. **Background enrichment** - Queue all patents, show progress
3. **Selective enrichment** - Only enrich selected/checked patents
4. **Priority enrichment** - Enrich high-score patents first

**Status:** Current implementation enriches up to 200 patents in a single request.

### Selection Checkboxes Purpose

**Current:** Used for "Create Focus Area" with selected patents

**Additional uses to consider:**
1. **Mark as interesting** - Flag for follow-up
2. **Mark as excluded** - Remove from consideration
3. **Batch actions:**
   - Enrich selected only
   - Add to existing Focus Area
   - Export selected
   - Expand family from selected (new seeds)
4. **Screening workflow:**
   - Review each patent before expanding further
   - Require selection before adding next generation
   - Filter to show only selected/unselected

### Grid Columns & Customization

**Current columns:** Patent ID, Title, Assignee, Relation, Portfolio, Competitor, IPR, Years Left, Score

**Additional columns needed:**
- Super-sector
- Sector
- Prosecution status
- Filing date
- CPC codes (abbreviated)
- Data status (portfolio/cached/not_found)

**Implementation:**
- Follow Patent Summary pattern with column selector
- Persist column preferences per user
- Default to compact view, expand as needed

### Constraint Filters

**Current:** Competitors, Affiliates, Portfolio requirement, Filing year

**Additional filters needed:**
- Super-sector (dropdown)
- Sector (dropdown, filtered by super-sector)
- CPC prefix
- Score range (min/max)
- Years remaining range
- Has IPR (yes/no/any)
- Has prosecution (yes/no/any)
- Data status (portfolio/external/unknown)

### Patent Tooltip Enhancement (Implemented)

Rich tooltip on patent ID showing:
- Title, assignee badges (relation type, portfolio status, competitor)
- Data retrieval status
- IPR summary with trial table (trial #, status, petitioner)
- Prosecution summary (status, office action count, rejection count)
- Click-through to patent detail page

**Pattern:** Similar to V2/V3 scoring page tooltips but adapted for family context.

### Incremental Generation Expansion

**Concept:** Rather than setting ancestors=2, descendants=2 upfront:
1. Start with 1 generation each direction
2. Review results, apply filters, select interesting patents
3. Click "Expand +1 generation" to add next level
4. Repeat until family is complete

**Benefits:**
- Prevents explosion (filter as you go)
- Surfaces interesting patents early
- Allows marking patents before expansion
- Natural workflow for discovery

---

*See also: [PATENT_FAMILIES_DESIGN.md](./PATENT_FAMILIES_DESIGN.md) for conceptual design and terminology.*
