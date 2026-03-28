# Taxonomy Strategy & Design Principles

## Current State Analysis (v1 - March 2026)

### Structure
| Level | Name | Count | Description |
|-------|------|-------|-------------|
| 1 | Super-sectors | 12 | High-level domains (NETWORKING, COMPUTING, etc.) |
| 2 | Sectors | 64 | Mid-level groupings (network-switching, computing-os-security) |
| 3 | Sub-sectors | 31,025 | **Individual CPC codes** |

### Problem
The current taxonomy has level 3 = individual CPC codes, which is:
- **Too granular** - 31K "sub-sectors" defeats the purpose of clustering
- **Not useful for classification** - All 188 rules target level 2
- **Inflexible** - Sub-sectors should be logical groupings, not CPC codes

### Current Rule System
- 188 TaxonomyRules, all targeting level 2 (sectors)
- Rules use CPC patterns (prefix matching) to map CPCs to sectors
- Level 3 nodes exist only as CPC code storage, not classification targets

---

## Design Principles (v2 - Target Architecture)

### Core Principle: Logical Groupings, Not CPC Hierarchy

Our taxonomy is **not constrained to CPC hierarchy levels**. Instead:

1. **Each taxonomy level is a logical grouping** chosen for analytical utility
2. **Rules can use any CPC pattern** at any taxonomy level
3. **Lower levels inherit parent constraints** - a sub-sector's patterns must be subsets of its parent sector's patterns
4. **Cluster sizes should be reasonable** - configurable targets guide automated refactoring

### Hierarchy Constraint Model

```
Super-sector (L1):  CPC patterns [H04L*, G06F*]
    ↓
Sector (L2):        CPC patterns [H04L45*, H04L49*]  ← must be subset of parent
    ↓
Sub-sector (L3):    CPC patterns [H04L45/0*, H04L45/1*]  ← must be subset of parent
```

**Key insight**: Sub-sectors can map to MULTIPLE CPC patterns, not just one CPC code.

---

## Taxonomy Level Metadata

Each TaxonomyType defines level metadata including target sizing:

```typescript
interface TaxonomyLevelMetadata {
  level: number;
  name: string;           // "Super-sector", "Sector", "Sub-sector"
  prefix: string;         // Abbreviation for naming convention

  // Target sizing (for automated refactoring guidance)
  targetCount?: {
    min: number;          // e.g., 10 super-sectors minimum
    max: number;          // e.g., 15 super-sectors maximum
  };
  targetClusterSize?: {
    min: number;          // e.g., 50 patents minimum per sub-sector
    max: number;          // e.g., 2000 patents maximum per sub-sector
    optimal: number;      // e.g., 200-500 patents ideal
  };
  targetPortfolioPercent?: {
    min: number;          // e.g., each sector should have ≥1% of portfolio
    max: number;          // e.g., no sector should exceed 15% of portfolio
  };
}
```

### v2 Target Configuration

| Level | Name | Target Count | Target Cluster Size | Notes |
|-------|------|--------------|---------------------|-------|
| 1 | Super-sector | 10-15 | 5,000-15,000 | Broad domains |
| 2 | Sector | 50-80 | 500-3,000 | Major tech areas |
| 3 | Sub-sector | 200-500 | 50-500 | Specific clusters |

These targets are **suggestions for automated refactoring tools**, not hard constraints. Analysis scripts can flag clusters that are undersized (merge candidates) or oversized (split candidates).

---

## Naming Convention (Prefixed, Globally Unique)

Per `01-taxonomy-refactor.md`, use abbreviated prefixes that compound at each level:

### Level Prefixes
```
Super-sector → 3-letter code
  COMPUTING  → CMP
  WIRELESS   → WRL
  NETWORKING → NET
  IMAGING    → IMG
  SECURITY   → SEC
  etc.
```

### Node Naming Pattern
```
Level 1: {CODE}
  NET (Networking)
  CMP (Computing)

Level 2: {PARENT_PREFIX}/{sector-slug}
  NET/switching
  NET/protocols
  CMP/computing-ui
  CMP/computing-runtime

Level 3: {PARENT_PREFIX_COMPOUND}/{subsector-slug}
  NETSW/layer2-switching     (NET + SW from "switching")
  NETSW/sdn-control
  NETPR/tcp-optimization     (NET + PR from "protocols")
  CMPUI/displays
```

### Benefits
- **Globally unique** - "displays" under COMPUTING is `CMPUI/displays`, under IMAGING is `IMGPR/displays`
- **Compact** - Abbreviated prefixes keep names manageable
- **Filter-friendly** - UI can filter by prefix without showing full hierarchy
- **Parseable** - Can extract parent relationship from prefix

### Storage
- Database stores the prefixed `code` as the unique identifier
- `name` field stores human-readable display name
- Prefix convention is defined in TaxonomyType level metadata

---

## Default Taxonomy Selection

The system supports multiple taxonomy versions running in parallel:

```typescript
interface TaxonomyType {
  id: string;
  code: string;           // 'patent-classification-v1', 'patent-classification-v2'
  name: string;
  isDefault: boolean;     // Only one can be default at a time
  levelMetadata: TaxonomyLevelMetadata[];
  // ...
}
```

### Behavior
- **Default taxonomy** is used by:
  - GUI filters and displays
  - API queries without explicit taxonomy parameter
  - New patent classification

- **Non-default taxonomies** remain accessible for:
  - Historical comparison
  - Regression testing
  - Parallel analysis

### Switching Default
```
POST /api/admin/taxonomy/:typeId/set-default
```
- Validates taxonomy has classifications
- Updates `isDefault` flags
- Triggers cache invalidation for GUI

---

## Migration Strategy

### Phase 1: Preserve v1 for Regression Testing
- Keep current taxonomy (v1) intact
- All existing data, rules, classifications remain
- Use as baseline for validating v2 results

### Phase 2: Design v2 Taxonomy
- Create new TaxonomyType `patent-classification-v2`
- Design logical sub-sectors (target: 200-500 sub-sectors, not 31K)
- Each sub-sector maps to multiple CPC patterns
- Apply naming convention with prefixes

### Phase 3: Parallel Classification
- Run both v1 and v2 classification in parallel
- Compare results for coverage and divergence
- Validate that v2 captures same patents with better granularity

### Phase 4: Transition
- Set v2 as default taxonomy
- Keep v1 available for historical comparison
- Update enrichment pipeline for v2 structure

---

## Service Layer Requirements

Before v2, build services to understand the data:

### TaxonomyAnalysisService
```typescript
// CPC distribution within a sector
analyzeCpcDistribution(sectorId: string): CpcDistributionReport

// Suggest sub-sector boundaries based on clustering
suggestSubsectorBoundaries(sectorId: string, targetCount: number): SubsectorSuggestion[]

// Validate naming convention compliance
validateNamingConvention(taxonomyTypeId: string): ValidationReport

// Compare coverage between taxonomies
compareTaxonomyCoverage(v1TypeId: string, v2TypeId: string): CoverageComparison
```

### CrossClassificationQueryService
```typescript
// Find patents by secondary/tertiary associations
findByAssociation(params: {
  taxonomyNodeId: string;
  associationRanks?: number[];  // [1,2,3] or [2,3] for non-primary only
  minConfidence?: number;
}): Patent[]

// Find patents spanning multiple super-sectors
findCrossDomain(params: {
  superSectorIds: string[];     // Must span ALL of these
  associationRanks?: number[];
}): Patent[]
```

---

## Future Considerations

When implementing v2 fully:

1. **Structured Questions** - May need new questions tailored to sub-sector granularity
2. **Snapshots** - Score snapshots should track taxonomy version used
3. **Enrichment Pipeline** - LLM scoring across all taxonomical associations
4. **Model Tiers** - Use cheaper models for broad runs, expensive for top patents
5. **Incremental Rollout** - Can design one super-sector at a time as pilot

---

## Implementation Plan

### Immediate (Service Layer)
- [ ] Cross-classification query endpoints
- [ ] Taxonomy analysis service (CPC distribution, cluster sizing)
- [ ] Naming convention validator

### v2 Pilot
- [ ] Pick one super-sector for pilot (suggest: NETWORKING)
- [ ] Design sub-sector structure with new naming convention
- [ ] Create v2 TaxonomyType with level metadata
- [ ] Import pilot nodes and rules
- [ ] Run parallel classification and compare

### Infrastructure
- [ ] Default taxonomy selection API
- [ ] GUI taxonomy switcher
- [ ] Background recalculation job system

---

## Open Questions

1. **Sector boundaries**: Should v2 have the same 64 sectors, or also refactor L2?
2. **Catch-all handling**: Each level needs a "General" node for unmatched patents
3. **Abbreviation collisions**: How to handle if sector slugs produce same 2-letter prefix?
4. **Incremental migration**: Can we migrate super-sectors one at a time?

---

*Created: 2026-03-28*
*Updated: 2026-03-28 (naming convention, level metadata, default taxonomy)*
*Status: Design Phase*
