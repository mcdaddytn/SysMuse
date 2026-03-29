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

### Multi-Classification Backfill (2026-03-28)
| Classification | Count | Coverage |
|---------------|-------|----------|
| Primary | 84,321 | 100% |
| Secondary | 43,823 | 52% |
| Tertiary | 23,777 | 28% |

**Implementation files:**
- `src/api/services/multi-classification-service.ts` - Core algorithm
- `scripts/populate-multi-classifications.ts` - Backfill script

### Taxonomy Structure Finding (2026-03-28)

**Current v1 taxonomy has a structural issue:**
- Level 3 = 31,025 individual CPC codes (not logical sub-sectors)
- All 188 rules target level 2 only
- No classification happens at level 3

**Divergence Analysis Results:**
| Level | 2+ unique | 3 unique |
|-------|-----------|----------|
| L1 (Super-sectors) | 31.9% | 4.3% |
| L2 (Sectors) | 52.0% | 28.2% |
| L3 (Sub-sectors) | 0% | 0% |

**Strategy documented:** `docs/design/TAXONOMY_STRATEGY.md`
- v1 preserved for regression testing
- v2 will have logical sub-sectors (200-500, not 31K)
- Naming convention: `{parent_abbrevs}/{slug}` - e.g., `NET/SWIT/sdn-control` (readable slug at end)
- Level metadata with target sizing (count ranges, cluster sizes, portfolio %)
- Default taxonomy selection for GUI switching between v1/v2

### v2 Taxonomy Pilot - REFINED (2026-03-28)

**Pilot scope:** SDN_NETWORK > network-switching (6,604 patents)
**Target sizes:** 100-1000 overall, <500 per portfolio (Broadcom)

**Initial pilot** had 6 sub-sectors, but routing/traffic-qos/packet-switching were too large (1000+ Broadcom each).

**Refined to 30 sub-sectors** based on CPC analysis:
- Routing: 11 sub-sectors (table-lookup, topology, multipath, shortest-path, addr-proc, etc.)
- Traffic-QoS: 8 sub-sectors (scheduling-priority, scheduling-core, bw-reservation, admission, etc.)
- Packet-Switching: 8 sub-sectors (ports, crossbar, fabric, multicast, buffer-addr, etc.)
- Existing: 3 sub-sectors (ethernet-lan, network-interconnect, general)

**Final Broadcom Distribution (all <500 target met):**
| Sub-sector | Broadcom | Status |
|------------|----------|--------|
| ethernet-lan | 402 | ✓ |
| network-interconnect | 376 | ✓ |
| general | 246 | ✓ |
| routing-table-lookup | 200 | ✓ |
| qos-bw-reservation | 191 | ✓ |
| pkt-ports | 186 | ✓ |
| ... (24 more, all <160) | | ✓ |

**Classification stats:**
- Total sub-sectors: 30
- Total rules: 83
- Classifications created: 13,860
- Multi-classification rate: 69.4%
- Avg classifications/patent: 2.16

**Key design decisions:**
1. Priority-based matching (first match wins, higher priority = more specific)
2. H04L45/47/49 rules (priority 70-85) take precedence over H04L12 (priority 60)
3. Catch-all sub-sectors for each category (routing-general, qos-other, pkt-other, general)

**Files created:**
- `scripts/setup-v2-refined.ts` - Creates 32 nodes and 83 rules
- `scripts/run-v2-pilot-classification.ts` - Priority-based classification
- `scripts/analyze-broadcom-v2.cjs` - Broadcom analysis
- `scripts/analyze-subsector-cpc-dist.cjs` - CPC distribution analysis
- `docs/design/V2_REFINED_SUBSECTORS.md` - Design documentation
- Portfolio group: `pg_v2_pilot` for v2 classifications

### v2 Network-Management Sub-sectors (2026-03-28)

**Scope:** SDN_NETWORK > network-management (4,978 patents classified)
**Target sizes:** <500 per portfolio (Broadcom)

**18 sub-sectors** across 5 CPC domains:

| Category | Sub-sectors | Largest Broadcom |
|----------|-------------|-----------------|
| Config Management | 4 (provision, sdn-nfv, automation, policy) | config-sdn-nfv: 101 |
| Monitoring | 4 (metrics-qos, active-probe, capture-flow, reporting) | mon-metrics-qos: 128 |
| NFV/Virtualization | 2 (orchestration, vnf-sfc) | nfv-vnf-sfc: 59 |
| Topology/Analysis | 2 (topology-discovery, network-analysis) | topology-discovery: 88 |
| Fault/Service/ML/Addr | 6 (fault-alarm, service-sla, ml-ai, general, addr-*) | fault-alarm: 60 |

**All Broadcom sub-sectors under 130 — well within <500 target.**

**Classification stats:**
- Total sub-sectors: 18
- Total rules: 190
- Classifications created: 11,691
- Multi-classification rate: 79.0%
- Avg classifications/patent: 2.35

**Key finding:** CPC codes H04L41/08xx (4-digit) and H04L41/8xx (3-digit) are **different CPC groups**. The 3-digit H04L41/8xx series (SDN/VM/ML management) requires separate rules from the 4-digit H04L41/08xx series (configuration management). Same applies to H04L43.

**Files created:**
- `scripts/setup-v2-network-mgmt.ts` - Creates 19 nodes and 190 rules
- `scripts/run-v2-mgmt-classification.ts` - Priority-based classification
- `scripts/analyze-network-mgmt-cpc.cjs` - CPC distribution analysis
- `docs/design/V2_NETWORK_MANAGEMENT_SUBSECTORS.md` - Design documentation

### v2 Combined Pilot Summary (2026-03-29)

| Metric | Switching | Management | Combined |
|--------|-----------|------------|----------|
| L3 Sub-sectors | 30 | 18 | 48 |
| Rules | 83 | 190 | 273 |
| Unique patents | 6,218 | 5,333 | 9,653 |
| Classifications | 11,687 | 10,987 | 22,674 |

### Lessons from Ad-Hoc Refactoring (2026-03-29)

The two sector refactors (switching, management) followed the same manual process:
1. Analyze CPC distribution with a one-off script
2. Design sub-sectors based on CPC groupings and portfolio sizes
3. Create a setup script to insert nodes + rules
4. Run classification script
5. Validate portfolio distribution, iterate on rules

**Key learnings to carry into generalized tooling:**
- CPC codes have parallel numbering schemes (e.g., H04L41/08xx ≠ H04L41/8xx) — rule generation must handle both 3-digit and 4-digit subgroup formats
- Priority-based matching (first match wins) works well; catch-all rules at low priority prevent gaps
- Overlap between v1 sectors causes classification conflicts when scripts clear/recreate per-sector — a unified classification pass across all rules would be cleaner
- Management needed 190 rules vs switching's 83, reflecting more complex CPC structure — rule count varies significantly by sector
- The analyze → design → classify → validate cycle is consistent and can be formalized

### Implementation Phase (Updated Roadmap)

**Completed:**
- [x] Cross-classification query service (`src/api/services/cross-classification-service.ts`)
- [x] Classification API routes (`src/api/routes/classifications.routes.ts`)
- [x] Naming convention documented (`docs/design/TAXONOMY_STRATEGY.md`)
- [x] v2 TaxonomyType structure created
- [x] v2 pilot classification run and analyzed
- [x] Refined sub-sectors for network-switching (30 sub-sectors, all within target)
- [x] **v2 sub-sectors for network-management (18 sub-sectors, all within target)**

**Next Steps:**
- [ ] **Generalize taxonomy refactor tooling** — move from ad-hoc per-sector scripts to reusable code callable outside Claude Code sessions. Design doc incoming.
- [ ] Continue v2 sub-sector expansion to remaining sectors (network-protocols, etc.)
- [ ] GUI updates for secondary/tertiary filters
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
Recent commits:
  - 28d13ec Updated SESSION_CONTEXT.MD before remote sess
  - 37a5232 Update SESSION_CONTEXT.md with v2 refined sub-sectors status
  - f45f583 Implement refined v2 sub-sectors for network-switching
  - 971a5ac Add v2 taxonomy pilot classification scripts and results

Uncommitted (to be committed this session):
  - scripts/setup-v2-network-mgmt.ts (setup 19 nodes + 190 rules)
  - scripts/run-v2-mgmt-classification.ts (classification script)
  - scripts/analyze-network-mgmt-cpc.cjs (CPC analysis)
  - docs/design/V2_NETWORK_MANAGEMENT_SUBSECTORS.md (design doc)
  - docs/SESSION_CONTEXT.md (this file)
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

*Last Updated: 2026-03-29 (v2 sub-sectors for network-management complete, lessons documented for generalized tooling)*
