# 02 — Generalized Weighted Scoring Framework

## Current State

The system has three score types: **base score** (quantitative metrics only, system-wide), **V2 enhanced score** (portfolio-level, weighted formula across quantitative + LLM metrics with user-controllable sliders), and **V3 consensus score** (multi-profile weighted average of V2 scores).

Current V2 formula: `score = Σ(normalize(metric_i) × weight_i) × year_multiplier × 100`

Normalization functions: `min(1, cc/20)` for citations, `min(1, sqrt(adj_fc)/30)` for adjusted citations, `min(1, years/15)` for remaining years, `(score-1)/4` for LLM 1-5 scales.

Weight presets are stored in `config/user-weight-profiles.json`. Scoring templates for LLM questions live in `config/scoring-templates/`.

## Problems with Current Approach

1. **V2/V3 naming obscures the real pattern**: V2 is portfolio-level scoring with user weights. V3 is consensus scoring of V2. The same slider+weight paradigm could apply at any taxonomy level but is hardcoded to portfolio scope.
2. **Fixed normalization functions**: Each metric has a hardcoded normalization. No way to experiment with nth-root vs. log vs. sigmoid without code changes.
3. **No grouped terms**: All metrics are in one flat weighted sum. No way to group citation metrics, group LLM metrics, or set an overall weight for "portfolio questions" vs. "sector questions."
4. **New LLM questions break scoring**: Adding a question means adding a new metric with no weight — the user must manually assign weights and existing snapshots become stale.
5. **Formulas live in code, not data**: The scoring formula is implemented in TypeScript, not stored as a configurable structure.

## Proposed Changes — Naming

| Current Name | New Name | Scope |
|-------------|----------|-------|
| Base Score | Base Score (unchanged) | System-wide |
| V2 Score | Portfolio Score (or User Score) | Per-portfolio |
| V3 Score | Consensus Score | Any score type |
| (new) | Taxonomy Score | Per super-sector, sector, or sub-sector |

The scoring GUI becomes a general page that can compute and display any score type. The page adapts its available metrics and sliders based on the selected scope.

## Formula Engine (HMDA v2)

Formulas are stored as structured data in the `FormulaDefinition` table (see `hmda-v2-architecture.md`, Section 4). Key design elements:

### Formula Structure

A formula is a tree of terms producing a single numeric value:

```
FormulaStructure
  ├── terms: FormulaTerm[]
  │   ├── MetricTerm      — attribute × weight × scaling
  │   ├── GroupTerm        — sub-expression with group weight
  │   └── ConstantTerm     — fixed value × weight
  ├── multipliers          — applied after summation (e.g., year_multiplier)
  └── outputScale          — e.g., 100 for 0-100 range
```

### Metric Types

| Type | Source | Examples | Registry Category |
|------|--------|----------|-------------------|
| Quantitative | USPTO/PatentsView APIs | forward_citations, remaining_years | CORE, ENRICHMENT |
| LLM-derived | Structured question responses | eligibility_score, claim_breadth | LLM_METRIC |
| Computed | Derived from other fields | competitor_density, adjusted_fc | COMPUTED |
| Intermediate | Output of a sub-formula | citation_group_score | COMPUTED (depends on others) |

All metrics are registered in the Attribute Registry with their storage location, data type, and range constraints.

### Scaling Functions

Current: hardcoded `linear`, `sqrt`. Proposed configurable options:

| Function | Parameters | Use Case |
|----------|-----------|----------|
| linear | min, max | Simple normalization to 0-1 |
| nroot | n (1.0-4.0), max | Diminishing returns: sqrt (n=2), cube root (n=3) |
| log | base (e, 10, 2), max | Heavy diminishing returns for high-range metrics |
| sigmoid | midpoint, steepness | S-curve for binary-ish scoring |
| step | thresholds[], values[] | Discrete bucketing |
| raw | (none) | No transformation |

Each metric in a formula term specifies its scaling function and parameters. The parameters are admin-controlled constants, not user-adjustable.

### Grouped Terms

Grouped terms allow hierarchical formula organization:

```
Overall Score = 
  0.50 × [Portfolio Questions Group]
    0.25 × normalize(eligibility_score)
    0.25 × normalize(validity_score)
    0.25 × normalize(claim_breadth)
    0.25 × normalize(enforcement_clarity)
  + 0.20 × [Citation Group]
    0.60 × normalize(competitor_citations)
    0.40 × normalize(adjusted_forward_citations)
  + 0.20 × [Sector Questions Group]
    (sector-specific LLM metrics)
  + 0.10 × [Lifecycle]
    1.00 × normalize(remaining_years)
  × year_multiplier
  × 100
```

Users control weights at two levels: group-level weights (what fraction of the score comes from each group) and within-group weights (relative importance of metrics within a group). This separation makes normalization across taxonomy levels cleaner — changing sector questions only affects the sector group weight, not the entire formula.

### Weight Profiles

```prisma
// From hmda-v2-architecture.md
model WeightProfile {
  id              String   @id @default(cuid())
  formulaDefId    String   @map("formula_def_id")
  name            String                  // "executive", "litigation", "default"
  displayName     String   @map("display_name")
  userId          String?  @map("user_id")
  weights         Json                    // Record<string, number>
  consensusWeight Float?   @map("consensus_weight")
  isDefault       Boolean  @default(false)
  
  @@unique([formulaDefId, name])
}
```

Weight profiles replace `config/user-weight-profiles.json`. Each profile stores a complete set of weight values keyed by the `weightKey` in the formula's metric/group terms. Multiple users can have their own profiles for the same formula.

### Adding New Metrics

When a new structured question is added to a scoring template:

1. The `syncTemplateAttributes` function (see `hmda-v2-phase1-implementation.md`) registers the new metric in the Attribute Registry
2. Existing formula definitions are NOT automatically modified — the new metric has no term in the formula
3. An admin explicitly adds the new metric as a term in the appropriate group, with a default weight of 0
4. Users see the new slider at weight 0 — scores are unchanged until they choose to assign weight
5. Snapshot normalization handles the transition period when some patents have the new metric scored and others don't

This is the critical design choice: **new questions start at weight 0** to avoid disrupting existing scores. Users opt in to new metrics by adjusting weights.

## Scoring at Different Taxonomy Levels

The same formula engine serves all scope levels:

| Scope | Available Metrics | Typical Use |
|-------|------------------|-------------|
| System-wide | Quantitative only | Base score — no LLM data needed |
| Portfolio | Portfolio LLM questions + quantitative | Primary ranking across all patents |
| Super-sector | Portfolio + super-sector questions | Comparison within a technology area |
| Sector | Portfolio + super-sector + sector questions | Detailed sector analysis |
| Sub-sector | All inherited questions | Fine-grained within-group ranking |

Each scope has its own `FormulaDefinition` with scope type and value. The formula at sector level can include metrics from portfolio questions (inherited) plus sector-specific questions, each in their own group terms.

## Formula SQL Generation

For hot-path queries (Patent Summary, Aggregates), the Formula Engine generates materialized views that embed the formula directly in SQL. This means filtering and sorting by computed scores happens entirely in Postgres without application-level computation. See `hmda-v2-architecture.md`, Section 4.4.

## UI Considerations

The scoring page works identically regardless of scope:

1. User selects score type (portfolio, sector, sub-sector) and scope value
2. Page loads the corresponding FormulaDefinition and the user's WeightProfile
3. Group-level sliders appear at the top; within-group metric sliders appear below
4. Changes to any slider trigger recalculation (debounced) using the Formula Engine
5. "Save Snapshot" persists results with full provenance

For consensus scoring, the same page shows multiple profiles with individual weights, and the consensus result is a weighted combination.

## Data Model Changes

### New Tables (Phase 2)
- `FormulaDefinition` — formula structure, scope, constants
- `WeightProfile` — user-specific weight sets per formula

### Registry Integration (Phase 1)
- All scoring-relevant attributes registered with `isFilterable`, `isSortable`, `isAggregatable` flags
- LLM metric attributes registered with `rangeMin`/`rangeMax` for normalization bounds

### Migration
- Seed current V2 formula structure as a `FormulaDefinition` with `scopeType: 'PORTFOLIO'`
- Convert `config/user-weight-profiles.json` entries to `WeightProfile` rows
- Existing scoring code continues to work during transition

## Future: Normative View Manipulation

An advanced feature where users directly rearrange patent rankings, and the system reverse-engineers weight changes that produce the desired ranking — or identifies when the current formula cannot achieve the desired ranking (suggesting new metrics or formula restructuring). This requires the grouped-term formula structure to be in place first.

## Open Questions

- **Rename V2/V3 now or later?** Renaming is cosmetic but reduces confusion. Can be done in UI labels without changing code identifiers initially.
- **How many group levels?** Current proposal is one level of grouping (flat groups within the formula). Nested groups (groups within groups) add complexity — defer unless needed.
- **Auto-populate new metrics at weight > 0?** Current design starts new metrics at weight 0. Alternative: start at a small weight (0.05) to immediately show effect. Risk: disrupts existing rankings. Recommendation: keep at 0.
- **Cross-scope score composition**: When a patent has both a portfolio score and a sector score, how do they compose into a single ranking? Options: keep separate, define a meta-formula that combines them, or let the user choose which to display. Deferred to Phase 3.
