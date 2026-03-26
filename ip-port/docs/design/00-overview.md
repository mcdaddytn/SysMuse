# 00 — Design Overview

## Vision

IP-Port is evolving from a single-portfolio patent analysis tool into a comprehensive I.P. management workstation. The system supports multiple portfolios, discovers competitors and affiliates, and enriches data incrementally for competitive analysis across portfolios.

Future expansion includes products, product subsystems, and technology stacks — linking patent portfolios to market activity for infringement prediction and licensing opportunity identification. The current refactor positions the system architecturally for these additions without implementing them immediately.

## Problem Statement

The system was built organically to gather and analyze one portfolio (Broadcom). Features were added incrementally without a comprehensive data architecture, resulting in scattered queries, hard-coded paths, inflexible taxonomy, and scoring that doesn't gracefully handle evolving LLM questions. The refactor addresses these issues while preserving the working system at every stage.

Concrete problems being solved:

- **Data fragmentation**: Patent data lives across Postgres tables, JSON cache files, XML bulk archives, and optionally Elasticsearch, with no unified access pattern or metadata describing where fields reside.
- **Rigid taxonomy**: Single super-sector/sector/sub-sector classification per patent, with no support for multiple associations or alternative classification schemes.
- **Scoring inflexibility**: V2 and V3 scores are special-cased rather than instances of a general scoring framework applicable at any taxonomy level.
- **Brittle versioning**: Binary staleness flag instead of granular tracking of which question versions and LLM models have been applied to each patent.
- **Snapshot limitations**: No principled way to combine snapshots from different scoring versions or normalize across heterogeneous LLM data.

## Design Principles

1. **Incremental enhancement**: The system works today. Every change must keep it working. Additive changes (new tables, new services, new endpoints) are preferred over modifications to existing code.

2. **Metadata-driven architecture**: The Attribute Registry (see `hmda-v2-architecture.md`) describes where every field lives — Postgres columns, EAV rows, JSON cache paths, XML selectors, Elasticsearch fields, computed formulas. Services use the registry rather than hard-coding data locations.

3. **Analysis before commitment**: Before refactoring taxonomy, scoring, or versioning, we build analysis services (see `taxonomy-analysis-service-detail.md`) that run against existing data to answer design questions with evidence. The analysis results inform which changes to make and in what order.

4. **Pragmatic generalization**: Schema additions support the general case (multiple named taxonomies, arbitrary score types, portfolio groups, multiple entity types) while implementation targets current capabilities. The taxonomy scope evolves through a spectrum: unnamed global → named taxonomy → multiple named taxonomies → portfolio groups → multi-taxonomy per patent → taxonomy evolution tools. We start at Level 0 and advance only when concrete need arises.

5. **Claude Code as a first-class consumer**: Every new service exposes REST endpoints suitable for Claude Code skills. During refactor, Claude Code runs regression tests, taxonomy analysis, and scoring validation against live data. Longer autonomous sessions — implementing a feature, testing against a reference instance, iterating on fixes — are a primary design goal (see `06-migration-plan.md`).

6. **Parallel instances for safety**: A reference instance (second laptop or same-machine different ports) running a tagged release with a database snapshot provides ground truth for regression testing. Claude Code compares primary vs. reference query results to verify changes are safe. Frequent tagging ensures any state can be recreated. See `06-migration-plan.md` for the full parallel-instance architecture.

## Component Relationships

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         HMDA v2 Data Architecture                       │
│                                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                 │
│  │  Attribute   │───▶│   Storage   │───▶│   Query     │                 │
│  │  Registry    │    │ Coordinator │    │   Builder   │                 │
│  └─────────────┘    └─────────────┘    └─────────────┘                 │
│         │                                     │                         │
│         ▼                                     ▼                         │
│  ┌─────────────┐                      ┌─────────────┐                  │
│  │   Formula    │                      │ Materialized│                  │
│  │   Engine     │                      │   Views     │                  │
│  └─────────────┘                      └─────────────┘                  │
└──────────────────────────────────────────────────────────────────────────┘
        │                    │                    │
        ▼                    ▼                    ▼
┌──────────────┐   ┌──────────────┐    ┌──────────────┐
│  01-Taxonomy │   │  02-Scoring  │    │ 04-Snapshots │
│  Management  │   │  Framework   │    │ & Normalize  │
└──────────────┘   └──────────────┘    └──────────────┘
        │                │                     │
        │          ┌─────┴──────┐              │
        │          │03-Consensus│              │
        │          │  Scoring   │              │
        │          └────────────┘              │
        │                                      │
        └──────────┬───────────────────────────┘
                   │
           ┌───────▼───────┐
           │05-Enrichment  │
           │  & Auto-Calc  │
           └───────────────┘
                   │
           ┌───────▼───────┐
           │06-Migration   │
           │  & Roadmap    │
           └───────────────┘
```

## Data Flow

The enrichment pipeline follows a natural sequence of increasing cost and value:

1. **Import**: Add company → discover affiliates/competitors → import patent IDs from PatentsView API
2. **Basic enrichment**: USPTO data (title, abstract, CPC codes, dates, citations) → affiliate matching → sector assignment → base score calculation
3. **Selective enrichment**: TopN by base score → LLM portfolio questions → V2 scoring → prosecution history → XML claims extraction
4. **Taxonomy-level enrichment**: TopN within sectors/sub-sectors → sector-specific LLM questions → taxonomy-level scoring
5. **Iterative refinement**: Taxonomy refactoring → question evolution → snapshot normalization → re-enrichment of topN with updated scores
6. **Competitive analysis**: Competitor portfolio enrichment → cross-portfolio comparison → product data integration
7. **Export**: Focus areas → vendor packages → litigation assessments

At each stage, scores from the previous stage drive enrichment decisions for the next. The snapshot system (see `04-snapshots.md`) handles the reality that data is always heterogeneous — different patents are at different enrichment levels, and normalization bridges the gaps.

## Implementation Roadmap

### Phase 1: Foundation (Current)
Non-breaking additions to support analysis and future phases. Establish regression infrastructure.

| Deliverable | Document | Risk |
|-------------|----------|------|
| Attribute Registry table + seed | `hmda-v2-phase1-implementation.md` | None — additive |
| Introspection Service + API | `hmda-v2-phase1-implementation.md` | None — new endpoints |
| Taxonomy Analysis Service | `taxonomy-analysis-service-detail.md` | None — read-only |
| LLM Currency Analysis Service | `hmda-v2-phase1-implementation.md` | None — read-only |
| Materialized view (mv_patent_summary) | `hmda-v2-phase1-implementation.md` | Low — feature-flagged |
| Claude Code data query + regression skills | `06-migration-plan.md` | None — new skills |
| Reference instance setup (second laptop or same-machine) | `06-migration-plan.md` | None — infrastructure |
| Tag `v-pre-refactor` and `v-phase-1-complete` | `06-migration-plan.md` | None |

### Phase 2: Scoring & Snapshots Enhancement
Generalize scoring, improve snapshots, add versioning groundwork.

| Deliverable | Document | Risk |
|-------------|----------|------|
| Formula definitions in DB | `02-scoring-framework.md` | Low — additive tables |
| Weight profiles in DB | `02-scoring-framework.md` | Low — replaces JSON files |
| Enhanced snapshot schema | `04-snapshots.md` | Medium — new tables, migration |
| Snapshot normalization service (Strategies 1-2) | `04-snapshots.md` | Medium — new logic |
| Question version tracking tables | `05-enrichment.md` | Low — additive tables |
| Named taxonomy entity (`TaxonomyDefinition`) | `01-taxonomy.md` | Low — additive |

### Phase 3: Taxonomy Multi-Classification
Based on Phase 1 analysis results. Driven by what the data shows.

| Deliverable | Document | Risk |
|-------------|----------|------|
| `PatentTaxonomyAssociation` table + migration | `01-taxonomy.md` | Medium — schema + data migration |
| Multi-classification algorithm (rank 1-3) | `01-taxonomy.md` | Medium — new service |
| Classification confidence scoring | `01-taxonomy.md` | Low — analytical |
| Catch-all General categories + prefix naming | `01-taxonomy.md` | Low — additive |
| Enrichment with multi-classification question batching | `05-enrichment.md` | Medium — service changes |
| Taxonomy Management GUI enhancements | `01-taxonomy.md` | Medium — UI changes |

### Phase 4: Data Service Layer + Named Taxonomies
Replace scattered queries with unified access. Enable taxonomy scope evolution.

| Deliverable | Document | Risk |
|-------------|----------|------|
| Storage Coordinator + adapters | `hmda-v2-architecture.md` | Medium — refactor |
| Query Builder with execution planning | `hmda-v2-architecture.md` | Medium — refactor |
| Swap existing routes to DataService | `hmda-v2-architecture.md` | Higher — behavior change |
| Portfolio groups + group-scoped taxonomies | `01-taxonomy.md` | Medium — new feature |
| Dynamic view generation from formulas | `hmda-v2-architecture.md` | Medium — new feature |

### Phase 5: Advanced Features
| Deliverable | Document | Risk |
|-------------|----------|------|
| Goal-seeking enrichment loops | `05-enrichment.md` | Medium |
| Multi-taxonomy per patent (comparison mode) | `01-taxonomy.md` | Medium |
| Taxonomy merge/split/comparison tools | `01-taxonomy.md` | Medium |
| Product entity support | Future design doc | Higher |
| Contextual gravity (Focus Areas) | Future design doc | Medium |
| Normative view manipulation | `02-scoring-framework.md` | Higher |

## Key Architectural References

| Document | Purpose |
|----------|---------|
| `hmda-v2-architecture.md` | Full data architecture: registry, storage coordinator, formula engine, query builder, versioning |
| `hmda-v2-phase1-implementation.md` | Phase 1 implementation: registry schema, seed data, analysis services, materialized views |
| `taxonomy-analysis-service-detail.md` | Seven-module taxonomy analysis service with full SQL implementations |
| `DATA_ARCHITECTURE_CONTEXT.md` | Current-state reference: existing schema, query patterns, hard-coded paths |
| `SYSTEM_OVERVIEW.md` | System statistics, accomplishments, pending tasks |

## Page Refactoring Notes

These UI changes are deferred but tracked here for planning:

- **Scoring pages**: V2 Scoring page becomes a general "User Scoring" page applicable at any taxonomy level. V3 becomes "Consensus Scoring" applicable to any score type. The page adapts its metric sliders based on the selected score scope.
- **Sector management**: Becomes "Taxonomy Management" — generalized to handle any classification hierarchy, not just super-sector/sector/sub-sector.
- **LLM Scores page**: Merged into the scoring pages since most scores derive from LLM metrics. The distinction between "LLM Scores" and "V2 Scoring" dissolves.
- **Filtering**: Patent Summary and Aggregate View get progressive filtering — selecting a super-sector limits available sectors, with an Apply button for performance. Available options and counts recalculate after Apply.
- **Admin**: New admin features for taxonomy configuration, score type management, and system settings. Initially read-only to demonstrate flexibility without the complexity of dynamic schema changes.

## Open Questions

- **Product data integration**: External vendor will provide patent-to-product mappings. Schema needs to accommodate this, but detailed design is deferred until data format is known.
- **Contextual gravity**: Planned for Focus Areas and Family Explorer to find central patents within groups. Deferred until taxonomy and scoring refactors stabilize.
- **Multi-login and access control**: Consensus scoring envisions per-user role restrictions. Current single-user mode is sufficient for initial phases.
- **Server deployment**: A previous version should be deployed on always-on infrastructure for regression testing during refactor. Specific deployment strategy TBD.
