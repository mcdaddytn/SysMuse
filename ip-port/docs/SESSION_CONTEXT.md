# Session Context — March 28, 2026

## Current Focus: Implementation Phase

We have completed the **schema design phase** and **data migration**. The abstract taxonomy model is now live with the Portfolio Group architecture.

**Migration completed:** 2026-03-28

### Pre-Refactor State Tagged

```
git tag: v1.0-pre-refactor
commit:  f87042f
```

Safe rollback point. Database state has been exported and verified on separate machine.

---

## Taxonomy Analysis Completed

### Key Findings

| Metric | Value | Implication |
|--------|-------|-------------|
| **82.7%** of top patents | have multiple inventive CPCs | High-value patents are complex |
| **51.4%** of top patents | map to multiple sectors | Single-classification loses nuance |
| **34.8%** of top patents | span multiple super-sectors | Cross-domain innovations |
| **N=3 associations** | captures 92.7% of sector coverage | Sweet spot for privileged associations |

### Optimal Association Count

| N | Sector Coverage | Marginal Gain |
|---|-----------------|---------------|
| 1 (current) | 49.6% | - |
| 2 | 79.6% | +30.0% |
| **3 (optimal)** | **92.7%** | +13.0% |
| 4 | 97.3% | +4.6% (diminishing) |

**Decision:** Target 3 privileged associations (primary, secondary, tertiary) with configurable expansion for high-value patents.

### Portfolio Group Architecture (Key Decision)

Replaces the concept of "global" taxonomy/settings:

- **Portfolio Group** = scoped set of related portfolios (competitors, tech areas)
- Each group has its own taxonomy configuration, weights, thresholds
- Admin-configurable parameters per group:
  - Privileged association count (default 3)
  - CPC weighting (inventive vs additional)
  - Association weighting (primary vs secondary vs tertiary)
  - LLM model tier and question count
  - Clustering thresholds

**Tiered Analysis Strategy:**
- Large screening groups (~100K patents) with standard settings
- Elite groups (~2K patents) with more associations, better models
- Promote high-value patents from screening to elite groups
- Elegantly solves the "8% need 4+ associations" problem

### Open Questions (Noted for Future)

1. **Sparse associations:** Some patents won't fill 3 slots. Options: null, duplicate primary, lower-confidence from additional CPCs
2. **High-value exceptions:** 8% need 4+ associations. Consider special handling / expanded LLM questions
3. **Weighting:** Inventive vs additional CPCs, reinforcement when multiple CPCs map to same sector

### Analysis Scripts Created

| Script | Purpose |
|--------|---------|
| `scripts/analyze-taxonomy-coverage.ts` | Overall CPC coverage, indexing codes |
| `scripts/analyze-taxonomy-gaps.ts` | Unmapped CPC analysis, core class gaps |
| `scripts/analyze-inventive-cpc-divergence.ts` | High-value patent divergence patterns |
| `scripts/analyze-association-coverage.ts` | Coverage curves, optimal N determination |
| `scripts/analyze-taxonomy-clustering.ts` | Sector co-occurrence, natural clusters |

### Analysis Output Files

Located in `output/`:
- `taxonomy-analysis-*.json` - Full coverage analysis
- `taxonomy-gaps-*.json` - Gap deep-dive
- `inventive-divergence-*.json` - High-value patent CPC divergence
- `association-coverage-*.json` - Coverage curves
- `taxonomy-clustering-*.json` - Co-occurrence clusters

**Note for machine transfer:** Include `output/` directory in transfers to preserve analysis results.

---

## Natural Sector Clusters Identified

7 clusters based on co-occurrence (Jaccard similarity > 0.25):

| Cluster | Overlap | Note |
|---------|---------|------|
| cameras-sensors + video-codec | **42%** | Cross-domain (IMAGING↔VIDEO_STREAMING) |
| image-processing + recognition-biometrics | 31% | Within IMAGING |
| wireless-scheduling + mobility + infrastructure | 24-31% | Within WIRELESS |
| video-client-processing + video-server-cdn | 31% | Within VIDEO_STREAMING |

If clustered: N=3 coverage improves from 92.7% to 95.7%.

---

## Design Documentation

| Document | Purpose |
|----------|---------|
| `docs/design/TAXONOMY_ANALYSIS_RESULTS.md` | Analysis findings, coverage curves, cluster recommendations |
| `docs/design/SCHEMA_TAXONOMY_ABSTRACTION.md` | **Abstract taxonomy model - pure vs pragmatic pattern** |
| `docs/design/SCHEMA_PORTFOLIO_GROUPS.md` | Portfolio Groups using abstract taxonomy references |

### Schema Design (In Progress)

**Key Design Decision:** Abstract taxonomy model to avoid hardcoded level names (super-sector, sector, sub-sector).

`SCHEMA_TAXONOMY_ABSTRACTION.md` defines:
- **TaxonomyType** - Classification system definition (object type, max depth, level labels)
- **TaxonomyNode** - Hierarchical nodes with self-referential parent
- **ObjectClassification** - Links objects to nodes with rank (1=primary, 2=secondary...)
- **TaxonomyRule** - Replaces SectorRule with taxonomy-agnostic rules
- **Pure vs Pragmatic pattern** - Normalized hierarchy + flattened fields for efficiency

`SCHEMA_PORTFOLIO_GROUPS.md` defines:
- **PortfolioGroup** - Scoped portfolio collection with config JSON
- **PortfolioGroupMember** - Portfolio ↔ Group junction
- **Tiered analysis strategy** - Screening → Elite promotion workflow
- References abstract `TaxonomyNode`, not hardcoded levels

---

## Refactor Roadmap

### Analysis Phase ✓ Complete
- [x] Basic CPC coverage analysis
- [x] Indexing code identification
- [x] High-value patent divergence
- [x] Association coverage curves
- [x] Sector clustering analysis
- [x] Portfolio Group architecture concept

### Schema Design Phase ✓ Complete
- [x] PortfolioGroup entity and relationships
- [x] Admin-configurable parameters (embedded JSON config)
- [x] Multi-classification junction table (ObjectClassification)
- [x] Abstract taxonomy model (TaxonomyType, TaxonomyNode)
- [x] Pure vs pragmatic schema pattern documented
- [x] Create clean Prisma schema (v2) with abstract model
- [x] Write data migration script
- [x] Test migration on dev database (dry-run)
- [x] Apply migration and validate

### Migration Results (2026-03-28)
| Entity | Count |
|--------|-------|
| TaxonomyTypes | 1 |
| TaxonomyNodes (level 1) | 12 |
| TaxonomyNodes (level 2) | 64 |
| TaxonomyNodes (level 3) | 31,025 |
| TaxonomyRules | 188 |
| PortfolioGroups | 1 |
| PortfolioGroupMembers | 24 |
| ObjectClassifications | 84,321 |
| Patents with pragmatic fields | 84,321 |

### Implementation Phase (Next)
- [ ] Multi-classification assignment algorithm
- [ ] Populate privileged associations for existing patents
- [ ] Cross-classification query support
- [ ] GUI updates for secondary/tertiary classification filters
- [ ] Background recalculation job system
- [ ] Tiered portfolio promotion workflow

---

## Previous Session Context (February 25)

The previous session focused on vendor package generation (VIDEO, WIRELESS, SEMICONDUCTOR). Key artifacts:

- Vendor exports in `output/vendor-exports/`
- Focus area prompts in `cache/focus-area-prompts/`
- Known issue: WIRELESS collective template missing `{{focusArea.patentData}}`

That work is preserved but paused while we focus on taxonomy/schema analysis.

---

## Git State

```
Branch: main
Behind origin: 6 commits (can fast-forward when ready)
Local commits since v1.0-pre-refactor:
  - f87042f Added sys overview and data arch docs
  - 8e66e5a Add comprehensive taxonomy coverage analysis scripts
  - 5643639 Add high-value patent CPC divergence analysis
  - 1bfddf5 Add association coverage and clustering analysis
```

Phase 3C work archived in branch: `phase-3c-archive`

---

## Infrastructure

| Component | Status | Port |
|-----------|--------|------|
| API Server | `npm run dev` | 3001 |
| Frontend | `npm run dev` (frontend/) | 3000 |
| PostgreSQL | Docker | 5432 |
| Elasticsearch | Docker | 9200 |

---

## Key Data Locations

| Data | Path |
|------|------|
| Analysis output | `output/*.json` |
| Design docs | `docs/design/` |
| Analysis scripts | `scripts/analyze-*.ts` |
| Taxonomy config | `config/sector-taxonomy-cpc-only.json` |
| LLM cache | `cache/llm-scores/` |
| Patent XMLs | `$USPTO_PATENT_GRANT_XML_DIR` |

---

*Last Updated: 2026-03-28*
