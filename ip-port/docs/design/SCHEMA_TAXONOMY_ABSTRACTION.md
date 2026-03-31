# Schema Design: Abstract Taxonomy Model

**Status:** Draft
**Created:** 2026-03-28
**Phase:** Schema Design (Revision)

---

## Problem Statement

The current schema hardcodes taxonomy-specific terminology:
- `SuperSector`, `Sector`, `SubSector` - level names for ONE taxonomy
- `superSectorId`, `sectorId` - FK references assuming this structure
- `SectorRule` - naming assumes middle level of current taxonomy

This creates several limitations:
1. **Depth inflexibility** - Adding a 4th or 5th level requires new entities
2. **Label rigidity** - "super-sector" only makes sense for CPC-based tech classification
3. **Single object type** - Schema assumes patents; products would need different taxonomy
4. **Tight coupling** - Business logic coupled to taxonomy structure

---

## Design Principles

### 1. Abstract Level Names

Level labels are configuration, not schema:

| Current (Hardcoded) | Abstract (Configurable) |
|---------------------|------------------------|
| `superSector` | Level 1 with label "Super-Sector" |
| `sector` | Level 2 with label "Sector" |
| `subSector` | Level 3 with label "Sub-Sector" |

### 2. Taxonomy Type Metadata

Each taxonomy type defines:
- **Object type** it classifies (patent, product, company, etc.)
- **Maximum depth** (3, 4, 5 levels)
- **Level labels** (configurable per level)
- **Classification rules** (CPC-based, keyword-based, manual, etc.)

### 3. Pure vs Pragmatic Schema

| Aspect | Pure Form | Pragmatic Form |
|--------|-----------|----------------|
| **Structure** | Normalized, recursive hierarchy | Denormalized, flattened |
| **Flexibility** | Any depth, any labels | Fixed depth slots |
| **Query performance** | Requires joins/CTEs | Direct column access |
| **Use case** | Master data, flexibility | Filtering, indexing, APIs |

Both forms coexist; **hybrid metadata layer** syncs them.

### 4. Privileged Association Pattern

Same pattern applies to classifications:

| Pure Form | Pragmatic Form |
|-----------|----------------|
| N classifications with rank | `primaryClassification`, `secondaryClassification`, etc. |

---

## Abstract Taxonomy Model

### Core Entities

```
┌─────────────────────┐
│   TaxonomyType      │  Defines a classification system
│                     │
│ - name              │  e.g., "patent-cpc-tech", "product-market"
│ - objectType        │  "patent", "product", "company"
│ - maxDepth          │  3, 4, 5...
│ - levelLabels[]     │  ["Super-Sector", "Sector", "Sub-Sector"]
│ - ruleType          │  "cpc-based", "keyword", "manual"
└─────────┬───────────┘
          │ has many
          v
┌─────────────────────┐
│   TaxonomyNode      │  A node in the taxonomy tree
│                     │
│ - taxonomyTypeId    │
│ - parentId          │  Self-reference for hierarchy
│ - level             │  0, 1, 2... (depth in tree)
│ - code              │  Unique identifier within taxonomy
│ - name              │  Display name
│ - description       │
└─────────┬───────────┘
          │ classified by
          v
┌─────────────────────┐
│ ObjectClassification│  Links object to taxonomy node(s)
│                     │
│ - objectType        │  "patent", "product"
│ - objectId          │  Patent ID, Product ID
│ - taxonomyNodeId    │
│ - associationRank   │  1=primary, 2=secondary, etc.
│ - weight            │
│ - confidence        │
│ - sourceCodes[]     │  CPC codes that led to this
└─────────────────────┘
```

### TaxonomyType

Defines a classification system:

```typescript
interface TaxonomyType {
  id: string;
  name: string;              // "patent-cpc-tech", "product-market-segment"
  displayName: string;       // "Technology Classification", "Market Segments"
  description?: string;

  // What this taxonomy classifies
  objectType: 'patent' | 'product' | 'company' | 'claim';

  // Hierarchy configuration
  maxDepth: number;          // 3 for current, could be 4 or 5
  levelLabels: string[];     // ["Super-Sector", "Sector", "Sub-Sector"]

  // How classifications are determined
  ruleType: 'cpc-based' | 'keyword-based' | 'manual' | 'llm-inferred';

  // Optional: root node ID
  rootNodeId?: string;

  // Status
  isActive: boolean;
  isDefault: boolean;        // Default taxonomy for this object type

  version: number;
  createdAt: Date;
  updatedAt: Date;
}
```

**Example: Current CPC-based patent taxonomy**

```json
{
  "id": "tax_cpc_tech_v1",
  "name": "patent-cpc-tech",
  "displayName": "Technology Classification",
  "objectType": "patent",
  "maxDepth": 3,
  "levelLabels": ["Super-Sector", "Sector", "Sub-Sector"],
  "ruleType": "cpc-based",
  "isDefault": true,
  "version": 1
}
```

**Example: Future product taxonomy**

```json
{
  "id": "tax_product_market",
  "name": "product-market-segment",
  "displayName": "Market Segments",
  "objectType": "product",
  "maxDepth": 4,
  "levelLabels": ["Industry", "Segment", "Category", "Sub-Category"],
  "ruleType": "manual",
  "isDefault": true,
  "version": 1
}
```

### TaxonomyNode

A node in the taxonomy hierarchy:

```typescript
interface TaxonomyNode {
  id: string;
  taxonomyTypeId: string;

  // Hierarchy
  parentId?: string;         // null for root nodes
  level: number;             // 0=root, 1, 2, 3...
  path: string;              // Materialized path: "VIDEO_STREAMING/video-codec"

  // Identity
  code: string;              // Unique within taxonomy: "video-codec"
  name: string;              // Display: "Video Codec"
  description?: string;

  // Metadata (flexible JSON for taxonomy-specific data)
  metadata?: {
    cpcPrefixes?: string[];  // For CPC-based: ["H04N19", "H04N21/2"]
    damagesTier?: string;    // "High", "Medium", etc.
    damagesRating?: number;
    // ... extensible
  };

  // Stats (cached)
  childCount: number;
  objectCount: number;       // Patents/products classified here

  // Status
  isActive: boolean;

  createdAt: Date;
  updatedAt: Date;
}
```

### ObjectClassification

Links an object to taxonomy node(s):

```typescript
interface ObjectClassification {
  id: string;

  // Scoping
  portfolioGroupId?: string; // Optional: scoped to portfolio group

  // Object being classified
  objectType: 'patent' | 'product';
  objectId: string;          // Patent ID, Product ID

  // Classification target
  taxonomyNodeId: string;

  // Privileged association rank (1=primary, 2=secondary, etc.)
  associationRank: number;

  // Scoring
  weight: number;            // Computed weight
  confidence?: number;       // 0-1

  // Provenance
  sourceCodes?: string[];    // CPC codes that led to this
  inventiveSourceCount?: number;

  // Assignment metadata
  assignedBy: 'algorithm' | 'manual' | string;  // or user ID
  configVersion: number;     // For staleness detection

  assignedAt: Date;
}
```

---

## Pragmatic Schema Pattern

### Why Pragmatic Forms?

Pure hierarchical models require complex queries:
```sql
-- To filter patents by "sector" (level 2):
SELECT p.* FROM patents p
JOIN object_classifications oc ON oc.object_id = p.patent_id
JOIN taxonomy_nodes tn ON tn.id = oc.taxonomy_node_id
WHERE tn.level = 2 AND tn.code = 'video-codec';
```

Pragmatic flattened form:
```sql
-- Direct column access:
SELECT * FROM patents WHERE primary_level2 = 'video-codec';
```

### Pragmatic Patent Fields (Current Pattern)

```typescript
// On Patent entity - flattened for query efficiency
interface PatentPragmaticFields {
  // Primary classification at each level
  primaryLevel1?: string;     // Was: superSector
  primaryLevel2?: string;     // Was: primarySector
  primaryLevel3?: string;     // Was: primarySubSectorName

  // Node IDs for joins
  primaryLevel1NodeId?: string;
  primaryLevel2NodeId?: string;
  primaryLevel3NodeId?: string;

  // Secondary/tertiary (privileged associations)
  secondaryLevel2?: string;
  tertiaryLevel2?: string;

  // Full taxonomy node reference
  primaryTaxonomyNodeId?: string;
}
```

### Pragmatic View Alternative

Instead of duplicating data, use a view:

```sql
CREATE VIEW patent_classifications_flat AS
SELECT
  p.patent_id,
  -- Level 1 (was super-sector)
  l1.code as level1_code,
  l1.name as level1_name,
  -- Level 2 (was sector)
  l2.code as level2_code,
  l2.name as level2_name,
  -- Level 3 (was sub-sector)
  l3.code as level3_code,
  l3.name as level3_name,
  -- Association rank
  oc.association_rank
FROM patents p
JOIN object_classifications oc ON oc.object_id = p.patent_id
JOIN taxonomy_nodes l3 ON l3.id = oc.taxonomy_node_id
LEFT JOIN taxonomy_nodes l2 ON l2.id = l3.parent_id
LEFT JOIN taxonomy_nodes l1 ON l1.id = l2.parent_id
WHERE oc.association_rank <= 3;  -- Privileged only
```

### Hybrid Metadata Layer

The layer manages:
1. **Sync on classification change** - Update pragmatic fields when ObjectClassification changes
2. **Bulk refresh** - Rebuild pragmatic data from pure source
3. **View refresh** - Refresh materialized views if used
4. **Staleness detection** - Flag pragmatic data needing refresh

---

## Classification Rules

### Abstract Rule Model

Replace `SectorRule` with `TaxonomyRule`:

```typescript
interface TaxonomyRule {
  id: string;

  // What taxonomy and node this rule targets
  taxonomyTypeId: string;
  targetNodeId: string;      // Node to classify into

  // Rule definition
  ruleType: 'cpc-prefix' | 'cpc-subgroup' | 'keyword' | 'phrase' | 'boolean';
  expression: string;        // The match expression

  // Priority and scope
  priority: number;          // Higher = evaluated first
  isExclusion: boolean;      // Exclude rather than include

  scope: 'global' | 'portfolio-group';
  portfolioGroupId?: string;

  // Status
  isActive: boolean;
  matchCount: number;        // Cached

  description?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## Portfolio Group Integration

### Config with Abstract Taxonomy References

```typescript
interface PortfolioGroupConfig {
  // Which taxonomy to use
  taxonomyTypeId: string;    // Reference to TaxonomyType

  // Association settings
  privilegedAssociationCount: number;  // Default: 3

  // Weighting (generic, not tied to level names)
  inventiveSourceWeight: number;
  additionalSourceWeight: number;
  associationWeights: {
    [rank: number]: number;  // { 1: 1.0, 2: 0.7, 3: 0.4 }
  };

  // ... other config
}
```

---

## Migration Strategy

### Option A: Parallel Schema (Recommended)

1. Create new abstract tables alongside existing
2. Migrate data: `Sector` → `TaxonomyNode` (level=2)
3. Create `TaxonomyType` record for current CPC taxonomy
4. Migrate `SectorRule` → `TaxonomyRule`
5. Update application code to use new entities
6. Deprecate old tables after validation

### Option B: In-Place Rename

1. Rename `Sector` → `TaxonomyNode`
2. Add `taxonomyTypeId`, `level`, `path` columns
3. Backfill data
4. Create `TaxonomyType` record

### Data Migration Map

| Old Entity | New Entity | Notes |
|------------|------------|-------|
| `SuperSector` | `TaxonomyNode` (level=1) | Merge into single hierarchy |
| `Sector` | `TaxonomyNode` (level=2) | Add parent reference |
| `SubSector` | `TaxonomyNode` (level=3) | Add parent reference |
| `SectorRule` | `TaxonomyRule` | Rename, add taxonomyTypeId |
| `Patent.superSector` | `Patent.primaryLevel1` | Or remove, use view |
| `Patent.primarySector` | `Patent.primaryLevel2` | Or remove, use view |

---

## Prisma Schema Sketch

```prisma
// =============================================================================
// ABSTRACT TAXONOMY MODEL
// =============================================================================

model TaxonomyType {
  id            String   @id @default(cuid())

  name          String   @unique  // "patent-cpc-tech"
  displayName   String   @map("display_name")
  description   String?

  objectType    String   @map("object_type")  // "patent", "product"
  maxDepth      Int      @map("max_depth")
  levelLabels   String[] @map("level_labels")  // ["Super-Sector", "Sector", ...]
  ruleType      String   @map("rule_type")  // "cpc-based", "keyword", "manual"

  isActive      Boolean  @default(true) @map("is_active")
  isDefault     Boolean  @default(false) @map("is_default")
  version       Int      @default(1)

  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  nodes         TaxonomyNode[]
  rules         TaxonomyRule[]

  @@map("taxonomy_types")
  @@index([objectType])
  @@index([isDefault])
}

model TaxonomyNode {
  id              String   @id @default(cuid())

  taxonomyTypeId  String   @map("taxonomy_type_id")
  taxonomyType    TaxonomyType @relation(fields: [taxonomyTypeId], references: [id])

  parentId        String?  @map("parent_id")
  parent          TaxonomyNode? @relation("NodeHierarchy", fields: [parentId], references: [id])
  children        TaxonomyNode[] @relation("NodeHierarchy")

  level           Int      // 0=root, 1, 2, 3...
  path            String   // Materialized path

  code            String   // Unique identifier
  name            String   // Display name
  description     String?

  metadata        Json?    // Extensible: cpcPrefixes, damagesTier, etc.

  childCount      Int      @default(0) @map("child_count")
  objectCount     Int      @default(0) @map("object_count")

  isActive        Boolean  @default(true) @map("is_active")

  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  classifications ObjectClassification[]
  rules           TaxonomyRule[]

  @@unique([taxonomyTypeId, code])
  @@map("taxonomy_nodes")
  @@index([taxonomyTypeId])
  @@index([parentId])
  @@index([level])
  @@index([path])
}

model ObjectClassification {
  id                String   @id @default(cuid())

  portfolioGroupId  String?  @map("portfolio_group_id")
  portfolioGroup    PortfolioGroup? @relation(fields: [portfolioGroupId], references: [id])

  objectType        String   @map("object_type")  // "patent", "product"
  objectId          String   @map("object_id")

  taxonomyNodeId    String   @map("taxonomy_node_id")
  taxonomyNode      TaxonomyNode @relation(fields: [taxonomyNodeId], references: [id])

  associationRank   Int      @map("association_rank")  // 1=primary, 2=secondary...

  weight            Float    @default(1.0)
  confidence        Float?

  sourceCodes       String[] @map("source_codes")
  inventiveSourceCount Int   @default(0) @map("inventive_source_count")

  assignedBy        String   @map("assigned_by")  // "algorithm" or user ID
  configVersion     Int      @map("config_version")

  assignedAt        DateTime @default(now()) @map("assigned_at")

  @@unique([portfolioGroupId, objectId, associationRank])
  @@map("object_classifications")
  @@index([portfolioGroupId])
  @@index([objectType, objectId])
  @@index([taxonomyNodeId])
  @@index([associationRank])
}

model TaxonomyRule {
  id              String   @id @default(cuid())

  taxonomyTypeId  String   @map("taxonomy_type_id")
  taxonomyType    TaxonomyType @relation(fields: [taxonomyTypeId], references: [id])

  targetNodeId    String   @map("target_node_id")
  targetNode      TaxonomyNode @relation(fields: [targetNodeId], references: [id])

  ruleType        String   @map("rule_type")  // cpc-prefix, keyword, etc.
  expression      String

  priority        Int      @default(0)
  isExclusion     Boolean  @default(false) @map("is_exclusion")

  scope           String   @default("global")  // "global", "portfolio-group"
  portfolioGroupId String? @map("portfolio_group_id")

  isActive        Boolean  @default(true) @map("is_active")
  matchCount      Int      @default(0) @map("match_count")
  description     String?

  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@map("taxonomy_rules")
  @@index([taxonomyTypeId])
  @@index([targetNodeId])
  @@index([scope, portfolioGroupId])
}
```

---

## Open Questions

1. **Pragmatic field naming**: Use `primaryLevel1` / `primaryLevel2` or keep `superSector` / `sector` for backward compatibility during migration?

2. **View vs materialized data**: Use PostgreSQL views for pragmatic access or maintain redundant columns with sync?

3. **CpcCode table**: Keep as separate entity or merge metadata into TaxonomyNode?

4. **Existing ScoringTemplate bindings**: Currently reference `superSectorId`, `sectorId`, `subSectorId` - migrate to `taxonomyNodeId` at appropriate level?

---

## Next Steps

1. [ ] Review and finalize abstract model
2. [ ] Decide on pragmatic implementation (views vs columns)
3. [ ] Create Prisma migration for new entities
4. [ ] Write data migration script
5. [ ] Update application code to use abstract model

---

*Last Updated: 2026-03-28*
