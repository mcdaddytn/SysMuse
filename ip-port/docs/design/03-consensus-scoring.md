# 03 — Consensus Scoring & Structured Questions

## Current State

Consensus scoring (V3) applies at portfolio level: multiple named weight profiles (each a saved V2 slider configuration) are combined into a weighted average consensus score. Currently limited to portfolio-level scores with a single user managing multiple profiles.

Structured questions are defined in JSON template files (`config/scoring-templates/`) with inheritance from portfolio → super-sector → sector → sub-sector. Each question specifies a `fieldName`, answer type (numeric/categorical/text), scale, default weight, and optional reasoning prompt. Answers are stored in the `PatentScore` EAV table (portfolio-level) and `PatentSubSectorScore` JSON metrics column (taxonomy-level).

## Problems with Current Approach

1. **Consensus limited to portfolio scope**: The same multi-profile consensus mechanism should apply to any score type (sector scores, sub-sector scores).
2. **No visibility into question structure**: Users cannot see which questions produce which metrics without reading JSON files. A read-only display of the question → metric → formula chain is needed.
3. **Question versioning is informal**: Template versions exist on `ScoringTemplate` but the relationship between template version, question changes, and score validity is not systematically tracked.
4. **Single user manages all profiles**: Future multi-user systems need per-user profiles with role-based access to consensus participation.

## Consensus Scoring Design

Consensus scoring is a layer on top of any weighted score. It takes N weight profiles and produces a combined score:

```
consensus_score(patent) = Σ(profile_weight_j × score(patent, weights_j)) / Σ(profile_weight_j)
```

Where `score(patent, weights_j)` is the formula evaluated with profile j's weights, and `profile_weight_j` is how much that profile counts in the consensus.

This design applies identically to portfolio scores, sector scores, or any FormulaDefinition-based score. The `WeightProfile` model (see `02-scoring-framework.md`) already supports this via the `consensusWeight` field.

### Consensus Workflow

1. Each participant saves their weight profile for a given formula
2. Admin assigns consensus weights to each profile (or uses equal weights)
3. System evaluates the formula once per profile per patent, then combines
4. Results are saved as a consensus snapshot with provenance tracking

## Structured Questions

### Question Definition

Questions are the bridge between LLM analysis and scoring metrics. Each question:

- Belongs to a taxonomy level (portfolio, super-sector, sector, or sub-sector)
- Produces one or more metric fields (numeric rating, text reasoning, categorical value)
- Has a `fieldName` that becomes the metric's name in the scoring formula
- Can inherit from parent levels and be customized with append/prepend text

### Question → Metric → Score Chain

```
Question Definition (ScoringTemplate.questions[])
  │
  ├── fieldName: "technical_novelty"
  ├── question: "Rate the technical novelty..."
  ├── answerType: "numeric", scale: {min: 1, max: 5}
  ├── requiresReasoning: true
  │
  ▼ LLM evaluates per patent
  │
Metric Storage
  │
  ├── PatentScore EAV: fieldName="technical_novelty", rating=4, reasoning="..."
  │   (stored in Postgres, registered in Attribute Registry as LLM_METRIC)
  │
  ▼ Formula references metric by attribute name
  │
FormulaDefinition term
  │
  ├── attribute: "technical_novelty"
  ├── weightKey: "w_technical_novelty"
  ├── scaling: { type: "linear", min: 1, max: 5 }
  │
  ▼ User controls weight via slider
  │
WeightProfile
  │
  └── weights: { "w_technical_novelty": 0.15, ... }
```

### Question Inheritance

```
Portfolio Template
  ├── eligibility_score
  ├── validity_score
  ├── claim_breadth
  ├── enforcement_clarity
  ├── design_around_difficulty
  └── market_relevance_score

  └── WIRELESS Super-Sector Template (inheritsFrom: portfolio)
      ├── (inherits all 6 portfolio questions)
      ├── standards_relevance          ← new at this level
      └── spectrum_efficiency          ← new at this level

      └── wireless-transmission Sector Template (inheritsFrom: wireless)
          ├── (inherits all 8 above)
          ├── mimo_applicability       ← new at this level
          └── beamforming_relevance    ← new at this level
```

When a patent in the wireless-transmission sector is scored, the LLM receives all 10 questions in one batch. The append/prepend feature allows a sector-level template to add context to an inherited question: "Rate the market relevance of this patent **specifically for wireless communication markets**."

### Attribute Registry Auto-Registration

When new questions are added to templates, `syncTemplateAttributes()` (see `hmda-v2-phase1-implementation.md`) automatically creates registry entries:

- A `LLM_METRIC` entry for the numeric rating
- An `LLM_TEXT` entry for the reasoning field
- An `LLM_CLASS` entry for categorical answers

This ensures the Query Builder, materialized views, and introspection API immediately know about new metrics without manual registry updates.

## Question Versioning

### The revAIQ Convention

Each patent's LLM data has a "currency" expressed as a dot-separated version string tracking question versions at each taxonomy level:

```
revAIQ = portfolio.superSector.sector.subSector
Example: 3.2.1.4
```

- Portfolio questions at version 3
- Super-sector questions at version 2
- Sector questions at version 1
- Sub-sector questions at version 4

**Per-taxonomy-path**: The revAIQ applies to a specific path through the taxonomy. Patent X classified under `WIRELESS/wireless-transmission/mimo-basic` has one revAIQ, and its secondary classification under `NETWORKING/protocol-stack` would have a different revAIQ.

**Versioning rules**: Incrementing a higher level resets lower levels. Changing portfolio questions → new portfolio version, lower levels reset. Changing only sub-sector questions → only sub-sector version increments.

### What's Tracked Today (Phase 1 — No Schema Changes)

The existing schema already captures some version information:
- `PatentScore.templateId`, `llmModel`, `scoredAt`
- `PatentSubSectorScore.templateVersion`, `questionFingerprint`, `llmModel`

The LLM Currency Analysis Service (see `hmda-v2-phase1-implementation.md`) queries these fields to understand current state: which models are in use, which template versions are deployed, staleness distribution by sector.

### What's Added (Phase 2)

- `QuestionVersion` table: tracks current version number at each taxonomy level
- `PatentQuestionCurrency` table: records per-patent what revAIQ has been applied
- Currency Service: computes gaps between patent's revAIQ and latest available

See `hmda-v2-architecture.md`, Section 6 for full schema.

### Open Versioning Questions

These are resolved through experimentation, not upfront design:

1. **Granularity**: Do we version per-instance (each sub-sector has its own version) or per-level (all sub-sectors share one version number)? Per-instance is more precise but complex. Per-level is simpler but marks unchanged sub-sectors as stale. The LLM Currency Analysis Service will show how often we change questions at fine-grained levels.

2. **Model as a version dimension**: Is LLM model (e.g., sonnet vs. opus) a separate axis or part of revAIQ? The model comparison analysis (`getModelComparisonOverlap()`) will show whether model differences are significant enough to warrant tracking.

3. **Freezing**: When to "freeze" a version and start a new one? Current thinking: freeze when you want to create a clean snapshot, not automatically on every question edit.

## LLM Integration

### Prompt Construction

For a given patent, the LLM prompt includes:

1. Patent context (title, abstract, claims if available)
2. Union of all questions from the patent's taxonomy path(s)
3. Each question formatted with its answer type and scale
4. Reasoning requirements where specified

With multiple taxonomy associations (Phase 3), the question set is the union across all classification paths, deduplicated by `fieldName`. This maximizes value per LLM call.

### Response Parsing

LLM responses are parsed into:
- Numeric ratings → `PatentScore.rating` or `PatentSubSectorScore.metrics`
- Text reasoning → `PatentScore.reasoning`
- Categorical values → `PatentScore.textValue`

The parsed values are simultaneously written to the EAV table and the JSON cache file for redundancy.

## Read-Only Question Viewer (Phase 2)

A new UI component showing:
- The complete question inheritance tree for any taxonomy path
- Which questions produce which metrics
- Which metrics feed into which formulas with what weights
- Current revAIQ status for any patent

This is initially read-only — users can view the question structure and understand how scores are computed, but cannot modify questions through the UI. Question editing remains a code/config change tracked in version control.

## Open Questions

- **Question editing GUI**: When to allow users to create/modify questions through the UI? Deferred to a later phase — the complexity of dynamic question management plus versioning tracking is significant.
- **Consensus at taxonomy levels**: Should sector-level scoring support consensus? Technically yes (same mechanism), but is there a use case currently? Probably not until multi-user access is implemented.
- **Question deactivation**: Can a question be "retired" without breaking existing formulas? The formula would need to handle missing metrics gracefully (already does — missing metrics contribute 0). But the UI should hide retired question sliders.
