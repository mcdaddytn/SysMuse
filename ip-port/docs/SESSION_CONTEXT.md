# Session Context — March 29, 2026

## Current Focus: Scoring Framework — Phase 1 Complete, Phase 2 Next

**Scoring Framework Phase 1 is complete.** The generalized formula engine (`FormulaDefinition` + `FormulaWeightProfile` in DB, `evaluateFormula()` engine) reproduces both existing scoring systems with exact parity (36/36 regression tests, 0.000000 diff). Two formula definitions seeded (v2-enhanced, llm-composite-portfolio) with 8 weight profiles.

**Next up: Phase 2 — Grouped Terms + Taxonomy-Scoped Formulas.** The engine supports `GroupTerm` in its type system but no seeded formulas use it yet. Next steps: build taxonomy-scoped formulas with separated term groups (portfolio questions vs sector questions vs citation metrics), move consensus scoring to backend, and wire the frontend scoring pages to use the formula engine.

**Key constraint:** Existing endpoints and frontend are untouched. The `?engine=formula` adapter on `/api/scores/v2-enhanced` enables side-by-side verification. Frontend migration happens after Phase 2 formula features are stable.

**Previous milestone (2026-03-28):** Schema design + data migration complete. Abstract taxonomy model live with Portfolio Group architecture.

**Previous milestone (2026-03-29):** Full v2 taxonomy generated with consolidation pipeline. Doc reorganization to align with 00-06 design series.

**Current milestone (2026-03-29):** Formula engine Phase 1 complete — schema, engine, seed, API, regression tests all passing.

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
| `docs/design/TAXONOMY_REFACTOR_SYSTEM.md` | **Parameterized taxonomy refactor system — RefactorSpec, services, future optimization loop** |

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

### Generalized Taxonomy Refactor System (2026-03-29)

Replaced ad-hoc per-sector scripts with generalized services:

| Service | Replaces | Purpose |
|---------|----------|---------|
| `taxonomy-analyzer-service.ts` | `analyze-*-cpc.cjs` scripts | CPC distribution, portfolio sizing, dual numbering detection |
| `taxonomy-proposer-service.ts` | `setup-v2-*.ts` scripts | Sub-sector proposal generation, node/rule creation |
| `taxonomy-refactor-service.ts` | Manual script orchestration | Full analyze→propose→classify→validate loop |

**Design doc:** `docs/design/TAXONOMY_REFACTOR_SYSTEM.md` — covers:
- `RefactorSpec` — parameterized transformation specification
- `InputScope` — filtering (portfolios, sectors, topN, diversity samples)
- `HierarchySpec` — depth, level targets, naming conventions
- `ClassificationSpec` — associations, weighting, quality goals
- `ExecutionSpec` — iterations, convergence, LLM budget, interactive mode
- `QuestionStrategySpec` — future structured question integration
- Bottom-up refactor with bubble-up to reshape higher levels
- Integration with existing batch_jobs infrastructure

**Key design decisions:**
- Uses existing `multi-classification-service.ts` weight formula (priority * 0.1, not the 0.01 from scripts)
- Filters Y-section indexing codes (scripts didn't)
- Supports iterative refinement with convergence detection
- Designed for future structured question refactor loop integration

### Full v2 Taxonomy Generated (2026-03-29)

Ran the generalized refactor pipeline across all 54 sectors (2 SDN sectors were already done manually). The pipeline includes a new **consolidation phase** that merges undersized sub-sectors via agglomerative clustering by CPC prefix similarity.

| Metric | Value |
|--------|-------|
| Super-sectors (L1) | 12 |
| Sectors (L2) | 56 |
| Sub-sectors (L3) | 293 |
| Rules | 3,693 |
| Classifications | 173,789 |
| Unique patents classified | 77,432 / 84,321 (91.8%) |
| Converged sectors | 26/54 |

**Key implementation details:**
- Agglomerative merging: CPC prefix similarity drives merge decisions, smallest pairs first
- Empty node cleanup after consolidation
- General bucket review: reclassifies catch-all patents when broader rules emerge
- Sector-size-aware targets: small sectors (<200 patents) → 2-5 sub-sectors; large sectors → 5-25
- Split phase for oversized sub-sectors (limited but functional)
- Convergence detection: stops when violations plateau between iterations
- `skipDuplicates` on classification inserts for cross-sector patent overlap

**Files:**
- `src/api/services/taxonomy-refactor-service.ts` — Full pipeline with consolidation
- `src/api/services/taxonomy-proposer-service.ts` — Proposal generation + collision handling
- `scripts/run-v2-full-refactor.ts` — Runner script
- `scripts/run-v2-classify-missing.ts` — Classification backfill utility

### Implementation Phase (Updated Roadmap)

**Completed:**
- [x] Cross-classification query service
- [x] Classification API routes
- [x] v2 TaxonomyType structure created
- [x] v2 pilot (network-switching: 30, network-management: 18 sub-sectors)
- [x] Generalized taxonomy refactor services (analyzer, proposer, orchestrator)
- [x] **Consolidation phase (agglomerative merge, split, general review)**
- [x] **Full v2 taxonomy generated (293 sub-sectors, 56 sectors)**

**Next implementation priorities (aligned with 00-06 design docs):**

1. **Scoring Framework (02-scoring-framework.md)** — PHASE 1 COMPLETE
   - [x] Understand current V2 formula implementation in code
   - [x] Design FormulaDefinition schema that can express the current formula exactly
   - [x] Implement formula engine that evaluates FormulaDefinition structures
   - [x] Seed current V2 formula as a FormulaDefinition row
   - [x] Verify new engine produces identical scores to existing code (36/36 regression tests pass)
   - [x] Add configurable scaling functions (linear, sqrt, log, nroot, range, sigmoid, step, raw)
   - [x] Migrate weight profiles to WeightProfile table (8 profiles linked to 2 formulas)
   - [x] Wire `?engine=formula` adapter on v2-enhanced endpoint for verification
   - [ ] Add grouped terms support (portfolio questions group, citation group, sector group)
   - [ ] Build taxonomy-scoped formulas (sector/sub-sector with inherited question groups)
   - [ ] Move consensus scoring to backend endpoint using multiple WeightProfiles
   - [ ] Wire scoring page to read formula from DB instead of hardcoded logic
   - [ ] SQL materialized view generation from formula structures

2. **Snapshot Enhancement (04-snapshots.md)** — builds on scoring framework
   - [ ] Enhanced snapshot schema with provenance (creation method, source snapshots, normalization)
   - [ ] revAIQ currency tracking per snapshot entry
   - [ ] Normalization strategies (zero-weight infill, aggregate-preserving expansion)
   - [ ] Auto-snapshot after enrichment

3. **revAIQ Question Versioning (03-consensus-scoring.md)** — enables cost-effective re-scoring
   - [ ] QuestionVersion table tracking current version at each taxonomy level
   - [ ] PatentQuestionCurrency table for per-patent revAIQ tracking
   - [ ] Currency service computing gaps between patent state and latest available

4. **Enrichment Pipeline (05-enrichment.md)** — version-aware, cost-managed
   - [ ] Use revAIQ to skip already-current patents
   - [ ] Mixed-model normalization (overlap-based cross-model correction)
   - [ ] Cost estimation before enrichment runs

5. **Taxonomy-Question Loop (07-taxonomy-question-integration.md)** — iterative optimization
   - [ ] Design and document the feedback loop in more detail
   - [ ] Integrate with scoring framework for differentiation evaluation

**Deferred (documented but lower priority):**
- [ ] Wire refactor services into batch_jobs + API routes (operationalize taxonomy refactor)
- [ ] Interactive mode for taxonomy refactor (intervention points for user review)
- [ ] Claim-level prosecution enrichment (requires data source research — see note in 07 doc)
- [ ] Product entity as first-class citizen (needed for vendor heat map import)

---

## Priority Design Documents

The **00-06 design doc series** under `docs/design/` is the current design system. All implementation should reference these docs. Older development queues (V3-V6) and superseded design docs have been archived to `docs/archive/`.

| Document | Focus Area | Status |
|----------|-----------|--------|
| `00-overview.md` | System vision, phased roadmap, architecture | Reference |
| `01-taxonomy-refactor.md` | Multi-classification, named taxonomies, portfolio groups | Partially implemented (v2 taxonomy done, multi-assoc done) |
| `02-scoring-framework.md` | Formula engine, grouped terms, weight profiles, scaling functions | **Phase 1 complete** — engine + schema + seed + regression |
| `03-consensus-scoring.md` | Structured questions, revAIQ versioning, question inheritance | **NEXT PRIORITY** |
| `04-snapshots.md` | Provenance, normalization strategies, snapshot lifecycle | **NEXT PRIORITY** |
| `05-enrichment.md` | Version-aware enrichment, cost management, auto-snapshot | Near-term |
| `06-migration-plan.md` | Phased migration, regression testing, Claude Code skills | Reference |
| `07-taxonomy-question-integration.md` | Taxonomy↔question optimization loop (design notes) | **NEW** — design insights |

### What's NOT in 00-06 (tracked separately)

| Feature | Status | Notes |
|---------|--------|-------|
| Prosecution enrichment | Deferred | Needs data source research; may need paid data |
| Product entity | Deferred | Blocked by vendor data format clarity |
| Vendor integration/export | Paused | Vendor packages exist; product entity needed for import |
| Tournament scoring | Archived | Alternative workflow, not current priority |

---

## Scoring Framework State

### Phase 1 Complete — Formula Engine

| Component | File | Status |
|-----------|------|--------|
| FormulaDefinition model | `prisma/schema-v2.prisma` | Live in DB |
| WeightProfile extended | `prisma/schema-v2.prisma` | `formulaDefId`, `consensusWeight`, `userId`, `isBuiltIn` added |
| Formula types | `src/api/services/formula-types.ts` | FormulaStructure, MetricTerm, GroupTerm, ScalingConfig, etc. |
| Formula engine | `src/api/services/formula-engine.ts` | `evaluateFormula()` with 7 scaling fns, multipliers, 3 sparse modes |
| API routes | `src/api/routes/formulas.routes.ts` | CRUD + `/evaluate` endpoint |
| Seed script | `prisma/seed-formulas.ts` | 2 formulas, 8 profiles seeded |
| Regression tests | `scripts/test-formula-engine.ts` | 36/36 pass, 0.000000 diff |
| V2 adapter | `src/api/routes/scores.routes.ts` | `?engine=formula` on `/v2-enhanced` |

**Seeded formulas:**
- `v2-enhanced` (PORTFOLIO scope): 13 terms (5 quantitative + 6 LLM + 2 API), year multiplier, renormalize sparse handling
- `llm-composite-portfolio` (PORTFOLIO scope): 7 LLM terms (1-10 scale), zero sparse handling

**Seeded weight profiles:** default, litigation, licensing, defensive, quick_wins, executive, aggressive_litigator, llm-default

### Phase 2 — Remaining Work
- Grouped terms (portfolio questions group, citation group, sector questions group)
- Taxonomy-scoped formulas with inherited question groups
- Consensus scoring backend
- Frontend migration to formula engine
- Mixed-model normalization (Haiku/Sonnet/Opus scores comparable)
- Snapshot management with revAIQ tracking
- SQL materialized view generation

---

## Git State

```
Branch: main
Recent commits:
  - (pending) Add generalized formula engine with regression-tested scoring parity
  - 5932334 Update SESSION_CONTEXT with scoring framework as next priority
  - 6a3df40 Reorganize docs: archive old queues, add taxonomy-question integration design notes
  - 2bb0b68 Add consolidation to taxonomy refactor pipeline, generate full v2 taxonomy
```

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
| **Priority design docs** | `docs/design/00-*.md` through `07-*.md` |
| Supporting design docs | `docs/design/SCHEMA_*.md`, `TAXONOMY_*.md` |
| Archived docs | `docs/archive/`, `docs/design/archive/` |
| Analysis output | `output/*.json` |
| Scripts | `scripts/` |
| Taxonomy config | `config/sector-taxonomy-cpc-only.json` |
| Scoring templates | `config/scoring-templates/` |
| LLM cache | `cache/llm-scores/` |
| Patent XMLs | `$USPTO_PATENT_GRANT_XML_DIR` |

---

*Last Updated: 2026-03-29 (formula engine Phase 1 complete, v2 taxonomy complete, docs reorganized to 00-07 design series)*
