# 06 — Migration Plan, Testing & Claude Code Skills

## Rollback Point

**Safe rollback commit:** `2200be07b4bb6ed1fcb43c268f22f1dac71cd3c7` (Feb 26, 2026)

This commit predates all major Phase 3 changes. If needed, revert to this state, restore database from backup, and restart services.

## What to Keep

- **All database data**: Preserved through all migrations. New tables are additive; existing data is never deleted.
- **Structured question templates**: `config/scoring-templates/*.json` — retained as-is. After stabilization, may refactor question placement across taxonomy levels.
- **JSON cache files**: `cache/` directory — untouched. File-based caches continue to serve as data source for on-demand long text.
- **Configuration files**: `config/*.json` — migrated to DB tables incrementally (weight profiles → WeightProfile table, sector taxonomy → already in Sector/SectorRule tables).

## What to Refactor

- **Taxonomy schema**: Add `PatentTaxonomyAssociation` for multi-classification while keeping denormalized fields
- **Scoring configuration**: Move formulas and weight profiles from code/JSON to `FormulaDefinition` and `WeightProfile` tables
- **Snapshot system**: Enhanced schema with provenance, normalization tracking, and currency awareness
- **Data access**: Scattered Prisma queries consolidated through Attribute Registry and eventually DataService
- **Hard-coded paths**: ~50+ cache path constants consolidated into registry `filePathTemplate` fields

## Migration Phases

### Phase 1: Foundation (Low Risk — All Additive)

**Goal**: Build analysis infrastructure and registry without changing existing behavior.

| Step | What | Risk | Dependency |
|------|------|------|------------|
| 1.1 | Add `AttributeDefinition` model to schema.prisma | None | — |
| 1.2 | Run `prisma migrate dev --name add_attribute_registry` | None | 1.1 |
| 1.3 | Create and run registry seed script | None | 1.2 |
| 1.4 | Build IntrospectionService + REST endpoints | None | 1.3 |
| 1.5 | Build TaxonomyAnalysisService (7 modules) | None | 1.2 |
| 1.6 | Build LlmCurrencyAnalysisService | None | 1.2 |
| 1.7 | Create `mv_patent_summary` materialized view | Low | 1.3 |
| 1.8 | Build Claude Code data query skill | None | 1.4 |
| 1.9 | Run taxonomy analysis playbook, capture results | None | 1.5 |
| 1.10 | Run LLM currency analysis, capture results | None | 1.6 |

**Verification**: All existing pages continue to work. New `/api/analysis/*` and `/api/data/*` endpoints return valid data. Materialized view query returns same results as current Patent Summary query.

### Phase 2: Scoring & Snapshot Enhancement (Medium Risk)

**Goal**: Generalize scoring, improve snapshot provenance, add version tracking groundwork.

| Step | What | Risk | Dependency |
|------|------|------|------------|
| 2.1 | Add `FormulaDefinition`, `WeightProfile` tables | Low | Phase 1 |
| 2.2 | Seed current V2 formula as FormulaDefinition | Low | 2.1 |
| 2.3 | Migrate `user-weight-profiles.json` to WeightProfile rows | Low | 2.1 |
| 2.4 | Add enhanced `ScoreSnapshot` fields (provenance) | Medium | 2.1 |
| 2.5 | Add `QuestionVersion`, `PatentQuestionCurrency` tables | Low | 2.1 |
| 2.6 | Build Formula Engine (TypeScript evaluation) | Low | 2.2 |
| 2.7 | Build snapshot normalization service (Strategies 1-2) | Medium | 2.4 |
| 2.8 | Add auto-snapshot after enrichment (configurable) | Medium | 2.7 |
| 2.9 | Wire scoring page to read FormulaDefinition from DB | Medium | 2.6 |
| 2.10 | Add read-only question viewer component | Low | 2.5 |

**Verification**: V2 scoring page produces identical results when reading formula from DB vs. hardcoded. Snapshots created with new schema match previous format. Auto-snapshot after enrichment creates valid snapshots.

### Phase 3: Taxonomy Generalization (Medium-High Risk)

**Goal**: Multiple taxonomy associations, enhanced classification, taxonomy-level enrichment.

| Step | What | Risk | Dependency |
|------|------|------|------------|
| 3.1 | Add `PatentTaxonomyAssociation` table | Low | Phase 2 |
| 3.2 | Populate associations from existing denormalized fields | Medium | 3.1 |
| 3.3 | Enhanced classification algorithm (multi-sector scoring) | Medium | 3.1 |
| 3.4 | Classification confidence scoring | Low | 3.3 |
| 3.5 | Update enrichment to use multi-classification for question batching | Medium | 3.3 |
| 3.6 | Update scoring pages for taxonomy-level scope selection | Medium | Phase 2 |
| 3.7 | Taxonomy Management GUI enhancements | Medium | 3.1 |

**Verification**: Existing sector assignments preserved. New secondary/tertiary classifications are reasonable (validated against taxonomy analysis results). Enrichment correctly batches questions from all classification paths.

### Phase 4: Full Data Service Layer (Higher Risk)

**Goal**: Unified data access replacing scattered queries.

| Step | What | Risk | Dependency |
|------|------|------|------------|
| 4.1 | Build StorageCoordinator with PostgresAdapter | Medium | Phase 1 |
| 4.2 | Add JsonCacheAdapter, XmlBulkAdapter | Medium | 4.1 |
| 4.3 | Build QueryBuilder with execution planning | Medium | 4.1 |
| 4.4 | Patent Summary page: parallel query via DataService (feature-flagged) | Medium | 4.3 |
| 4.5 | Verify DataService results match existing queries | High | 4.4 |
| 4.6 | Swap Patent Summary to DataService (remove feature flag) | High | 4.5 |
| 4.7 | Swap remaining pages to DataService | High | 4.6 |
| 4.8 | Add Elasticsearch adapter | Medium | 4.2 |

**Verification**: Side-by-side comparison of DataService query results vs. existing Prisma queries for every page. Performance benchmarking against materialized view path.

## Testing Strategy

### Regression Testing Approach

Deploy a "reference instance" on the local network running the pre-refactor codebase against a snapshot of the production database. This serves as ground truth for comparison.

**Reference instance setup:**
1. Tag the current working state: `git tag v-pre-refactor`
2. Database backup: `pg_dump ip_port > pre-refactor-backup.sql`
3. Deploy reference instance on a local machine with the backup
4. Reference instance is read-only — never modified during refactor

### Snapshot-Based Regression Tests

Before each phase, capture data snapshots through existing services:

```
# Patent Summary: capture current query results
GET /api/patents?portfolioId=X&limit=5000&sortBy=baseScore → save as patent-summary-baseline.json

# Aggregate View: capture current aggregations
GET /api/patents/aggregate?groupBy=superSector&portfolioId=X → save as aggregate-baseline.json

# V2 Scoring: capture current scoring results
GET /api/scores/v2-enhanced?portfolioId=X&presetId=default&topN=2000 → save as v2-scoring-baseline.json

# Sector view: capture sector distribution
GET /api/sectors → save as sectors-baseline.json
```

After each migration step, re-run the same queries and diff against baselines. Any unexpected changes indicate a regression.

### Claude Code Regression Testing

Claude Code skills can automate regression testing:

```
Skill: regression-test
1. Fetch baselines from reference instance
2. Fetch same data from development instance
3. Compare: row counts, score distributions, ranking correlation
4. Report: which fields changed, by how much, for which patents
```

This runs as part of the development workflow — after every significant change, Claude Code validates that existing behavior is preserved.

## Claude Code Skills Roadmap

### Phase 1 Skills (Built With Phase 1 Services)

**Skill: data-query**
```
Purpose: Query patent data through the introspection and data service APIs
Entry point: GET /api/data/introspect → understand available fields
Key operations:
  - POST /api/data/query → filtered, sorted, paginated patent data
  - GET /api/data/patent/:id → detailed patent with on-demand text
  - POST /api/data/aggregate → grouped metrics
  - GET /api/data/stats → system overview
```

**Skill: taxonomy-analysis**
```
Purpose: Run taxonomy analysis modules and interpret results
Entry point: GET /api/analysis/taxonomy/coverage → baseline census
Key operations:
  - CPC distribution, multi-classification potential, confidence distribution
  - Portfolio comparison, sector balance, rule effectiveness
  - CPC hierarchy drill-down for sector splitting decisions
```

**Skill: llm-currency**
```
Purpose: Analyze LLM data freshness and model distribution
Key operations:
  - Model distribution, template version distribution
  - Staleness report by sector
  - Rerun cost estimation
  - Model comparison overlap analysis
```

### Phase 2 Skills

**Skill: scoring-analysis**
```
Purpose: Evaluate formula configurations, compare weight profiles, test normalization
Key operations:
  - Compute scores with arbitrary weight profiles
  - Compare two snapshots (ranking correlation, movement)
  - Test normalization strategies on sample data
  - Estimate impact of adding new metric at various weights
```

**Skill: regression-test**
```
Purpose: Automated regression testing comparing dev vs. reference instance
Key operations:
  - Capture baseline snapshots from reference instance
  - Compare query results between instances
  - Report deltas with statistical significance
  - Validate materialized view contents against direct queries
```

### Phase 3+ Skills

**Skill: taxonomy-refactor**
```
Purpose: Assist with taxonomy restructuring decisions
Key operations:
  - Simulate sector splits/merges using CPC hierarchy data
  - Estimate impact on patent distribution
  - Generate new sector rules from CPC analysis
  - Validate classification changes against baseline
```

**Skill: question-generation**
```
Purpose: Help develop and test new structured LLM questions
Key operations:
  - Analyze current question coverage by taxonomy level
  - Suggest questions based on CPC descriptions and sector focus
  - Test questions on sample patents before batch deployment
  - Estimate scoring impact of new questions at various weights
```

**Skill: enrichment-planning**
```
Purpose: Plan enrichment campaigns with cost awareness
Key operations:
  - Identify patents needing enrichment by scope and revAIQ gap
  - Estimate costs for various topN and model combinations
  - Simulate iterative enrichment with bubble-up parameters
  - Generate enrichment plan with phased execution
```

## Branch and Version Strategy

### During Active Refactor

```
main                     ← stable, deployable at all times
  └── refactor/phase-1   ← Phase 1 work, merged to main when complete
  └── refactor/phase-2   ← Phase 2 work, branched from main after Phase 1 merge
  └── refactor/phase-3   ← etc.
```

**Tags:**
- `v-pre-refactor` — last known good state before any changes
- `v-phase-1-complete` — after Phase 1 merged and verified
- `v-phase-2-complete` — etc.

### Database Migrations

Each phase produces Prisma migrations that are:
1. Forward-only (no destructive changes)
2. Tested against a copy of production data before deployment
3. Backed up with `pg_dump` before execution

If a migration fails:
```bash
# 1. Stop services
# 2. Restore database
pg_restore -d ip_port pre-phase-N-backup.sql
# 3. Checkout previous tag
git checkout v-phase-(N-1)-complete
# 4. Restart services
```

## Deployment Strategy

### Development (Current)
Local development with local Postgres. All new services tested here first.

### Reference Instance
Pre-refactor codebase running on local network machine with production database snapshot. Used for regression testing throughout the refactor.

### Production
Eventually deployed to always-on server infrastructure. Specific hosting strategy TBD — but the goal is to have a stable instance accessible remotely for demo and analysis purposes.

## Open Questions

- **Reference instance hosting**: Local machine vs. cloud VM? Local is simpler but requires the machine to be on. Cloud VM has a monthly cost but is always available.
- **Database size management**: Current database with 84K patents and all enrichment data. Size estimate? Need to monitor growth as materialized views and snapshot tables are added.
- **Zero-downtime migration**: Can we migrate schemas while the app is running? Prisma migrations lock tables briefly — acceptable for our single-user development scenario but needs thought for production.
- **Multi-instance data sync**: If we have a reference instance and a development instance, how do we keep the database copies manageable? Periodic pg_dump/restore vs. logical replication?
