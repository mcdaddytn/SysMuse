# 07 — Taxonomy ↔ Structured Question Integration (Design Notes)

*Created: 2026-03-29*
*Status: DESIGN NOTES — Capturing fresh insights from taxonomy refactor implementation*

## Context

The generalized taxonomy refactor pipeline (analyzer → proposer → classify → consolidate) is now operational and produced a full v2 taxonomy (293 sub-sectors across 56 sectors). This document captures design insights for the next challenge: integrating taxonomy refactoring with structured question evolution as an iterative optimization loop.

## The Interrelated Problem

Taxonomy and structured questions are tightly coupled:

1. **Taxonomy determines which questions are asked** — Question inheritance chain (portfolio → super-sector → sector → sub-sector) means taxonomy structure directly shapes the LLM evaluation
2. **Question quality depends on taxonomy granularity** — A sub-sector with 500 diverse patents gets worse question differentiation than one with 200 focused patents
3. **Score quality feeds back into taxonomy decisions** — Poorly-differentiating sub-sectors should be split/merged based on how well questions separate patents within them

Neither can be fully optimized independently. The design challenge is an iterative loop:

```
Taxonomy Refactor → Question Refactor → Score Samples → Evaluate → Adjust → Repeat
```

## Fresh Insights from v2 Implementation

### 1. CPC-only classification produces usable but imperfect groupings

The current refactor uses CPC prefix rules exclusively. This works well for most sectors but has limitations:
- **Cross-CPC technology functions** (e.g., ABR streaming spanning H04L65/*, H04N21/*, G06Q30/*) are split across sub-sectors
- **CPC codes don't capture detectability, standards alignment, or commercial relevance** — attributes that matter for scoring differentiation
- **Conclusion**: CPC is the right starting point, but the question evaluation loop should be able to reshape sub-sectors beyond CPC boundaries when scoring data shows better groupings

### 2. Consolidation via agglomerative merging works well

The merge-by-CPC-prefix-similarity approach reduced 81 initial sub-sectors to 3-10 per sector. Key learnings:
- Empty node cleanup after merging is essential
- Merge decisions should also consider question differentiation (future)
- Split decisions need finer CPC granularity data — the current split logic is limited

### 3. General/catch-all bucket size is a quality signal

The general sub-sector caught 0-434 patents per sector. A large general bucket means:
- The taxonomy rules don't cover all CPC patterns in the sector
- OR the patents genuinely don't cluster (diverse CPCs, no dominant theme)
- **Design insight**: After scoring, compare general-bucket patent scores against scored sub-sectors. If general patents score similarly to a specific sub-sector, they should be reclassified. If they score distinctly low, general is the right place.

### 4. Sector-size-aware targets are critical

Small sectors (< 200 patents) need 2-5 sub-sectors. Large sectors (6000+) need 5-25. The refactor service now adjusts targets dynamically, but the question system should also adapt:
- Small sub-sectors (< 50 patents) may not need sub-sector-specific questions
- Large sub-sectors (> 300 patents) benefit most from targeted questions
- **Design insight**: Question authoring effort should be proportional to sub-sector size and score variation within it

### 5. Intervention points are needed but not yet wired

The `mode: 'interactive'` field exists in RefactorSpec but isn't implemented. When it is, the natural intervention points are:
1. After initial proposal — review/edit proposed sub-sectors before creating
2. After consolidation — approve merge/split decisions
3. After scoring samples — review question differentiation before committing
4. After full scoring — approve final taxonomy before activating

## Design Challenges for Future Implementation

### Challenge 1: The Optimization Loop

```
┌─────────────────────────────────────────────────────────┐
│                  Taxonomy-Question Loop                   │
│                                                           │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐           │
│  │ Taxonomy │───▶│ Question │───▶│  Score   │           │
│  │ Refactor │    │ Refactor │    │ Samples  │           │
│  └──────────┘    └──────────┘    └──────────┘           │
│       ▲                               │                   │
│       │          ┌──────────┐         │                   │
│       └──────────│ Evaluate │◀────────┘                   │
│                  │  Results │                              │
│                  └──────────┘                              │
└─────────────────────────────────────────────────────────┘
```

**Evaluation metrics** (what tells us if we're improving):
- Score variance within sub-sectors (lower = more homogeneous = better taxonomy)
- Score differentiation between sub-sectors (higher = questions are separating well)
- Rank stability across scoring runs (higher = taxonomy is robust)
- Coverage: % of patents with current revAIQ (higher = more scored with current questions)

**Convergence criteria** (when to stop iterating):
- Score variance within sub-sectors drops below threshold
- No sub-sector has more than N patents with identical scores (differentiation achieved)
- General bucket is below target % of sector

### Challenge 2: Question Generation from Taxonomy

When a new sub-sector is created (e.g., `video-codec/h04n19-46` — motion estimation), the system should:
1. Analyze the CPC codes in the sub-sector to understand the technology area
2. Propose sub-sector-specific questions (potentially LLM-assisted)
3. Test questions on a sample (e.g., 20 patents) to evaluate differentiation
4. Iterate on questions before scoring the full sub-sector

This connects to the scoring framework (doc 02) where new questions start at weight 0 and users opt in. But for taxonomy-driven question generation, we may want auto-generated questions at a small default weight so they immediately contribute to differentiation assessment.

### Challenge 3: revAIQ Across Taxonomy Changes

When taxonomy is refactored (sub-sectors split/merged), the revAIQ version string changes meaning:
- Old revAIQ `3.2.1.4` referred to old sub-sector structure
- New revAIQ `3.2.1.1` refers to new sub-sector structure (version reset)
- Scores from old sub-sector questions are not directly comparable to new sub-sector questions

**Design need**: Snapshot normalization (doc 04) must handle taxonomy version transitions. The "Aggregate-Preserving Expansion" strategy (Strategy 2) applies here — old scores are preserved as estimates until new scoring catches up.

### Challenge 4: Cost-Effective Scoring Cycles

Each taxonomy-question iteration requires LLM scoring. With ~84K patents and Sonnet pricing, full rescoring is expensive (~$500+). The design should support:
- **Sample scoring**: Score 10-20% of each sub-sector to evaluate differentiation
- **Mixed-model scoring**: Haiku for broad coverage, Sonnet for topN, with normalization bridging the gap (doc 04, Strategy 3)
- **Incremental scoring**: Only score patents affected by taxonomy changes, merge into broader snapshot

## Relationship to 00-06 Design Docs

| This Doc's Concern | Related Design Doc | Connection |
|--------------------|--------------------|------------|
| Taxonomy refactor loop | 01-taxonomy-refactor | Extends multi-classification with iterative refinement |
| Question generation | 03-consensus-scoring | Question inheritance chain, revAIQ versioning |
| Score evaluation | 02-scoring-framework | Grouped terms, formula engine evaluation |
| Snapshot management | 04-snapshots | Normalization across taxonomy versions |
| Cost-effective scoring | 05-enrichment | Version-aware enrichment, budget controls |

## Prosecution Enrichment (Separate Future Track)

Claim-level prosecution analysis (see `DESIGN_CLAIM_LEVEL_PROSECUTION_ANALYSIS.md`) is a valuable enrichment feature but sits outside the taxonomy-question loop. Key notes for future implementation:

- **Data source**: USPTO ODP File Wrapper API provides document metadata; actual office action documents need to be downloaded and LLM-processed
- **Data quality concern**: Free API data may be incomplete or inconsistent for older patents. Paid prosecution data services (e.g., Docket Navigator, PatSnap, Innography) may provide higher-quality structured data. **More research needed before implementation.**
- **Priority**: Deferred until the scoring framework (02) and snapshot system (04) are more mature, as prosecution data will integrate as an enrichment type scored through the formula engine
- **Independence**: This feature doesn't depend on taxonomy refactoring and can be implemented at any time once research is complete
