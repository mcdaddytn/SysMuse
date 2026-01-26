# LLM Patent Analysis Pipeline

## Overview

The system uses Claude (Anthropic API) to perform qualitative patent analysis that complements quantitative citation-based scoring. LLM analysis generates text summaries, numeric quality ratings (1-5), and classification metadata used in multi-metric scoring profiles.

## Question Taxonomy

### Tier 1: Attorney Core Questions (V1)

The original 5 questions from attorneys — generated for all patents promoted to prominence. These provide a quick human-readable assessment superior to raw patent titles/abstracts.

| # | Field | Type | Description |
|---|-------|------|-------------|
| 1 | `summary` | Text | High-level summary for non-technical audience (2-3 sentences) |
| 2 | `prior_art_problem` | Text | What problem in prior art does this patent solve? (2-3 sentences) |
| 3 | `technical_solution` | Text | How does the technical solution work? (2-3 sentences) |
| 4 | `eligibility_score` | 1-5 | Patent eligibility strength under 35 USC 101 |
| 5 | `validity_score` | 1-5 | Strength against prior art invalidity challenges |

### Tier 2: Enforcement & Quality Scores (V1+)

Additional numeric ratings used in scoring profiles. Generated alongside Tier 1.

| # | Field | Type | Description |
|---|-------|------|-------------|
| 6 | `claim_breadth` | 1-5 | Scope and breadth of patent claims |
| 7 | `claim_clarity_score` | 1-5 | How clear and well-defined claim boundaries are |
| 8 | `enforcement_clarity` | 1-5 | How easily infringement can be detected |
| 9 | `design_around_difficulty` | 1-5 | How difficult to avoid infringing |
| 10 | `evidence_accessibility_score` | 1-5 | How accessible is infringement evidence |
| 11 | `confidence` | 1-5 | LLM confidence in this analysis |

### Tier 3: Market & Investigation (V2+)

Market applicability and investigation guidance — used for licensing strategy.

| # | Field | Type | Description |
|---|-------|------|-------------|
| 12 | `technology_category` | Enum | Primary technology domain (networking, cybersecurity, etc.) |
| 13 | `product_types` | Array | Specific product types this patent might cover |
| 14 | `market_relevance_score` | 1-5 | Relevance to current commercial products |
| 15 | `trend_alignment_score` | 1-5 | Alignment with current technology trends |
| 16 | `likely_implementers` | Array | Types of companies likely using this technology |
| 17 | `detection_method` | Enum | How infringement would be detected (observable/technical_analysis/reverse_engineering/discovery_required) |
| 18 | `investigation_priority_score` | 1-5 | Priority for infringement investigation |

### Tier 4: Cross-Sector Signals (V3)

Broadly applicable classification used for portfolio segmentation and 101-risk assessment.

| # | Field | Type | Description |
|---|-------|------|-------------|
| 19 | `implementation_type` | Enum | hardware/software/firmware/system/method/hybrid |
| 20 | `standards_relevance` | Enum | none/related/likely_essential/declared_essential |
| 21 | `standards_bodies` | Array | Relevant standards (3GPP, IEEE, ETSI, IETF, etc.) |
| 22 | `market_segment` | Enum | consumer/enterprise/infrastructure/industrial/automotive/medical/mixed |
| 23 | `implementation_complexity` | Enum | simple/moderate/complex/highly_complex |
| 24 | `claim_type_primary` | Enum | method/system/apparatus/device/computer_readable_medium/composition |
| 25 | `geographic_scope` | Enum | us_centric/global/regional |
| 26 | `lifecycle_stage` | Enum | emerging/growth/mature/declining |

### Computed Sub-Scores (derived from individual ratings)

| Field | Formula |
|-------|---------|
| `legal_viability_score` | `(eligibility × 0.30 + validity × 0.30 + claim_breadth × 0.20 + claim_clarity × 0.20) / 5 × 100` |
| `enforcement_potential_score` | `(enforcement_clarity × 0.35 + evidence_accessibility × 0.35 + design_around × 0.30) / 5 × 100` |
| `market_value_score` | `(market_relevance × 0.50 + trend_alignment × 0.50) / 5 × 100` |

### Future: Sector-Specific Questions (Tier 5)

Sector-specific prompts exist in `config/sector-prompts/` (9 sectors) and generate additional fields via `services/llm-sector-analysis.ts`:

- `specific_products` — Product objects with (product_name, company, relevance, evidence_type)
- `product_evidence_sources` — Sources for product information
- `revenue_model`, `unit_volume_tier`, `price_point_tier`, `revenue_per_unit_estimate`
- `licensing_leverage_factors`, `negotiation_strengths`, `potential_objections`
- `within_sector_rank_rationale`, `litigation_grouping_candidates`

These are not yet integrated into the main cache pipeline.

---

## Prompt Configuration Files

All prompts are stored as JSON config files (not hard-coded):

```
config/prompts/
├── patent-analysis-v1.json          # 9 fields (attorney core)
├── patent-analysis-v2-draft.json    # 17 fields (+ market/investigation) — DRAFT
└── patent-analysis-v3.json          # 26 fields (+ cross-sector) — ACTIVE

config/sector-prompts/
├── cloud-auth.json
├── network-switching.json
├── network-protocols.json
├── network-auth-access.json
├── network-management.json
├── network-threat-protection.json
├── computing-os-security.json
├── video-codec.json
└── rf-acoustic.json
```

Each prompt config contains: `systemPrompt`, `userPromptTemplate`, `outputSchema` (with scale definitions), `scoringWeights`.

---

## Data Pipeline

### Analysis Services

| Service | Prompt | Model | Output |
|---------|--------|-------|--------|
| `services/llm-patent-analysis.ts` | V1 (9 fields) | Claude Sonnet 4 | `output/llm-analysis/` |
| `services/llm-patent-analysis-v2.ts` | V2 (17 fields) | Claude Sonnet 4 | `output/llm-analysis-v2/` |
| `services/llm-patent-analysis-v3.ts` | V3 (26 fields) | Claude Sonnet 4 | `output/llm-analysis-v3/` |
| `services/llm-sector-analysis.ts` | Sector-specific | Claude Opus 4 | Per-sector output |

### Runner Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `scripts/run-llm-top-patents.ts` | Score all patents, analyze top N without LLM data | `npx tsx scripts/run-llm-top-patents.ts --count 100` |
| `scripts/run-llm-analysis-v3.ts` | Run V3 analysis by sector or top N | `npx tsx scripts/run-llm-analysis-v3.ts --sector cloud-auth` |
| `scripts/import-llm-scores.ts` | Import from JSON/CSV into per-patent cache | `npx tsx scripts/import-llm-scores.ts <file> [--force]` |
| `scripts/merge-llm-into-analysis.ts` | Merge LLM into multi-score-analysis | |

### Cache Structure

```
cache/llm-scores/
├── 10003303.json    # Per-patent: all 26+ fields from V3 pipeline
├── 8429630.json     # Older: 5 scores only (from V1-era pipeline)
└── ... (7,669 files)

output/llm-analysis-v3/
├── combined-v3-2026-01-26.json    # 5,000 patents, all fields + computed sub-scores
└── batches/
    ├── batch-v3-001-2026-01-26.json
    └── ... (999 batch files)
```

### Data Flow

```
Patent data (cache/api/) ──> Runner script ──> Anthropic API ──> Batch JSON
                                                                    │
                            ┌───────────────────────────────────────┘
                            ▼
                    Combined JSON ──> Import script ──> Per-patent cache
                                                            │
                                                            ▼
                                    Scoring service ◄── cache/llm-scores/
                                    Patents API     ◄──      │
                                                            ▼
                                                    GUI (grid + detail)
```

### Important: All Fields Preserved

As of Session 12, both `saveLlmScore()` (in `run-llm-top-patents.ts`) and `import-llm-scores.ts` preserve **all** fields from the V3 analysis. Previously, 14 of 26 fields were being dropped during the save/import step — including the two key attorney text fields (`prior_art_problem`, `technical_solution`). This was fixed by spreading the full analysis object rather than cherry-picking fields.

---

## Current Coverage

| Source | Count | Fields | Pipeline |
|--------|-------|--------|----------|
| V3 full analysis (`llm-top-patents`) | 5,000 | All 26 + computed | `run-llm-top-patents.ts` |
| V1 scores only (`all-patents-scored-v3`) | 2,669 | 5 numeric scores | Older bulk import |
| **Total with LLM data** | **7,669** | — | 35% of active 3yr+ patents |
| Active patents (3+ years) | 21,870 | — | — |

---

## Scoring Integration

### Scoring Profiles (V3)

The scoring service (`src/api/services/scoring-service.ts`) uses LLM metrics with configurable weight profiles:

| Profile | Key LLM Weights |
|---------|----------------|
| **Executive** | eligibility (0.05), validity (0.05), claim_breadth (0.04), enforcement (0.04), design_around (0.04), market_relevance (0.05) |
| **Litigation** | eligibility (0.18), validity (0.18), enforcement (0.04) |
| **Licensing** | claim_breadth (0.08), market_relevance (0.08) |
| **Quick Wins** | eligibility (0.15), validity (0.14), enforcement (0.17) |
| **Quality Focus** | validity (0.18), claim_breadth (0.13) |

When LLM metrics are unavailable (65% of scored patents), weights are redistributed proportionally among available quantitative metrics.

### Rating Scale Reference

All scores use consistent 1-5 scale (higher = better for patent holder):

| Score | Meaning |
|-------|---------|
| 5 | Very Strong / Very Broad / Very Clear / Very Difficult to avoid |
| 4 | Strong / Broad / Clear / Difficult |
| 3 | Moderate |
| 2 | Weak / Narrow / Unclear / Easy to avoid |
| 1 | Very Weak / Very Narrow / Very Unclear / Very Easy |

---

## Design: Question Tiering and Batching Strategy

### Promotion-Based Question Execution

Questions should be executed in tiers as patents gain prominence:

```
Discovery ──> Tier 1-2 (attorney core + scores) ──> Tier 3 (market) ──> Tier 4 (classification)
                                                                              │
                                                                    Tier 5 (sector-specific)
```

**Tier 1-2 (First Order)**: Run when a patent is first identified as high-potential (top N by quantitative score). Provides the 5 attorney questions plus enforcement/quality scores.

**Tier 3-4 (Second Order)**: Run on patents that pass initial screening. Adds market applicability, investigation guidance, and cross-sector classification.

**Tier 5 (Higher Order)**: Run when a patent is assigned to a specific sector or focus area. Uses sector-specific prompts with domain expertise, product identification, and licensing context.

### Batching Efficiency

Currently: All tiers run in a single V3 prompt (26 fields per patent, 5 patents per batch).

Future optimization for large-scale runs:
- **Question grouping**: Combine patents that need the same question tier into batches
- **Sector batching**: Group same-sector patents for sector-specific prompts
- **Incremental enrichment**: Track which tiers each patent has completed; only request missing tiers
- **Cost optimization**: Use Sonnet for Tier 1-3, Opus for Tier 5 (sector-specific requiring deeper reasoning)

### Queuing Design (Future)

The UI should support:
1. **Single patent**: "Request LLM Analysis" button on patent detail page
2. **Bulk selection**: Multi-select patents in grid, "Queue for LLM Analysis"
3. **Automatic**: Queue top-ranked patents without LLM data when scores are recalculated
4. **Progress tracking**: Job queue with status, cost estimation, completion percentage

### Field Assignment

LLM results map to patent fields via the cache pipeline:
- Numeric scores (1-5) → Used directly in scoring profiles
- Text fields → Displayed in grid columns and detail pages
- Enum/classification fields → Used for filtering, grouping, and sector assignment
- Array fields → Displayed in detail page chips

---

## Configuration

### Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-20250514     # Default model
LLM_BATCH_SIZE=5                        # Patents per API call
LLM_RATE_LIMIT_MS=2000                  # Delay between batches
LLM_MAX_RETRIES=3                       # Retry count on failure
```

### Cost Estimation (Claude Sonnet 4)

| Scope | Patents | Est. Cost |
|-------|---------|-----------|
| Per patent | 1 | ~$0.01 |
| Small batch | 100 | ~$1 |
| Medium batch | 1,000 | ~$10 |
| Full V3 run | 5,000 | ~$50 |
| Full portfolio | 21,870 | ~$220 |

---

## Usage

```bash
# Run V3 analysis on top 100 patents without LLM data
npx tsx scripts/run-llm-top-patents.ts --count 100

# Run by sector
npx tsx scripts/run-llm-top-patents.ts --sector cloud-computing --count 50

# Dry run (preview without API calls)
npx tsx scripts/run-llm-top-patents.ts --count 500 --dry-run

# Import from external file (overwrite existing)
npx tsx scripts/import-llm-scores.ts output/llm-analysis-v3/combined-v3-2026-01-26.json --force

# Import all files from directory
npx tsx scripts/import-llm-scores.ts ./exports/ --all

# Reload caches after import
curl -X POST http://localhost:3001/api/scores/reload
```

---

*Last Updated: 2026-01-26 (Session 12 — Fixed data pipeline to preserve all 26 V3 fields. Re-imported 5,000 patents from combined output. Documented question taxonomy with tiering strategy.)*
