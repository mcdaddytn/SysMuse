# Prompt Template & LLM Workflow System Design

## Overview

This document describes the architecture for a generic, reusable LLM prompt template system that integrates with the facet calculation engine to support structured data extraction, multi-stage workflows, and tournament-style patent ranking. The system is designed to be object-agnostic — templates bind to input object types (patents, focus areas, products, etc.) and produce typed, named output values that feed into downstream calculations and decisions.

---

## Core Concepts

### Prompt Template

A reusable definition of what to ask an LLM. Templates come in two forms:

1. **Free-form** — A single prompt with placeholders that produces a text response. Useful for summaries, analysis narratives, and open-ended questions.

2. **Structured** — A set of individually-editable questions, each with a named output field and typed answer format. The system auto-assembles these into an LLM prompt that instructs the model to return a JSON object with typed fields. This is the workhorse pattern for extracting facet values.

### Object Type Binding

Each template declares an **object type** that provides its placeholder values:

| Object Type | Available Placeholders | Example Use |
|-------------|----------------------|-------------|
| `patent` | `{patent.patent_id}`, `{patent.patent_title}`, `{patent.abstract}`, `{patent.cpc_codes}`, etc. | Per-patent analysis questions |
| `focus_area` | `{focusArea.name}`, `{focusArea.description}`, `{focusArea.patentIDs}`, `{focusArea.patentData}`, `{focusArea.patentCount}` | Collective analysis across patent groups |
| `product` (future) | `{product.name}`, `{product.company}`, `{product.description}`, etc. | Product-patent mapping |
| `company` (future) | `{company.name}`, `{company.industry}`, etc. | Competitor analysis |

Templates are stored independently in a library and can be referenced contextually from any part of the system (focus areas, patent detail, sector rankings, etc.).

### Structured Questions

Each question in a structured template defines:

| Property | Description | Example |
|----------|-------------|---------|
| `fieldName` | Output field name (becomes a column/facet key) | `eligibility_score` |
| `question` | The question text, may include placeholders | `Rate patent eligibility strength under 35 USC 101` |
| `answerType` | Expected data type | `INTEGER`, `FLOAT`, `BOOLEAN`, `TEXT`, `ENUM` |
| `constraints` | Type-specific constraints | `{ min: 1, max: 5 }` or `{ maxSentences: 3 }` or `{ options: ["a","b","c"] }` |
| `description` | Optional guidance for the LLM | `Higher = better for patent holder` |

**Example: V3 analysis as a structured template:**

```json
{
  "name": "V3 Patent Analysis",
  "objectType": "patent",
  "templateType": "STRUCTURED",
  "questions": [
    {
      "fieldName": "summary",
      "question": "Provide a high-level summary for a non-technical audience",
      "answerType": "TEXT",
      "constraints": { "maxSentences": 3 }
    },
    {
      "fieldName": "eligibility_score",
      "question": "Rate patent eligibility strength under 35 USC 101",
      "answerType": "INTEGER",
      "constraints": { "min": 1, "max": 5 },
      "description": "5=Very Strong, 4=Strong, 3=Moderate, 2=Weak, 1=Very Weak"
    },
    {
      "fieldName": "technology_category",
      "question": "What is the primary technology category?",
      "answerType": "ENUM",
      "constraints": {
        "options": ["video streaming", "cloud computing", "mobile devices", "cybersecurity", "AI/ML", "IoT", "networking", "rf/wireless", "semiconductor"]
      }
    },
    {
      "fieldName": "likely_implementers",
      "question": "What types of companies are likely using this technology?",
      "answerType": "TEXT_ARRAY",
      "constraints": { "maxItems": 5 }
    }
  ]
}
```

### Prompt Assembly

For structured templates, the system auto-generates the LLM prompt:

1. **System message**: Generic instruction to return valid JSON
2. **User message**: Combines all questions with format instructions, substitutes placeholders from the bound object, appends JSON schema for the expected response

This means the user never has to hand-write JSON formatting instructions — they edit individual questions and the system handles serialization/deserialization.

For free-form templates, the user writes the full prompt text with placeholders and receives the raw response.

---

## Execution Contexts

Templates execute in a **context** that determines iteration and result storage:

### Per-Object Execution
Run the template once for each object in a set. Results attach to individual objects.

- **Focus area → per patent**: Run a patent-bound template for each patent in the focus area. Results stored per `(focusAreaId, templateId, patentId)`.
- **Sector → per patent**: Run for each patent in a sector.
- **Portfolio → per patent**: Run for top-N patents by some criteria.

### Collective Execution
Run the template once for the entire group. Results attach to the group.

- **Focus area collective**: Run a focus-area-bound template once with all patent data aggregated. Result stored per `(focusAreaId, templateId)`.

### Batched Execution
Multiple objects processed in a single LLM call to optimize context usage:

- Combine N patent records into one chat (as the V3 analyzer does with batch size 5)
- System determines optimal batch size based on context limits and data size
- Each batch still produces per-object results

---

## Multi-Stage Workflows

### Stage Dependencies

Prompt templates can declare dependencies on other templates' outputs. The system resolves the dependency graph and executes in order.

```
Template A (per patent: extract features)
    ↓ outputs: feature_score, relevance_rating
Template B (collective: summarize top patents)
    ↓ requires: Template A results + facet-derived ranking
Template C (per patent: deep-dive on finalists)
    ↓ requires: Template B selection
```

### Tournament Ranking

A tournament is a multi-round workflow where each round narrows a pool using LLM-derived scores and facet calculations.

**Configuration per round:**

| Parameter | Description | Example |
|-----------|-------------|---------|
| `poolSize` | Number of objects entering this round | 100, 40, 16 |
| `batchSize` | Objects per LLM chat | 25, 20, 16 |
| `templateId` | Which prompt template to use | Different questions per round |
| `rankingFormula` | Facet calc to rank results | `0.4 * novelty + 0.3 * breadth + 0.3 * market_fit` |
| `advanceCount` | How many advance from each batch | 10, 8, all |
| `advanceMode` | Selection strategy | `TOP_N_PER_BATCH`, `TOP_N_GLOBAL`, `THRESHOLD` |

**Example: Patent Relevance Tournament**

```
Round 1: 100 patents → 4 batches of 25 → ask "rate relevance 1-5"
  → Facet calc: weighted_score = 0.5 * relevance + 0.3 * breadth + 0.2 * novelty
  → Take top 10 from each batch → 40 advance

Round 2: 40 patents → 2 batches of 20 → ask deeper questions
  → Facet calc: refined_score = 0.4 * deep_relevance + 0.3 * enforcement + 0.3 * market
  → Take top 8 from each batch → 16 advance

Round 3: 16 patents → 1 batch of 16 → comprehensive comparison
  → Final ranking with full context
  → All 16 ranked
```

**Cross-Round Normalization:**
- Round 3 finalists get highest confidence scores
- Round 2 results normalized against Round 3 overlap
- Round 1 results normalized against Round 2 overlap
- Full pool receives extrapolated rankings

### Optimized Summary

A two-stage pattern for summarizing large sets:

1. **Stage 1**: Per-patent summaries (can run in parallel)
2. **Stage 2**: Group summaries that fit as many Stage 1 results into one context window as possible, producing meta-summaries

---

## Facet Engine Integration

### Data Flow

```
Input Objects (patents, focus areas, etc.)
    ↓
Prompt Template (structured questions)
    ↓ LLM execution
Raw LLM Results (typed JSON fields)
    ↓ stored as facet values
Facet Values (ATOMIC type, source: "llm")
    ↓ referenced by formulas
Derived Facets (DERIVED type, weighted averages, etc.)
    ↓
Scoring / Ranking / Decision Gates
    ↓ triggers next stage
Downstream Templates (tournament rounds, deep-dives)
```

### Facet Value Storage

LLM-produced typed values map directly to FacetValue records:

| Structured Question Field | FacetValue Column |
|--------------------------|-------------------|
| `INTEGER` (1-5 scale) | `numericValue` |
| `FLOAT` | `numericValue` |
| `BOOLEAN` | `booleanValue` |
| `TEXT` | `textValue` |
| `ENUM` | `textValue` |
| `TEXT_ARRAY` | `textValue` (JSON-encoded) |

The `FacetDefinition` for each question is auto-created when a structured template is first executed, establishing the facet schema that downstream calculations reference.

### Derived Calculations

The existing scoring engine pattern generalizes to any facet calculation:

```typescript
// Current V3 scoring (specific)
score = Σ(normalized_metric × weight) × year_multiplier × 100

// Generic facet formula (same pattern, configurable)
derived_value = Σ(normalize(input_facet) × weight)
```

Formula types supported:
- **Weighted average**: `0.4 * facet_a + 0.3 * facet_b + 0.3 * facet_c`
- **Multiplicative**: `facet_a * facet_b * factor`
- **Conditional**: `IF(facet_a > 3, facet_b * 1.5, facet_b * 0.5)`
- **Normalization**: MinMax, Z-Score, Percentile (per scope: focus area, sector, portfolio)

### Decision Gates

Derived facet values can trigger downstream actions:

- **Threshold gate**: If `relevance_score > 3`, include in next stage
- **Top-N gate**: Take top 10 by `composite_score` for deep-dive
- **Filter gate**: Only patents where `technology_category = "cloud computing"`

These gates connect template stages in tournament and multi-stage workflows.

---

## Dependency System

### Placeholder Prerequisites

Templates can reference placeholders from other templates' outputs:

```
Template: "Analyze product against patent portfolio"
Placeholders:
  {product.name}           ← from product record
  {product.company}        ← from product record
  {company.summary}        ← from ANOTHER template's output on the company
  {focusArea.topPatents}   ← from a tournament ranking
```

If `{company.summary}` hasn't been computed, the system:
1. Identifies the template that produces `company.summary`
2. Checks if prerequisites for THAT template are met
3. Executes the dependency chain in order
4. Then executes the original template

### Foreign Key Relationships

Object relationships enable cross-object placeholder resolution:

```
Product → belongs to → Company
  → Product template can reference {company.summary}
  → System resolves the company record, checks for summary facet
  → Runs company summary template if missing

Patent → belongs to → Focus Area (many-to-many)
  → Patent template can reference {focusArea.name}
  → Focus Area template can reference all patent data
```

---

## Data Source Abstraction

The facet engine and prompt template system should work with data from multiple storage backends:

| Storage | Use Case | Access Pattern |
|---------|----------|---------------|
| **PostgreSQL** (Prisma) | Focus areas, search terms, facet definitions, facet values | Structured queries |
| **JSON files** (cache/) | Patent data, LLM results, API responses | File-per-record pattern |
| **Computed** | Derived facets, normalized scores | Formula evaluation at query time |

The key abstraction is a **DataProvider** interface that resolves placeholder values from whatever storage holds them:

```typescript
interface DataProvider {
  objectType: string;
  getFields(): FieldDefinition[];
  getRecord(id: string): Record<string, unknown>;
  getRecords(ids: string[]): Record<string, unknown>[];
}
```

Current implementations:
- `PatentDataProvider`: Loads from streaming-candidates + cache/llm-scores
- `FocusAreaDataProvider`: Loads from Prisma + aggregates patent data

Future implementations:
- `ProductDataProvider`: Loads product records
- `CompanyDataProvider`: Loads company records

---

## UI Architecture

### Prompt Template Library (standalone page)

Accessible from left navigation. Provides:

- **List view**: All templates, filterable by object type and template type
- **Template editor**:
  - Name, description, object type selector
  - Template type toggle (Free-form / Structured)
  - **Free-form mode**: Full prompt text editor with placeholder insertion
  - **Structured mode**: Question list editor
    - Add/remove/reorder questions
    - Per-question: field name, question text (with placeholder insertion), answer type, constraints
    - Live preview of assembled prompt
  - Model selector, context field selector
- **Test/Preview**: Resolve template against a sample object without calling LLM

### Contextual Usage (Focus Area, Patent Detail, etc.)

When a feature needs LLM analysis:

1. **Select template**: Pick from library (filtered to matching object type)
2. **Or create new**: Opens template editor inline or navigates to library
3. **Configure execution**: Per-patent vs. collective, batch size
4. **Execute**: Runs template, shows progress
5. **View results**: Structured results shown as typed columns; free-form shown as text

### V3 Analysis Retrofit

The existing V3 LLM analysis (26 questions across 6 categories) can be represented as a structured template:

- Object type: `patent`
- 26 structured questions with types matching the current V3 schema
- Same output fields that currently populate `cache/llm-scores/`
- Scoring profiles reference these fields as facet inputs

This means the V3 prompt becomes editable — users can add questions, modify types, or create variants without code changes.

---

## Implementation Phases

### Phase 1: Structured Questions (Current Sprint)

**Goal**: Upgrade PromptTemplate to support structured questions with typed answers.

Schema changes:
- Add `templateType` (FREE_FORM / STRUCTURED) to PromptTemplate
- Add `objectType` field (default: "patent")
- Add `questions` JSON field for structured question definitions
- Make `focusAreaId` optional (templates can exist independently)

Backend changes:
- Auto-format structured questions into LLM prompts
- Parse typed JSON responses back into named fields
- Store results with typed field metadata

Frontend changes:
- Add Prompt Templates page to left nav
- Template library with CRUD
- Structured question editor (add/edit/remove questions with types)
- Focus area LLM tab references templates from library

### Phase 2: Facet Integration

**Goal**: Connect structured template outputs to the facet engine.

- Auto-create FacetDefinition records from structured template questions
- Store LLM results as FacetValue records
- Implement derived facet calculations (weighted average, multiplicative)
- Display facet values as columns in patent grids

### Phase 3: Multi-Stage Workflows

**Goal**: Enable template chaining with dependency resolution.

- Template dependency declaration (prerequisite templates)
- Execution orchestrator that resolves dependency graphs
- Placeholder resolution from upstream template outputs
- Decision gates (threshold, top-N, filter)

### Phase 4: Tournament Ranking

**Goal**: Multi-round LLM comparison workflows.

- Tournament configuration (rounds, batch sizes, advance rules)
- Cross-round normalization
- Automatic pool management per round
- Full-pool ranking extrapolation

### Phase 5: Generic Object Types

**Goal**: Extend beyond patents and focus areas.

- Product and company data providers
- Cross-object placeholder resolution (foreign key traversal)
- Web search result integration
- Custom object type registration

---

## Relationship to Existing Systems

### Current V3 Analysis Pipeline

```
scripts/run-llm-top-patents.ts
  → services/llm-patent-analysis-v3.ts (hardcoded prompt, Zod schema)
  → cache/llm-scores/{patent_id}.json
  → scoring-service.ts (6 profiles, weighted averages)
  → Frontend grid columns
```

### Target Architecture

```
Prompt Template Library (editable, versioned)
  → prompt-template-service.ts (generic execution engine)
  → Facet Values (typed, per object)
  → Facet Engine (derived calculations, formulas)
  → Scoring / Ranking (configurable profiles)
  → Frontend grid columns (dynamic from facet schema)
  → Tournament / Workflow orchestrator (multi-stage)
```

The V3 analysis becomes a pre-configured template that users can clone and modify. Scoring profiles reference facet definitions rather than hardcoded field names. New question types can be added without code changes.

---

*Document Version: 1.0*
*Created: 2026-01-28*
