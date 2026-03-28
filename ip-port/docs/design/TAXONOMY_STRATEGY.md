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

## Naming Convention (Delimited Prefixes, Globally Unique)

Each node has a **slug** (human-readable name) and an **abbreviation** (for building prefix chains). The code format keeps the current level's full slug at the end for readability, with parent abbreviations as the prefix.

### Structure
| Level | Slug | Abbreviation | Code |
|-------|------|--------------|------|
| 1 | networking | NET | `networking` |
| 2 | switching | SWIT | `NET/switching` |
| 3 | sdn-control | SDNCT | `NET/SWIT/sdn-control` |
| 4 | algorithms | ALGOR | `NET/SWIT/SDNCT/algorithms` |
| 5 | ip-distribution | IPDST | `NET/SWIT/SDNCT/ALGOR/ip-distribution` |

### Code Format
```
Level 1: {slug}
  networking
  computing
  wireless

Level 2: {L1_ABBREV}/{slug}
  NET/switching
  NET/protocols
  CMP/computing-ui

Level 3: {L1_ABBREV}/{L2_ABBREV}/{slug}
  NET/SWIT/sdn-control
  NET/SWIT/layer2-switching
  NET/PROT/tcp-optimization

Level 4+: {parent_abbrev_chain}/{slug}
  NET/SWIT/SDNCT/algorithms
  NET/SWIT/SDNCT/ALGOR/ip-distribution
```

### Abbreviation Guidelines
- **L1**: 3 letters (NET, CMP, WRL, IMG, SEC)
- **L2+**: 4-5 letters, no strict length constraint
- **Uniqueness**: Must be unique within the level (GUI can auto-suggest)
- **Readable**: Abbreviation should be recognizable from slug

### Benefits
- **Readable codes** - Full slug at end makes filtering intuitive
- **Globally unique** - Prefix chain prevents collisions
- **Scalable** - Works cleanly for 5+ level hierarchies
- **Parseable** - Split on `/` to get hierarchy; last element is slug
- **Mouse-over friendly** - Can show full hierarchy on hover

### Parsing Example
```typescript
const code = "NET/SWIT/sdn-control";
const parts = code.split("/");
// parts = ["NET", "SWIT", "sdn-control"]
// Parent abbrevs: ["NET", "SWIT"]
// Current slug: "sdn-control"

// To get full path, look up each abbrev's slug:
// NET -> "networking", SWIT -> "switching"
// Full path: networking > switching > sdn-control
```

### Storage
- `code`: Full prefixed code (e.g., `NET/SWIT/sdn-control`)
- `name`: Human-readable display name (e.g., "SDN Control Plane")
- `abbreviation`: This node's abbreviation (e.g., `SDNCT`) - stored for building child prefixes
- Abbreviation uniqueness enforced at each level within parent

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
