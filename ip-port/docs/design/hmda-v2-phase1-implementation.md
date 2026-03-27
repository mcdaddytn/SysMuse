# HMDA v2 — Phase 1 Implementation Plan
# Registry Seeding, Analysis Services, and Early Enhancements

## Table of Contents

1. Registry Schema & Migration
2. Registry Seed Data — Complete Inventory
3. Taxonomy Analysis Service (non-breaking)
4. Data Introspection Service (Claude Code skill foundation)
5. Early Versioning Groundwork
6. Materialized View — Patent Summary (first performance win)
7. Implementation Sequence & Dependencies

---

## 1. Registry Schema & Migration

### 1.1 Prisma Schema Addition

This is purely additive — no existing tables are modified. We add one new model
and its supporting enums to `schema.prisma`.

```prisma
// =============================================================================
// ATTRIBUTE REGISTRY (HMDA v2)
// Maps every queryable, displayable, or scorable field to its physical location.
// Describes current schema pragmatically — the "map" of all data in the system.
// =============================================================================

model AttributeDefinition {
  id              String   @id @default(cuid())

  // Identity — the canonical name used across the system
  name            String   @unique        
  displayName     String   @map("display_name")
  description     String?
  
  // Classification
  category        AttrCategory
  dataType        AttrDataType @map("data_type")
  entityType      String   @default("patent") @map("entity_type")
  
  // ── Physical Storage Location ──
  storageType     AttrStorageType @map("storage_type")
  
  // Postgres details
  pgTable         String?  @map("pg_table")
  pgColumn        String?  @map("pg_column")
  pgJoinClause    String?  @map("pg_join_clause")    // e.g. "LEFT JOIN patent_citation_analyses pca ON p.patent_id = pca.patent_id"
  pgJoinAlias     String?  @map("pg_join_alias")     // e.g. "pca"
  pgEavFieldName  String?  @map("pg_eav_field_name") // For EAV: the field_name value in patent_scores
  pgEavValueCol   String?  @map("pg_eav_value_col")  // "rating", "float_value", "text_value", "reasoning"
  
  // File-based storage
  filePathTemplate String? @map("file_path_template") // "cache/llm-scores/{{patent_id}}.json"
  fileSelector    String?  @map("file_selector")      // JSONPath: "$.eligibility_score" or XPath
  fileFormat      String?  @map("file_format")        // "json", "xml"
  
  // Elasticsearch
  esIndex         String?  @map("es_index")
  esField         String?  @map("es_field")
  
  // Virtual / Computed
  formula         String?                              // SQL expression
  dependsOn       String[] @default([]) @map("depends_on")
  
  // ── Query Capabilities ──
  isFilterable    Boolean  @default(false) @map("is_filterable")
  isSortable      Boolean  @default(false) @map("is_sortable")
  isAggregatable  Boolean  @default(false) @map("is_aggregatable")
  isDisplayable   Boolean  @default(true)  @map("is_displayable")
  
  // ── Value Constraints ──
  enumValues      String[] @default([]) @map("enum_values")
  rangeMin        Float?   @map("range_min")
  rangeMax        Float?   @map("range_max")
  
  // ── UI Presentation ──
  uiGroup         String?  @map("ui_group")
  uiOrder         Int      @default(0) @map("ui_order")
  formatHint      String?  @map("format_hint")        // "percent", "date", "integer", "score_1_5"
  
  // ── Provenance ──
  sourceSystem    String?  @map("source_system")       // "patentsview", "llm", "uspto_xml", "calculated", "user"
  templateFieldName String? @map("template_field_name") // Links to scoring template question fieldName
  
  // ── Lifecycle ──
  version         Int      @default(1)
  isActive        Boolean  @default(true) @map("is_active")
  
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@map("attribute_definitions")
  @@index([category])
  @@index([entityType])
  @@index([storageType])
  @@index([isActive])
  @@index([uiGroup])
}

enum AttrCategory {
  CORE            // Patent core fields: title, assignee, grant_date
  ENRICHMENT      // Data from external APIs: citations, prosecution
  LLM_METRIC      // Numeric scores from LLM structured questions
  LLM_TEXT        // Text/reasoning from LLM structured questions
  LLM_CLASS       // Categorical classifications from LLM
  COMPUTED        // Derived from other attributes via formula
  TAXONOMY        // Classification: super_sector, sector, sub_sector
  LONG_TEXT       // Full claims, description, prosecution docs (on-demand only)
  SYSTEM          // Internal: enrichment flags, timestamps, IDs
}

enum AttrDataType {
  INT
  FLOAT
  TEXT
  LONG_TEXT
  DATE
  BOOLEAN
  ENUM
  JSON
  TEXT_ARRAY      // String[] like inventors, competitorNames
}

enum AttrStorageType {
  POSTGRES
  POSTGRES_EAV    // PatentScore EAV pattern
  JSON_CACHE
  XML_BULK
  ELASTICSEARCH
  VIRTUAL         // Computed, no physical storage
}
```

### 1.2 Migration Script

```bash
# Generate and run migration
npx prisma migrate dev --name add_attribute_registry
```

This creates the `attribute_definitions` table. No other tables are touched.

---

## 2. Registry Seed Data — Complete Inventory

Below is the full seed organized by category. This captures every field currently
used across Patent Summary, V2 Scoring, Aggregates, and Patent Detail pages, plus
the file-based data that the detail page or LLM context needs on-demand.

### 2.1 CORE — Patent Table Direct Columns

These are the fast-path fields. They live directly on the `patents` table and
need no joins or pivots.

```typescript
// seed/registry-seed.ts

import { AttrCategory, AttrDataType, AttrStorageType, Prisma } from '@prisma/client';

type AttrSeed = Omit<Prisma.AttributeDefinitionCreateInput, 'id' | 'createdAt' | 'updatedAt'>;

const CORE_ATTRS: AttrSeed[] = [
  {
    name: 'patent_id',
    displayName: 'Patent ID',
    description: 'USPTO patent number (e.g., "10002051")',
    category: 'CORE',
    dataType: 'TEXT',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'patent_id',
    isFilterable: true,
    isSortable: true,
    uiGroup: 'identity',
    uiOrder: 1,
    sourceSystem: 'patentsview',
  },
  {
    name: 'patent_id_numeric',
    displayName: 'Patent Number (Numeric)',
    description: 'Numeric portion of patent ID for sorting',
    category: 'CORE',
    dataType: 'INT',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'patent_id_numeric',
    isFilterable: true,
    isSortable: true,
    isDisplayable: false, // Internal use for sorting
    uiGroup: 'identity',
    sourceSystem: 'calculated',
  },
  {
    name: 'title',
    displayName: 'Title',
    description: 'Patent title',
    category: 'CORE',
    dataType: 'TEXT',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'title',
    isFilterable: true,  // search/contains
    isSortable: true,
    uiGroup: 'identity',
    uiOrder: 2,
    sourceSystem: 'patentsview',
  },
  {
    name: 'abstract',
    displayName: 'Abstract',
    description: 'Patent abstract (stored in DB, searchable)',
    category: 'CORE',
    dataType: 'TEXT',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'abstract',
    isFilterable: true,  // full-text search
    isSortable: false,
    uiGroup: 'identity',
    uiOrder: 3,
    sourceSystem: 'patentsview',
  },
  {
    name: 'grant_date',
    displayName: 'Grant Date',
    description: 'Date patent was granted',
    category: 'CORE',
    dataType: 'DATE',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'grant_date',
    isFilterable: true,
    isSortable: true,
    uiGroup: 'dates',
    uiOrder: 10,
    formatHint: 'date',
    sourceSystem: 'patentsview',
  },
  {
    name: 'filing_date',
    displayName: 'Filing Date',
    description: 'Date patent application was filed',
    category: 'CORE',
    dataType: 'DATE',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'filing_date',
    isFilterable: true,
    isSortable: true,
    uiGroup: 'dates',
    uiOrder: 11,
    formatHint: 'date',
    sourceSystem: 'patentsview',
  },
  {
    name: 'assignee',
    displayName: 'Assignee',
    description: 'Current patent assignee/owner',
    category: 'CORE',
    dataType: 'TEXT',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'assignee',
    isFilterable: true,
    isSortable: true,
    uiGroup: 'ownership',
    uiOrder: 4,
    sourceSystem: 'patentsview',
  },
  {
    name: 'inventors',
    displayName: 'Inventors',
    description: 'List of inventors',
    category: 'CORE',
    dataType: 'TEXT_ARRAY',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'inventors',
    isFilterable: false,
    isSortable: false,
    uiGroup: 'ownership',
    uiOrder: 5,
    sourceSystem: 'patentsview',
  },
  {
    name: 'affiliate',
    displayName: 'Affiliate',
    description: 'Matched affiliate name (denormalized)',
    category: 'CORE',
    dataType: 'TEXT',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'affiliate',
    isFilterable: true,
    isSortable: true,
    uiGroup: 'ownership',
    uiOrder: 6,
    sourceSystem: 'calculated',
  },
  {
    name: 'forward_citations',
    displayName: 'Forward Citations',
    description: 'Total forward citation count',
    category: 'CORE',
    dataType: 'INT',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'forward_citations',
    isFilterable: true,
    isSortable: true,
    isAggregatable: true,
    uiGroup: 'citations',
    uiOrder: 20,
    rangeMin: 0,
    sourceSystem: 'patentsview',
  },
  {
    name: 'remaining_years',
    displayName: 'Remaining Years',
    description: 'Estimated remaining patent life in years',
    category: 'CORE',
    dataType: 'FLOAT',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'remaining_years',
    isFilterable: true,
    isSortable: true,
    isAggregatable: true,
    uiGroup: 'lifecycle',
    uiOrder: 12,
    rangeMin: 0,
    rangeMax: 20,
    formatHint: 'decimal_1',
    sourceSystem: 'calculated',
  },
  {
    name: 'is_expired',
    displayName: 'Is Expired',
    description: 'Whether patent term has expired',
    category: 'CORE',
    dataType: 'BOOLEAN',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'is_expired',
    isFilterable: true,
    isSortable: false,
    uiGroup: 'lifecycle',
    uiOrder: 13,
    sourceSystem: 'calculated',
  },
  {
    name: 'base_score',
    displayName: 'Base Score',
    description: 'Portfolio-wide score from basic USPTO metrics (no LLM data required)',
    category: 'COMPUTED',
    dataType: 'FLOAT',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'base_score',
    isFilterable: true,
    isSortable: true,
    isAggregatable: true,
    uiGroup: 'scores',
    uiOrder: 30,
    rangeMin: 0,
    rangeMax: 100,
    formatHint: 'score_0_100',
    sourceSystem: 'calculated',
    dependsOn: ['forward_citations', 'competitor_citations', 'remaining_years'],
  },
  {
    name: 'primary_cpc',
    displayName: 'Primary CPC',
    description: 'Primary CPC classification code',
    category: 'CORE',
    dataType: 'TEXT',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'primary_cpc',
    isFilterable: true,
    isSortable: true,
    uiGroup: 'classification',
    uiOrder: 40,
    sourceSystem: 'patentsview',
  },
];
```

### 2.2 TAXONOMY — Classification Fields

```typescript
const TAXONOMY_ATTRS: AttrSeed[] = [
  {
    name: 'super_sector',
    displayName: 'Super-Sector',
    description: 'Top-level technology classification',
    category: 'TAXONOMY',
    dataType: 'ENUM',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'super_sector',
    enumValues: [
      'COMPUTING', 'WIRELESS', 'SEMICONDUCTOR', 'NETWORKING',
      'SECURITY', 'VIDEO_STREAMING', 'IMAGING', 'AI_ML', 'UNCLASSIFIED'
    ],
    isFilterable: true,
    isSortable: true,
    isAggregatable: true,
    uiGroup: 'classification',
    uiOrder: 41,
    sourceSystem: 'calculated',
  },
  {
    name: 'primary_sector',
    displayName: 'Sector',
    description: 'Mid-level technology sector within super-sector',
    category: 'TAXONOMY',
    dataType: 'TEXT',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'primary_sector',
    isFilterable: true,
    isSortable: true,
    isAggregatable: true,
    uiGroup: 'classification',
    uiOrder: 42,
    sourceSystem: 'calculated',
  },
  {
    name: 'primary_sub_sector_name',
    displayName: 'Sub-Sector',
    description: 'Fine-grained sub-sector classification',
    category: 'TAXONOMY',
    dataType: 'TEXT',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'primary_sub_sector_name',
    isFilterable: true,
    isSortable: true,
    isAggregatable: true,
    uiGroup: 'classification',
    uiOrder: 43,
    sourceSystem: 'calculated',
  },
];
```

### 2.3 ENRICHMENT — Citation Analysis (Joined Table)

```typescript
const CITATION_ATTRS: AttrSeed[] = [
  {
    name: 'competitor_citations',
    displayName: 'Competitor Citations',
    description: 'Forward citations from competitors',
    category: 'ENRICHMENT',
    dataType: 'INT',
    storageType: 'POSTGRES',
    pgTable: 'patent_citation_analyses',
    pgColumn: 'competitor_citations',
    pgJoinClause: 'LEFT JOIN patent_citation_analyses pca ON p.patent_id = pca.patent_id',
    pgJoinAlias: 'pca',
    isFilterable: true,
    isSortable: true,
    isAggregatable: true,
    uiGroup: 'citations',
    uiOrder: 21,
    rangeMin: 0,
    sourceSystem: 'calculated',
  },
  {
    name: 'affiliate_citations',
    displayName: 'Affiliate Citations',
    description: 'Forward citations from affiliates',
    category: 'ENRICHMENT',
    dataType: 'INT',
    storageType: 'POSTGRES',
    pgTable: 'patent_citation_analyses',
    pgColumn: 'affiliate_citations',
    pgJoinClause: 'LEFT JOIN patent_citation_analyses pca ON p.patent_id = pca.patent_id',
    pgJoinAlias: 'pca',
    isFilterable: true,
    isSortable: true,
    isAggregatable: true,
    uiGroup: 'citations',
    uiOrder: 22,
    rangeMin: 0,
    sourceSystem: 'calculated',
  },
  {
    name: 'neutral_citations',
    displayName: 'Neutral Citations',
    description: 'Forward citations from non-competitor, non-affiliate entities',
    category: 'ENRICHMENT',
    dataType: 'INT',
    storageType: 'POSTGRES',
    pgTable: 'patent_citation_analyses',
    pgColumn: 'neutral_citations',
    pgJoinClause: 'LEFT JOIN patent_citation_analyses pca ON p.patent_id = pca.patent_id',
    pgJoinAlias: 'pca',
    isFilterable: true,
    isSortable: true,
    isAggregatable: true,
    uiGroup: 'citations',
    uiOrder: 23,
    rangeMin: 0,
    sourceSystem: 'calculated',
  },
  {
    name: 'adjusted_forward_citations',
    displayName: 'Adjusted Forward Citations',
    description: 'Weighted citation count (competitor citations boosted)',
    category: 'ENRICHMENT',
    dataType: 'FLOAT',
    storageType: 'POSTGRES',
    pgTable: 'patent_citation_analyses',
    pgColumn: 'adjusted_forward_citations',
    pgJoinClause: 'LEFT JOIN patent_citation_analyses pca ON p.patent_id = pca.patent_id',
    pgJoinAlias: 'pca',
    isFilterable: true,
    isSortable: true,
    isAggregatable: true,
    uiGroup: 'citations',
    uiOrder: 24,
    rangeMin: 0,
    sourceSystem: 'calculated',
  },
  {
    name: 'competitor_density',
    displayName: 'Competitor Density',
    description: 'Ratio of competitor citations to total non-affiliate citations',
    category: 'ENRICHMENT',
    dataType: 'FLOAT',
    storageType: 'POSTGRES',
    pgTable: 'patent_citation_analyses',
    pgColumn: 'competitor_density',
    pgJoinClause: 'LEFT JOIN patent_citation_analyses pca ON p.patent_id = pca.patent_id',
    pgJoinAlias: 'pca',
    isFilterable: true,
    isSortable: true,
    isAggregatable: true,
    uiGroup: 'citations',
    uiOrder: 25,
    rangeMin: 0,
    rangeMax: 1,
    formatHint: 'percent',
    sourceSystem: 'calculated',
  },
  {
    name: 'competitor_names',
    displayName: 'Citing Competitors',
    description: 'Names of competitors who cite this patent',
    category: 'ENRICHMENT',
    dataType: 'TEXT_ARRAY',
    storageType: 'POSTGRES',
    pgTable: 'patent_citation_analyses',
    pgColumn: 'competitor_names',
    pgJoinClause: 'LEFT JOIN patent_citation_analyses pca ON p.patent_id = pca.patent_id',
    pgJoinAlias: 'pca',
    isFilterable: false,
    isSortable: false,
    uiGroup: 'citations',
    uiOrder: 26,
    sourceSystem: 'calculated',
  },
];
```

### 2.4 ENRICHMENT — Prosecution (Joined Table)

```typescript
const PROSECUTION_ATTRS: AttrSeed[] = [
  {
    name: 'prosecution_quality_score',
    displayName: 'Prosecution Quality',
    description: 'Quality score derived from prosecution history',
    category: 'ENRICHMENT',
    dataType: 'INT',
    storageType: 'POSTGRES',
    pgTable: 'patent_prosecution',
    pgColumn: 'prosecution_quality_score',
    pgJoinClause: 'LEFT JOIN patent_prosecution pp ON p.patent_id = pp.patent_id',
    pgJoinAlias: 'pp',
    isFilterable: true,
    isSortable: true,
    isAggregatable: true,
    uiGroup: 'prosecution',
    uiOrder: 50,
    rangeMin: 1,
    rangeMax: 5,
    formatHint: 'score_1_5',
    sourceSystem: 'file-wrapper',
  },
  {
    name: 'office_actions_count',
    displayName: 'Office Actions',
    description: 'Number of office actions during prosecution',
    category: 'ENRICHMENT',
    dataType: 'INT',
    storageType: 'POSTGRES',
    pgTable: 'patent_prosecution',
    pgColumn: 'office_actions_count',
    pgJoinClause: 'LEFT JOIN patent_prosecution pp ON p.patent_id = pp.patent_id',
    pgJoinAlias: 'pp',
    isFilterable: true,
    isSortable: true,
    isAggregatable: true,
    uiGroup: 'prosecution',
    uiOrder: 51,
    rangeMin: 0,
    sourceSystem: 'file-wrapper',
  },
  {
    name: 'prosecution_category',
    displayName: 'Prosecution Category',
    category: 'ENRICHMENT',
    dataType: 'TEXT',
    storageType: 'POSTGRES',
    pgTable: 'patent_prosecution',
    pgColumn: 'prosecution_category',
    pgJoinClause: 'LEFT JOIN patent_prosecution pp ON p.patent_id = pp.patent_id',
    pgJoinAlias: 'pp',
    isFilterable: true,
    isSortable: false,
    uiGroup: 'prosecution',
    uiOrder: 52,
    sourceSystem: 'file-wrapper',
  },
];
```

### 2.5 LLM_METRIC — Portfolio-Level Structured Question Scores (EAV)

These are the LLM-generated numeric scores stored in the `patent_scores` EAV table.
The registry maps them so they can be pivoted into materialized views.

```typescript
const LLM_METRIC_ATTRS: AttrSeed[] = [
  {
    name: 'eligibility_score',
    displayName: 'Eligibility Score',
    description: 'Patent eligibility assessment (1=weak, 5=strong)',
    category: 'LLM_METRIC',
    dataType: 'INT',
    storageType: 'POSTGRES_EAV',
    pgTable: 'patent_scores',
    pgEavFieldName: 'eligibility_score',
    pgEavValueCol: 'rating',
    rangeMin: 1,
    rangeMax: 5,
    isFilterable: true,
    isSortable: true,
    isAggregatable: true,
    uiGroup: 'llm_scores',
    uiOrder: 60,
    formatHint: 'score_1_5',
    sourceSystem: 'llm',
    templateFieldName: 'eligibility_score',
  },
  {
    name: 'validity_score',
    displayName: 'Validity Score',
    description: 'Patent validity assessment (1=likely invalid, 5=very strong)',
    category: 'LLM_METRIC',
    dataType: 'INT',
    storageType: 'POSTGRES_EAV',
    pgTable: 'patent_scores',
    pgEavFieldName: 'validity_score',
    pgEavValueCol: 'rating',
    rangeMin: 1,
    rangeMax: 5,
    isFilterable: true,
    isSortable: true,
    isAggregatable: true,
    uiGroup: 'llm_scores',
    uiOrder: 61,
    formatHint: 'score_1_5',
    sourceSystem: 'llm',
    templateFieldName: 'validity_score',
  },
  {
    name: 'claim_breadth',
    displayName: 'Claim Breadth',
    description: 'How broadly the claims read (1=narrow, 5=very broad)',
    category: 'LLM_METRIC',
    dataType: 'INT',
    storageType: 'POSTGRES_EAV',
    pgTable: 'patent_scores',
    pgEavFieldName: 'claim_breadth',
    pgEavValueCol: 'rating',
    rangeMin: 1,
    rangeMax: 5,
    isFilterable: true,
    isSortable: true,
    isAggregatable: true,
    uiGroup: 'llm_scores',
    uiOrder: 62,
    formatHint: 'score_1_5',
    sourceSystem: 'llm',
    templateFieldName: 'claim_breadth',
  },
  {
    name: 'enforcement_clarity',
    displayName: 'Enforcement Clarity',
    description: 'How clear infringement detection would be (1=difficult, 5=obvious)',
    category: 'LLM_METRIC',
    dataType: 'INT',
    storageType: 'POSTGRES_EAV',
    pgTable: 'patent_scores',
    pgEavFieldName: 'enforcement_clarity',
    pgEavValueCol: 'rating',
    rangeMin: 1,
    rangeMax: 5,
    isFilterable: true,
    isSortable: true,
    isAggregatable: true,
    uiGroup: 'llm_scores',
    uiOrder: 63,
    formatHint: 'score_1_5',
    sourceSystem: 'llm',
    templateFieldName: 'enforcement_clarity',
  },
  {
    name: 'design_around_difficulty',
    displayName: 'Design-Around Difficulty',
    description: 'How hard to design around this patent (1=easy, 5=very hard)',
    category: 'LLM_METRIC',
    dataType: 'INT',
    storageType: 'POSTGRES_EAV',
    pgTable: 'patent_scores',
    pgEavFieldName: 'design_around_difficulty',
    pgEavValueCol: 'rating',
    rangeMin: 1,
    rangeMax: 5,
    isFilterable: true,
    isSortable: true,
    isAggregatable: true,
    uiGroup: 'llm_scores',
    uiOrder: 64,
    formatHint: 'score_1_5',
    sourceSystem: 'llm',
    templateFieldName: 'design_around_difficulty',
  },
  {
    name: 'market_relevance_score',
    displayName: 'Market Relevance',
    description: 'Current market relevance of the technology (1=niche, 5=critical)',
    category: 'LLM_METRIC',
    dataType: 'INT',
    storageType: 'POSTGRES_EAV',
    pgTable: 'patent_scores',
    pgEavFieldName: 'market_relevance_score',
    pgEavValueCol: 'rating',
    rangeMin: 1,
    rangeMax: 5,
    isFilterable: true,
    isSortable: true,
    isAggregatable: true,
    uiGroup: 'llm_scores',
    uiOrder: 65,
    formatHint: 'score_1_5',
    sourceSystem: 'llm',
    templateFieldName: 'market_relevance_score',
  },
];
```

### 2.6 LLM_TEXT — Reasoning and Text Fields (EAV + JSON Cache)

```typescript
const LLM_TEXT_ATTRS: AttrSeed[] = [
  // Reasoning stored in EAV
  {
    name: 'eligibility_score_reasoning',
    displayName: 'Eligibility Reasoning',
    category: 'LLM_TEXT',
    dataType: 'LONG_TEXT',
    storageType: 'POSTGRES_EAV',
    pgTable: 'patent_scores',
    pgEavFieldName: 'eligibility_score',
    pgEavValueCol: 'reasoning',
    isFilterable: false,
    isSortable: false,
    uiGroup: 'llm_reasoning',
    sourceSystem: 'llm',
  },
  // ... (one per metric — pattern repeats for validity, claim_breadth, etc.)
  
  // Summary and structured text from JSON cache
  {
    name: 'llm_summary',
    displayName: 'AI Summary',
    description: 'Attorney-style patent summary generated by LLM',
    category: 'LLM_TEXT',
    dataType: 'LONG_TEXT',
    storageType: 'JSON_CACHE',
    filePathTemplate: 'cache/llm-scores/{{patent_id}}.json',
    fileSelector: '$.summary',
    fileFormat: 'json',
    isFilterable: false,
    isSortable: false,
    uiGroup: 'llm_text',
    uiOrder: 70,
    sourceSystem: 'llm',
  },
  {
    name: 'prior_art_problem',
    displayName: 'Prior Art Problem',
    description: 'Problem in the prior art this patent addresses',
    category: 'LLM_TEXT',
    dataType: 'LONG_TEXT',
    storageType: 'JSON_CACHE',
    filePathTemplate: 'cache/llm-scores/{{patent_id}}.json',
    fileSelector: '$.prior_art_problem',
    fileFormat: 'json',
    isFilterable: false,
    isSortable: false,
    uiGroup: 'llm_text',
    uiOrder: 71,
    sourceSystem: 'llm',
  },
  {
    name: 'technical_solution',
    displayName: 'Technical Solution',
    description: 'How the patent solves the prior art problem',
    category: 'LLM_TEXT',
    dataType: 'LONG_TEXT',
    storageType: 'JSON_CACHE',
    filePathTemplate: 'cache/llm-scores/{{patent_id}}.json',
    fileSelector: '$.technical_solution',
    fileFormat: 'json',
    isFilterable: false,
    isSortable: false,
    uiGroup: 'llm_text',
    uiOrder: 72,
    sourceSystem: 'llm',
  },
];
```

### 2.7 LLM_CLASS — Categorical Classifications from LLM

```typescript
const LLM_CLASS_ATTRS: AttrSeed[] = [
  {
    name: 'technology_category',
    displayName: 'Technology Category',
    description: 'LLM-assigned technology category',
    category: 'LLM_CLASS',
    dataType: 'TEXT',
    storageType: 'POSTGRES_EAV',
    pgTable: 'patent_scores',
    pgEavFieldName: 'technology_category',
    pgEavValueCol: 'text_value',
    isFilterable: true,
    isSortable: false,
    isAggregatable: true,
    uiGroup: 'llm_classification',
    sourceSystem: 'llm',
  },
  {
    name: 'implementation_type',
    displayName: 'Implementation Type',
    description: 'Hardware vs software vs method',
    category: 'LLM_CLASS',
    dataType: 'TEXT',
    storageType: 'POSTGRES_EAV',
    pgTable: 'patent_scores',
    pgEavFieldName: 'implementation_type',
    pgEavValueCol: 'text_value',
    isFilterable: true,
    isSortable: false,
    isAggregatable: true,
    uiGroup: 'llm_classification',
    sourceSystem: 'llm',
  },
  {
    name: 'standards_relevance',
    displayName: 'Standards Relevance',
    description: 'Relevance to industry standards (SEP potential)',
    category: 'LLM_CLASS',
    dataType: 'TEXT',
    storageType: 'POSTGRES_EAV',
    pgTable: 'patent_scores',
    pgEavFieldName: 'standards_relevance',
    pgEavValueCol: 'text_value',
    isFilterable: true,
    isSortable: false,
    isAggregatable: true,
    uiGroup: 'llm_classification',
    sourceSystem: 'llm',
  },
  {
    name: 'market_segment',
    displayName: 'Market Segment',
    description: 'Primary market segment for the technology',
    category: 'LLM_CLASS',
    dataType: 'TEXT',
    storageType: 'POSTGRES_EAV',
    pgTable: 'patent_scores',
    pgEavFieldName: 'market_segment',
    pgEavValueCol: 'text_value',
    isFilterable: true,
    isSortable: false,
    isAggregatable: true,
    uiGroup: 'llm_classification',
    sourceSystem: 'llm',
  },
];
```

### 2.8 SYSTEM — Enrichment Flags and Internal Fields

```typescript
const SYSTEM_ATTRS: AttrSeed[] = [
  {
    name: 'has_llm_data',
    displayName: 'Has LLM Data',
    category: 'SYSTEM',
    dataType: 'BOOLEAN',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'has_llm_data',
    isFilterable: true,
    uiGroup: 'enrichment_flags',
    sourceSystem: 'system',
  },
  {
    name: 'has_citation_data',
    displayName: 'Has Citation Data',
    category: 'SYSTEM',
    dataType: 'BOOLEAN',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'has_citation_data',
    isFilterable: true,
    uiGroup: 'enrichment_flags',
    sourceSystem: 'system',
  },
  {
    name: 'has_prosecution_data',
    displayName: 'Has Prosecution Data',
    category: 'SYSTEM',
    dataType: 'BOOLEAN',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'has_prosecution_data',
    isFilterable: true,
    uiGroup: 'enrichment_flags',
    sourceSystem: 'system',
  },
  {
    name: 'has_xml_data',
    displayName: 'Has XML Data',
    category: 'SYSTEM',
    dataType: 'BOOLEAN',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'has_xml_data',
    isFilterable: true,
    uiGroup: 'enrichment_flags',
    sourceSystem: 'system',
  },
  {
    name: 'has_ipr_data',
    displayName: 'Has IPR Data',
    category: 'SYSTEM',
    dataType: 'BOOLEAN',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'has_ipr_data',
    isFilterable: true,
    uiGroup: 'enrichment_flags',
    sourceSystem: 'system',
  },
  {
    name: 'has_family_data',
    displayName: 'Has Family Data',
    category: 'SYSTEM',
    dataType: 'BOOLEAN',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'has_family_data',
    isFilterable: true,
    uiGroup: 'enrichment_flags',
    sourceSystem: 'system',
  },
  {
    name: 'is_quarantined',
    displayName: 'Quarantined',
    category: 'SYSTEM',
    dataType: 'BOOLEAN',
    storageType: 'POSTGRES',
    pgTable: 'patents',
    pgColumn: 'is_quarantined',
    isFilterable: true,
    uiGroup: 'enrichment_flags',
    sourceSystem: 'system',
  },
];
```

### 2.9 LONG_TEXT — On-Demand File-Based Data

```typescript
const LONG_TEXT_ATTRS: AttrSeed[] = [
  {
    name: 'claims_text',
    displayName: 'Patent Claims',
    description: 'Full claims text from USPTO bulk XML',
    category: 'LONG_TEXT',
    dataType: 'LONG_TEXT',
    storageType: 'XML_BULK',
    filePathTemplate: '${USPTO_PATENT_GRANT_XML_DIR}/US{{patent_id}}.xml',
    fileSelector: '//us-patent-grant/claims',
    fileFormat: 'xml',
    isFilterable: false,
    isSortable: false,
    uiGroup: 'full_text',
    sourceSystem: 'uspto_xml',
  },
  {
    name: 'description_text',
    displayName: 'Patent Description',
    description: 'Full description text from USPTO bulk XML',
    category: 'LONG_TEXT',
    dataType: 'LONG_TEXT',
    storageType: 'XML_BULK',
    filePathTemplate: '${USPTO_PATENT_GRANT_XML_DIR}/US{{patent_id}}.xml',
    fileSelector: '//us-patent-grant/description',
    fileFormat: 'xml',
    isFilterable: false,
    isSortable: false,
    uiGroup: 'full_text',
    sourceSystem: 'uspto_xml',
  },
  {
    name: 'patentsview_full',
    displayName: 'PatentsView Response',
    description: 'Full PatentsView API response for this patent',
    category: 'LONG_TEXT',
    dataType: 'JSON',
    storageType: 'JSON_CACHE',
    filePathTemplate: 'cache/api/patentsview/patent/{{patent_id}}.json',
    fileFormat: 'json',
    isFilterable: false,
    isSortable: false,
    isDisplayable: false,
    uiGroup: 'raw_data',
    sourceSystem: 'patentsview',
  },
  {
    name: 'prosecution_documents',
    displayName: 'Prosecution Documents',
    description: 'Prosecution history document cache',
    category: 'LONG_TEXT',
    dataType: 'JSON',
    storageType: 'JSON_CACHE',
    filePathTemplate: 'cache/prosecution-documents/{{patent_id}}.json',
    fileFormat: 'json',
    isFilterable: false,
    isSortable: false,
    isDisplayable: false,
    uiGroup: 'raw_data',
    sourceSystem: 'file-wrapper',
  },
  // Elasticsearch full-text
  {
    name: 'abstract_fulltext',
    displayName: 'Abstract (Full-Text Search)',
    description: 'Abstract indexed in Elasticsearch for full-text and MLT queries',
    category: 'LONG_TEXT',
    dataType: 'LONG_TEXT',
    storageType: 'ELASTICSEARCH',
    esIndex: 'patents',
    esField: 'abstract',
    isFilterable: true,  // via ES full-text query
    isSortable: false,
    uiGroup: 'full_text',
    sourceSystem: 'patentsview',
  },
];
```

### 2.10 Seed Runner

```typescript
// seed/run-registry-seed.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedRegistry() {
  const allAttrs = [
    ...CORE_ATTRS,
    ...TAXONOMY_ATTRS,
    ...CITATION_ATTRS,
    ...PROSECUTION_ATTRS,
    ...LLM_METRIC_ATTRS,
    ...LLM_TEXT_ATTRS,
    ...LLM_CLASS_ATTRS,
    ...SYSTEM_ATTRS,
    ...LONG_TEXT_ATTRS,
  ];
  
  console.log(`Seeding ${allAttrs.length} attribute definitions...`);
  
  let created = 0;
  let updated = 0;
  
  for (const attr of allAttrs) {
    const result = await prisma.attributeDefinition.upsert({
      where: { name: attr.name },
      create: attr,
      update: {
        // Update everything except name (the key) and version
        displayName: attr.displayName,
        description: attr.description,
        category: attr.category,
        dataType: attr.dataType,
        storageType: attr.storageType,
        pgTable: attr.pgTable,
        pgColumn: attr.pgColumn,
        pgJoinClause: attr.pgJoinClause,
        pgJoinAlias: attr.pgJoinAlias,
        pgEavFieldName: attr.pgEavFieldName,
        pgEavValueCol: attr.pgEavValueCol,
        filePathTemplate: attr.filePathTemplate,
        fileSelector: attr.fileSelector,
        fileFormat: attr.fileFormat,
        esIndex: attr.esIndex,
        esField: attr.esField,
        formula: attr.formula,
        dependsOn: attr.dependsOn,
        isFilterable: attr.isFilterable,
        isSortable: attr.isSortable,
        isAggregatable: attr.isAggregatable,
        isDisplayable: attr.isDisplayable,
        enumValues: attr.enumValues,
        rangeMin: attr.rangeMin,
        rangeMax: attr.rangeMax,
        uiGroup: attr.uiGroup,
        uiOrder: attr.uiOrder,
        formatHint: attr.formatHint,
        sourceSystem: attr.sourceSystem,
        templateFieldName: attr.templateFieldName,
      },
    });
    
    // Simple heuristic: if updatedAt > createdAt, it was updated
    if (result.updatedAt.getTime() - result.createdAt.getTime() < 1000) {
      created++;
    } else {
      updated++;
    }
  }
  
  console.log(`Done: ${created} created, ${updated} updated`);
  
  // Also discover any EAV field_names in patent_scores not yet in registry
  await discoverUnregisteredEavFields();
}

async function discoverUnregisteredEavFields() {
  const knownFields = await prisma.attributeDefinition.findMany({
    where: { storageType: 'POSTGRES_EAV' },
    select: { pgEavFieldName: true },
  });
  const knownSet = new Set(knownFields.map(f => f.pgEavFieldName));
  
  const eavFields = await prisma.$queryRaw<{ field_name: string; cnt: number }[]>`
    SELECT field_name, COUNT(*) as cnt 
    FROM patent_scores 
    GROUP BY field_name 
    ORDER BY cnt DESC
  `;
  
  const unregistered = eavFields.filter(f => !knownSet.has(f.field_name));
  
  if (unregistered.length > 0) {
    console.log(`\nFound ${unregistered.length} unregistered EAV fields in patent_scores:`);
    for (const f of unregistered) {
      console.log(`  - ${f.field_name} (${f.cnt} rows)`);
    }
    console.log('These should be added to the registry seed or registered via template sync.');
  }
}

seedRegistry()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

---

## 3. Taxonomy Analysis Service (Non-Breaking)

This service is purely additive — it queries existing data to answer design
questions about taxonomy effectiveness. It does not modify any existing data.

### 3.1 Purpose

Answer these questions with data before committing to taxonomy redesign:

1. **Coverage effectiveness**: What % of patents get classified? How many fall into UNCLASSIFIED?
2. **CPC distribution**: How are CPC codes distributed across patents? How many distinct CPC codes per patent?
3. **Multi-classification potential**: If a patent has CPC codes mapping to multiple sectors, what are the overlaps?
4. **Portfolio variation**: Do different portfolios have radically different CPC distributions that would benefit from portfolio-specific taxonomies?
5. **Sector size balance**: Which sectors are too large or too small? What CPC splits would improve balance?
6. **Rule effectiveness**: Which sector rules are matching? Which are redundant?

### 3.2 Service Interface

```typescript
// services/taxonomy-analysis-service.ts

export interface TaxonomyAnalysisService {
  
  // ── CPC Distribution ──
  
  /** How many CPC codes does each patent have? Distribution stats. */
  getCpcCountDistribution(opts?: { portfolioId?: string }): Promise<{
    min: number; max: number; avg: number; median: number;
    percentiles: Record<string, number>;  // p25, p50, p75, p90, p95
    histogram: { bucket: string; count: number }[];
  }>;
  
  /** Most common CPC codes across all patents (or within scope) */
  getTopCpcCodes(opts: {
    portfolioId?: string;
    superSector?: string;
    sector?: string;
    level?: 'SECTION' | 'CLASS' | 'SUBCLASS' | 'GROUP' | 'SUBGROUP';
    limit?: number;
  }): Promise<{
    code: string;
    title: string;
    patentCount: number;
    inventiveCount: number;  // How many times it appears as inventive
    currentSector: string | null;
    currentSuperSector: string | null;
  }[]>;
  
  /** For a given patent set, which CPC codes map to which sectors? */
  getCpcToSectorMapping(opts?: { portfolioId?: string }): Promise<{
    cpcCode: string;
    cpcTitle: string;
    sectors: { sectorName: string; superSector: string; ruleType: string }[];
    unmapped: boolean;  // No sector rule matches this CPC
  }[]>;
  
  // ── Multi-Classification Analysis ──
  
  /** How many patents would get multiple sector assignments if we used ALL their CPC codes? */
  getMultiSectorPotential(opts?: { portfolioId?: string }): Promise<{
    singleSector: number;       // Patents with CPCs mapping to only 1 sector
    twoSectors: number;         // Maps to exactly 2
    threePlusSectors: number;   // Maps to 3+
    // The most common sector pairs for multi-mapped patents
    topSectorPairs: { sectors: string[]; count: number }[];
    // Sample patents that map to many sectors
    highOverlapSamples: {
      patentId: string;
      title: string;
      sectors: string[];
      cpcCodes: string[];
    }[];
  }>;
  
  /** Detailed per-patent classification: what sectors WOULD each CPC code assign to? */
  getPatentClassificationDetail(patentId: string): Promise<{
    patentId: string;
    currentSuperSector: string | null;
    currentSector: string | null;
    currentSubSector: string | null;
    cpcCodes: {
      code: string;
      isInventive: boolean;
      title: string;
      wouldMapToSector: string | null;
      wouldMapToSuperSector: string | null;
      ruleUsed: string | null;
    }[];
    alternativeClassifications: {
      sector: string;
      superSector: string;
      matchingCpcCount: number;
      inventiveCpcCount: number;
    }[];
  }>;
  
  // ── Portfolio Comparison ──
  
  /** Compare CPC distributions across portfolios */
  getPortfolioCpcComparison(portfolioIds: string[]): Promise<{
    cpcCode: string;
    cpcTitle: string;
    counts: Record<string, number>;  // portfolioId -> count
    totalAcross: number;
  }[]>;
  
  /** Super-sector distribution per portfolio */
  getPortfolioTaxonomyDistribution(portfolioIds: string[]): Promise<{
    superSector: string;
    distributions: Record<string, { count: number; pct: number }>;  // portfolioId -> stats
  }[]>;
  
  // ── Sector Balance ──
  
  /** Identify over- and under-sized sectors with refactoring suggestions */
  getSectorSizeAnalysis(opts?: { portfolioId?: string }): Promise<{
    sector: string;
    superSector: string;
    patentCount: number;
    status: 'ok' | 'oversized' | 'undersized';
    topCpcCodes: { code: string; count: number }[];  // For split guidance
    suggestedAction?: string;
  }[]>;
  
  // ── Rule Effectiveness ──
  
  /** Which sector rules are matching patents, and how many? */
  getRuleEffectiveness(opts?: { sectorId?: string }): Promise<{
    ruleId: string;
    expression: string;
    ruleType: string;
    sectorName: string;
    matchCount: number;
    isActive: boolean;
    overlapsWithRules: string[];  // Other rules that match same patents
  }[]>;
  
  /** Find patents that match rules for MULTIPLE sectors (rule conflicts) */
  getRuleConflicts(opts?: { portfolioId?: string }): Promise<{
    patentId: string;
    matchedSectors: { sector: string; ruleExpression: string; ruleType: string }[];
  }[]>;
}
```

### 3.3 Key Implementation — Multi-Classification Potential

This is the most important analysis for taxonomy redesign. It shows us what
happens when we honor all CPC codes instead of picking just one sector.

```typescript
async getMultiSectorPotential(opts?: { portfolioId?: string }) {
  // Step 1: For each patent, find ALL sectors its CPC codes would map to
  //         by evaluating sector rules against patent_cpc_codes
  
  const query = `
    WITH patent_cpc_sectors AS (
      -- For each patent's CPC code, find which sector rules match
      SELECT DISTINCT
        pc.patent_id,
        s.name AS sector_name,
        ss.name AS super_sector_name,
        sr.rule_type,
        sr.expression
      FROM patent_cpc_codes pc
      JOIN sector_rules sr ON (
        (sr.rule_type = 'CPC_PREFIX' AND pc.cpc_code LIKE sr.expression || '%')
        OR (sr.rule_type = 'CPC_SUBGROUP' AND pc.cpc_code = sr.expression)
      )
      JOIN sectors s ON sr.sector_id = s.id
      LEFT JOIN super_sectors ss ON s.super_sector_id = ss.id
      WHERE sr.is_active = true
        AND sr.is_exclusion = false
        ${opts?.portfolioId ? `
        AND pc.patent_id IN (
          SELECT patent_id FROM portfolio_patents WHERE portfolio_id = '${opts.portfolioId}'
        )` : ''}
    ),
    patent_sector_counts AS (
      SELECT 
        patent_id,
        COUNT(DISTINCT sector_name) AS sector_count,
        ARRAY_AGG(DISTINCT sector_name ORDER BY sector_name) AS sectors
      FROM patent_cpc_sectors
      GROUP BY patent_id
    )
    SELECT 
      sector_count,
      COUNT(*) AS patent_count,
      -- Sample some for sector_count > 1
      ARRAY_AGG(patent_id) FILTER (WHERE sector_count > 1) AS sample_ids
    FROM patent_sector_counts
    GROUP BY sector_count
    ORDER BY sector_count
  `;
  
  // Step 2: Get the most common sector pairs
  const pairQuery = `
    WITH patent_sector_pairs AS (
      SELECT 
        pcs1.patent_id,
        pcs1.sector_name AS sector_a,
        pcs2.sector_name AS sector_b
      FROM patent_cpc_sectors pcs1
      JOIN patent_cpc_sectors pcs2 
        ON pcs1.patent_id = pcs2.patent_id 
        AND pcs1.sector_name < pcs2.sector_name
    )
    SELECT sector_a, sector_b, COUNT(*) AS pair_count
    FROM patent_sector_pairs
    GROUP BY sector_a, sector_b
    ORDER BY pair_count DESC
    LIMIT 20
  `;
  
  // ... execute and assemble results
}
```

### 3.4 REST Endpoints (Non-Breaking Addition)

```typescript
// routes/taxonomy-analysis-routes.ts

router.get('/api/analysis/taxonomy/cpc-distribution', async (req, res) => {
  const result = await taxonomyAnalysis.getCpcCountDistribution({
    portfolioId: req.query.portfolioId as string,
  });
  res.json(result);
});

router.get('/api/analysis/taxonomy/top-cpc', async (req, res) => {
  const result = await taxonomyAnalysis.getTopCpcCodes({
    portfolioId: req.query.portfolioId as string,
    superSector: req.query.superSector as string,
    sector: req.query.sector as string,
    level: req.query.level as any,
    limit: parseInt(req.query.limit as string) || 50,
  });
  res.json(result);
});

router.get('/api/analysis/taxonomy/multi-sector-potential', async (req, res) => {
  const result = await taxonomyAnalysis.getMultiSectorPotential({
    portfolioId: req.query.portfolioId as string,
  });
  res.json(result);
});

router.get('/api/analysis/taxonomy/patent-classification/:patentId', async (req, res) => {
  const result = await taxonomyAnalysis.getPatentClassificationDetail(req.params.patentId);
  res.json(result);
});

router.get('/api/analysis/taxonomy/portfolio-comparison', async (req, res) => {
  const ids = (req.query.portfolioIds as string).split(',');
  const result = await taxonomyAnalysis.getPortfolioCpcComparison(ids);
  res.json(result);
});

router.get('/api/analysis/taxonomy/sector-size', async (req, res) => {
  const result = await taxonomyAnalysis.getSectorSizeAnalysis({
    portfolioId: req.query.portfolioId as string,
  });
  res.json(result);
});

router.get('/api/analysis/taxonomy/rule-effectiveness', async (req, res) => {
  const result = await taxonomyAnalysis.getRuleEffectiveness({
    sectorId: req.query.sectorId as string,
  });
  res.json(result);
});

router.get('/api/analysis/taxonomy/rule-conflicts', async (req, res) => {
  const result = await taxonomyAnalysis.getRuleConflicts({
    portfolioId: req.query.portfolioId as string,
  });
  res.json(result);
});
```

---

## 4. Data Introspection Service (Claude Code Skill Foundation)

This is the endpoint that Claude Code (and any future analysis tool) calls
first to discover what data is available.

### 4.1 Service

```typescript
// services/introspection-service.ts

export class IntrospectionService {
  constructor(private prisma: PrismaClient) {}
  
  /** 
   * Full system introspection — what data exists, where it lives,
   * what can be filtered/sorted/aggregated.
   */
  async getSystemSchema(): Promise<SystemSchema> {
    const [attrs, superSectors, sectors, portfolios, snapshots] = await Promise.all([
      this.prisma.attributeDefinition.findMany({
        where: { isActive: true },
        orderBy: [{ uiGroup: 'asc' }, { uiOrder: 'asc' }],
      }),
      this.prisma.superSector.findMany({ include: { _count: { select: { sectors: true } } } }),
      this.prisma.sector.findMany({ 
        include: { 
          superSector: { select: { name: true } },
          _count: { select: { subSectors: true } },
        } 
      }),
      this.prisma.portfolio.findMany({ select: { id: true, name: true, displayName: true, patentCount: true } }),
      this.prisma.scoreSnapshot.findMany({ 
        where: { isActive: true },
        select: { id: true, name: true, scoreType: true, portfolioId: true, patentCount: true, createdAt: true },
      }),
    ]);
    
    // Group attributes by uiGroup for organized display
    const attrsByGroup: Record<string, typeof attrs> = {};
    for (const attr of attrs) {
      const group = attr.uiGroup || 'ungrouped';
      if (!attrsByGroup[group]) attrsByGroup[group] = [];
      attrsByGroup[group].push(attr);
    }
    
    return {
      entityTypes: ['patent'],  // Future: 'product', 'company'
      attributes: attrs,
      attributesByGroup: attrsByGroup,
      filterableAttributes: attrs.filter(a => a.isFilterable).map(a => a.name),
      sortableAttributes: attrs.filter(a => a.isSortable).map(a => a.name),
      aggregatableAttributes: attrs.filter(a => a.isAggregatable).map(a => a.name),
      taxonomy: {
        superSectors: superSectors.map(ss => ({ 
          name: ss.name, displayName: ss.displayName, sectorCount: ss._count.sectors 
        })),
        sectors: sectors.map(s => ({
          name: s.name, displayName: s.displayName,
          superSector: s.superSector?.name,
          subSectorCount: s._count.subSectors,
          patentCount: s.patentCount,
        })),
      },
      portfolios,
      activeSnapshots: snapshots,
      storageTypes: [...new Set(attrs.map(a => a.storageType))],
      uiGroups: Object.keys(attrsByGroup),
    };
  }
  
  /** 
   * Quick overview stats — good for dashboard and skill context setting.
   */
  async getSystemStats(): Promise<SystemStats> {
    const [totalPatents, enrichedCounts, portfolioCount, sectorCount] = await Promise.all([
      this.prisma.patent.count(),
      this.prisma.patent.groupBy({
        by: ['hasLlmData'],
        _count: true,
      }),
      this.prisma.portfolio.count(),
      this.prisma.sector.count(),
    ]);
    
    const withLlm = enrichedCounts.find(e => e.hasLlmData)?._count || 0;
    
    return {
      totalPatents,
      withLlmData: withLlm,
      llmCoverage: withLlm / totalPatents,
      portfolioCount,
      sectorCount,
      registeredAttributes: await this.prisma.attributeDefinition.count({ where: { isActive: true } }),
    };
  }
  
  /**
   * Discover what EAV field_names exist but aren't in the registry yet.
   * Useful after new LLM templates are run.
   */
  async getUnregisteredFields(): Promise<{ fieldName: string; count: number; sampleValues: any }[]> {
    const registered = new Set(
      (await this.prisma.attributeDefinition.findMany({
        where: { storageType: 'POSTGRES_EAV' },
        select: { pgEavFieldName: true },
      })).map(r => r.pgEavFieldName)
    );
    
    const allFields = await this.prisma.$queryRaw<{ field_name: string; cnt: bigint }[]>`
      SELECT field_name, COUNT(*) as cnt
      FROM patent_scores
      GROUP BY field_name
      ORDER BY cnt DESC
    `;
    
    return allFields
      .filter(f => !registered.has(f.field_name))
      .map(f => ({
        fieldName: f.field_name,
        count: Number(f.cnt),
        sampleValues: null, // Could fetch a few samples
      }));
  }
}
```

### 4.2 REST Endpoints

```typescript
router.get('/api/data/introspect', async (req, res) => {
  const schema = await introspection.getSystemSchema();
  res.json(schema);
});

router.get('/api/data/stats', async (req, res) => {
  const stats = await introspection.getSystemStats();
  res.json(stats);
});

router.get('/api/data/unregistered-fields', async (req, res) => {
  const fields = await introspection.getUnregisteredFields();
  res.json(fields);
});
```

---

## 5. Early Versioning Groundwork

We don't implement full revAIQ tracking yet, but we lay the groundwork by
capturing version information we currently have.

### 5.1 What We Can Track Today (Without Schema Changes)

The `PatentScore` table already has `templateId`, `llmModel`, and `scoredAt`.
The `PatentSubSectorScore` table has `templateVersion` and `questionFingerprint`.
We can build analysis queries on these existing fields to understand our current state.

### 5.2 LLM Data Currency Analysis Service

```typescript
// services/llm-currency-analysis-service.ts

export class LlmCurrencyAnalysisService {
  
  /**
   * What LLM models have been used across the system?
   * Helps understand cost and quality distribution.
   */
  async getModelDistribution(opts?: { portfolioId?: string }): Promise<{
    model: string;
    patentCount: number;
    oldestRun: Date;
    newestRun: Date;
  }[]> {
    return this.prisma.$queryRaw`
      SELECT 
        llm_model as model,
        COUNT(DISTINCT patent_id) as patent_count,
        MIN(scored_at) as oldest_run,
        MAX(scored_at) as newest_run
      FROM patent_scores
      WHERE llm_model IS NOT NULL
      GROUP BY llm_model
      ORDER BY patent_count DESC
    `;
  }
  
  /**
   * Which template versions are in use? How many patents at each version?
   */
  async getTemplateVersionDistribution(): Promise<{
    templateConfigId: string;
    templateVersion: number;
    patentCount: number;
    isStale: boolean;
    newestRun: Date;
  }[]> {
    return this.prisma.$queryRaw`
      SELECT
        template_config_id,
        template_version,
        COUNT(*) as patent_count,
        BOOL_OR(is_stale) as is_stale,
        MAX(executed_at) as newest_run
      FROM patent_sub_sector_scores
      WHERE template_config_id IS NOT NULL
      GROUP BY template_config_id, template_version
      ORDER BY template_config_id, template_version DESC
    `;
  }
  
  /**
   * Per-sector staleness report: how many patents in each sector
   * have stale LLM data?
   */
  async getStalenessReport(opts?: { portfolioId?: string }): Promise<{
    superSector: string;
    sector: string;
    totalPatents: number;
    withLlmData: number;
    staleCount: number;
    freshCount: number;
    stalePct: number;
  }[]> {
    // Join patents -> patent_scores staleness
    // Group by sector
  }
  
  /**
   * For enrichment planning: estimate how many patents need LLM reruns
   * if we upgrade to a new model or add questions.
   */
  async getRerunEstimate(opts: {
    portfolioId?: string;
    superSector?: string;
    targetModel?: string;        // Only count patents NOT on this model
    onlyStale?: boolean;
  }): Promise<{
    totalInScope: number;
    alreadyUpToDate: number;
    needsRerun: number;
    estimatedTokens: number;     // Based on avg tokens per patent from LlmResponseCache
    estimatedCost: number;       // Rough cost estimate
  }> {
    // Use LlmResponseCache for token averages
    // Cross-reference with patent_scores.llm_model
  }
  
  /**
   * Compare scores between two LLM models on patents scored by both.
   * Critical for normalization design — shows how model differences
   * affect scoring and rankings.
   */
  async getModelComparisonOverlap(opts: {
    modelA: string;
    modelB: string;
    metric: string;  // e.g., "eligibility_score"
    portfolioId?: string;
  }): Promise<{
    overlapCount: number;     // Patents scored by both models
    modelAOnly: number;
    modelBOnly: number;
    correlation: number;      // Pearson correlation of scores
    avgDifference: number;    // Mean(modelB - modelA)
    rankDisplacement: number; // Avg change in rank
    samples: {
      patentId: string;
      scoreA: number;
      scoreB: number;
      delta: number;
    }[];
  }> {
    // This is crucial for future normalization work.
    // We'll run this when we do model comparison experiments.
  }
}
```

### 5.3 Versioning Groundwork Note

The full revAIQ convention (e.g., "3.2.1.4" for portfolio.superSector.sector.subSector)
requires these open questions to be resolved through experimentation:

1. **Granularity**: Do we version per-sub-sector, per-sector, or at broader levels?
   The currency analysis service above will tell us whether we actually change
   questions at fine-grained levels frequently enough to warrant fine-grained versioning.

2. **Multi-taxonomy**: When patents have multiple classifications, how does versioning
   compose? We need the multi-classification analysis from Section 3 first.

3. **Model dimension**: Is LLM model a separate version axis or part of the same string?
   The model comparison service above will show how much model differences matter.

For now, we capture data. The analysis services will inform the versioning design
before we commit to a specific convention.

---

## 6. Materialized View — Patent Summary (First Performance Win)

### 6.1 Registry-Driven View Generation

Once the registry is seeded, we can generate the materialized view dynamically
from registry data rather than hand-coding the SQL.

```typescript
// views/patent-summary-view.ts

export async function generatePatentSummaryView(prisma: PrismaClient): Promise<string> {
  // Get all filterable/sortable patent attributes from registry
  const attrs = await prisma.attributeDefinition.findMany({
    where: {
      isActive: true,
      entityType: 'patent',
      OR: [{ isFilterable: true }, { isSortable: true }, { isAggregatable: true }],
    },
  });
  
  // Separate by storage type
  const directCols = attrs.filter(a => a.storageType === 'POSTGRES' && a.pgTable === 'patents');
  const joinCols = attrs.filter(a => a.storageType === 'POSTGRES' && a.pgTable !== 'patents');
  const eavCols = attrs.filter(a => a.storageType === 'POSTGRES_EAV');
  
  // Build SELECT for direct columns
  const directSelect = directCols
    .map(a => `p.${a.pgColumn} AS "${a.name}"`)
    .join(',\n    ');
  
  // Build JOINs (deduplicate by alias)
  const joinMap = new Map<string, string>();
  for (const a of joinCols) {
    if (a.pgJoinAlias && a.pgJoinClause && !joinMap.has(a.pgJoinAlias)) {
      joinMap.set(a.pgJoinAlias, a.pgJoinClause);
    }
  }
  const joinSelect = joinCols
    .map(a => `${a.pgJoinAlias}.${a.pgColumn} AS "${a.name}"`)
    .join(',\n    ');
  const joinClauses = [...joinMap.values()].join('\n');
  
  // Build EAV pivot
  const eavPivotSelect = eavCols
    .map(a => `MAX(CASE WHEN ps.field_name = '${a.pgEavFieldName}' THEN ps.${a.pgEavValueCol} END) AS "${a.name}"`)
    .join(',\n    ');
  const eavFieldNames = eavCols.map(a => `'${a.pgEavFieldName}'`).join(',');
  
  return `
-- Generated from attribute_definitions registry
-- Regenerate with: SELECT generate_patent_summary_view()

DROP MATERIALIZED VIEW IF EXISTS mv_patent_summary CASCADE;

CREATE MATERIALIZED VIEW mv_patent_summary AS
WITH llm_pivot AS (
  SELECT 
    patent_id,
    ${eavPivotSelect}
  FROM patent_scores ps
  WHERE ps.field_name IN (${eavFieldNames})
  GROUP BY patent_id
)
SELECT
    p.id AS patent_cuid,
    ${directSelect},
    ${joinSelect ? joinSelect + ',' : ''}
    lp.*
FROM patents p
${joinClauses}
LEFT JOIN llm_pivot lp ON p.patent_id = lp.patent_id
WHERE p.is_quarantined = false;

CREATE UNIQUE INDEX idx_mv_ps_patent_id ON mv_patent_summary (patent_id);
CREATE INDEX idx_mv_ps_super_sector ON mv_patent_summary (super_sector);
CREATE INDEX idx_mv_ps_primary_sector ON mv_patent_summary (primary_sector);
CREATE INDEX idx_mv_ps_base_score ON mv_patent_summary (base_score DESC NULLS LAST);
CREATE INDEX idx_mv_ps_remaining_years ON mv_patent_summary (remaining_years DESC NULLS LAST);
CREATE INDEX idx_mv_ps_competitor_citations ON mv_patent_summary (competitor_citations DESC NULLS LAST);
CREATE INDEX idx_mv_ps_eligibility ON mv_patent_summary (eligibility_score DESC NULLS LAST);
CREATE INDEX idx_mv_ps_has_llm ON mv_patent_summary (has_llm_data);
CREATE INDEX idx_mv_ps_is_expired ON mv_patent_summary (is_expired);
  `;
}
```

---

## 7. Implementation Sequence & Dependencies

### Step 1: Add Registry Schema (Day 1)
- Add `AttributeDefinition` model to `schema.prisma`
- Run `prisma migrate dev --name add_attribute_registry`
- No existing code touched

### Step 2: Seed Registry (Day 1-2)
- Create `seed/registry-seed.ts` with all attribute definitions above
- Run seeder, verify with `SELECT * FROM attribute_definitions`
- Run `discoverUnregisteredEavFields()` to find any gaps
- Fill gaps in seed data

### Step 3: Introspection Service + Routes (Day 2-3)
- Create `IntrospectionService` 
- Add `/api/data/introspect`, `/api/data/stats`, `/api/data/unregistered-fields`
- Test from browser/curl — this becomes the Claude Code skill entry point
- Verify registry accurately describes the existing system

### Step 4: Taxonomy Analysis Service (Day 3-5)
- Create `TaxonomyAnalysisService`
- Start with `getCpcCountDistribution` and `getMultiSectorPotential`
- Add routes under `/api/analysis/taxonomy/*`
- Run analysis, capture results for design discussions
- Iterate on additional analysis methods as design questions arise

### Step 5: LLM Currency Analysis Service (Day 5-6)
- Create `LlmCurrencyAnalysisService`
- Start with `getModelDistribution`, `getTemplateVersionDistribution`, `getStalenessReport`
- This data feeds into versioning design decisions

### Step 6: Materialized View (Day 6-7)
- Generate `mv_patent_summary` from registry
- Create refresh function
- Wire into existing Patent Summary page as a **parallel** query path
  (feature-flagged — can compare old vs new query performance)
- Once verified, swap to primary

### Ongoing: Analysis-Driven Design
- Use taxonomy analysis results to design multi-classification approach
- Use LLM currency data to design revAIQ convention
- Use model comparison (when we run experiments) to design normalization strategies
- Feed all findings back into the registry and HMDA v2 architecture

---

## Appendix: What This Phase Does NOT Change

To be absolutely clear about safety — this phase:

- Does NOT modify any existing tables
- Does NOT change any existing service logic
- Does NOT change any existing API endpoints
- Does NOT change any UI behavior
- Does NOT require data migration

It ONLY adds:
- One new table (`attribute_definitions`)
- New read-only analysis services
- New REST endpoints under `/api/data/*` and `/api/analysis/*`
- An optional materialized view (feature-flagged)

The existing system continues to run exactly as it does today.
