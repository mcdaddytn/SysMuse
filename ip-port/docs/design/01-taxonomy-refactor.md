# 01 — Taxonomy & Classification

## Current State

The system uses a three-level hierarchy: super-sector (12) → sector (64) → sub-sector (~250+). Each patent has a single primary classification denormalized on the Patent model (`superSector`, `primarySector`, `primarySubSectorName`). Classification is driven by CPC-prefix matching rules stored in the `SectorRule` table, with the first matching rule winning.

Current schema entities: `SuperSector`, `Sector`, `SubSector`, `SectorRule`, `PatentCpc`, `CpcCode`.

Current statistics (84K patents): COMPUTING 25%, WIRELESS 18%, SEMICONDUCTOR 16%, NETWORKING 16%, SECURITY 10%, VIDEO_STREAMING 8%, IMAGING 6%, UNCLASSIFIED <1%, AI_ML <1%.

## Problems with Current Approach

1. **Single classification per patent**: Each patent maps to exactly one sector, but patents typically have 5-15 CPC codes spanning multiple technology areas. A patent with CPC codes for both video codecs and wireless transmission is forced into one sector, losing the other dimension.

2. **Rule conflicts are hidden**: When multiple sector rules match a patent's CPC codes, the first match wins silently. There is no visibility into which patents have ambiguous classification or how many rules conflict.

3. **Taxonomy is global**: The same super-sector/sector/sub-sector structure applies to all portfolios, but a semiconductor company and a software company have fundamentally different technology distributions. Portfolio-specific rules exist but are rarely used.

4. **Rigid hierarchy**: The three-level structure is hardcoded. Some technology areas need deeper granularity (e.g., networking protocols) while others are adequately described at two levels.

5. **Denormalized classification fields on Patent**: `superSector`, `primarySector`, `primarySubSectorName` must be updated whenever taxonomy changes, creating maintenance burden and staleness risk.

## Analysis-First Approach

Before committing to schema changes, the Taxonomy Analysis Service (`taxonomy-analysis-service-detail.md`) provides seven analysis modules to answer key design questions with data:

| Module | Question Answered |
|--------|-------------------|
| CPC Distribution | How many CPC codes per patent? What's the coverage? |
| Classification Coverage | What % classified? Where are gaps? |
| Multi-Classification Potential | How many patents map to 2+ sectors via their CPCs? |
| Classification Confidence | How unambiguous are current assignments? |
| Portfolio Comparison | Do portfolios need different taxonomies? |
| Sector Balance | Which sectors are over/undersized? Where to split? |
| Rule Effectiveness | Which rules conflict? Which are dead? |

**The results of these analyses determine the specific changes in Phase 3.** The schema design below supports the general case, but implementation priorities depend on what the data shows.

## Proposed Changes

### Multiple Taxonomy Associations

The core change: a patent can have multiple sector associations, ranked by strength. This replaces the single denormalized field with a join table.

```prisma
// NEW: Patent-to-taxonomy association (replaces denormalized fields)
model PatentTaxonomyAssociation {
  id              String   @id @default(cuid())

  patentId        String   @map("patent_id")
  
  // Which taxonomy level this associates to
  superSectorId   String?  @map("super_sector_id")
  sectorId        String?  @map("sector_id")
  subSectorId     String?  @map("sub_sector_id")

  // Association type
  rank            Int      @default(1)    // 1=primary, 2=secondary, 3=tertiary
  
  // How this association was determined
  source          ClassificationSource @default(CPC_RULE)
  confidence      Float?               // 0-1, from classification confidence scoring
  
  // Which CPC codes support this association
  supportingCpcCodes String[] @map("supporting_cpc_codes")
  supportingCpcCount Int     @default(0) @map("supporting_cpc_count")
  
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@unique([patentId, sectorId, rank])
  @@map("patent_taxonomy_associations")
  @@index([patentId])
  @@index([sectorId])
  @@index([superSectorId])
  @@index([rank])
}

enum ClassificationSource {
  CPC_RULE        // Matched by sector rule
  LLM_SUGGESTED   // LLM recommended this classification
  USER_OVERRIDE   // Manual user assignment
  INHERITED       // Inherited from patent family
}
```

**Migration strategy**: The existing denormalized fields (`superSector`, `primarySector`, `primarySubSectorName`) remain on the Patent model for the fast display path. The new association table is populated alongside them. Existing queries continue to use the denormalized fields; new queries can use the association table for multi-classification views.

**System limit on associations**: Configurable in admin settings (initially read-only). Default: 3 associations per patent (primary, secondary, tertiary). The multi-classification analysis module reveals how many are actually needed before we commit.

### Classification Confidence Scoring

Each patent gets a confidence assessment of its classification:

- **High** (≥70% of CPC codes point to one sector): Unambiguous assignment
- **Medium** (40-70%): Reasonable primary, potential secondary
- **Low** (<40%): Weak primary, needs review
- **Ambiguous**: Multiple sectors tied

This is computed by the Taxonomy Analysis Service and can be stored in the association table's `confidence` field. It informs which patents need human review and which can be auto-classified.

### Attribute Registry Integration

All taxonomy fields are registered in the Attribute Registry (`hmda-v2-phase1-implementation.md`, Section 2.2):

```
super_sector       → POSTGRES, patents.super_sector (current denormalized)
primary_sector     → POSTGRES, patents.primary_sector (current denormalized)
primary_sub_sector → POSTGRES, patents.primary_sub_sector_name (current denormalized)
```

When multi-classification is implemented, new registry entries will point to the association table with join clauses for primary, secondary, and tertiary classifications.

### Question Inheritance Through Taxonomy

Structured LLM questions inherit down the taxonomy hierarchy:

```
Portfolio Questions (asked of all patents)
  └── Super-Sector Questions (inherit portfolio + add sector-specific)
      └── Sector Questions (inherit above + add finer detail)
          └── Sub-Sector Questions (inherit above + most specific)
```

Each level can override inherited questions by matching `fieldName`, or extend them with append/prepend text for context customization. This is already implemented via `ScoringTemplate.inheritsFromId` and the inheritance chain.

**Multiple associations implication**: When a patent has primary (video-codec) and secondary (wireless-transmission) classifications, its LLM question set is the union of questions from both paths through the hierarchy. This maximizes the value of each LLM call by asking all relevant questions in one batch.

### Taxonomy Generalization (Future)

The current super-sector/sector/sub-sector naming is just one instance of a hierarchical taxonomy. The architecture supports:

- **Multiple taxonomy types**: A patent could be classified in a technology taxonomy AND a market-segment taxonomy independently.
- **Variable depth**: Some taxonomies have 2 levels, others have 4+.
- **Multiple entity types**: Products, companies, and documents could have their own taxonomy associations using the same pattern.

These capabilities are designed into the schema but not implemented in initial phases. The `PatentTaxonomyAssociation` model already accommodates this by allowing different sector hierarchies to coexist.

## Sector Rule Engine

### Current Rules

Rules live in the `SectorRule` table with types: `CPC_PREFIX`, `CPC_SUBGROUP`, `KEYWORD`, `PHRASE`, `KEYWORD_AND`, `BOOLEAN`. Each rule has a priority and can be scoped to LIBRARY (global) or PORTFOLIO (portfolio-specific).

### Rule Improvements Needed

Based on the Rule Effectiveness analysis module:

1. **Conflict visibility**: Surface which rules match the same patents for different sectors. Currently conflicts are hidden — the first rule match wins.
2. **Coverage gaps**: Identify CPC codes present in the data that no rule matches.
3. **Dead rule cleanup**: Rules that match zero patents should be flagged for review.
4. **Promotion workflow**: Portfolio-specific rules that prove effective can be promoted to library scope. The `promotedFrom`/`promotedAt` fields exist but the workflow isn't built.

### Classification Algorithm Enhancement

Current: First matching CPC_PREFIX rule wins, checked against primary CPC only.

Proposed: Evaluate ALL rules against ALL CPC codes per patent. Score each potential sector by the number and quality (inventive vs. non-inventive) of matching CPC codes. Assign primary classification to the highest-scoring sector, secondary to the next, etc.

```typescript
// Simplified classification scoring per sector
sectorScore = (inventiveMatchCount * 2 + nonInventiveMatchCount) / totalCpcCodes
```

This produces the `confidence` field and naturally supports multiple associations.

## Data Model Changes

### New Tables (Phase 3)
- `PatentTaxonomyAssociation` — multi-classification join table (schema above)

### Modified Tables (Phase 3)
- None modified — existing denormalized fields kept for backward compatibility

### Registry Entries (Phase 1)
- Taxonomy fields registered in `attribute_definitions` (already designed in Phase 1 seed)

## CPC Hierarchy Navigation

The CPC Hierarchy Analysis module (Module 7 of taxonomy analysis) provides drill-down into CPC trees. This is essential for:

- **Sector splitting**: Finding natural CPC boundaries to split oversized sectors
- **Sub-sector generation**: Identifying CPC groups with enough patents to warrant sub-sectors
- **Rule creation**: Understanding which CPC prefixes to use for new or refined rules

The service endpoint `GET /api/analysis/taxonomy/cpc-hierarchy/:rootCode` returns a tree of CPC codes under any prefix with patent counts at each level.

## Implementation Phases

### Phase 1 (Current — No Schema Changes)
- Deploy Taxonomy Analysis Service (7 modules)
- Run analysis playbook, capture results
- Register taxonomy fields in Attribute Registry
- Identify specific multi-classification and balance issues

### Phase 2 (After Analysis)
- Create `PatentTaxonomyAssociation` table
- Populate from existing denormalized fields (all rank=1)
- Enhance classification algorithm to populate rank 2-3 associations
- Add classification confidence scoring

### Phase 3 (After Scoring Refactor)
- Wire multi-classification into scoring templates (union of questions)
- Update enrichment to use multi-classification for LLM question batching
- Taxonomy Management GUI enhancements

## Open Questions

- **How many associations per patent?** The multi-classification analysis module will show the distribution. Current hypothesis: primary + secondary covers 90%+ of cases. TBD based on data.
- **Universal vs. portfolio-specific taxonomy?** The portfolio comparison analysis will show CPC divergence. If Jaccard similarity is high across portfolios, one taxonomy works. If low, portfolio-specific rule weights may be needed.
- **Should we use inventive CPC codes differently?** Inventive CPCs may be better indicators of a patent's primary technology area. The analysis distinguishes inventive vs. non-inventive counts.
- **Taxonomy naming**: Current names (super-sector, sector, sub-sector) are specific. Should we rename to generic terms (level-1, level-2, level-3) or keep domain-specific names? Keeping current names for now — renaming is cosmetic and low priority.
- **Cross-taxonomy scoring**: When a patent has classifications in two sectors, does it appear in scoring for both? How do sector-level scores compose? This depends on Phase 2 scoring generalization.
