# Schema Design: Portfolio Groups & Multi-Classification

**Status:** Draft (Revised)
**Created:** 2026-03-28
**Updated:** 2026-03-28
**Phase:** Schema Design
**Dependencies:** [SCHEMA_TAXONOMY_ABSTRACTION.md](./SCHEMA_TAXONOMY_ABSTRACTION.md)

---

## Overview

This document defines the schema for:

1. **Portfolio Groups** - Scoped collections of portfolios with shared analysis parameters
2. **Admin-Configurable Parameters** - Weights, thresholds, and rules per group
3. **Multi-Classification Support** - Multiple taxonomical associations per object
4. **Tiered Analysis Strategy** - Different settings for screening vs. deep analysis groups

**Note:** This design references the abstract taxonomy model defined in `SCHEMA_TAXONOMY_ABSTRACTION.md`. Classification entities use `TaxonomyNode` rather than hardcoded level names.

---

## Design Principles

1. **Additive/Non-Breaking** - New entities augment existing schema
2. **Taxonomy Agnostic** - Uses abstract `TaxonomyNode` references, not hardcoded levels
3. **Parameter Versioning** - Track config changes for audit/reproducibility
4. **Background Recalculation** - Settings changes trigger async recalculation jobs

---

## Entity Relationships

```
┌──────────────────┐     ┌───────────────────────┐
│   PortfolioGroup │────<│ PortfolioGroupMember  │
│                  │     │  (portfolio junction)  │
│  - name          │     └───────────┬───────────┘
│  - tier          │                 │
│  - config (Json) │                 v
│  - taxonomyTypeId│         ┌───────────────┐
└────────┬─────────┘         │   Portfolio   │
         │                   │   (existing)  │
         │                   └───────────────┘
         │
         │ owns classifications
         v
┌─────────────────────────┐        ┌─────────────────┐
│  ObjectClassification   │───────>│  TaxonomyNode   │
│                         │        │  (from abstract │
│  - portfolioGroupId     │        │   taxonomy)     │
│  - objectType           │        └─────────────────┘
│  - objectId             │
│  - taxonomyNodeId       │
│  - associationRank (1-N)│
│  - weight               │
└─────────────────────────┘
```

---

## Portfolio Group

The central entity replacing "global" taxonomy/settings.

```prisma
model PortfolioGroup {
  id              String   @id @default(cuid())

  // Identity
  name            String   @unique
  displayName     String   @map("display_name")
  description     String?

  // Which taxonomy this group uses
  taxonomyTypeId  String   @map("taxonomy_type_id")
  taxonomyType    TaxonomyType @relation(fields: [taxonomyTypeId], references: [id])

  // Tier for tiered analysis strategy
  tier            PortfolioGroupTier @default(STANDARD)

  // Analysis parameters (embedded JSON - see PortfolioGroupConfig)
  config          Json

  // Status
  status          PortfolioGroupStatus @default(ACTIVE)

  // Recalculation tracking
  lastRecalculatedAt DateTime? @map("last_recalculated_at")
  recalculationStatus RecalculationStatus? @map("recalculation_status")

  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  // Relations
  members         PortfolioGroupMember[]
  classifications ObjectClassification[]

  @@map("portfolio_groups")
  @@index([taxonomyTypeId])
  @@index([tier])
  @@index([status])
}

enum PortfolioGroupTier {
  SCREENING   // Large groups, standard settings (3 associations, standard LLM)
  STANDARD    // Default tier
  ELITE       // Small groups, enhanced settings (5+ associations, premium LLM)
  CUSTOM      // Custom configuration
}

enum PortfolioGroupStatus {
  ACTIVE
  ARCHIVED
  RECALCULATING
}

enum RecalculationStatus {
  PENDING
  IN_PROGRESS
  COMPLETE
  FAILED
}
```

---

## PortfolioGroupConfig (TypeScript Type)

Embedded in `PortfolioGroup.config` as JSON:

```typescript
interface PortfolioGroupConfig {
  // Association settings
  privilegedAssociationCount: number;  // Default: 3, Elite: 5

  // Source code weighting (for CPC-based taxonomies)
  inventiveSourceWeight: number;       // Default: 1.0
  additionalSourceWeight: number;      // Default: 0.3

  // Association rank weighting (for composite scoring)
  // Keys are rank numbers, not hardcoded names
  associationWeights: {
    [rank: number]: number;
    // 1: 1.0 (primary)
    // 2: 0.7 (secondary)
    // 3: 0.4 (tertiary)
    // 4: 0.2 (quaternary) - for elite groups
  };

  // Reinforcement when multiple sources map to same node
  reinforcementBonus: number;          // Default: 0.2

  // Node clustering (optional)
  clusteringEnabled: boolean;          // Default: false
  clusterThreshold: number;            // Default: 0.30 (Jaccard threshold)

  // LLM configuration
  llmModelTier: 'economy' | 'standard' | 'premium';
  llmQuestionsPerAssociation: number;  // Default: 3

  // Source code filter patterns (for CPC-based: indexing codes)
  sourceCodeFilterPatterns: string[];  // Default: ['^Y', '^[A-H]\\d{2}[A-Z]2\\d{3}']

  // Version for change tracking
  configVersion: number;
  configUpdatedAt: string;             // ISO timestamp
}
```

**Default Config:**

```json
{
  "privilegedAssociationCount": 3,
  "inventiveSourceWeight": 1.0,
  "additionalSourceWeight": 0.3,
  "associationWeights": {
    "1": 1.0,
    "2": 0.7,
    "3": 0.4
  },
  "reinforcementBonus": 0.2,
  "clusteringEnabled": false,
  "clusterThreshold": 0.30,
  "llmModelTier": "standard",
  "llmQuestionsPerAssociation": 3,
  "sourceCodeFilterPatterns": ["^Y", "^[A-H]\\d{2}[A-Z]2\\d{3}"],
  "configVersion": 1,
  "configUpdatedAt": "2026-03-28T00:00:00Z"
}
```

---

## PortfolioGroupMember

Junction table linking Portfolios to PortfolioGroups:

```prisma
model PortfolioGroupMember {
  id              String   @id @default(cuid())

  portfolioGroupId String  @map("portfolio_group_id")
  portfolioGroup  PortfolioGroup @relation(fields: [portfolioGroupId], references: [id], onDelete: Cascade)

  portfolioId     String   @map("portfolio_id")
  portfolio       Portfolio @relation(fields: [portfolioId], references: [id], onDelete: Cascade)

  // Member metadata
  addedAt         DateTime @default(now()) @map("added_at")
  addedBy         String?  @map("added_by")

  // Classification stats (cached)
  classifiedCount Int      @default(0) @map("classified_count")

  @@unique([portfolioGroupId, portfolioId])
  @@map("portfolio_group_members")
  @@index([portfolioGroupId])
  @@index([portfolioId])
}
```

---

## ObjectClassification

Multi-classification using abstract taxonomy model:

```prisma
model ObjectClassification {
  id                String   @id @default(cuid())

  // Scope: which portfolio group this classification belongs to
  portfolioGroupId  String   @map("portfolio_group_id")
  portfolioGroup    PortfolioGroup @relation(fields: [portfolioGroupId], references: [id], onDelete: Cascade)

  // Object being classified (polymorphic)
  objectType        String   @map("object_type")  // "patent", "product"
  objectId          String   @map("object_id")    // Patent ID, Product ID

  // Classification target (references abstract TaxonomyNode)
  taxonomyNodeId    String   @map("taxonomy_node_id")
  taxonomyNode      TaxonomyNode @relation(fields: [taxonomyNodeId], references: [id])

  // Privileged association rank (1=primary, 2=secondary, etc.)
  associationRank   Int      @map("association_rank")

  // Scoring/weighting
  weight            Float    @default(1.0)
  confidence        Float?

  // Provenance (for CPC-based: which CPC codes led here)
  sourceCodes       String[] @map("source_codes")
  inventiveSourceCount Int   @default(0) @map("inventive_source_count")

  // Assignment metadata
  assignedAt        DateTime @default(now()) @map("assigned_at")
  assignedBy        String   @map("assigned_by")  // "algorithm" or user ID

  // Config version for staleness detection
  configVersion     Int      @map("config_version")

  @@unique([portfolioGroupId, objectId, associationRank])
  @@map("object_classifications")
  @@index([portfolioGroupId])
  @@index([objectType, objectId])
  @@index([taxonomyNodeId])
  @@index([associationRank])
}
```

**Design Decisions:**

1. **Portfolio Group scoping**: Same object can have different classifications in different groups
2. **Rank-based uniqueness**: Each object has exactly one classification per rank per group
3. **Polymorphic object reference**: Supports patents, products, etc. via `objectType`/`objectId`
4. **Abstract taxonomy reference**: Uses `TaxonomyNode`, not hardcoded level names

---

## Pragmatic Fields on Patent

For query efficiency, Patent entity can have flattened fields (synced by hybrid layer):

```prisma
model Patent {
  // ... existing fields ...

  // Pragmatic classification fields (synced from ObjectClassification)
  // Use generic level names, not hardcoded "sector" terminology
  primaryLevel1       String?  @map("primary_level1")      // e.g., "VIDEO_STREAMING"
  primaryLevel2       String?  @map("primary_level2")      // e.g., "video-codec"
  primaryLevel3       String?  @map("primary_level3")      // e.g., "h264-encoding"

  primaryLevel1NodeId String?  @map("primary_level1_node_id")
  primaryLevel2NodeId String?  @map("primary_level2_node_id")
  primaryLevel3NodeId String?  @map("primary_level3_node_id")

  // Source code stats
  inventiveSourceCount   Int?   @map("inventive_source_count")
  additionalSourceCount  Int?   @map("additional_source_count")
  mappedSourceCount      Int?   @map("mapped_source_count")
  unmappedSourceCount    Int?   @map("unmapped_source_count")

  // Multi-classification indicators
  potentialNodeCount     Int?   @map("potential_node_count")
  crossLevel1            Boolean? @map("cross_level1")  // Maps to multiple level-1 nodes
}
```

**Note:** These fields are populated by the hybrid metadata layer from `ObjectClassification` data. They provide query efficiency without requiring joins.

---

## TaxonomyType Integration

The PortfolioGroup references a TaxonomyType:

```prisma
model TaxonomyType {
  // ... as defined in SCHEMA_TAXONOMY_ABSTRACTION.md ...

  // Relation
  portfolioGroups  PortfolioGroup[]
}
```

This allows:
- Different portfolio groups can use different taxonomies
- A patent portfolio group might use "patent-cpc-tech"
- A product portfolio group might use "product-market-segment"

---

## Migration from Current Schema

### Mapping Table

| Current Entity | New Entity | Migration Notes |
|----------------|------------|-----------------|
| `Patent.superSector` | `Patent.primaryLevel1` | Rename field |
| `Patent.primarySector` | `Patent.primaryLevel2` | Rename field |
| `Patent.primarySubSectorName` | `Patent.primaryLevel3` | Rename field |
| `Sector` | `TaxonomyNode` (level=2) | Add hierarchy fields |
| `SectorRule` | `TaxonomyRule` | Rename, add taxonomyTypeId |
| N/A (new) | `PortfolioGroup` | Create with default config |
| N/A (new) | `ObjectClassification` | Populate from existing assignments |

### Migration Steps

1. Create `TaxonomyType` for current CPC taxonomy
2. Create `TaxonomyNode` entries from SuperSector/Sector/SubSector
3. Create default `PortfolioGroup` with all current portfolios
4. Create `ObjectClassification` from existing patent→sector assignments
5. Rename pragmatic fields on Patent
6. Migrate `SectorRule` to `TaxonomyRule`

---

## API Considerations

### Admin Endpoints

```typescript
// Portfolio Group CRUD
POST   /api/admin/portfolio-groups
GET    /api/admin/portfolio-groups
GET    /api/admin/portfolio-groups/:id
PATCH  /api/admin/portfolio-groups/:id
DELETE /api/admin/portfolio-groups/:id

// Configuration updates (triggers recalculation)
PATCH  /api/admin/portfolio-groups/:id/config

// Membership
POST   /api/admin/portfolio-groups/:id/members
DELETE /api/admin/portfolio-groups/:id/members/:portfolioId

// Recalculation
POST   /api/admin/portfolio-groups/:id/recalculate
GET    /api/admin/portfolio-groups/:id/recalculation-status
```

---

## Tiered Analysis Strategy

**Problem:** 8% of high-value patents benefit from 4+ associations.

**Solution:** Tiered Portfolio Groups

```
Portfolio Group: "Broadcom & Competitors (Screening)"
├── ~100K patents
├── privilegedAssociationCount: 3
├── llmModelTier: "standard"
├── Purpose: Initial screening

Portfolio Group: "Broadcom Elite (Deep Analysis)"
├── ~2K patents (promoted from screening)
├── privilegedAssociationCount: 5
├── llmModelTier: "premium"
├── Additional LLM questions per association
```

**Workflow:**
1. Large portfolio enters screening group
2. Analysis identifies high-value patents
3. Promote best patents to elite group
4. Elite group has richer settings
5. Cycle continues as analysis narrows

---

## Open Questions

1. **Backward compatibility**: Keep `superSector`/`sector` field names during migration?
2. **View vs columns**: Use PostgreSQL views for pragmatic access?
3. **Cross-group classifications**: How to handle patent in multiple groups with different taxonomies?

---

## Next Steps

1. [ ] Finalize `SCHEMA_TAXONOMY_ABSTRACTION.md`
2. [ ] Create unified Prisma schema with both models
3. [ ] Write migration script
4. [ ] Build admin UI for group management

---

*Last Updated: 2026-03-28*
