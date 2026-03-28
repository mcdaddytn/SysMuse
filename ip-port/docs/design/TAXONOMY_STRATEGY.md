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
4. **Cluster sizes should be reasonable** - each sub-sector should contain enough patents for meaningful analysis

### Hierarchy Constraint Model

```
Super-sector (L1):  CPC patterns [H04L*, G06F*]
    ↓
Sector (L2):        CPC patterns [H04L45*, H04L49*]  ← must be subset of parent
    ↓
Sub-sector (L3):    CPC patterns [H04L45/0*, H04L45/1*]  ← must be subset of parent
```

**Key insight**: Sub-sectors can map to MULTIPLE CPC patterns, not just one CPC code.

### Naming Convention

To ensure uniqueness and enable filtering, all nodes use prefixed naming:

```
Level 1: {SUPER_SECTOR}
Level 2: {super_sector}-{sector}
Level 3: {super_sector}-{sector}-{subsector}

Examples:
  NETWORKING
  NETWORKING-switching
  NETWORKING-switching-layer2
  NETWORKING-switching-layer3-routing
```

Benefits:
- **Unique names** across entire taxonomy
- **Hierarchical parsing** - can extract parent from child name
- **Filter-friendly** - UI can filter by prefix patterns

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
- Once validated, make v2 the primary taxonomy
- Keep v1 available for historical comparison

---

## v2 Sub-sector Design Guidelines

### Target Structure
| Level | Target Count | Purpose |
|-------|--------------|---------|
| L1 Super-sectors | 10-15 | High-level domains |
| L2 Sectors | 50-80 | Major technology areas |
| L3 Sub-sectors | 200-500 | Specific technology clusters |

### Sub-sector Sizing
- **Minimum**: 50 patents (avoid over-fragmentation)
- **Maximum**: 2,000 patents (avoid catch-all buckets)
- **Optimal**: 200-500 patents per sub-sector

### Rule Design
Each sub-sector should have:
1. **Primary patterns** - CPC prefixes that strongly indicate this sub-sector
2. **Exclusion patterns** - CPCs that should NOT map here (handled by exclusion rules)
3. **Priority weighting** - Higher priority for more specific patterns

Example:
```
Sub-sector: NETWORKING-switching-sdn
Primary patterns: H04L41/0803, H04L41/0816, H04L41/0893
Exclusion: None (parent sector handles)
Description: Software-defined networking control plane
```

---

## Implementation Plan

### Schema Changes
None required - the abstract taxonomy model already supports this:
- `TaxonomyType` - create `patent-classification-v2`
- `TaxonomyNode` - create new nodes with prefixed codes
- `TaxonomyRule` - create rules targeting L3 nodes

### New Components Needed

1. **Taxonomy Design Tool** (scripts)
   - Analyze CPC distribution within sectors
   - Suggest sub-sector boundaries based on clustering
   - Generate rule candidates

2. **Naming Convention Validator**
   - Ensure all codes follow `{parent}-{name}` pattern
   - Validate uniqueness across taxonomy

3. **Coverage Analyzer**
   - Compare v1 vs v2 classification coverage
   - Identify patents that change classification
   - Flag potential issues (orphans, collisions)

### API Endpoints (Future)

```
GET /api/taxonomy/types
GET /api/taxonomy/:typeId/nodes
GET /api/taxonomy/:typeId/rules
POST /api/admin/taxonomy/:typeId/validate
POST /api/admin/taxonomy/:typeId/analyze-coverage
```

---

## Open Questions

1. **Sector boundaries**: Should v2 have the same 64 sectors, or should we also refactor L2?
2. **Catch-all handling**: How to handle CPCs that don't match any specific sub-sector?
3. **Cross-taxonomy comparison**: How to map v1 classifications to v2 for validation?
4. **Incremental rollout**: Can we migrate one super-sector at a time?

---

## Next Steps

1. [ ] Design sub-sector structure for ONE super-sector (pilot)
2. [ ] Build CPC clustering analysis tool
3. [ ] Implement naming convention validator
4. [ ] Create v2 TaxonomyType and pilot nodes
5. [ ] Run parallel classification and compare results

---

*Created: 2026-03-28*
*Status: Design Phase*
