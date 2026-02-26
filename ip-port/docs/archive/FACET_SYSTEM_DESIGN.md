# Facet System Design

## Overview

This document defines the facet-based categorization and scoring system for the patent portfolio workstation. The key insight is that **scoring is really just facet calculation** - facet values can be derived from API data, LLM responses, or user input, and then feed into further calculations.

---

## Terminology

### Core Terms

| Term | Definition | Example |
|------|------------|---------|
| **Affiliate** | Normalized entity name for assignee variations | "VMware" for VMware LLC, VMware Inc., Pivotal, Carbon Black |
| **Assignee** | Raw USPTO assignee name (variations exist) | "VMware LLC", "VMware, Inc." |
| **Super-Sector** | Top-level technology domain (mutually exclusive) | "Network Technology", "Computing", "Wireless" |
| **Primary Sector** | Actionable breakout within super-sector (mutually exclusive) | "network-security-core", "network-switching" |
| **Focus Area** | User-definable technology interest (non-exclusive, multi-assign) | "Zero Trust", "5G NR", "Container Security" |
| **Facet** | Any computable or assignable attribute on a patent | citation_count, eligibility_score, focus_areas[] |

### Hierarchy

```
Super-Sector (mutually exclusive, collectively exhaustive)
    └── Primary Sector (mutually exclusive within super-sector)
            └── Focus Areas (user-definable, non-exclusive, multi-assign)
```

### Why "Focus Area" (not Sector)

The term "sector" implies industry verticals or mutually exclusive categories. Beyond the hierarchical Super-Sector/Primary Sector structure, additional categorizations are:

- **User-definable** - created ad-hoc based on analysis needs
- **Non-exclusive** - a patent can belong to multiple
- **Interest-driven** - represents areas of strategic focus
- **Dynamic** - can be created from search term extraction

"Focus Area" better captures this concept. Alternative terms considered:
- "Interest Area" - good but slightly passive
- "Tech Tag" - too informal
- "Topic" - too generic
- "Theme" - implies narrative rather than technology

---

## Facet Types

### 1. Core Data Facets (from USPTO APIs)

| Facet | Type | Source | Example |
|-------|------|--------|---------|
| `patent_id` | string | PatentsView | "US10123456" |
| `grant_date` | date | PatentsView | "2023-05-15" |
| `expiration_date` | date | Calculated | "2040-05-15" |
| `years_remaining` | float | Calculated | 14.3 |
| `assignee` | string | PatentsView | "VMware LLC" |
| `affiliate` | string | Mapping | "VMware" |
| `forward_citations` | int | PatentsView | 142 |
| `competitor_citations` | int | Calculated | 23 |
| `cpc_codes` | string[] | PatentsView | ["H04L63/08", "G06F21/31"] |

### 2. Classification Facets (mutually exclusive hierarchies)

| Facet | Type | Cardinality | Source |
|-------|------|-------------|--------|
| `super_sector` | string | 1 | CPC mapping / LLM |
| `primary_sector` | string | 1 | CPC mapping / LLM |
| `focus_areas` | string[] | 0..n | User / Search terms / LLM |

### 3. Attorney Question Facets (from spreadsheet)

These are the 5 original attorney questions:

| Facet | Type | Question |
|-------|------|----------|
| `atty_summary` | text | High-level summary for non-technical audience |
| `atty_prior_art_problem` | text | What problem in prior art does this solve? |
| `atty_technical_solution` | text | How does the technical solution work? |
| `atty_eligibility_score` | 1-5 | Patent eligibility strength (101) |
| `atty_validity_score` | 1-5 | Strength against prior art invalidity |

### 4. General LLM Facets (for all analyzed patents)

These are asked of all patents that bubble up for analysis:

| Facet | Type | Description |
|-------|------|-------------|
| `claim_breadth` | 1-5 | Scope of patent claims |
| `enforcement_clarity` | 1-5 | How easily infringement can be detected |
| `design_around_difficulty` | 1-5 | How hard to avoid infringing |
| `market_relevance` | 1-5 | Current market applicability |
| `llm_confidence` | 1-5 | LLM's confidence in analysis |
| `implementation_type` | enum | hardware / software / method / system |
| `claim_type_primary` | enum | apparatus / method / system / CRM |

### 5. Focus Area-Specific LLM Facets

Each Focus Area can define custom questions that produce new facets. These columns appear when viewing that Focus Area.

**Example: "Zero Trust" Focus Area:**

| Facet | Type | Question |
|-------|------|----------|
| `zt_architecture_layer` | enum | Which layer? (identity / network / endpoint / data) |
| `zt_enforcement_point` | enum | Where enforced? (gateway / agent / inline) |
| `zt_standard_alignment` | text | Related NIST/CISA guidelines |

**Example: "Video Codec" Focus Area:**

| Facet | Type | Question |
|-------|------|----------|
| `vc_codec_type` | enum | H.264 / H.265 / AV1 / VP9 / other |
| `vc_standard_essential` | bool | Potentially standard-essential? |
| `vc_royalty_basis` | text | Typical royalty calculation method |

### 6. Scoring Facets (calculated from other facets)

| Facet | Type | Formula |
|-------|------|---------|
| `v2_score` | float | Weighted sum of citations, years, competitor_cites |
| `v3_score` | float | Weighted sum including LLM quality scores |
| `consensus_score` | float | Average of user-weighted scores |
| `sector_rank` | int | Rank within primary_sector |
| `focus_area_rank` | int | Rank within selected focus_area |

---

## Facet Schema (Database)

```prisma
// User-defined Focus Areas
model FocusArea {
  id              String   @id @default(cuid())
  name            String   @unique
  displayName     String   @map("display_name")
  description     String?

  // Parent sector (optional - can be cross-sector)
  superSector     String?  @map("super_sector")
  primarySector   String?  @map("primary_sector")

  // Source
  createdBy       String   @map("created_by")  // user_id or "system"
  createdFrom     String?  @map("created_from") // "search_term" | "manual" | "llm"
  searchTerms     String[] @map("search_terms") // If created from search

  // LLM questions for this focus area
  customQuestions Json?    @map("custom_questions") // [{key, question, type, options?}]

  // Status
  isActive        Boolean  @default(true)
  patentCount     Int      @default(0) @map("patent_count")

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  // Relations
  patents         PatentFocusArea[]

  @@map("focus_areas")
}

// Patent-FocusArea join with facet values
model PatentFocusArea {
  id              String   @id @default(cuid())

  patentId        String   @map("patent_id")
  focusAreaId     String   @map("focus_area_id")
  focusArea       FocusArea @relation(fields: [focusAreaId], references: [id])

  // Relevance
  relevanceScore  Float?   @map("relevance_score") // 0-1 match strength
  assignedBy      String   @map("assigned_by") // "search" | "llm" | "manual"

  // Focus-area-specific facet values (from custom LLM questions)
  customFacets    Json?    @map("custom_facets") // {key: value, ...}

  createdAt       DateTime @default(now())

  @@unique([patentId, focusAreaId])
  @@map("patent_focus_areas")
}

// Generic facet value storage for extensibility
model PatentFacet {
  id              String   @id @default(cuid())

  patentId        String   @map("patent_id")
  facetKey        String   @map("facet_key")    // e.g., "zt_architecture_layer"
  facetValue      String   @map("facet_value")  // Stored as string, parsed by type
  facetType       String   @map("facet_type")   // "string" | "int" | "float" | "bool" | "enum"

  // Source tracking
  source          String   // "api" | "llm" | "user" | "calculated"
  sourceDetail    String?  @map("source_detail") // Model name, user id, formula
  confidence      Float?   // For LLM-derived values

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([patentId, facetKey])
  @@index([facetKey])
  @@map("patent_facets")
}
```

---

## Column Visibility by Context

### Default Portfolio Grid

| Column | Default | Description |
|--------|---------|-------------|
| Patent ID | visible | Link to detail |
| Title | visible | Patent title |
| Grant Date | visible | Date granted |
| Expiration | hidden | Expiration date |
| Years Remaining | visible | Years until expiry |
| **Affiliate** | **visible** | Normalized entity name |
| Assignee | hidden | Raw USPTO assignee |
| **Super-Sector** | **visible** | Top-level category |
| Primary Sector | hidden | Detailed sector |
| Forward Citations | visible | Total citations |
| Competitor Cites | visible | Citations from competitors |
| v2 Score | visible | Simple weighted score |

### When Focus Area(s) Selected

Additional columns become available:

| Condition | Additional Columns |
|-----------|-------------------|
| Single Focus Area | Focus Area-specific LLM facets |
| Multiple Focus Areas | Intersection of shared facets + relevance scores |
| Any Focus Area | `relevance_score` for each |

### Patent Detail View Columns

| Tab | Columns/Fields |
|-----|----------------|
| Overview | All core facets |
| Attorney Questions | 5 attorney question responses |
| LLM Analysis | All general LLM facets |
| Focus Areas | List of assigned areas with custom facets |
| Scoring | v2, v3, consensus breakdown |

---

## Scoring as Facet Calculation

### V2 Score Formula

```typescript
const v2_score = (
  (facets.forward_citations / maxCitations) * weights.citation +
  (facets.years_remaining / 20) * weights.years +
  (facets.competitor_citations / maxCompetitor) * weights.competitor
) * 100;
```

### V3 Score Formula

```typescript
const v3_score = (
  // Quantitative facets (50%)
  (facets.forward_citations / maxCitations) * 0.15 +
  (facets.competitor_citations / maxCompetitor) * 0.20 +
  (facets.years_remaining / 20) * 0.15 +

  // LLM quality facets (35%)
  (facets.eligibility_score / 5) * 0.10 +
  (facets.validity_score / 5) * 0.10 +
  (facets.enforcement_clarity / 5) * 0.08 +
  (facets.design_around_difficulty / 5) * 0.07 +

  // Market facets (15%)
  (facets.market_relevance / 5) * 0.15
) * 100;
```

### Focus Area Score

When viewing a specific Focus Area, scoring can incorporate focus-area-specific facets:

```typescript
const focusAreaScore = (
  v3_score * 0.70 +
  relevance_score * 0.20 +
  focusAreaCustomScore * 0.10  // From custom facets
);
```

---

## Focus Area Creation Workflow

### From Search Term Extraction

1. User selects patents or searches
2. System extracts key terms
3. User creates Focus Area from terms
4. System matches additional patents by terms
5. (Optional) LLM defines custom questions for the area

### Manual Creation

1. User defines Focus Area name and description
2. Optionally links to super/primary sector
3. Defines custom LLM questions (if any)
4. Manually assigns patents or uses filters

### From LLM Analysis

1. LLM identifies technology cluster
2. System suggests Focus Area creation
3. User approves and customizes
4. System auto-populates patent assignments

---

## API Endpoints

### Focus Areas

```
GET    /api/focus-areas                    - List all focus areas
POST   /api/focus-areas                    - Create focus area
GET    /api/focus-areas/:id                - Get focus area details
PUT    /api/focus-areas/:id                - Update focus area
DELETE /api/focus-areas/:id                - Delete focus area
GET    /api/focus-areas/:id/patents        - Patents in focus area
POST   /api/focus-areas/:id/patents        - Add patents to focus area
DELETE /api/focus-areas/:id/patents/:pid   - Remove patent
```

### Facets

```
GET    /api/patents/:id/facets             - All facets for patent
PUT    /api/patents/:id/facets/:key        - Update facet value
GET    /api/facets/schema                  - Available facet definitions
POST   /api/facets/calculate               - Trigger facet calculation
```

### Dynamic Columns

```
GET    /api/columns/available              - All available columns
GET    /api/columns/default                - Default column set
GET    /api/columns/focus-area/:id         - Columns for focus area
POST   /api/columns/user-preference        - Save user column prefs
```

---

## Implementation Priority

### Phase 1: Core Terminology (Immediate)

1. Update Portfolio Grid to show Affiliate by default
2. Add Super-Sector column
3. Hide Assignee by default (still available)
4. Update existing sector → primary_sector terminology

### Phase 2: Attorney + LLM Facets

1. Add attorney question columns (hidden by default)
2. Add general LLM facet columns
3. Connect to existing LLM analysis data
4. Column selector groups facets by category

### Phase 3: Focus Areas

1. Create FocusArea schema
2. Build Focus Area management UI
3. Implement patent assignment (manual + search)
4. Focus Area filter in grid

### Phase 4: Custom Facets

1. Custom LLM question definition per Focus Area
2. PatentFacet storage for extensibility
3. Dynamic column generation
4. Focus Area-specific scoring

---

## Open Questions

1. **Should Focus Areas inherit from sectors?**
   - Option A: Independent (cross-sector possible)
   - Option B: Always within a sector (simpler)
   - **Recommendation**: Allow both - optional sector linkage

2. **How to handle facet conflicts?**
   - Same facet from different sources (API vs LLM)
   - **Recommendation**: Track source, use latest with confidence weighting

3. **Focus Area visibility/sharing?**
   - Per-user vs shared
   - **Recommendation**: Creator-owned by default, can share with team

---

*Document Version: 1.0*
*Created: 2026-01-24*
