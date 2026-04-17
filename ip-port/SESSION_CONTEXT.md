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

---

## Recent Changes (April 10-13, 2026)

### 24. Batch Scoring Pipeline Enhancements
**Files created:** `scripts/preflight-batch.ts`, `scripts/summarize-production-docs.ts`, `scripts/summarize-control-group-docs.ts`, `scripts/test-scoring-variants.ts`
**Files modified:** `scripts/score-infringement.ts`, `scripts/score-control-group.ts`

**Score Engine Upgrades (`score-infringement.ts`):**
- `--pass0` flag: Summary-based pre-screening before pass1 (reduces unnecessary pass1 calls)
- `--pass0-threshold <n>`: Minimum pass0 score to proceed to pass1 (default: 0.10)
- `--multi-doc`: Aggregates multiple product docs for pass2 deep analysis
- `--max-docs-per-product <n>`: Caps docs per product to control pair explosion
- `--from-targets <csv>`: Reads target CSVs with Target/TargetProduct/Patent columns
- `--force`: Re-scores even if cached score file exists
- CPC→super-sector resolution FIXED: reads `sector-taxonomy-cpc-only.json` with longest-prefix matching, then maps via `super-sectors.json`
- `formatSummaryForPrompt()` FIXED: now includes interfaces, signalProcessing, dataHandling, securityFeatures

**Preflight (`preflight-batch.ts`):**
- Dry-run cost estimator for scoring batches
- Shows pair counts, doc coverage, estimated costs per super-sector
- `--max-docs-per-product` support for cost estimation

**Summarizer (`summarize-production-docs.ts`):**
- Haiku-based product doc summarization (~$0.002/doc vs $0.02 Sonnet)
- `--model <id>` flag for model override
- Structured JSON extraction of product capabilities

**Scoring Variant Test Harness (`test-scoring-variants.ts`):**
- Tests baseline/summary/multi-doc/patent-guided scoring variants
- Multi-doc helps networking products with rich doc sets (Panorama err 0.170→0.076)
- Summary helps moderate overscoring and boost thin-doc pass1 scores

### 25. YouTube HTML Contamination Fixes
**Files modified:** `scripts/score-infringement.ts`, `scripts/extract-youtube-transcripts.ts`

- Content-based YouTube HTML detection and filtering in doc discovery
- Fixed junk HTML contamination affecting scoring quality
- Added `--max-videos` flag to transcript extractor for batch limiting
- Slug aliases for company name matching

### 26. Production Scoring Batches (April 12-13, 2026)
Ran 6 scoring batches totaling 1,575 pairs, ~$48:

| Batch | Description | Pairs | Pass2 | High (>=0.65) | Top Score |
|-------|-------------|------:|------:|--------------:|----------:|
| D | Mid-cap stale rescore (Cisco, Juniper, Arista, HPE) | 352 | 311 | 229 | 0.994 |
| E | Mega-cap stale rescore | 159 | 130 | 97 | 0.980 |
| F1 | Security: Fortinet+CrowdStrike+SonicWall | 350 | 106 | 45 | 0.933 |
| F2 | Security: McAfee+SentinelOne+Splunk+Ping+Zscaler | 363 | 94 | 44 | 0.956 |
| G1 | Wireless: Mavenir+Parallel+Sierra | 48 | 14 | 6 | 0.864 |
| G2 | Wireless: Cambium+Ubiquiti+Baicells+Airspan+JMA+Ruckus | 303 | 129 | 35 | 0.951 |

**Key findings:**
- 59 power patents hitting 3+ companies
- US10749736 broadest: 9 companies
- Ping Identity surprise star: 23 high-signal pairs
- AWS 100% hit rate (14/14 >= 0.65)
- Cisco CBR-8 #1 pair globally at 0.994

### 27. Vendor Summary Package (April 13, 2026)
**Output:** `output/vendor-summary-2026-04-13/`

Generated comprehensive scoring summary with 5 files:
- `portfolio-scoring-summary.md` — 991-line report: executive summary, super-sector/sector aggregates, top 20 patents & targets per super-sector, global top 50 pairs, 59 power patents, 146-company leaderboard, taxonomy gap analysis, enhancement roadmap
- `all-current-scores.csv` — 3,764 v3 score rows
- `company-exposure-summary.csv` — 147 companies with actionable counts, hit rates
- `top-pairs-by-sector.csv` — Top 10 pairs per sector
- `enhancement-roadmap.csv` — 7 prioritized action items

**Portfolio totals:** 3,763 current v3 scores, 542 actionable (>=0.65, 14.4%), across 146 companies.

### Identified Taxonomy Issues
1. **SEMICONDUCTOR missing 6 sectors**: semiconductor-bonding, -devices, -fabrication, -interconnect, -multichip, -thermal-emi NOT in `super-sectors.json` — 313 patents default to COMPUTING
2. **COMPUTING hollowed**: computing-runtime, computing-systems, computing-ui moved to VIRTUALIZATION
3. **Config drift**: `sector-taxonomy-cpc-only.json` uses "NETWORKING", `super-sectors.json` uses "SDN_NETWORK"

### Enhancement Roadmap (prioritized)
1. Fix Taxonomy — Add 6 missing semiconductor sectors ($0, config change)
2. Re-score 582 stale v1 pairs (~$12)
3. Score 85 unscored companies with docs (~$34 full, strategic sampling first)
4. Expand 41 companies with <5 pairs (~$12)
5. Fix Config Drift — NETWORKING/SDN_NETWORK alignment ($0)
6. Review COMPUTING/VIRTUALIZATION taxonomy ($0)
7. Expand AUDIO coverage (~$2)

---

## Recent Changes (April 15-16, 2026)

### 28. Base Score Formula v4 — Reweighting Away from Citations
**Files modified (3 copies of calculateBaseScore):**
- `src/api/services/portfolio-enrichment-service.ts` (line 121)
- `src/api/services/patent-hydration-service.ts` (line 82)
- `scripts/recalculate-base-scores.ts` (line 111)

**Problem:** Old formula gave citations 71% of score weight. Patents with 0 citations but 15+ years remaining maxed at ~19 points, burying high-quality young patents discovered by LLM scoring.

**New formula (v4):**

| Component | Old | New | Max pts |
|-----------|-----|-----|---------|
| Citation Score | `log10(fwd+1) × 40` | `log10(fwd+1) × 20` | ~40 |
| Time Score | `clamp(yrs/20, -0.5, 1) × 25` | `clamp(yrs/20, 0, 1) × 45` | 45 |
| Velocity Score | `log10(cpy+1) × 20` | `log10(cpy+1) × 15` | ~15 |
| Youth Bonus | N/A | Up to 10 pts for patents < 5 yrs old with 15+ yrs remaining | 10 |

**Impact:** 29,321 patents recalculated. 11,773 increased score, 17,548 decreased. Citation weight dropped from 71% to ~50%, time weight rose from 29% to ~41%.

**`--db` flag added** to `recalculate-base-scores.ts`: Writes updated scores to `Patent.baseScore` via Prisma in batches of 500.

### 29. V3 Litigation Discovery Snapshot Regeneration
After base score update + LLM gap fill, regenerated V3 snapshot: **31,026 patents** (up from 30,241). V3 scoring uses ~88% LLM quality weight with near-zero citation weight.

### 30. Nutanix Sector Gap Analysis
**File created:** `scripts/analyze-nutanix-sector-gaps.ts`

Queries DB for LLM coverage across 22 Nutanix-relevant sectors (COMPUTING 6, NETWORKING 8, SECURITY 8). Found:
- 95.7% LLM coverage in Nutanix sectors (only 785 gap patents)
- 3,529 hidden gems (high V3 score, low base score or not in Nutanix FA)
- All 785 gap patents subsequently scored via `run-sector-scoring.ts` (0 failures)

### 31. V3 Score Type for Vendor Packages
**File modified:** `scripts/create-sector-vendor-package.ts`

Added `--score-type=v3|subsector` flag. When v3: queries active V3 snapshot's PatentScoreEntry for patents in target sector, sorted by V3 score desc. Surfaces patents with high LLM quality signals even if they haven't been through sub-sector scoring.

### 32. Nutanix V3 Discovery Package (87 patents)
**File created:** `scripts/create-nutanix-v3-package.ts`

Combined package: 37 existing Nutanix Litigation Targets + top 50 V3 discoveries from Nutanix-relevant sectors. Nutanix-specific assessment questions targeting AHV, NCI, Flow Virtual Networking, Flow Network Security, Prism Central. Reuses existing product intelligence from AHV template.

**Output:** Focus Area "Nutanix V3 Discovery — Combined" (87 patents, 10 per-patent questions, collective strategy).

### 33. Litigation Export Service
**File created:** `src/api/services/litigation-export-service.ts`

Generates comprehensive CSV exports for focus areas: patent metadata, EAV scores, sub-sector scoring metrics with reasoning, V2/V3 snapshot scores. Used by `scripts/export-litigation-package.ts`.

### 34. Nutanix V3 Infringement Scoring
Scored 341 patent-product pairs (73 unique patents × 5 Nutanix products) using internal-v3 two-pass engine. Cost: ~$8.50.

**Results:**
- 29 patents score ≥0.80 (up from 11 in original 37-patent set)
- 19 Tier 1 patents ≥0.85 (up from 9)
- 15 patents show infringement signals across 3+ products
- Top new discoveries: US11539659 (0.910), US11675585 (0.888), US11593148 (0.868)

### 35. V3 Discovery Export Package
**Output:** `output/vendor-exports/nutanix-v3-discovery-2026-04-16/`

| File | Description |
|------|-------------|
| `nutanix-infringement-summary.md` | Full heat map: 87 patents × 5 products, strategic tiers, cross-product coverage |
| `nutanix-patent-product-matrix.csv` | 87-row patent × product score matrix |
| `nutanix-all-scores.csv` | 435 scored pairs with documents and narratives |
| `collective-strategy.md` | Technology clusters, claim chains, vulnerability analysis, assertion strategy |
| `litigation-package-*.csv` | Full patent detail export (227 columns, 87 patents, 90 metric keys) |
| `vendor-targets.csv` | 87 patents with per-patent assessment scores |
| `nutanix-assessment-results.csv` | Per-patent structured assessment results |
| `vendor-targets-pivot.csv` | 732 patent-target pairs |

### Supporting Scripts Created
- `scripts/_generate-nutanix-v3-docs.ts` — JSON→markdown collective strategy + litigation CSV
- `scripts/_generate-nutanix-v3-infringement-summary.ts` — Heat map summary from score cache
- `scripts/_get-v3-unscored.ts` — Identifies unscored V3 patents per Nutanix product
- `scripts/create-litigation-discovery-snapshot.ts` — V3 snapshot creation
- `scripts/create-nutanix-litigation-focus-area.ts` — Nutanix litigation FA setup
- `scripts/check-nutanix-patents-in-db.ts` — DB verification utility

---

---

## Recent Changes (April 16, 2026 — Session 2)

### 36. Sector Infringement Heatmap Batches (7 sectors)
Ran infringement pair scoring for 7 initial sectors, producing standardized 8-file packages:

| Sector | Patents | Pairs | Very-High | Tier 1 | Dominant Target |
|--------|---------|-------|-----------|--------|-----------------|
| computing-runtime | 74 | 391 | 22 | — | — |
| network-switching | 74 | 444 | 33 | — | — |
| network-auth-access | 43 | 228 | 9 | — | — |
| computing-systems | 64 | 256 | 27 | 17 | NVIDIA (23 >=0.80) |
| network-management | 36 | 288 | 10 | 10 | Cisco (3 at 0.98) |
| network-threat-protection | 35 | 280 | 9 | 9 | CrowdStrike/Darktrace |
| network-secure-compute | 35 | 210 | 19 | 8 | Nutanix (14 >=0.80) |

All packages at `output/vendor-exports/{sector}-2026-04-16/` with 8 standard files each.

**Scripts created per sector:** `_build-{abbrev}-infringement-targets.ts` + `_generate-{abbrev}-infringement-summary.ts`

### 37. V3 Reranking + Infringement for New Sectors

**V3 Reranking Analysis:**
Compared V3 top-35 vs existing subsector top-35 for candidate sectors. Found massive divergence:
- network-protocols: 35/35 new patents (0 overlap)
- computing-auth-boot: 24/24 new (0 overlap)
- wireless-infrastructure: 27/31 new
- computing-data-protection: 21/26 new
- computing-os-security: 19/20 new

**Wireless-Infrastructure V3 Package (STRONG RESULTS):**
- 65 patents (35 V3 + 30 original), 686 pairs, 179 Pass 2, 0 failures
- **18 very-high, 13 Tier 1**
- Ericsson (12 >=0.80), Mavenir (9 >=0.80) dominant for RIC/Cloud RAN patents
- CommScope (4 >=0.80), Ubiquiti for Wi-Fi/MIMO patents
- Top: US9408208 (0.96 CommScope), US11831517 (0.95 Mavenir/Ericsson/PW/Nokia)
- Qualcomm poor match (wrong product docs)

**Network-Protocols V3 Package (WEAK RESULTS):**
- 69 patents (35 V3 + 36 original), 685 pairs, only 12 Pass 2, 0 failures
- **4 very-high, 2 Tier 1 — very low yield**
- V3-selected patents (distributed networking, FaaS, DPU) didn't match router/switch docs
- Only older SoC/TCP patents scored well vs Cisco

**Key Insight:** V3 reranking effectiveness depends on alignment between patent themes and available product docs. Cloud-native/RIC patents match well against Ericsson/Mavenir docs. Abstract distributed systems patents don't match traditional router datasheets.

### Scripts Created (Session 2)
- `scripts/_build-wi-infringement-targets.ts` — wireless-infrastructure targets (11 products, 8 companies)
- `scripts/_generate-wi-infringement-summary.ts` — wireless-infrastructure heatmap (8 companies)
- `scripts/_build-np-infringement-targets.ts` — network-protocols targets (10 products, 5 companies)
- `scripts/_generate-np-infringement-summary.ts` — network-protocols heatmap (5 companies)

---

## Recent Changes (April 17, 2026 — Session 3)

### 38. V3 Batch: computing-os-security, computing-data-protection, computing-auth-boot

Ran full V3 pipeline for all 3 remaining sectors via `scripts/_run-v3-batch-3sectors.sh`.

| Sector | Patents | Pairs | Pass 2 | Very-High | Tier 1 | Tier 2 | Top Target |
|--------|---------|-------|--------|-----------|--------|--------|------------|
| computing-os-security | 62 | 620 | 99 (16%) | 1 | 1 | 4 | Check Point (0.89), SentinelOne (0.81) |
| computing-data-protection | 66 | 660 | 46 (7%) | 2 | 0 | 4 | McAfee DLP (0.82), Dell (0.81) |
| computing-auth-boot | 66 | 447 | 37 (8%) | 3 | 1 | 6 | Microsoft (0.92), Okta (0.82) |

**Key results:**
- **computing-auth-boot strongest**: US11726798 "Connected provisioning" scored 0.92 Microsoft, 0.82 Okta, 0.73 Ping Identity (3 companies >=0.50)
- **computing-os-security**: US11645390 (NGAV virtualization) 0.89 Check Point, 0.81 SentinelOne. US12050684 hit 7/9 companies >=0.50 (best cross-company)
- **computing-data-protection weakest**: No Tier 1; US8572758 (DLP) 0.82 McAfee, 0.75 Varonis best result
- **Palo Alto XSOAR docs all junk HTML** — computing-auth-boot effectively 4 companies not 5

### Scripts Created (Session 3)
- `scripts/_build-cos-infringement-targets.ts` — computing-os-security (11 products, 9 companies)
- `scripts/_generate-cos-infringement-summary.ts` — computing-os-security heatmap
- `scripts/_build-cdp-infringement-targets.ts` — computing-data-protection (10 products, 7 companies)
- `scripts/_generate-cdp-infringement-summary.ts` — computing-data-protection heatmap
- `scripts/_build-cab-infringement-targets.ts` — computing-auth-boot (10 products, 5 companies)
- `scripts/_generate-cab-infringement-summary.ts` — computing-auth-boot heatmap
- `scripts/_run-v3-batch-3sectors.sh` — master batch runner

### All 12 V3 Sector Packages Complete

| Sector | Date | Very-High | Tier 1 | Quality |
|--------|------|-----------|--------|---------|
| computing-runtime | 04-16 | 22 | — | Strong |
| network-switching | 04-16 | 33 | — | Strong |
| network-auth-access | 04-16 | 9 | — | Moderate |
| computing-systems | 04-16 | 27 | 17 | Strong |
| network-management | 04-16 | 10 | 10 | Strong |
| network-threat-protection | 04-16 | 9 | 9 | Moderate |
| network-secure-compute | 04-16 | 19 | 8 | Strong |
| wireless-infrastructure | 04-16 | 18 | 13 | Strong (V3) |
| network-protocols | 04-16 | 4 | 2 | Weak (V3) |
| computing-os-security | 04-17 | 1 | 1 | Moderate (V3) |
| computing-data-protection | 04-17 | 2 | 0 | Weak (V3) |
| computing-auth-boot | 04-17 | 3 | 1 | Moderate (V3) |

### Pending Improvements
1. **Abstract infringement scripts** — Replace per-sector `_build-*` and `_generate-*` scripts with data-driven config (company/product definitions) + single generic builder/generator
2. **Nutanix V3 opportunities** — Check if newly scored V3 patents surface additional Nutanix-relevant candidates
3. **Palo Alto XSOAR doc quality** — Docs flagged as 100% junk HTML; need rediscovery or manual cleanup

### Pipeline Reference
```bash
# 1. Create V3 vendor package
npx tsx scripts/create-sector-vendor-package.ts <SECTOR> --score-type=v3 --top=35

# 2. Build infringement targets
npx tsx scripts/_build-{abbrev}-infringement-targets.ts

# 3. Run infringement scoring
npx tsx scripts/score-infringement.ts --from-targets output/{sector}-infringement-targets.csv --max-docs-per-product 1 --concurrency 6

# 4. Generate heatmap
npx tsx scripts/_generate-{abbrev}-infringement-summary.ts

# 5. Export litigation CSV + copy to package
npx tsx scripts/export-litigation-package.ts --id <focus-area-id>
cp output/litigation-packages/litigation-package-*.csv output/vendor-exports/{sector}-2026-04-16/litigation-package-all-fields-export.csv
```

---

## Recent Changes (April 17, 2026 — Session 4)

### 39. Focus Area Portfolio Auto-Association (Enhancement 1)
**Files modified:**
- `prisma/schema.prisma` — Added `FOCUS_AREA_IMPORT` to `PatentSource` enum
- `src/api/services/uspto-import-service.ts` — Exported `matchAffiliate()` for reuse
- `src/api/routes/focus-areas.routes.ts` — Auto-association after XML enrichment in POST `/:id/fetch-patents`

**What it does:** After "Load Patent Data" (USPTO XML enrichment) completes for a focus area, the system automatically:
1. Queries enriched patent assignees from the Patent table
2. Loads all companies with portfolios and their active affiliate patterns
3. Matches each patent's assignee(s) against affiliate patterns using `matchAffiliate()`
4. Upserts `PortfolioPatent` with `source: FOCUS_AREA_IMPORT` and updates `Patent.affiliate`
5. Returns `portfolioLinks: { linked: N, companies: [...] }` in the response

Handles semicolon-separated assignees, is idempotent, and non-fatal on error.

### 40. Focus Area as Batch Job Target Type (Enhancement 2)
**Files modified:**
- `src/api/routes/batch-jobs.routes.ts` — Added `'focus-area'` to `TargetType`, validation, `analyzeGaps()` (two-step query via `FocusAreaPatent`), and focus area name resolution for job display
- `frontend/src/services/api.ts` — Added `'focus-area'` to `TargetType` union
- `frontend/src/pages/JobQueuePage.vue` — Added Focus Area option to target type selector, focus area dropdown, and display formatting

### Enhancement 3 (Planned): Prior Art Invalidity Risk Scoring
**Spec document:** `docs/prior-art-risk-scoring-spec.md`

**Short-term (quick version):** Implement prior art risk questions as Focus Area structured questions using the existing prompt template system. Deploy Q-U1 through Q-U8 (universal LLM questions) and applicable Q-S* super-sector questions per focus area. This avoids portfolio-wide rescoring and leverages existing focus area infrastructure.

**Long-term goal:** Refactor into taxonomy-based questions with inheritance (super-sector → sector → sub-sector). Questions live at the highest stable level; sub-sector annotations inject tech-specific context. Migration path: proven focus-area questions promote to taxonomy level, triggering one-time portfolio backfill.

**Implementation phases (from spec):**
- Phase 1: ODP-only API metrics (Q-API-1, Q-API-2, Q-API-4) + universal LLM questions (Q-U1–Q-U8) + focus-area super-sector questions + CSV export + composite scoring v1
- Phase 2: EPO OPS integration, Q-API-3/Q-API-5, Q-U6 priority chain assessment
- Phase 3: Web search question infrastructure (Semantic Scholar, arXiv, GitHub, Wayback Machine), Q-U12–Q-U15, Q-S2/Q-S3
- Phase 4: Taxonomy promotion, sub-sector annotation framework, portfolio-wide backfill
- Phase 5: PTAB data integration, IPR outcome calibration

---

## Recent Changes (April 17, 2026 — Session 5)

### 41. loadEnrichedPatents Database Fallback Fix
**File modified:** `src/api/services/prompt-template-service.ts`

**Problem:** Per-patent LLM assessments were generating prompts with empty patent content (no title, abstract, claims, assignee). Root cause was a 3-layer failure:
1. `loadEnrichedPatents()` was synchronous but needed to be `async` for DB fallback
2. The DB fallback itself crashed silently: `grantDate.toISOString()` failed because `grantDate` is a string in Prisma, not a Date object
3. The outer `catch {}` swallowed the error, so zero patents got enriched via DB

**Fix:**
- Made `loadEnrichedPatents()` async, updated all call sites to `await`
- Added DB fallback: queries Prisma for patent metadata + extracts claims from USPTO XML
- Fixed `grantDate.toISOString()` → `String(dbp.grantDate).split('T')[0]`
- Added `extractClaimsText` import from patent-xml-parser-service
- Updated `previewTemplate` to async in focus-areas.routes.ts

**Result:** All 44 BB-Google patents now have title, abstract, claims, assignee in LLM prompts. Assessment quality improved significantly (lit scores 8/10 vs previous 3/10).

### 42. Blackberry-Google Vendor Package Regeneration
Re-executed per-patent assessment (44 patents) and collective strategy with proper patent content. Exported full 9-file package to `output/vendor-exports/bb-google-2026-04-17/`.

### 43. Nutanix Expanded Analysis — 102 New Patents Discovered
Cross-referenced 87 existing Nutanix patents against 609 unique patents from 11 sector vendor packages. Found 548 patents not in original set, 102 of which explicitly mention Nutanix/HCI/AHV/Prism or target hyperconverged infrastructure.

### 44. Nutanix Expanded V3 Discovery Package (189 patents)
**Files created:**
- `scripts/_create-nutanix-expanded-package.ts` — Pool builder + V3 scoring + target CSV generation
- `scripts/_export-nutanix-expanded-package.ts` — Full package export with heatmap, CSVs, LLM assessments, litigation-package-all-fields-export
- `output/nutanix-expanded-pool.json` — 87 existing + 102 new patent IDs with metadata
- `output/nutanix-expanded-v3-ranking.csv` — V3 Litigation Discovery rankings for all 189
- `output/nutanix-targets-{product}.csv` — Per-product infringement target CSVs (5 files)

**V3 Scoring:** All 189 patents scored with Litigation Discovery preset (low citation weight). V3 snapshot: `cmo0og0u400018ct6s6322wuc` (31,026 patents).

**Infringement Scoring:** 510 patent-product pairs scored (102 new patents × 5 Nutanix products) via 5 parallel nohup processes with `--max-docs-per-product 8`.

**Results:**
- 39 very-high (>=0.80) — 20 NEW
- 71 high-signal (>=0.65) — 36 NEW
- 23 multi-product hits (>=3 at >=0.50) — 14 NEW
- Max score: 0.949 (US9083609 vs FNS)
- Strongest NEW patents: US11683214 (0.93 FVN, 4/5 products), US11496392 (0.91 FVN, 4/5 products), US11743168 (0.89 FVN)

**Export package:** `output/vendor-exports/nutanix-expanded-2026-04-17/`

| File | Description |
|------|-------------|
| `litigation-package-all-fields-export.csv` | Full data extract (189 patents, 265 columns, 109 metric keys) |
| `nutanix-infringement-heatmap.md` | Full heatmap with per-product breakdown, strategic tiers |
| `nutanix-patent-product-matrix.csv` | Patent × Product score matrix |
| `nutanix-all-scores.csv` | 774 scored pairs with narratives |
| `nutanix-comparative-ranking.csv` | Composite ranking with NEW/EXISTING flags |
| `nutanix-v3-ranking.csv` | V3 scores |
| `README.md` | Package manifest |

**Not yet generated (requires LLM execution):**
- `nutanix-collective-strategy.md` — Cross-patent assertion strategy
- `nutanix-assessment-results.csv` — Per-patent structured assessment
- `vendor-targets.csv` / `vendor-targets-pivot.csv` — Assertion target mapping

Focus Area: "Nutanix V3 Expanded Discovery" (ID: cmo35m8wj0000a75kt4ci98cp, 189 patents)

### Design Task: Consolidate Vendor Package Pipeline
**Status:** Noted for future implementation

Current state: multiple per-company/sector scripts (`_build-*`, `_generate-*`, `_create-*`, `_export-*`) with duplicated logic and inconsistent naming. Need to:
1. Abstract into a single data-driven service with config per company/product
2. Standardize output file set across all packages (all packages get same file types)
3. Make triggerable from GUI with configurable options (model, question set, patent selection)
4. Consolidate structured assessment questions into taxonomy-aware question bank
5. Clean up naming conventions (consistent slugs, file names, directory structure)

---

## CLAUDE.md Rules (permanent)
- **ALWAYS** include claims context in LLM scoring (`includeClaims: 'independent_only'`). Never use `includeClaims: 'none'` in production.
- Base score formula v4 must stay in sync across 3 files (see §28 above).
