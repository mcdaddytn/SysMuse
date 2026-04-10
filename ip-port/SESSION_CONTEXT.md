# Session Context - April 2026

## Recent Changes (stable-demo branch)

### 1. XML Extraction Integrated into Import Pipeline
**Files modified:**
- `src/api/services/uspto-query-service.ts` — Added `xml_source` to `UsptoPatentRecord` and SQL queries
- `src/api/services/patent-xml-extractor-service.ts` — Added `extractPatentXmlsBySource()` function
- `src/api/services/uspto-import-service.ts` — Added Phase 3: auto XML extraction + `hasXmlData` batch update
- `src/api/routes/portfolios.routes.ts` — Fixed `cpcPrefixes` → `cpcSections` param mismatch

**What it does:** Import is now 3 phases:
1. Query USPTO index DB for patents matching affiliate patterns
2. Upsert patents + CPC codes into app DB
3. Extract XML from weekly ZIP files using `xml_source` field, update `hasXmlData`

The `xml_source` field (e.g., "ipg240102") maps directly to the ZIP filename, bypassing the old grant date → publication Tuesday calculation.

**Tested:** 1000 Broadcom patents imported, 991 XMLs extracted, claims extraction verified, LLM enrichment with claims context confirmed working.

### 2. XML Backfill for Legacy Patents
- Backfilled 674 `BULK_DATA_IMPORT` patents that were imported before Phase 3 existed
- Backfilled 11,504 additional patents across 560 ZIPs (all patents in index DB missing XML)

### 3. Prisma napi String Size Limit Fix
**File:** `src/api/services/patent-data-service.ts` (line 795)

**Problem:** `getAllPatents()` loading ~74K patents with relations exceeded Prisma's Rust→napi bridge serialization limit (~45K rows), causing `Failed to convert rust 'String' into napi 'string'` error. Aggregate view showed 0 results.

**Fix:** Replaced single `findMany` with cursor-based pagination (BATCH_SIZE = 20,000). Note: this changes `orderBy` to `patentId: 'asc'` for cursor mechanics; user-specified sorting is applied post-fetch in the DTO layer.

### 4. Aggregate View Portfolio Filtering
**File:** `frontend/src/pages/AggregatesPage.vue` (lines 362, 396)

**Problem:** Aggregate fetch did NOT include `portfolioId` in request body, so results came from all 74K patents across all portfolios (showing competitor affiliates like Ericsson, Qualcomm, Apple, Marvell).

**Fix:** Added `portfolioId: portfolioStore.selectedPortfolioId` to both the aggregate query and CSV export request bodies.

### 5. Empty Affiliate Data Fix
**Problem:** 106 patents in Broadcom portfolio (imported via legacy `CANDIDATES_FILE` path) had empty `affiliate` field. The DTO fallback (`affiliate || assignee || 'Unknown'`) exposed raw assignee names (TOHOKU UNIVERSITY, IBM, Cypress, ASML, etc.) in aggregate views.

**Fix (SQL):**
- Updated 101 patents with correct affiliates: VMware LLC→VMware (57), Nicira→Nicira (19), Avago (11), Pivotal (8), CA Technologies (5), LSI/Agere (1)
- Removed 5 non-Broadcom patents from portfolio (TOHOKU, IBM, Cypress, ASML, EMC)

---

## Patent Import Path Audit

### Active Import Paths

| Path | Source Enum | File | Affiliate Matching | Uses PatentsView |
|------|------------|------|-------------------|-----------------|
| USPTO Bulk Import | `BULK_DATA_IMPORT` | `uspto-import-service.ts` | YES | NO |
| USPTO Manifests | `BULK_DATA_IMPORT` | `scripts/import-via-manifests.ts` | YES | NO |
| Manual/User Upload | `MANUAL` | `portfolios.routes.ts:212` | YES (creates affiliates) | **YES** (deprecated) |

### Deprecated / Legacy

| Path | Source Enum | Status |
|------|------------|--------|
| PatentsView Import | `PATENTSVIEW_IMPORT` | No active code, but PatentsView API still used for MANUAL enrichment |
| Candidates File | `CANDIDATES_FILE` | Schema default only, no active code. Legacy bootstrap data. |

### PatentsView API Still Used In
- `portfolios.routes.ts` lines 316-389: Enriches MANUAL patents with titles, abstracts, dates
- `portfolios.routes.ts` lines 140-163: Analyze-patents preview
- `portfolios.routes.ts` lines 467-525: Patent count queries
- `patent-hydration-service.ts`: Fallback enrichment for unresolved patents

### TODO: Migrate MANUAL path off PatentsView
The `create-from-patents` route (MANUAL import) still fetches from PatentsView API for enrichment. This should be migrated to use USPTO index DB + XML extraction instead. The PatentsView API is deprecated and may become unavailable.

---

## Recent Changes (continued)

### 6. Affiliate Prefix Matching Word Boundary Fix
**Files:** `uspto-import-service.ts`, `bulk-patent-search-service.ts`

**Problem:** Simple `startsWith()` matching caused false positives: "LSI" matched "LSIS Co., Ltd" (Korean company), "Pivotal" matched "Pivotal Commware", etc. LSI had 807/1063 false positives; Pivotal had 59/65.

**Fix:** Added word-boundary check — after a prefix match, the next character must be non-alphanumeric (space, comma, etc.) or end-of-string. Also removed overly-broad bare "LSI" and "Pivotal" patterns from affiliate DB.

### 7. Query Performance Fix (168s → 1s)
**File:** `uspto-query-service.ts`

**Problem:** `ILIKE` cannot use btree `text_pattern_ops` indexes. Assignee search on 5.5M rows took 168s.

**Fix:** Created expression index `lower(assignee) text_pattern_ops` and changed SQL to `lower(ip.assignee) LIKE 'pattern%'`. Query dropped to 1.0s. Also removed SQL `LIMIT` (was being consumed by false positives before post-filter).

### 8. Pre-2015 USPTO Index Data
Indexed 2005-2014: 522 files, 2,339,109 patents in 24 minutes. Forward citations recomputed in 13 minutes. Total index: 5,585,299 patents across 1,096 files.

### 9. Full Broadcom Import
Imported 5,887 new pre-2015 patents via CLI, 5,869 XMLs extracted. Portfolio total: 36,727.

### 10. Filter Options Scoped to Portfolio + Alphabetized
**Files:** `FlexFilterBuilder.vue`, `PortfolioPage.vue`, `AggregatesPage.vue`, `patent-data-service.ts`

**Problem:** FlexFilterBuilder fetched filter options (affiliates, competitors, sectors, etc.) without `portfolioId`, showing values from all portfolios. Options were sorted by count (descending), making them hard to find.

**Fix:**
- Added `portfolioId` prop to FlexFilterBuilder, passed to API call as query param
- Both parent pages (PortfolioPage, AggregatesPage) now pass `portfolioStore.selectedPortfolioId`
- Filter options reload when portfolio changes
- All filter option lists sorted alphabetically instead of by count

---

## Recent Changes (April 6-8, 2026)

### 11. Competitive Landscape Expansion — 20 New Competitors + Affiliate Fixes
**File:** `config/competitors.json` (v5.3 → v6.0)

- Added 13 missing Broadcom affiliate exclude patterns (Nicira, VeloCloud, Heptio, Foundry Networks, Emulex, NetLogic, PLX Technology, SandForce, CloudHealth, Cyoptics, AirWatch, Agere Systems, \bLSI\b)
- Added 20 new competitor companies discovered via neutral citation mining across 5 categories (emergingTargets, cybersecurity, enterprise, networking, semiconductor)
- Added discovery strategy `neutral-citation-mining-v1` documenting the methodology
- Updated FireEye → Musarubra (Trellix) with merged patterns
- Total companies: 147

### 12. Vendor Package Script Enhancements
**File:** `scripts/create-sector-vendor-package.ts`

- **CPC filter** (`--cpc=PREFIX1,PREFIX2`): Narrows patent selection within a sector by CPC code prefixes. Enables sub-sector packaging without taxonomy changes.
- **Label flag** (`--label=NAME`): Custom naming for CPC-filtered packages (Focus Areas, templates, export directories)
- **Affiliate exclusion in LLM prompts**: CRITICAL EXCLUSION and TARGETING RULES added to per-patent assessment questions and collective strategy prompt
- **Competitor citation context**: contextFields now include `competitor_citations` and `competitor_names`
- **Smaller company targeting**: LLM prompts now emphasize $200M-$5B revenue targets over large cross-licensed companies
- **Fixed Marvell misclassification**: Replaced Marvell (a competitor) with Foundry Networks in BROADCOM_AFFILIATES

### 13. Citation Re-classification
Re-classified 29,474 patents with expanded competitor config:
- 136,890 competitor citations (42.8%)
- 45,965 affiliate citations (14.4%)
- 136,986 neutral citations (42.8%)

### 14. Targeted LLM Enrichment
**File:** `scripts/enrich-specific-patents.ts` (new)

Batch enrichment of 85 patents missing LLM cache files across 3 sectors (network-multiplexing, wireless-power-mgmt, wireless-infrastructure). Calls Claude Sonnet directly with concurrency=5. Produces `cache/llm-scores/{patentId}.json`.

### 15. 35 Vendor Packages Generated
Generated comprehensive vendor packages across all scored sectors:

**Standard sector packages (22):** network-multiplexing, wireless-power-mgmt, wireless-infrastructure, video-server-cdn, video-codec, computing-auth-boot, wireless-scheduling, wireless-mobility, test-measurement, network-error-control, video-broadcast, power-management, video-storage, computing-data-protection, wireless-mimo-antenna, semiconductor-modern, semiconductor-manufacturing, audio, radar-sensing, antennas, wireless-services, lithography, telephony, pcb-packaging, 3d-stereo-depth, cameras-sensors, ai-ml, display-control, image-processing

**CPC-filtered semiconductor sub-packages (6):** semiconductor-interconnect (H01L23/48-52), semiconductor-bonding (H01L24), semiconductor-thermal-emi (H01L23/28-42,55x), semiconductor-multichip (H01L25), semiconductor-fabrication (H01L21), semiconductor-devices (H01L29/27)

**Totals:** 1,226 patents, 19,169 patent-target pairs across 35 packages. All outputs in `output/vendor-exports/{sector}-2026-04-06/`.

### 16. Niche Scoring & Neutral Citation Mining
**Files:** `scripts/score-niche-sectors.ts`, `scripts/mine-neutral-citations.ts` (new)

- Niche Finder scoring profile added to scoring-service.ts (no competitor citation boost)
- Identified 72 hidden gem patents underweighted by Aggressive Litigator profile
- Mined 8,360 neutral citation companies from citing-patent-details cache

### 17. Supporting Scripts
New utility scripts created during this work:
- `scripts/create-opportunity-package.ts` — Target-specific opportunity packages
- `scripts/find-missing-vendor-packages.ts` — Identifies sectors without packages
- `scripts/create-missing-vendor-packages.ts` — Batch package creation
- `scripts/map-broadcom-target-overlap.ts` — Competitor patent overlap analysis
- `scripts/process-product-docs.ts` — Product document processing
- `scripts/summarize-product-docs.ts` — Product document summarization
- `src/api/services/product-doc-service.ts` — Product document service

### 18. Cross-Package Consolidation & Gap Analysis
**Files:** `scripts/consolidate-vendor-packages.ts`, `scripts/find-product-docs.ts` (new)

**Phase A — consolidate-vendor-packages.ts:**
Standalone filesystem-only script that reads all 44 sector vendor packages from `output/vendor-exports/*-2026-04-06/`, parses collective strategies (technology clusters, claim chains, vulnerability matrix, top patents), merges all pivot CSVs, normalizes company names (4-tier matching against product cache, competitors.json, companies.json, plus hardcoded aliases), and generates:

- `all-patent-targets.csv` — 18,492 merged patent-target pairs with sector attribution
- `target-summary.csv` — 1,672 normalized unique targets with patent exposure counts, product doc status, competitor category
- `package-overview.md` — Cross-package narrative: Very High/High clusters table, HIGH vulnerability targets, top patents by lit score, per-sector summary, top targets by exposure

**Phase B — find-product-docs.ts:**
Reads Phase A output, identifies targets missing product documentation (1,540 of 1,672 = 92%), gathers product context from pivot data, generates focused search queries per target. Outputs:

- `gap-targets.csv` — Top 50 gap targets ranked by patent exposure
- `search-queries.csv` — 126 search queries (2-3 per target, using sector tech areas and known product mentions)
- `evidence-summary.md` — Per-target evidence summary with Tier 1/2/3 framework
- `product-doc-urls.csv` / `youtube-videos.csv` — Empty templates for interactive URL collection
- Supports `--update-cache` flag to write found URLs into `cache/patlytics/products/` for download pipeline integration

**Key findings:**
- Top gap targets by patent exposure: HPE (157), CommScope (103), Unisoc (96), Lattice Semiconductor (88), ASE (76)
- 158 Very High or High strength technology clusters across 44 sectors
- Wireless sectors dominate top-20 patents by LitScore (scores of 8 with 15-29 targets each)

**Next steps:**
- Extend overview rankings beyond top 20 (targets, patents) and add per-super-sector top patent lists
- Begin interactive web search for product documentation on gap targets
- Feed found URLs into download pipeline

---

## Recent Changes (April 9-10, 2026)

### 19. Internal Infringement Heatmap System

Built a complete internal infringement scoring engine to replace/supplement Patlytics vendor analysis.

**New scripts created:**
- `scripts/score-infringement.ts` — Production two-pass scoring engine (Pass 1: screening with 15K chars, Pass 2: deep claim-element analysis with full doc text)
- `scripts/score-control-group.ts` — Calibration test harness for prompt iteration
- `scripts/build-control-group.ts` — Builds calibration set using exact Patlytics documents
- `scripts/analyze-calibration.ts` — Computes Pearson r, MAE, bias between internal and Patlytics scores
- `scripts/calibrate-infringement.ts` — Calibration reporting
- `scripts/summarize-product-docs-v2.ts` — Sector-agnostic product doc summarization
- `scripts/export-infringement-heatmap.ts` — Export results as heatmap CSVs

**Calibration Results (v2 prompts, N=77):**
- High-scoring group (52%, score >= 0.72): MAE = 0.063, Bias = +0.039 — excellent calibration
- Low-scoring group (48%, score <= 0.25): MAE = 0.629, Bias = -0.629 — intentionally conservative
- Overall: Our system is more conservative than Patlytics — when we score high, it correlates well with Patlytics; when we score low, Patlytics often scores higher due to "technology relevance" scoring vs our "claim-specific functional alignment"
- This is acceptable: high-scoring candidates are reliable for enforcement prioritization

**Key v2 Prompt Innovations:**
- Functional equivalence matching: LLM instructed to match on WHAT systems do, not terminology (e.g., "flow tables" ≈ "routing policies")
- max(Pass1, Pass2) scoring strategy: Prevents Pass 2 from over-penalizing literal claim element mismatches
- temperature=0 for determinism
- Improved JSON parser handles LLM reasoning prefix before JSON output

**Production Batch Setup:**
- `--from-targets` mode reads `all-patent-targets.csv` (18,492 pairs), normalizes patent IDs (US10396716B2 → 10396716), slugifies company names
- Dry run shows 17,030 pairs discovered, 16,449 uncached
- Estimated cost: ~$411 ($206 with Batch API)
- Results cached to `cache/infringement-scores/{company}/{product}/{patentId}.json`

**Cache structure:**
- `cache/infringement-scores/` — 545+ scored pairs from calibration runs
- `cache/calibration-control/` — 100-pair control group with manifest, docs, texts, results
- `cache/product-summaries-v2/` — Sector-agnostic product summaries

### 20. Doc Quality Screening & Quarantine System
**Files created:** `scripts/screen-doc-quality.ts` (new)
**Files modified:** `scripts/score-control-group.ts`, `scripts/build-control-group.ts`

**Doc Quality Screener** (`screen-doc-quality.ts`):
- Heuristic-based screening with 6 ordered rules: extraction_failed → stub_extraction → video_stub → paywall_stub → junk_html → thin_content
- Junk HTML detection via pattern matching (navigation, cookie banners, sidebar content) with configurable threshold (default 30%)
- CLI flags: `--control-only`, `--all`, `--threshold`, `--verbose`
- Outputs: `cache/doc-quality-screening/results.json` + `quarantine-report.md`

**Quarantine-Aware Scoring** (`score-control-group.ts` modifications):
- Loads quarantine results and filters pairs before scoring
- Shows Full Set vs Clean Set metrics side-by-side
- `--skip-quarantined` (default on) and `--include-quarantined` flags
- Detail table shows `!` flag for quarantined pairs

### 21. Expanded Calibration Set with Super-Sector Quotas
**File modified:** `scripts/build-control-group.ts`

**Major enhancements to control group builder:**
- **Super-sector quota system**: Configurable per-sector targets with priority ordering. Default quotas: SEMICONDUCTOR=28, COMPUTING=32, SECURITY=28, WIRELESS=18, NETWORKING=22, VIDEO_STREAMING=16
- **Patent→sector→super-sector mapping**: Uses vendor-exports CSVs + score-history directories with prefix-based sector classification
- **GLSSD2 local doc lookup**: Checks `/Volumes/GLSSD2/data/products/docs/` before downloading, copies locally. Avoids expired CDN dependency.
- **File type detection**: Magic bytes (`%PDF-`) + extension check to correctly identify PDF vs HTML when copying from GLSSD2. Fixed 41 extraction failures caused by HTML files copied as .pdf.
- **URL priority flipped**: Raw vendor URLs tried first, CDN fallback second (CDN links expired Apr 9, 2026)
- **Score threshold lowered**: Default 0.35 (was 0.40)
- **Overflow allocation**: Unfilled WIRELESS slots overflow to SEMICONDUCTOR/COMPUTING/SECURITY (not to VIDEO_STREAMING/NETWORKING)

### 22. Bulk Product Document Download
**File used:** `scripts/download-patlytics-docs.ts`

- Downloaded 4,355 product docs via raw vendor URLs (93% success rate)
- Expanded from 2.1GB/102 companies to 11GB/220 companies on GLSSD2
- 319 failures: 215 HTTP 403 (auth-walled portals), 40 network errors, 25 HTTP 406, 17 HTTP 404
- Remaining viable downloads: ~138 across priority sectors (all failed, not pending)

### 23. Calibration Results — Expanded Set (N=101 clean pairs)
- Pearson r: 0.226 (vs 0.218 on original 60-pair clean set)
- Spearman ρ: 0.211
- MAE: 0.198 (vs 0.159 — more varied pairs are harder)
- Bias: -0.042 (system slightly conservative vs Patlytics)
- Within 0.25: 73% (vs 88%)
- Key issue: SEMICONDUCTOR pairs score low (LLM very conservative on chip/RF docs)
- Worst misses: Cortex XDR (6K doc, Δ=-0.87), Intel CXL (10K, Δ=-0.73), AMD EPYC (103K, Δ=-0.57)

**Identified Next Steps for Calibration Improvement:**
1. **Integrate product doc summarization into scoring pipeline** — v2 summarizer exists but is disconnected from `score-infringement.ts`. Multi-doc products (avg 12.9 docs/product) need summarization to fit context windows.
2. **Patent-taxonomy-guided summarization** — Use patent super-sector/sector to drive what summarization extracts. Aggregate all correlated patents' taxonomy for a product before summarizing.
3. **Per-sector scoring question refinement** — Existing super-sector templates have terminology mappings and necessary-implication guidance. Consider adding sector-level (not just super-sector) template detail.
4. **Ad-hoc testing on SEMICONDUCTOR pairs** — Try variants of questions, summarization, and scoring weights before framework changes.

---

## Key Architecture Notes

- **USPTO Index DB**: 5.58M patents, 1,096 files, 2005-2025, with forward citations computed. Located at `prisma/uspto/schema.prisma`.
- **`xml_source` field** on `IndexedPatent` maps to weekly ZIP filename (e.g., `ipg240102` → `ipg240102.zip`)
- **Affiliate matching** uses `matchAffiliate()` in `uspto-import-service.ts` — prefix-matches assignee against `AffiliatePattern` table, with word-boundary enforcement
- **Prisma batch size limit**: Keep `findMany` with relations under ~20K rows per batch to avoid napi serialization failures
- **Expression index**: `lower(assignee) text_pattern_ops` on `indexed_patents` for fast case-insensitive prefix matching; created in `scripts/create-uspto-db.ts` since Prisma cannot define expression indexes
