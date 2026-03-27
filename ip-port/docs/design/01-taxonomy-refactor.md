# 01 — Taxonomy & Sector Management Refactor

## Current State

The system has a single three-level hierarchy: super-sector (12) → sector (64) → sub-sector (~250+). Each patent has one primary classification denormalized on the Patent model (`superSector`, `primarySector`, `primarySubSectorName`). Classification is driven by CPC-prefix matching rules in the `SectorRule` table.

Current statistics (84K patents): COMPUTING 25%, WIRELESS 18%, SEMICONDUCTOR 16%, NETWORKING 16%, SECURITY 10%, VIDEO_STREAMING 8%, IMAGING 6%, UNCLASSIFIED <1%, AI_ML <1%.

The taxonomy originated from the Broadcom portfolio and our initial assumptions about how to categorize patent technology areas. It is based on CPC mappings but the mapping is incomplete and inconsistent — super-sector rules are not explicitly defined (they are implied by the union of their child sector rules), and the initial taxonomy was built without systematic analysis of CPC distribution across the full 84K patent dataset.

Classification currently uses the first inventive CPC code per patent (ordering is often arbitrary), so we lose the richness of patents having 5-15 CPC codes spanning multiple technology areas. The CPC code associations exist in `PatentCpc` but are not leveraged for multi-classification or structured question differentiation.

## Problems with Current Approach

**Classification quality:**
- Single association per patent misses multi-domain patents (a patent with codes for both video codecs and wireless transmission is forced into one sector)
- First-inventive-CPC selection is arbitrary — doesn't consider which CPC codes are most relevant to the patent's core innovation
- No catch-all/general category at any level — hierarchy is not collectively exhaustive, resulting in UNCLASSIFIED patents that should at minimum be captured in a general bucket
- Super-sectors lack explicit rules — their boundaries are implicitly the union of their sectors' rules, which is fragile
- Rule conflicts are hidden — when multiple sector rules match, first match wins silently with no visibility into ambiguity

**Structural rigidity:**
- Three-level hierarchy is hardcoded — some areas need deeper granularity while others are adequately described at two levels
- Same taxonomy applies to all portfolios, but a semiconductor company and a software company have fundamentally different technology distributions
- SubSector statuses (PROSPECTIVE, APPLIED, ARCHIVED) exist but the promotion workflow isn't built
- Denormalized fields on Patent (`superSector`, `primarySector`, `primarySubSectorName`) must be updated on every taxonomy change

**Naming and navigation:**
- Sub-sector names are not globally unique — "displays" under COMPUTING and "displays" under IMAGING could collide
- No prefix convention to disambiguate levels in filter UIs
- CPC Subgroup vs CPC Prefix rule type distinction is unclear in terms of when to use which

**Impact on scoring:**
- Single classification limits structured question specificity — a patent classified only as "wireless-transmission" never gets asked video codec questions even if it has relevant CPC codes
- Taxonomy refactoring invalidates all LLM scores in affected areas with no gradual migration path

## Analysis-First Approach

Before committing to schema changes, the Taxonomy Analysis Service (`taxonomy-analysis-service-detail.md`) provides seven modules answering specific design questions with data from the existing 84K patents:

| Module | Question | What It Tells Us |
|--------|----------|-----------------|
| CPC Distribution | How many CPC codes per patent? | Typical range (expect 5-15), distribution shape |
| Classification Coverage | What % classified? Where are gaps? | Whether rules are adequate, size of UNCLASSIFIED population |
| Multi-Classification | How many patents map to 2+ sectors? | Whether we need 2 or 3 associations, which pairs overlap most |
| Classification Confidence | How unambiguous are assignments? | What % have clean vs. messy CPC distributions |
| Portfolio Comparison | Do portfolios need different taxonomies? | Jaccard similarity, discriminating CPC codes |
| Sector Balance | Which sectors over/undersized? | Where to split, merge, or refactor |
| Rule Effectiveness | Which rules conflict/are dead? | Rule cleanup priorities, orphaned patents |
| CPC Hierarchy | How do patents distribute within a CPC tree? | Natural split points for sector boundaries |

**The results determine priorities.** If multi-classification analysis shows 80% of patents map to only 1 sector, secondary/tertiary is lower priority. If portfolio comparison shows high Jaccard similarity, global taxonomy suffices. The analysis service is built first (Phase 1, no schema changes) and run before any taxonomy schema changes.

## Proposed Changes

### Catch-All Categories (Collectively Exhaustive Hierarchy)

Every level of the taxonomy gets a "General" catch-all:

```
General/General/General          ← patents matching no specific rules
COMPUTING/General/General        ← patents in COMPUTING but no specific sector
COMPUTING/computing-ui/General   ← patents in computing-ui but no specific sub-sector
```

Catch-all rules are the lowest priority — they match only when no more specific rule does. This ensures every patent has a classification at every level, eliminating the UNCLASSIFIED category. Patents landing in catch-all categories are flagged for taxonomy refactoring review.

When patents accumulate in a catch-all, the system can queue a taxonomy refactoring task: "84 patents in NETWORKING/General — consider creating a new sector."

### Naming Convention (Prefixed, Globally Unique)

To prevent collisions and make filter UIs unambiguous:

```
Super-sector: 3-letter code
  COMPUTING → CMP
  WIRELESS → WRL
  NETWORKING → NET

Sector: parent prefix + sector slug
  CMP/computing-ui
  WRL/wireless-transmission
  NET/protocol-stack

Sub-sector: parent prefix + sub-sector slug  
  CMPUI/displays
  WRLTX/mimo-basic
  NETPS/tcp-optimization
```

This convention means "displays" under COMPUTING is `CMPUI/displays` and "displays" under IMAGING is `IMGPR/displays` — globally unique without needing to show the full hierarchy path in every filter dropdown.

The prefix convention is stored in the taxonomy entity and used for display. The database still uses the unique `name` field as the key — the prefix is a display/filter convenience.

### Super-Sector Explicit Rules

Currently super-sectors are implied by their sectors. We should add explicit CPC prefix rules at the super-sector level (initially: the OR of the beginning of all prefix rules in child sectors). This provides:

- Clearer catch-all behavior (patent matches CMP-level prefix but no specific sector → goes to CMP/General)
- Better filtering performance (can check super-sector membership without evaluating all sector rules)
- Foundation for portfolio-specific super-sector variants

### Multiple Taxonomy Associations per Patent

The core classification change. Instead of one sector per patent, we compute primary, secondary, and optionally tertiary associations by evaluating ALL CPC codes against ALL rules and ranking sectors by match strength.

**Association strength scoring:**

```
For each patent P, for each sector S:
  inventiveMatchCount = count of P's inventive CPC codes matching S's rules
  totalMatchCount = count of all P's CPC codes matching S's rules
  
  strength = (inventiveMatchCount × 2 + totalMatchCount) / totalCpcCodes(P)
```

Inventive CPC codes are weighted 2x because they better represent the patent's core innovation. The top-scoring sector becomes primary, second becomes secondary, etc.

**Association table schema:**

```prisma
model PatentTaxonomyAssociation {
  id              String   @id @default(cuid())
  patentId        String   @map("patent_id")
  
  // Which taxonomy node this associates to (finest level)
  superSectorId   String?  @map("super_sector_id")
  sectorId        String?  @map("sector_id")
  subSectorId     String?  @map("sub_sector_id")

  // Association rank and strength
  rank            Int      @default(1)    // 1=primary, 2=secondary, 3=tertiary
  strength        Float?                  // 0-1, from CPC match scoring
  
  // How determined
  source          ClassificationSource @default(CPC_RULE)
  
  // CPC evidence supporting this association
  supportingCpcCodes    String[] @map("supporting_cpc_codes")
  inventiveCpcCount     Int      @default(0) @map("inventive_cpc_count")
  nonInventiveCpcCount  Int      @default(0) @map("non_inventive_cpc_count")
  
  // What fraction of the patent's total CPC codes does this cover?
  cpcCoverageRatio      Float?   @map("cpc_coverage_ratio")
  
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@unique([patentId, sectorId, rank])
  @@map("patent_taxonomy_associations")
  @@index([patentId])
  @@index([sectorId])
  @@index([superSectorId])
  @@index([rank])
  @@index([strength])
}

enum ClassificationSource {
  CPC_RULE        // Matched by sector rule evaluation
  LLM_SUGGESTED   // LLM recommended this classification
  USER_OVERRIDE   // Manual user assignment
  INHERITED       // Inherited from patent family
}
```

**Configurable association limit:** System setting (admin, initially read-only) for max associations per patent. Default: 3 (primary, secondary, tertiary). The multi-classification analysis module reveals how many are actually needed.

**CPC coverage tracking:** Each association records how many inventive and non-inventive CPC codes support it, and what fraction of the patent's total CPC codes it covers. A patent with 11 inventive CPCs where 6 map to primary, 3 to secondary, and 2 to tertiary has 100% coverage across 3 associations. If only 8 of 11 are covered by 3 associations, the 73% coverage flags that patent for potential taxonomy gap analysis.

**Non-inventive CPC handling:** Non-inventive CPCs are included in the match scoring with 1x weight (vs. 2x for inventive) but are not the primary driver. They provide additional signal for secondary/tertiary associations. The association table tracks inventive vs. non-inventive counts separately so we can evaluate whether non-inventive codes are adding value.

### IPC to CPC Mapping

Patents before 2013 may have IPC codes instead of CPC codes. There is an IPC→CPC mapping available from WIPO. We should incorporate this mapping so older patents can participate in CPC-based classification. This is a data enrichment task rather than a taxonomy design change — the mapping produces CPC codes that feed into the same rule engine.

### Migration Strategy for Denormalized Fields

The existing denormalized fields on Patent (`superSector`, `primarySector`, `primarySubSectorName`, `primarySubSectorId`) remain for the fast display path and backward compatibility. They always reflect the primary (rank=1) association.

The new association table is populated alongside them:

1. **Initial population**: For every patent, create a rank=1 association from the existing denormalized fields
2. **Multi-classification**: Run the classification algorithm to compute rank=2 and rank=3 associations
3. **Existing queries**: Continue to use denormalized fields (no behavior change)
4. **New features**: Use the association table for multi-classification views, enrichment scoping, question batching

When we're confident the association table is correct and the system is stable, we can optionally stop maintaining the denormalized fields and read everything from the association table via join. But this is a Phase 4 optimization, not a near-term requirement.

### Taxonomy Scope: Named Taxonomies, Portfolio Groups, and Multi-Taxonomy

The design is not a binary choice between "one global taxonomy" and "per-portfolio taxonomies." The system evolves through a spectrum of flexibility.

**Level 0 (Current):** One unnamed taxonomy for everything. All portfolios share the same super-sector/sector/sub-sector structure. This is where we are today.

**Level 1 (Near-term):** Named taxonomies. The current taxonomy becomes a named entity (e.g., "broadcom-tech-v1") rather than an implicit global. Each portfolio has a `defaultTaxonomyId` setting pointing to this named taxonomy. All portfolios still share it, but the naming makes the relationship explicit and opens the door for alternatives.

**Level 2 (When needed):** Multiple named taxonomies coexist. When we import a company in a very different tech area (say, biotech), we create a new named taxonomy ("biotech-v1") with its own hierarchy tailored to that domain. The biotech portfolio and its competitors use "biotech-v1" while broadcom portfolios continue with "broadcom-tech-v1". This is tech-area-focused rather than portfolio-specific — taxonomies describe technology domains, not individual companies.

**Level 3 (Portfolio groups):** Portfolios are organized into logical groups that share a taxonomy. Instead of global-vs-portfolio, we have: "semiconductor group" (broadcom, intel, qualcomm, mediatek) sharing one taxonomy, "cloud/networking group" (cisco, juniper) sharing another, with overlap allowed — a portfolio can appear in multiple groups. The group is the natural scope for competitive analysis and taxonomy management.

**Level 4 (Multi-taxonomy per patent):** A single patent can be classified under multiple taxonomy types simultaneously. Beyond primary/secondary/tertiary associations within one taxonomy, a patent could have a "technology taxonomy" classification AND a "market segment taxonomy" classification independently. This is useful for evaluating candidate taxonomies against each other during refactoring — run both, compare scores, and decide which to keep.

**Level 5 (Taxonomy evolution tools):** Features to merge, split, and compare taxonomies. If two portfolio groups have independently developed taxonomies with overlapping areas, a merge tool can identify shared CPC territory, propose a combined taxonomy, and simulate the reclassification impact before committing.

```prisma
// Schema addition for named taxonomies (Phase 3+)
model TaxonomyDefinition {
  id              String   @id @default(cuid())
  name            String   @unique        // "broadcom-tech-v1", "biotech-v1"
  displayName     String   @map("display_name")
  description     String?
  
  // How many hierarchy levels does this taxonomy use?
  depth           Int      @default(3)    // 3 = super-sector/sector/sub-sector
  levelNames      String[] @default(["super-sector", "sector", "sub-sector"]) @map("level_names")
  
  // Scope
  isGlobal        Boolean  @default(false) @map("is_global")
  
  version         Int      @default(1)
  isActive        Boolean  @default(true) @map("is_active")
  
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@map("taxonomy_definitions")
}

// Portfolio group for shared taxonomy scope
model PortfolioGroup {
  id              String   @id @default(cuid())
  name            String   @unique
  displayName     String   @map("display_name")
  description     String?
  
  // Default taxonomy for this group
  defaultTaxonomyId String? @map("default_taxonomy_id")
  
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@map("portfolio_groups")
}

model PortfolioGroupMembership {
  id              String   @id @default(cuid())
  portfolioId     String   @map("portfolio_id")
  groupId         String   @map("group_id")
  
  @@unique([portfolioId, groupId])
  @@map("portfolio_group_memberships")
}
```

**Pragmatic path:** We implement Level 0→1 immediately (just naming the existing taxonomy and adding the `defaultTaxonomyId` field to Portfolio). Level 2 is triggered when we actually import a company outside the current taxonomy's domain. Level 3-5 are designed into the schema now but built only when needed. The `PatentTaxonomyAssociation` table already accommodates all levels by referencing the taxonomy's sector hierarchy — different taxonomies simply have different sector trees.

**Named sub-sectors across taxonomies:** The same conceptual sub-sector (like "displays") can exist in multiple named taxonomies with different CPC rules. The sector name is the semantic anchor; the rules are the implementation that varies by taxonomy context. This is especially useful when two portfolio groups overlap in some technology areas but diverge in others.

**What the analysis will tell us:** The Portfolio Comparison module computes Jaccard similarity on CPC subclass sets. High similarity (>0.6) means portfolios can share a taxonomy. Low similarity (<0.3) suggests they belong to different portfolio groups with different taxonomies. The discriminating CPC analysis identifies which technology areas drive the divergence.

### Taxonomy Depth

Current: fixed 3 levels (super-sector, sector, sub-sector).

**Near-term:** Keep 3 levels but design the schema so adding a 4th level (sub-sub-sector or sub-sector-L2) is a straightforward migration. The hierarchy table supports variable depth — each node has a `parentId` pointing up the tree.

**Naming for deeper levels:** If we go beyond 3 levels, the names become: super-sector → sector → sub-sector → sub-sector-L2 → etc. These are just labels on the hierarchy levels and can be renamed per taxonomy if needed. The important thing is the code doesn't hardcode "exactly 3 levels" — it walks the hierarchy to any depth.

## Structured Questions and Multiple Associations

This is where multi-classification creates the most value. With multiple associations, a patent's LLM question set is the **union** of questions from all classification paths:

```
Patent X: primary=CMP/video-codec, secondary=WRL/wireless-transmission

LLM question batch:
  Portfolio questions (6)               ← always included
  VIDEO_STREAMING super-sector (2)      ← from primary path
  video-codec sector (3)                ← from primary path
  WIRELESS super-sector (2)             ← from secondary path
  wireless-transmission sector (2)      ← from secondary path
  ─────────────────────────────
  Total: 15 questions, one LLM call
```

This maximizes value per LLM call — the base context (patent title, abstract, claims) is the same regardless of question count. We're already combining portfolio + super-sector + sector + sub-sector questions in one call; extending to secondary/tertiary classification paths is the same pattern with more questions.

**Deduplication:** If the same `fieldName` appears in multiple paths (e.g., both paths inherit the same portfolio question), it's asked once. The question union is deduplicated by `fieldName`.

**Question versioning with multiple paths:** Each taxonomy path has its own revAIQ version string. Patent X's primary path might be at revAIQ "3.2.1.4" while its secondary path is at "3.1.2.1". The enrichment system evaluates each path independently to determine what needs updating.

## Taxonomy Refactoring Scenarios

### Creating new sectors from catch-all
When patents accumulate in General/General or COMPUTING/General, analyze their CPC codes to identify clusters. Use CPC Hierarchy Analysis (Module 7) to find natural groupings. Create new sectors with CPC prefix rules. Reclassify affected patents.

### Splitting oversized sectors
Sector Balance Analysis (Module 5) identifies sectors >500 patents with high CPC concentration (one CPC cluster dominates). Split at the dominant CPC boundary — the cluster becomes its own sector or sub-sector.

### Moving CPC codes between sectors to rebalance
When a CPC group straddles two sectors, evaluate which assignment produces better-balanced sectors. Use rule priority to resolve — the higher-priority rule wins, but the patent gets a secondary association to the other sector.

### Portfolio-specific sector expansion
A portfolio may need finer granularity in a specific technology area. Create portfolio-scoped sub-sectors with portfolio-specific rules. These exist alongside the global taxonomy — the global catch-all still applies for other portfolios.

### Merging back portfolio expansions
When portfolio-specific refinements prove generally useful, promote them to the global taxonomy. The `SectorRule.promotedFrom` and `promotedAt` fields track this lineage.

### Score-driven refactoring
With multiple associations, compare LLM question scores across primary vs. secondary classifications. If patents consistently score poorly on secondary-classification questions, that association may be weak. If many patents in a sector have low secondary scores for the same reason, the sector's CPC rules may need refinement. This is an advanced analytical use that leverages the multi-classification data.

### Cost-managed refactoring
Use cheaper LLM models for experimental taxonomy refactoring and analysis. Once taxonomy is stable, rerun topN with the best model. Use snapshot normalization (see `04-snapshots.md`) to bridge the model gap for patents not yet rescored. This makes taxonomy experimentation affordable.

## Rule Engine Clarifications

**CPC_PREFIX vs CPC_SUBGROUP:** `CPC_PREFIX` matches the beginning of a CPC code (e.g., rule "H04L1" matches "H04L1/00", "H04L1/0001", etc.). `CPC_SUBGROUP` is an exact match (e.g., rule "H04L63/1416" matches only that specific code). Use PREFIX for broad sector mapping, SUBGROUP for precise sub-sector assignment.

**Rule priority:** Higher priority number = evaluated first. Used for: (1) more specific rules before broader ones, (2) portfolio-specific rules before global rules, (3) exclusion rules to override inclusion rules. The catch-all "General" category should have the lowest priority.

**Exclusion rules:** `isExclusion = true` removes patents from a sector even if inclusion rules match. Useful for edge cases: "All H04L63 go to SECURITY except H04L63/045 which is really NETWORKING."

**Rule match count tracking:** `SectorRule.matchCount` records how many patents each rule matches. The Rule Effectiveness analysis module uses this for dead rule detection and redundancy analysis.

**SubSector.status meanings:**
- `PROSPECTIVE`: Generated by sub-sector expansion algorithm but not yet activated — serves as a preview of potential taxonomy changes
- `APPLIED`: Active in the system, patents are classified against it
- `ARCHIVED`: Deactivated (perhaps merged into another sub-sector), kept for historical reference

## Attribute Registry Integration

All taxonomy fields are registered in the Attribute Registry (`hmda-v2-phase1-implementation.md`):

```
super_sector           → POSTGRES, patents.super_sector (denormalized primary)
primary_sector         → POSTGRES, patents.primary_sector (denormalized primary)
primary_sub_sector     → POSTGRES, patents.primary_sub_sector_name (denormalized primary)
```

When multi-classification is implemented, new entries for secondary/tertiary point to the association table with appropriate join clauses:

```
secondary_super_sector → POSTGRES, patent_taxonomy_associations (rank=2, join via super_sector_id)
secondary_sector       → POSTGRES, patent_taxonomy_associations (rank=2, join via sector_id)
// etc.
```

## Data Model Changes

### New Tables (Phase 3)
- `PatentTaxonomyAssociation` — multi-classification join table (schema above)
- `TaxonomyDefinition` — named taxonomy entities (Level 1 of scope spectrum)

### New Tables (Phase 4+)
- `PortfolioGroup` — logical groupings of portfolios sharing a taxonomy
- `PortfolioGroupMembership` — many-to-many between portfolios and groups

### Modified Tables
- `SuperSector` — add explicit CPC prefix rules (additive)
- `Sector`, `SubSector` — add prefix code field for naming convention (additive)
- `Portfolio` — add `defaultTaxonomyId` field (additive, nullable)
- None destructively modified — denormalized fields kept for backward compatibility

### New Enum Values
- `ClassificationSource` — how the association was determined

### Registry Entries (Phase 1)
- Taxonomy fields registered in `attribute_definitions` with current denormalized locations

## Implementation Phases

### Phase 1 (Current — No Schema Changes)
- Deploy Taxonomy Analysis Service (7 modules)
- Run analysis playbook against 84K patents, capture results
- Register taxonomy fields in Attribute Registry
- Identify specific multi-classification and balance issues from data
- Create Claude Code taxonomy-analysis skill

### Phase 2 (After Analysis — Low Risk Additions)
- Add `TaxonomyDefinition` table; seed current taxonomy as a named entity
- Add `defaultTaxonomyId` to Portfolio (all portfolios point to the one taxonomy)
- Add catch-all "General" categories at every level
- Add prefix naming convention
- Add explicit super-sector rules
- Create `PatentTaxonomyAssociation` table
- Populate rank=1 from existing denormalized fields (data migration script)
- Run multi-classification algorithm to populate rank=2, rank=3

### Phase 3 (Multi-Classification Integration — Medium Risk)
- Wire scoring templates to union questions across classification paths
- Update enrichment to batch questions from all associations
- Update Patent Summary filtering to support primary/secondary/tertiary
- Taxonomy Management GUI: view multi-classification, manage rules, preview refactoring

### Phase 4 (Named Taxonomies & Portfolio Groups — Higher Risk)
- `PortfolioGroup` and `PortfolioGroupMembership` tables
- Support for creating a second named taxonomy (triggered by importing divergent tech-area portfolios)
- Portfolio group management in admin UI
- Score-driven refactoring: analyze LLM scores across associations
- Deeper hierarchy support (4+ levels)

### Phase 5 (Taxonomy Evolution — Advanced)
- Multiple taxonomy types per patent (technology + market-segment)
- Taxonomy comparison tools: classify under two taxonomies, compare scores
- Taxonomy merge/split tools for combining portfolio-group taxonomies
- Auto-refactoring suggestions based on CPC distribution analysis
- Goal-seeking taxonomy optimization with LLM budget constraints

## Open Questions

- **How many associations per patent are actually needed?** Multi-classification analysis will show the distribution. Current hypothesis: primary + secondary covers 90%+ of cases. 3 is the pragmatic limit to handle in GUI and scoring. The unbounded association table captures all data for analysis.

- **Should primary association always be non-General?** Design intent: yes — if a patent's CPC codes produce "General" as the strongest match but have a specific sector match, the specific sector should be primary even if fewer CPCs match. The General category serves as a catch-all, not a preferred assignment.

- **Inventive-only or all CPC codes?** The strength scoring weights inventive 2x, which naturally makes inventive codes dominant. But non-inventive codes can tip secondary/tertiary assignments. The analysis service tracks both counts so we can evaluate whether non-inventive codes add value.

- **When does taxonomy refactoring invalidate scores?** Moving a patent from one sector to another invalidates sector-level LLM scores (questions are different). Portfolio-level scores are unaffected. The revAIQ convention handles this — sector version increments, patent's revAIQ shows it needs sector-level re-scoring.

- **Portfolio-specific vs. global taxonomy?** Replaced by the named-taxonomy model (Level 0-5 spectrum). Near-term: name the existing taxonomy, add `defaultTaxonomyId` to Portfolio. Trigger for Level 2: importing a company whose tech area is clearly outside the current taxonomy. The Portfolio Comparison analysis reveals when divergence is sufficient to warrant a separate taxonomy.

- **Portfolio groups — when to create?** When we have 3+ portfolios that clearly share a technology domain but differ from other portfolios in the system. The semiconductor group (broadcom, intel, qualcomm) is the natural first group. Competitive analysis and enrichment scope naturally at the group level.

- **Multi-taxonomy per patent — when useful?** Two concrete use cases: (1) evaluating a candidate taxonomy against the current one during refactoring — classify patents under both, compare scores, decide which is better; (2) a technology taxonomy plus a market-segment taxonomy providing orthogonal views. Both are Phase 4+ capabilities.

- **3rd party data (Patlytics etc.)?** Can import external classification data as `source: 'EXTERNAL'` associations. Useful for training the system and filling gaps where CPC rules alone are insufficient.

- **Sub-sector PROSPECTIVE status workflow?** The expansion algorithm generates PROSPECTIVE sub-sectors as previews. The GUI should allow promoting to APPLIED or archiving. This workflow needs to be built — currently the status exists but the promotion path is code-only.

- **IPC→CPC mapping timeline?** Pre-2013 patents with IPC codes need mapping. The WIPO mapping table exists. Implementation priority depends on how many pre-2013 patents are in the system and whether they're in scope for analysis.
