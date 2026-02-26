# Session Context — February 25, 2026

## CRITICAL: WIRELESS Collective Strategy Has Hallucinated Patent Numbers

The WIRELESS vendor package (`output/vendor-exports/WIRELESS-2026-02-25/collective-strategy.md`) contains **fabricated patent numbers**. The LLM invented realistic-sounding US patent numbers (US8,923,785; US9,647,738; etc.) instead of using the actual 34 Crown Jewel patents.

### Root Cause

The WIRELESS collective template (`cmm24noaq03i7uxdijmaol843`) was a raw prompt that said "Below are the 34 highest-value wireless patents... each with complete patent information including claims" but **did NOT include the `{{focusArea.patentData}}` template variable** to inject actual patent data.

Evidence: `inputTokens: 585` — just the prompt instructions, no patent data. Compare with VIDEO collective (`cmlznkwqk00tv3m6ob2aycvl7`) which properly includes patent data via template variables and uses thousands of input tokens.

### What Was Correct

- All 34 Crown Jewel patents ARE correctly broadcom-core (Avago/Broadcom assignees)
- The per-patent assessment template (`cmm24d28103ique6txjbrp9yzn`) worked correctly — `tier1-assessment-results.csv` has correct patent IDs
- The focus area selection was correct — the problem is ONLY in the collective strategy prompt

### Fix Required

The WIRELESS collective template must be re-created with `{{focusArea.patentData}}` variable in the prompt text, following the VIDEO collective template pattern. Then re-execute the collective strategy.

### VIDEO Collective Template (Reference — Working)

Template ID: `cmlznkwqk00tv3m6ob2aycvl7`
Cache: `cache/focus-area-prompts/cmlzgcsew003v3m6odn6skqk8/cmlznkwqk00tv3m6ob2aycvl7/_collective.json`

The VIDEO prompt includes:
```
Focus Area: {{focusArea.name}}
Description: {{focusArea.description}}
Patent Count: {{focusArea.patentCount}}

Patent data for all patents in this focus area:
{{focusArea.patentData}}
```

This injects the actual patent data (patent_id, title, assignee, claims, scores, etc.) so the LLM can reference real patents. The VIDEO collective strategy correctly references patents like 9406252, 10798394, 11595673, etc.

### WIRELESS Collective Template (Broken)

Template ID: `cmm24noaq03i7uxdijmaol843`
Cache: `cache/focus-area-prompts/cmm242s1301cue6tx1pqaxmb3/cmm24noaq03i7uxdijmaol843/_collective.json`

The prompt was a flat text block with no template variables — no patent data was sent to the LLM.

---

## Standard Vendor Package Output Format

The VIDEO super-sector package produced a per-patent formatted output that should be the **standard format** for all future vendor packages (WIRELESS, SEMICONDUCTOR, etc.). This output was generated interactively in a Claude Code session (not by `export-vendor-package.ts`).

### Desired Per-Patent Format (from VIDEO)

```markdown
### Batch 1: HDR Processing (2 patents)

#### US10057786 — "Visual Quality Optimized Video Coding"
- **Lit Viability:** 8/10 - HDR tone mapping methods can be detected through...
- **Detection Feasibility:** 8/10 - Standard compliance testing reveals...
- **Strategy:** SEP_FRAND_LICENSING - ISO standards for HDR...
- **Standards:** HDR10, HLG
- **Competitor Cites:** Samsung (3 citations), LG (2)
- **Top Targets:** Samsung Smart TVs, LG OLED TVs, Sony Bravia

#### US9825512 — "HDR Signal Processing Pipeline"
- **Lit Viability:** 7/10 - ...
- ...
```

Key characteristics:
- Patents grouped by **technology batch** (e.g., HDR Processing, Codec Standards, CDN/Streaming)
- Each patent has: Lit Viability score, Detection Feasibility score, Strategy, Standards, Competitor Citations, Top Targets
- Batches come from focus area sub-groups (sub-FAs under the parent litigation targets FA)
- Data sourced from per-patent assessment results in `cache/focus-area-prompts/`

### How to Reproduce This Format

1. Query the per-patent assessment results from `cache/focus-area-prompts/{parentFaId}/{assessmentTemplateId}/`
2. Group patents by sub-focus-area membership
3. For each group, format each patent with the Lit/Det/Strategy/Standards/Cites/Targets fields
4. This can be done as a Claude Code interactive session or automated via a new script

---

## Vendor Package Pipeline — Complete Process

### Step 1: LLM Scoring
- Score all broadcom-core patents using sector-specific templates + claims
- Script: `scripts/run-sector-scoring.ts` or batch mode via GUI
- Results: `cache/llm-scores/` and `patent_sub_sector_scores` table

### Step 2: Ranking
- Composite scores from weighted template metrics
- Recompute with `scripts/recompute-super-sector-scores.ts` if weights change

### Step 3: Focus Areas
- Create parent FA (e.g., "Broadcom Video Litigation Targets") from top-scoring patents
- Create sub-FAs grouping patents by technology (e.g., CDN/Streaming, Codec, HDR)
- Create Tier 1 FA ("Crown Jewels") as subset of parent — top 15-25 patents

### Step 4: Per-Patent Litigation Assessment
- Template type: STRUCTURED, execution mode: PER_PATENT
- Apply to parent FA — assesses each patent individually
- Fields: detectability_score, claim_mapping_score, standards_alignment, target_products, litigation_risk_factors, overall_litigation_score, recommended_assertion_strategy
- Results: `cache/focus-area-prompts/{faId}/{templateId}/{patentId}.json`

### Step 5: Collective Strategy
- Template type: FREE_FORM, execution mode: COLLECTIVE
- **MUST include `{{focusArea.patentData}}` in prompt** to inject actual patent data
- Apply to Tier 1 FA — generates cross-patent strategy narrative
- Fields: technology_clusters, claim_chain_strategies, competitor_vulnerability_matrix, ranked_patents
- Results: `cache/focus-area-prompts/{tier1FaId}/{templateId}/_collective.json`

### Step 6: Family Expansion
- For top 3-5 seed patents, discover continuation/divisional families via PatentsView
- Import family members, score them, add to focus areas
- Example: VIDEO VVC family 10798394→11595673→11882300→12289460

### Step 7: Vendor Package Export
- Script: `scripts/export-vendor-package.ts {SUPER_SECTOR} [--include-assessments]`
- Outputs: ranked CSV, competitor landscape, top-200 JSON, sector summary, README
- With `--include-assessments`: tier1-assessment-results.csv, collective-strategy.md
- Interactive session: Generate per-patent formatted output (Lit/Det/Strategy format above)

---

## WIRELESS Focus Area IDs

| Focus Area | ID | Patents |
|-----------|-----|---------|
| Parent: Crown Jewels | `cmm242s1301cue6tx1pqaxmb3` | 34 patents |
| Per-patent assessment template | `cmm24d28103ique6txjbrp9yzn` | STRUCTURED, PER_PATENT |
| Collective template (BROKEN) | `cmm24noaq03i7uxdijmaol843` | FREE_FORM, COLLECTIVE — no patent data |

## VIDEO Focus Area IDs

| Focus Area | ID | Patents |
|-----------|-----|---------|
| Parent: Litigation Targets | `cmlzezda000023m6oq8gtiep9` | 41 patents |
| Sub-FA: Broadcast & Client | `cmlzezych000e3m6oesdzygpx` | 5 patents |
| Sub-FA: CDN & Adaptive Streaming | `cmlzezu7f000b3m6o3t2gvx8a` | 18 patents |
| Sub-FA: Codec Standards/SEP | `cmlzezmgj00053m6oqno0qmu8` | 14 patents |
| Sub-FA: Competitor-Cited | `cmlzezpu400083m6owjbxqctg` | 5 patents |
| Tier 1: Vendor Handoff | `cmlzgcsew003v3m6odn6skqk8` | 21 patents |
| Per-patent assessment template | `cmlzf6wa8003s3m6oy3zamh7q` | STRUCTURED, PER_PATENT |
| Collective template v3 (WORKING) | `cmlznkwqk00tv3m6ob2aycvl7` | FREE_FORM, COLLECTIVE — has patent data |

---

## Current Focus: SEMICONDUCTOR Vendor Package Analysis

We are building a vendor package for **SEMICONDUCTOR**, following the corrected VIDEO workflow.

### What Was Completed

- **Semiconductor super-sector template v2** — Reweighted for litigation
- **`scripts/recompute-super-sector-scores.ts`** — Recalculates composite scores
- **`scripts/export-vendor-package.ts`** — Generic vendor export for any super-sector
- **Initial SEMICONDUCTOR export** — `output/vendor-exports/SEMICONDUCTOR-2026-02-25/` with 2,545 broadcom-core patents

### Current SEMICONDUCTOR Data State

**Broadcom-core scoring: 2,545 patents scored (100% of eligible broadcom SEMICONDUCTOR)**

| Sector | Total | Scored | Avg Score | Top Score |
|--------|-------|--------|-----------|-----------|
| analog-circuits | 1,952 | 1,086 | 60.58 | 78.96 |
| semiconductor | 1,387 | 623 | 54.69 | 70.48 |
| audio | 487 | 131 | 59.74 | 73.40 |
| memory-storage | 483 | 238 | 55.12 | 69.81 |
| test-measurement | 463 | 217 | 48.00 | 78.34 |
| semiconductor-modern | 433 | 98 | 54.40 | 70.03 |
| pcb-packaging | 226 | 74 | 44.63 | 67.45 |
| semiconductor-manufacturing | 71 | 30 | 59.54 | 71.60 |
| magnetics-inductors | 60 | 16 | 62.37 | 72.39 |
| lithography | 44 | 35 | 54.23 | 67.34 |

### Competitor Portfolios in SEMICONDUCTOR

| Portfolio | Patents | LLM Scored |
|-----------|---------|------------|
| broadcom-core | 2,545 | 2,545 (actual scores) |
| mediatek | 709 | 0 |
| marvell | 598 | 0 |
| samsung | 595 | 453 |
| apple | 236 | 168 |

**CRITICAL GAP:** Competitor landscape essentially empty. Missing semiconductor-specific competitors: TI, ADI, onsemi, Microchip, NXP, Renesas, Infineon, ST.

### Planned Next Steps

1. Fix WIRELESS collective strategy (re-create template with `{{focusArea.patentData}}`)
2. Generate WIRELESS per-patent formatted output (Lit/Det/Strategy format)
3. Import semiconductor-specific competitors (TI, ADI, onsemi minimum)
4. Create sub-sector templates for large sectors (analog-circuits, etc.)
5. Build SEMICONDUCTOR focus areas and family expansion
6. Full SEMICONDUCTOR vendor package with competitive landscape

---

## Batch API Mode (Implemented Feb 25)

- GUI `batchMode` toggle now wired to actual Anthropic Message Batches API
- `BATCH_MODE=true` env var → `run-sector-scoring.ts` → `submitBatchScoring()` → fire-and-forget
- Lifecycle: `running` → `batch_pending` → `completed` (auto-processes results)
- Anthropic batch ID tracked in `batch_jobs.anthropic_batch_id` column
- DELETE handler cancels Anthropic batch if in `batch_pending` state
- Portfolio name displayed in LLM Batch Scoring tab

---

## XML Zero-Padding Fix (Feb 25)

- Root cause: Bulk XML doc-numbers are zero-padded (US09959345.xml) but DB patent IDs strip leading zeros (9959345)
- Fix: `findPatentXmlPath()` utility checks both padded and unpadded variants
- Applied to: `patent-xml-extractor-service.ts`, `extract-patent-xmls-batch.ts`
- 4,121 incorrectly quarantined patents repaired (had XML files but couldn't find them)

---

## Infrastructure Status

| Component | Status | Port |
|-----------|--------|------|
| API Server | `npm run dev` (from root) | 3001 |
| Frontend | `npm run dev` (from frontend/) | 3000 |
| PostgreSQL | Docker | 5432 |
| Elasticsearch | Docker | 9200/9300 |

---

## Key Files

| File | Purpose |
|------|---------|
| `scripts/export-vendor-package.ts` | Generic vendor export for any super-sector |
| `scripts/export-wireless-vendor-package.ts` | WIRELESS-specific export (reference) |
| `scripts/recompute-super-sector-scores.ts` | Recompute composites from stored metrics |
| `src/api/services/llm-scoring-service.ts` | LLM scoring, batch API, context options |
| `src/api/services/prompt-template-service.ts` | Template variable substitution, focus area prompts |
| `src/api/routes/batch-jobs.routes.ts` | Batch jobs, gap analysis, batch API polling |
| `cache/focus-area-prompts/` | Per-patent assessments and collective strategies |
| `output/vendor-exports/` | Exported vendor packages |

---

## Cache & Data Locations

| Cache | Path | ~Count |
|-------|------|--------|
| LLM scores | `cache/llm-scores/` | ~31,450 |
| Prosecution scores | `cache/prosecution-scores/` | ~11,576 |
| IPR scores | `cache/ipr-scores/` | ~10,745 |
| PatentsView | `cache/api/patentsview/patent/` | ~49,000 |
| Patent XMLs | `$USPTO_PATENT_GRANT_XML_DIR` | ~28,000 |
| Score history | `cache/score-history/` | varies |
| Focus area prompts | `cache/focus-area-prompts/` | varies |

---

*Last Updated: 2026-02-25*
