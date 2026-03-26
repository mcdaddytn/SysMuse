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

## Branch, Tag, and Release Strategy

### Tagging Convention

Every meaningful checkpoint gets a tag for instant rollback and reference-instance deployment:

```
v-pre-refactor              ← before any Phase 1 changes
v-phase-1-registry          ← after registry schema + seed
v-phase-1-analysis          ← after taxonomy + LLM analysis services added
v-phase-1-matview           ← after materialized view added
v-phase-1-complete          ← Phase 1 fully verified, all tests pass
v-phase-2-formulas          ← after formula/weight tables added
v-phase-2-snapshots         ← after enhanced snapshot schema
v-phase-2-complete          ← Phase 2 fully verified
...etc
```

Tags are lightweight and cheap. Tag before and after every migration. Tag after any change that Claude Code could use as a stable baseline for autonomous iteration.

### Branch Strategy

```
main                         ← always deployable, current best version
  └── refactor/phase-1       ← Phase 1 work, merged to main when verified
  └── refactor/phase-2       ← branched from main after Phase 1 merge
  └── refactor/phase-3       ← etc.
  └── experiment/*           ← throwaway branches for taxonomy experiments,
                               scoring formula tests, etc. — never merged
                               directly, learnings applied manually
```

**Key rule:** `main` is always a working system. Claude Code can `git checkout main` at any time and have a functional instance. Phase branches may be broken during development — that's expected.

### Incremental Release Cadence

Each tag on `main` is a potential release. The goal is frequent small merges rather than large phase-level merges:

1. Complete a step within a phase (e.g., "add registry schema and seed")
2. Verify: all existing pages work, new endpoints return valid data
3. Tag the step
4. Merge to main
5. The previous tag becomes the regression baseline for the next step

This means `main` advances in small increments, and any step can be independently rolled back by reverting to the previous tag.

## Parallel Instance Strategy

### Why Parallel Instances

During refactor, we need the ability to compare new behavior against the current system with real data. A second instance running a known-good version serves as ground truth for regression testing.

### Instance Architecture

```
┌──────────────────────────────────────┐
│  PRIMARY INSTANCE (development)      │
│  - Latest main or phase branch       │
│  - Active development database       │
│  - Port 3000 / 5432                  │
│  - Machine: development laptop       │
└──────────────────────────────────────┘
           ↕ Claude Code compares
┌──────────────────────────────────────┐
│  REFERENCE INSTANCE (stable)         │
│  - Tagged release (e.g., v-phase-1)  │
│  - Snapshot of production database   │
│  - Port 3001 / 5433                  │
│  - Machine: second laptop on LAN     │
│    (or same machine, different ports) │
└──────────────────────────────────────┘
           ↕ Periodic sync
┌──────────────────────────────────────┐
│  SERVER INSTANCE (always-on)         │
│  - Latest stable tag from main       │
│  - Full production database copy     │
│  - Accessible remotely               │
│  - Machine: dedicated server (future)│
└──────────────────────────────────────┘
```

### Setting Up the Reference Instance

**Option A: Same machine, different ports** (simplest for initial development)
```bash
# Snapshot the database
pg_dump ip_port > snapshots/pre-phase-N.sql

# Create a second database
createdb ip_port_reference
pg_restore -d ip_port_reference snapshots/pre-phase-N.sql

# Run reference instance on different port
DATABASE_URL=postgresql://localhost:5432/ip_port_reference PORT=3001 npm run dev
```

**Option B: Second laptop on LAN** (better isolation, current hardware available)
```bash
# On second laptop: clone repo at tagged version
git clone <repo> ip-port-reference
cd ip-port-reference
git checkout v-phase-1-complete

# Restore database snapshot
pg_restore -d ip_port snapshots/pre-phase-N.sql

# Run normally — accessible at <laptop-ip>:3000 from LAN
npm run dev
```

**Option C: Dedicated server** (future, always-on)
- Deploy a stable tagged release to a server
- Full database copy via pg_dump/restore or pg_basebackup
- Accessible for demos, remote analysis, and Claude Code regression testing
- Updated periodically when a new stable tag is promoted

### Database Sync Protocol

The reference instance database should be refreshed at key moments:

1. **Before each phase begins**: Snapshot current production DB → restore to reference
2. **After major data enrichment**: If significant LLM data has been added to production, refresh reference to include it
3. **After taxonomy refactoring**: If classifications have changed in production, reference needs the updated data

Sync is manual (pg_dump/restore) rather than automated replication. This is intentional — we want the reference instance to represent a specific known state, not to drift.

### Claude Code Cross-Instance Testing

Claude Code skills can operate against both instances simultaneously:

```typescript
// regression-test skill configuration
const PRIMARY_URL = 'http://localhost:3000';
const REFERENCE_URL = 'http://localhost:3001';  // or http://<laptop-ip>:3000

// Compare patent summary results
const primaryData = await fetch(`${PRIMARY_URL}/api/patents?portfolioId=X&limit=5000`);
const referenceData = await fetch(`${REFERENCE_URL}/api/patents?portfolioId=X&limit=5000`);

// Diff: row counts, score distributions, ranking correlation, missing/added fields
```

## Claude Code Autonomous Iteration

### The Goal

Claude Code should be able to run longer sessions — implementing a feature, testing it against the reference instance, fixing issues, and iterating — without requiring human interaction at every step. The human sets the goal and reviews the result.

### What Makes This Possible

1. **Regression baselines exist**: Tagged releases provide known-good states. The reference instance provides comparison data.
2. **Analysis services are queryable**: Claude Code can call `/api/data/introspect`, `/api/analysis/taxonomy/*`, etc. to understand the current state of data.
3. **Tests are automatable**: Compare query results between primary and reference instances. If Patent Summary returns the same data (within tolerance), the change is safe.
4. **Rollback is trivial**: `git checkout <previous-tag>` + `prisma migrate reset` restores any known state.

### Autonomous Iteration Pattern

```
Human: "Implement the taxonomy analysis service from taxonomy-analysis-service-detail.md"

Claude Code session:
  1. Read the design doc
  2. Create the types file
  3. Implement Module 1 (CPC distribution)
  4. Add route, test endpoint manually
  5. Run against reference instance to verify SQL produces reasonable results
  6. Implement Module 2
  7. Test
  8. ... continue through all 7 modules
  9. Run full playbook, capture results
  10. Commit with descriptive message
  11. Tag: v-phase-1-analysis
  12. Report results to human
```

The key enablers:
- **Design docs as specifications**: Claude Code reads the design doc as its task definition
- **Self-verification**: New endpoints can be called immediately to check results make sense
- **Cross-instance comparison**: When modifying existing behavior, compare against reference
- **Incremental commits**: Each module gets its own commit so rollback is granular

### Skills That Enable Autonomy

**regression-test skill** (highest priority for enabling autonomy):
```
1. Capture baseline from reference instance (or from saved JSON snapshots)
2. Run same queries against primary instance
3. Compare: exact match for counts, statistical correlation for scores
4. Report pass/fail with specifics on any divergence
5. Human reviews report, approves or requests fixes
```

**self-test skill** (for new services):
```
1. Call new endpoint with known parameters
2. Verify response shape matches type definitions
3. Verify counts are reasonable (not 0, not wildly high)
4. Verify known patents appear in expected results
5. Run a few edge cases (empty filters, nonexistent IDs)
```

**incremental-commit skill**:
```
1. Stage changed files
2. Run lint/typecheck
3. Run regression test
4. If pass: commit with descriptive message, tag if milestone
5. If fail: report failure, attempt fix, re-test (max 3 attempts)
6. If still failing: stash changes, report to human
```

### Safety Boundaries for Autonomous Operation

Claude Code operates under these constraints during autonomous sessions:

- **No destructive database operations**: No DROP TABLE, no DELETE without WHERE, no TRUNCATE
- **No modification to existing service files** without regression test passing first
- **New files only** during Phase 1 (no changes to existing services or routes)
- **Tag before any schema migration**: Always create a tag before running `prisma migrate`
- **Stop and report** if regression tests show >1% divergence in any metric
- **Stop and report** if any existing endpoint returns a different response shape

## Migration Phase Database Handling

Each phase produces Prisma migrations that are:
1. Forward-only (no destructive changes — no column drops, no table drops)
2. Tested against a copy of production data before deployment to primary
3. Backed up with `pg_dump` before execution

```bash
# Before any migration
pg_dump ip_port > snapshots/pre-migration-$(date +%Y%m%d-%H%M).sql

# Run migration
npx prisma migrate dev --name <descriptive-name>

# Verify
npm run dev  # start server, check key pages

# If problems
pg_restore -d ip_port snapshots/pre-migration-*.sql
git checkout <previous-tag>
```

### Second Database for Schema Experiments

For riskier Phase 3+ changes (taxonomy restructuring, multi-classification), we can use a second database on the same machine:

```bash
# Create experiment database
createdb ip_port_experiment
pg_restore -d ip_port_experiment snapshots/latest.sql

# Run experimental migrations against it
DATABASE_URL=postgresql://localhost:5432/ip_port_experiment npx prisma migrate dev

# Test with the application
DATABASE_URL=postgresql://localhost:5432/ip_port_experiment npm run dev

# If it works: apply same migration to production database
# If it doesn't: drop and recreate experiment database
```

This lets us test schema migrations against real data without risking the primary database.

## Deployment Strategy

### Development (Current)
Primary development on local machine with local Postgres. All new services tested here first.

### Reference Instance (Phase 1+)
Second laptop on LAN running a tagged release with database snapshot. Claude Code regression tests compare against this instance. Refreshed at phase boundaries.

### Server Instance (Phase 2+)
Always-on server with stable tagged release. Used for demos, remote access, and as a long-lived regression baseline. Updated when a phase is complete and verified.

## Open Questions

- **Reference instance hosting**: Second laptop is available and simplest for now. Server instance can be set up when we need always-on remote access. Cloud VM is an option if we need it accessible outside the local network.
- **Database size**: Current database with 84K patents. Need to monitor growth as materialized views (which duplicate data for performance) and snapshot tables (which grow with each snapshot) are added. Estimate: 2-5x current size is manageable for local Postgres.
- **Claude Code session length**: How long can Claude Code iterate autonomously before human review is needed? Starting conservatively: one module per autonomous session, human reviews results before next module. As confidence grows, extend to multi-module sessions.
- **Regression test tolerance**: What level of divergence between primary and reference is acceptable? Exact match for counts and identifiers; ±0.01 for scores (floating point); rank correlation >0.99 for rankings. These thresholds need calibration against actual data.
- **Experiment database lifecycle**: How many experiment databases to keep? Recommendation: one at a time, drop before creating a new one. The experiment is throwaway — the migration script is the artifact we keep.
