# Patent Families & Citation Counting Design

## Overview

Patent families are generational citation trees centered on one or more patents of interest, spanning backward (cited prior art) and forward (citing patents) across configurable generations. They provide a natural grouping of related patents that can be superimposed with other groupings (search scopes, focus areas, sectors).

Citation counting, enhanced with affiliate/competitor/neutral classification, provides key metrics for patent valuation and strategic analysis.

---

## Terminology

| Term | Definition |
|------|------------|
| **Patent of Interest** | The seed patent from which a family is built |
| **Backward Citation / Parent** | A patent cited by the patent of interest (prior art) |
| **Forward Citation / Child** | A patent that cites the patent of interest |
| **Generation** | One level of citation traversal (1 generation = direct citations) |
| **Sibling** | Patents sharing the same parent (cited by the same prior art) |
| **Cousin** | Patents at the same generational level but through different ancestors |
| **Family Root** | The seed patent(s) from which traversal begins |
| **Family Scope** | The complete set of patents discovered through generational traversal |

---

## Patent Family Construction

### Generational Specification

A patent family is defined by specifying how many generations to traverse in each direction:

```
backward_generations: N  (how many levels of prior art to include)
forward_generations:  M  (how many levels of citing patents to include)
```

**Default**: 1 generation in each direction (direct parents and children).

### Traversal Examples

```
2 generations backward, 1 generation forward:

          Grandparent
              │
           Parent
              │
    ┌─────────┼─────────┐
    │    PATENT OF       │
    │    INTEREST         │
    │         │          │
    │      Child 1    Child 2
    │
  Sibling (shares Parent)
```

```
1 generation each direction, with connecting patents:

   Parent 1    Parent 2    Parent 3
       │           │           │
       └─────┬─────┘           │
             │                 │
    PATENT OF INTEREST ────────┘
             │
       ┌─────┼─────┐
    Child 1  Child 2  Child 3
```

### Connecting Patents

When building a family, also include **connecting patents**: any patent that creates a link between an already-discovered parent and child within the family tree. This fills in "bridge" patents that might not be direct citations of the seed but connect family members.

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `backwardGenerations` | int | 1 | Levels of prior art to traverse |
| `forwardGenerations` | int | 1 | Levels of citing patents to traverse |
| `includeConnecting` | bool | true | Include patents connecting existing family members |
| `excludeCompetitors` | bool | false | Exclude patents from competitor assignees |
| `excludeAffiliates` | bool | false | Exclude patents from affiliate assignees |
| `maxFamilySize` | int | 500 | Safety limit on total family size |
| `includeExpired` | bool | true | Include expired patents in family |

---

## On-Demand Patent Loading

Patent family construction requires citation data that may not be in our database. The system should **lazy-load** patents and their citations on demand:

### Loading Strategy

```
1. Start with patent of interest (must exist in system)
2. Check if citation data is cached:
   a. Forward citations: cache/api/patentsview/forward-citations/{id}.json
   b. Backward citations: (from patent record or separate API call)
3. If not cached, fetch from PatentsView API:
   a. Queue API request (respect rate limits)
   b. Cache response to disk
   c. Store citation relationships
4. Recursively expand for additional generations
5. Download patent records for newly discovered patents (title, abstract, CPC, assignee)
```

### Background Job Integration

Family construction should run as a background job:

```typescript
interface PatentFamilyJob {
  id: string;
  type: 'PATENT_FAMILY_BUILD';
  status: 'PENDING' | 'RUNNING' | 'COMPLETE' | 'ERROR';

  // Configuration
  seedPatentIds: string[];         // Starting patent(s)
  backwardGenerations: number;
  forwardGenerations: number;
  includeConnecting: boolean;
  filters: {
    excludeCompetitors: boolean;
    excludeAffiliates: boolean;
    maxFamilySize: number;
  };

  // Progress tracking
  discoveredCount: number;         // Patents found so far
  downloadedCount: number;         // Patent records fetched
  pendingApiCalls: number;         // Remaining API calls
  estimatedApiCalls: number;       // Estimated total API calls

  // Result
  familyId?: string;               // Created PatentFamily record
}
```

### API Rate Limit Awareness

- Do NOT run family construction while background citation/abstract jobs are active
- Queue family jobs and execute when API bandwidth is available
- Show user estimated API calls required before starting
- Allow partial family construction (build what we can from cache, queue remaining)

---

## Citation Counting

### Assignee Classification

By default, every assignee is **neutral**. Users can promote assignees to:

| Classification | Description | Criteria |
|----------------|-------------|----------|
| **Affiliate** | Part of the portfolio owner's corporate family | Same parent company, subsidiaries, acquired entities |
| **Competitor** | Known competitive entity | High citation overlap, market competition, user designation |
| **Neutral** | All other assignees | Default classification |

### Promotion to Competitor

Assignees can be promoted to competitor status via:
1. **Manual**: User marks assignee as competitor
2. **Auto-suggest**: System flags assignees with high citation counts against the portfolio
3. **Threshold**: Assignees exceeding N citations of portfolio patents can be auto-flagged for review

### Citation Count Dimensions

For each patent, maintain these citation counts:

| Metric | Direction | Scope | Description |
|--------|-----------|-------|-------------|
| `total_forward` | Forward | All | Total patents citing this patent |
| `total_backward` | Backward | All | Total patents cited by this patent |
| `competitor_forward` | Forward | Competitor | Competitor patents citing this patent |
| `competitor_backward` | Backward | Competitor | Competitor patents cited by this patent |
| `affiliate_forward` | Forward | Affiliate | Affiliate patents citing this patent |
| `affiliate_backward` | Backward | Affiliate | Affiliate patents cited by this patent |
| `neutral_forward` | Forward | Neutral | Neutral party patents citing this patent |
| `neutral_backward` | Backward | Neutral | Neutral party patents cited by this patent |

### Relationships

```
total_forward = competitor_forward + affiliate_forward + neutral_forward
total_backward = competitor_backward + affiliate_backward + neutral_backward
```

### Multi-Generational Counts (Computed On-Demand)

These are NOT maintained by default but can be calculated when needed:

| Metric | Example |
|--------|---------|
| `competitor_forward_2gen` | Competitor citations up to 2 generations forward |
| `total_backward_3gen` | All citations up to 3 generations backward |

These are expensive to compute and should be cached per patent family or calculated during family construction.

### Scoring Impact

Citation counts feed into scoring formulas with different weights:

```typescript
// Example: Competitor citations weighted more heavily
const citationScore = (
  competitor_forward * weights.competitor +    // e.g., 3x multiplier
  affiliate_forward * weights.affiliate +      // e.g., 0.5x (self-cites less valuable)
  neutral_forward * weights.neutral            // e.g., 1x baseline
) / total_forward;
```

This addresses the self-citation inflation problem (documented in `CITATION_CATEGORIZATION_PROBLEM.md`) where portfolio self-citations inflate rankings.

---

## Data Model

### Patent Family

```typescript
interface PatentFamily {
  id: string;
  name: string;                    // User-assigned or auto-generated
  description?: string;

  // Seeds
  seedPatentIds: string[];

  // Configuration used to build
  backwardGenerations: number;
  forwardGenerations: number;
  includeConnecting: boolean;

  // Discovered members
  memberPatentIds: string[];       // All patents in the family
  memberCount: number;

  // Relationships (adjacency list or edge list)
  edges: CitationEdge[];

  // Stats
  totalForwardCitations: number;
  totalBackwardCitations: number;
  competitorCitationCount: number;
  affiliateCitationCount: number;

  // Metadata
  createdBy: string;
  createdAt: Date;
  lastRebuiltAt?: Date;
  status: 'BUILDING' | 'COMPLETE' | 'STALE';
}

interface CitationEdge {
  citingPatentId: string;          // The patent doing the citing
  citedPatentId: string;           // The patent being cited
  generation: number;              // Distance from seed
  direction: 'FORWARD' | 'BACKWARD';
  assigneeClassification: 'COMPETITOR' | 'AFFILIATE' | 'NEUTRAL';
}
```

### Assignee Classification

```typescript
interface AssigneeClassification {
  id: string;
  assigneeName: string;            // Raw or normalized
  affiliateGroup?: string;         // Normalized affiliate group name
  classification: 'COMPETITOR' | 'AFFILIATE' | 'NEUTRAL';

  // Evidence
  portfolioCitationCount: number;  // How many times this assignee cites portfolio patents
  citedByPortfolioCount: number;   // How many times portfolio cites this assignee
  promotedBy: 'MANUAL' | 'AUTO_SUGGEST' | 'THRESHOLD';
  promotedAt: Date;

  // Notes
  notes?: string;
}
```

---

## UI Components

### Patent Family Builder Page

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Build Patent Family                                                      │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ Seed Patents: [US10123456] [US10234567] [+ Add]                         │
│                                                                          │
│ Backward Generations: [1 ▼]    Forward Generations: [1 ▼]              │
│ ☑ Include connecting patents   ☐ Exclude competitors                    │
│ Max family size: [500]                                                   │
│                                                                          │
│ Estimated API calls: ~47 (12 cached, 35 needed)                         │
│                                                                          │
│ [Build Family]  [Build from Cache Only]                                  │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ Family: "Secure Auth Protocol Family" (127 patents)                      │
│                                                                          │
│ ┌─ Generation View ──────────────────────────────────────────────────┐  │
│ │  Gen -2:  ██████ 23 patents                                        │  │
│ │  Gen -1:  ████████████ 41 patents                                  │  │
│ │  Gen  0:  ██ 2 patents (seeds)                                     │  │
│ │  Gen +1:  ██████████████████ 61 patents                            │  │
│ │                                                                     │  │
│ │  Competitor:  ████ 28 (22%)                                        │  │
│ │  Affiliate:   ██ 15 (12%)                                          │  │
│ │  Neutral:     ████████████ 84 (66%)                                │  │
│ └─────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│ [View as Grid] [Create Focus Area] [Export]                              │
└──────────────────────────────────────────────────────────────────────────┘
```

### Citation Breakdown Panel (Patent Detail)

```
┌──────────────────────────────────────────────────────────────┐
│ Citations for US10123456                                      │
├──────────────────────────────────────────────────────────────┤
│           Forward (Citing)    Backward (Cited)               │
│ ──────────────────────────────────────────────               │
│ Total         142                 23                          │
│ Competitor     23 (16.2%)          5 (21.7%)                 │
│ Affiliate      18 (12.7%)          3 (13.0%)                │
│ Neutral       101 (71.1%)         15 (65.2%)                │
│                                                               │
│ Top Citing Competitors:                                       │
│   Intel Corp (7)  |  Qualcomm (5)  |  Samsung (4)           │
│                                                               │
│ [View Full Citation Tree] [Build Patent Family]               │
└──────────────────────────────────────────────────────────────┘
```

---

## Extended Family Model — Category-Constrained Expansion

Updated: 2026-01-26 (Session 14)

The basic patent family model (parents, children) produces a single-generation view. Expanding to include the patent of interest's own parents and children creates a **three-generation unit** — the patent connects two nuclear families (its parent's family where it is a child, and its own family where it is a parent). This is analogous to a diatomic molecule: two nuclei (parent generation and child generation) bonded through the patent of interest. We refer to this three-generation unit as the **diatomic family**.

### Diatomic Family (Three Generations)

The diatomic family is the tightest meaningful citation group:

| Relationship | Definition | Generation |
|-------------|-----------|------------|
| **Parents** | Patents cited by the PoI (prior art) — can be N parents, not limited to 2 | -1 |
| **Self** | The patent of interest | 0 |
| **Children** | Patents that cite the PoI | +1 |
| **Siblings** | Other patents that share the same parents (cited by the same prior art) | 0 (lateral) |

Adding siblings to this unit gives us lateral breadth at the middle generation. From here we can selectively extend outward.

### Extended Family (Generation 2+)

Expanding beyond the diatomic family by adding or removing relatives at any generation:

| Relationship | Definition | How Discovered |
|-------------|-----------|----------------|
| **Grandparents** | Parents of parents | 2 levels backward |
| **Grandchildren** | Children of children | 2 levels forward |
| **Uncles/Aunts** | Siblings of parents | Lateral from parent level |
| **Cousins** | Children of siblings (share grandparent) | 1 forward from sibling |
| **2nd Cousins** | Children of cousins (share great-grandparent) | Another level out |

**Generational preference**: We typically favor newer generations when selecting a discrete patent set — younger patents represent more current technology and have more remaining life. However, older patents (including uncles and even expired patents) are valuable **as connectors**. An uncle may not end up in the final focus area, but the uncle's role in the citation graph reveals cousins and younger relatives that are highly relevant. The uncle is a bridge, not necessarily a destination.

**Expired patents as connectors**: Even expired patents in the family tree are useful. They establish the citation lineage that connects active patents. When expressing the family as a discrete set for a focus area, expired patents may be excluded from the selection but retained in the family graph for navigation and discovery.

### Category-Constrained Expansion

Unconstrained family expansion quickly produces thousands of patents. The solution is to use **category overlays as expansion filters** — applying categorical constraints at each generation to keep the family finite and meaningful.

#### Category Types for Constraining Expansion

Categories can take various forms, and boolean combinations of any of them:

| Category Type | Nature | Example |
|--------------|--------|---------|
| **Sectors** | Two-level hierarchy (super-sector → sector) | `SECURITY / network-threat-protection` |
| **Focus groups** | Free-form categories (can be hierarchical or flat) | "Zero Trust Authentication" |
| **CPC codes** | Natural patent classification hierarchy | `H04L63` (network security) |
| **Portfolio membership** | Binary: in-portfolio or external | Broadcom portfolio |
| **Focus areas** | Formalized groupings (can themselves be search scopes) | "Wireless Payment Security" |
| **Boolean combinations** | AND/OR/NOT of any of the above | `(SECURITY OR WIRELESS) AND in-portfolio` |

The superposition of these category structures for the purpose of limiting generational expansion is a key capability. A narrow category combination produces a tighter family; a broad one lets more patents in.

#### Recursive Focus Area Scoping

Focus areas can participate recursively in this system: a focus area can be part of a search scope that defines a new focus area. This starts to resemble a hierarchy when sibling focus areas are filled out to make each level exhaustive (MECE). This recursive relationship between focus areas and search scopes is discussed in the Search Scope and Hierarchical Placement sections of `FOCUS_AREA_SYSTEM_DESIGN.md`.

#### Expansion Configuration

```typescript
interface FamilyExpansionConfig {
  seedPatentIds: string[];

  // Generation limits
  maxBackwardGenerations: number;    // Typically 1-2
  maxForwardGenerations: number;     // Typically 1-3
  maxLateralGenerations: number;     // Cousin depth (1 = first cousins, 2 = second cousins)

  // Category constraints (narrow the family at each expansion step)
  constraints: {
    sectors?: string[];              // Only include patents in these sectors
    superSectors?: string[];         // Or broader sector groups
    cpcCodes?: string[];             // Natural classification filter
    focusAreaIds?: string[];         // Only include patents in these focus areas
    focusGroupIds?: string[];        // Free-form category filter
    inPortfolio?: boolean;           // Only in-portfolio patents
    excludeExpired?: boolean;        // Skip expired patents (but still traverse through them)
    booleanExpression?: string;      // Compound: "(SECURITY OR WIRELESS) AND in-portfolio"
  };

  // Expansion preference
  preferDirection: 'forward' | 'balanced' | 'lateral';
  // forward: favor children/grandchildren (newer tech)
  // balanced: equal backward/forward
  // lateral: favor siblings/cousins (parallel tech)

  // Connector behavior
  retainConnectors: boolean;         // Keep older/expired patents as graph connectors
                                     // even if they don't pass constraints for selection

  maxFamilySize: number;             // Hard cap
}
```

#### Lateral Expansion (Sibling-First Strategy)

The most interesting family pattern favors **lateral expansion** — siblings and cousins represent parallel inventions in the same technology space:

```
Generation -1:  Parent A          Parent B          Parent C
                  │                  │                  │
Generation  0:  PoI     Sib1     Sib2     Sib3      Sib4
                  │       │        │
Generation +1:  Ch1    Cousin1  Cousin2    ← First cousins (children of siblings)
                  │       │
Generation +2:  GCh1   2ndCous1            ← Second cousins
```

This lateral tree is bounded by the constraint categories. At each expansion step:
1. Discover candidate patents (all children of current-level siblings)
2. Filter by constraints (sector, CPC, focus area, boolean combinations)
3. Keep patents passing constraints; retain others as connectors if configured
4. Continue to next level if under maxFamilySize

### Cross-Category Family Example

A compelling use case: building a family that spans technology categories.

**Scenario**: A patent covering secure wireless financial transactions sits at the intersection of three sectors:
- Financial transactions
- Wireless protocol stack
- Security

```
Seed: US10XXXXXX (secure wireless payment)

Parents (prior art):
  ├── US9AAAAA (NFC payment protocol) — Financial
  ├── US9BBBBB (wireless encryption) — Wireless + Security
  └── US9CCCCC (tokenized transactions) — Financial + Security

Siblings (share parents):
  ├── US10DDDDD (mobile wallet auth) — Financial + Security
  ├── US10EEEEE (BLE payment channel) — Wireless + Financial
  └── US10FFFFF (encrypted NFC handshake) — Wireless + Security

Cousins (children of siblings):
  ├── US11GGGGG (biometric payment on wearable) — All three
  ├── US11HHHHH (5G payment gateway) — Wireless + Financial
  └── US11IIIII (hardware security for payments) — Security + Financial
```

These patents come from different sectors but end up close in the citation tree. The family **reveals technology convergence** that sector-only analysis would miss.

### Family-to-Focus-Area Conversion with Scope Overlay

A patent family can seed a focus area in two ways:

1. **Family AS focus area**: Convert the entire family (or filtered subset) directly into a focus area
2. **Family × Scope → focus area**: Overlay the family with a search scope (e.g., a sector) and create a focus area from the intersection

```
Patent Family (89 patents, including connectors)
    ×
Search Scope: Portfolio / network-security (2,341 patents)
    =
Focus Area candidate: 34 patents (family members in network-security)
    +
Adjacent set: 2,307 patents (in scope but not in family — context)
    +
Connector-only: 12 patents (in family graph but not selected — bridges)
```

This gives a focused starting set (34) with a well-defined adjacent set (2,307) for search term testing, plus the connector patents visible in the family graph for understanding the citation lineage.

---

## Integration with Focus Areas and Search Scopes

Patent families serve as both:

1. **A natural Focus Area source**: A patent family can be directly converted to a Focus Area for further analysis with search terms and LLM facets
2. **A Search Scope**: A patent family can serve as the scope within which search terms are evaluated

### Superimposition

Patent families can be overlaid with other groupings:

```
Patent Family × Sector → Which sectors does this family span?
Patent Family × Competitor → Which competitors appear in this family?
Patent Family × Focus Area → How does this family relate to existing focus areas?
```

This enables rich analysis: e.g., "In the patent family around US10123456, 40% of forward citations are in the network-security sector, and 3 competitor patents (Intel) are in generation +1."

---

## Implementation Priority

### Near-Term (Next 2-3 sprints)

1. **Citation counting dimensions**: Add competitor/affiliate/neutral breakdown to existing citation data
2. **Assignee classification table**: Create UI for marking assignees as competitor/affiliate
3. **Patent family builder**: Basic family construction from cached citation data (no new API calls)
4. **Family visualization**: Simple generation-based bar chart and patent grid

### Medium-Term

5. **On-demand API loading**: Fetch missing citations during family construction
6. **Family-to-Focus-Area conversion**: One-click creation of Focus Area from family
7. **Multi-generational citation counts**: Computed metrics for scoring
8. **Auto-suggest competitors**: Flag assignees with high citation overlap

### Long-Term

9. **Interactive family tree visualization**: Zoomable graph showing citation relationships
10. **Cross-family analysis**: Compare patent families, find shared ancestors
11. **Family health metrics**: Aging analysis, competitive pressure trends

---

*Last Updated: 2026-01-26 (Session 14 — added Extended Family Model: diatomic family concept, category-constrained expansion with boolean combinations, recursive focus area scoping, cross-category families, connector patent retention)*
