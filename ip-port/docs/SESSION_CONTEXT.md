# Session Context — February 25, 2026

## Current Focus: SEMICONDUCTOR Vendor Package Analysis

We are in the middle of building a vendor package for the **SEMICONDUCTOR** super-sector, following the same workflow used for VIDEO (completed Feb 24) and WIRELESS (completed Feb 25). The package supports two vendor workstreams:

1. **Heat map analysis** — Patent lists for mapping against competitor product landscapes
2. **Claims charts** — High-potential litigation candidates for detailed claim-by-claim analysis

### What Was Completed Before Context Loss

- **Semiconductor super-sector template v2** — Reweighted for litigation: design-around difficulty (25%), claim breadth (20%), implementation clarity (20%) up; manufacturing/integration demoted to 5% each
- **`scripts/recompute-super-sector-scores.ts`** — Recalculates composite scores from stored metrics using current template weights (no LLM calls). Ran `--dry-run` on SEMICONDUCTOR.
- **`scripts/export-vendor-package.ts`** — Generic vendor export for any super-sector
- **Initial SEMICONDUCTOR export** — `output/vendor-exports/SEMICONDUCTOR-2026-02-25/` with 2,545 broadcom-core patents

### Current SEMICONDUCTOR Data State

**Overall:**
| Metric | Count |
|--------|-------|
| Total SEMICONDUCTOR patents | 7,691 |
| Quarantined | 2,085 |
| Eligible (non-quarantined) | 5,606 |
| Have USPTO XML | 3,890 |
| have_llm_data flag set | 1,853 |

**Broadcom-core scoring: 2,545 patents scored (100% of eligible broadcom SEMICONDUCTOR)**

**Sector Breakdown (broadcom-core):**
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

**NOTE:** "Scored" column counts are from patent_sub_sector_scores table (2,545 total have scores), but "total" column is ALL patents in that sector across ALL portfolios. So analog-circuits has 1,952 total patents but only 1,086 broadcom-core scores.

### Competitor Portfolios in SEMICONDUCTOR

| Portfolio | Patents | LLM Scored |
|-----------|---------|------------|
| broadcom-core | 2,545 | 943 (flag) / 2,545 (actual scores) |
| mediatek | 709 | 0 |
| marvell | 598 | 0 |
| samsung | 595 | 453 |
| apple | 236 | 168 |
| sony | 180 | 88 |
| intel | 176 | 6 |
| nvidia | 129 | 35 |
| ericsson | 105 | 3 |
| skyworks | 89 | 0 |
| cisco | 80 | 0 |
| qualcomm | 54 | 0 |

**CRITICAL GAP:** Competitor landscape CSV is essentially empty — only broadcom-core has meaningful scores. MediaTek, Marvell, Samsung are top competitors with zero SEMICONDUCTOR scores.

### Missing Semiconductor-Specific Competitors

These companies are PRIMARY semiconductor competitors to Broadcom but **not yet imported** as portfolios:
- **Texas Instruments (TI)** — analog/mixed-signal, direct competitor to analog-circuits
- **Analog Devices (ADI)** — analog/mixed-signal, merged with Maxim
- **ON Semiconductor (onsemi)** — power, analog
- **Microchip Technology** — mixed signal, microcontrollers
- **NXP Semiconductors** — automotive, connectivity, analog
- **Renesas** — automotive, industrial
- **Infineon** — power, automotive
- **STMicroelectronics** — broad semiconductor
- **Maxim Integrated** — now part of ADI, analog

### Scoring Templates Available

| Level | Template | Questions |
|-------|----------|-----------|
| Super-sector | `semiconductor.json` (v2, litigation-weighted) | 10 questions |
| Sector | `semiconductor-general.json` | 4 questions (digital logic, processor) |
| Sector | `semiconductor-manufacturing.json` | 3 questions (fab processes) |
| Sector | `semiconductor-modern.json` | 3 questions (post-2023 CPC) |
| Sub-sector | `semiconductor-manufacturing.json` (H01L21*) | 4 questions (wafer fab) |
| Sub-sector | `semiconductor-test.json` (H01L22*) | 4 questions (metrology) |

**Sub-sector gap:** No sub-sector templates for analog-circuits, audio, memory-storage, pcb-packaging, magnetics-inductors, lithography. These are needed before deeper scoring runs.

---

## Planned Next Steps for SEMICONDUCTOR Package

1. **Score remaining broadcom-core patents** — 2,545 scored, but scoring gap exists across sectors (some sectors only partially scored)
2. **Import semiconductor-specific competitors** — TI, ADI, onsemi at minimum via GUI Company→Discover Affiliates→Import Patents flow
3. **Enrich competitor patents** — hydrate, XML extract, auto-quarantine, LLM score
4. **Create sub-sector templates** for high-value sectors (analog-circuits is largest at 1,952 patents)
5. **Use focus areas & family expansion** to identify crown jewels and sibling/cousin patents
6. **Re-export vendor package** with competitive landscape populated

---

## Infrastructure Status

| Component | Status | Port |
|-----------|--------|------|
| API Server | `npm run dev` (from root) | 3001 |
| Frontend | `npm run dev` (from frontend/) | 3000 |
| PostgreSQL | Docker | 5432 |
| Elasticsearch | Docker | 9200/9300 |

---

## Previous Completions (Feb 22-25)

### Vendor Package Pipeline (Feb 24-25)
- VIDEO super-sector vendor package completed Feb 24
- WIRELESS super-sector vendor package completed Feb 25
- Generic `export-vendor-package.ts` script created (works for any super-sector)
- `recompute-super-sector-scores.ts` script for weight rebalancing without re-scoring

### Score Versioning & Staleness (Feb 25)
- `questionFingerprint`, `isStale`, `staleReason` on PatentSubSectorScore
- `computeStalenessForSector()` compares fingerprints vs current templates
- `scoringFilter` type: `'unscored' | 'stale' | 'unscored_or_stale' | 'all'`
- Score history snapshots: `cache/score-history/{subSectorId}/{patentId}_{timestamp}.json`

### Claims Always Included (Feb 22)
- `useClaims` flag removed from all code paths — claims always on
- `DEFAULT_CONTEXT_OPTIONS.includeClaims` = `'independent_only'`

### Quarantine System (Feb 20+)
- XML quarantine: pre-2005, design-patent, reissue-patent, recent-no-bulk, extraction-failed
- LLM quarantine: no-abstract, no-sector
- Auto-quarantine: `POST /api/batch-jobs/auto-quarantine` with dryRun support

---

## Known Architecture Debt

### File-Polling for Enrichment Status
- LLM & Prosecution: file-first → poll → DB flag (async, indirect)
- XML: direct DB update (correct)
- IPR: file-only, no DB flag at all
- Impact: Sector enrichment views lag behind actual progress

### has_llm_data Flag Lag
- broadcom-core shows 943 in has_llm_data but 2,545 actual scores exist
- Flag sync via `syncEnrichmentFlags()` hasn't caught up
- Actual scoring status is best checked via patent_sub_sector_scores table directly

### Chrome Scrollbar Problem — UNRESOLVED
Scrollbars work in Safari but NOT Chrome. See MEMORY.md.

---

## Key Files

| File | Purpose |
|------|---------|
| `scripts/export-vendor-package.ts` | Generic vendor export for any super-sector |
| `scripts/recompute-super-sector-scores.ts` | Recompute composites from stored metrics |
| `config/scoring-templates/super-sectors/semiconductor.json` | SEMICONDUCTOR scoring template v2 |
| `config/scoring-templates/sectors/semiconductor-*.json` | Sector-level scoring templates |
| `config/scoring-templates/sub-sectors/semiconductor-*.json` | Sub-sector scoring templates |
| `src/api/services/llm-scoring-service.ts` | LLM scoring, context options |
| `src/api/services/scoring-template-service.ts` | Template inheritance & merging |
| `src/api/routes/batch-jobs.routes.ts` | Batch jobs, gap analysis, claims gate |
| `src/api/routes/scoring-templates.routes.ts` | Scoring & staleness endpoints |
| `frontend/src/pages/SectorManagementPage.vue` | Sector scoring GUI |
| `output/vendor-exports/SEMICONDUCTOR-2026-02-25/` | Current SEMICONDUCTOR export |

---

## Cache & Data Locations

| Cache | Path | ~Count | Source |
|-------|------|--------|--------|
| LLM scores | `cache/llm-scores/` | ~31,450 | LLM enrichment pipeline |
| Prosecution scores | `cache/prosecution-scores/` | ~11,576 | Prosecution scoring |
| IPR scores | `cache/ipr-scores/` | ~10,745 | IPR scoring |
| PatentsView | `cache/api/patentsview/patent/` | ~49,000 | Hydration pipeline |
| Patent XMLs | `$USPTO_PATENT_GRANT_XML_DIR` | ~28,000 | USPTO bulk extraction |
| Score history | `cache/score-history/` | varies | Snapshot on recompute |

---

*Last Updated: 2026-02-25*
