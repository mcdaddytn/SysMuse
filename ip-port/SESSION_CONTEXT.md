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

---

## Key Architecture Notes

- **USPTO Index DB**: 5.58M patents, 1,096 files, 2005-2025, with forward citations computed. Located at `prisma/uspto/schema.prisma`.
- **`xml_source` field** on `IndexedPatent` maps to weekly ZIP filename (e.g., `ipg240102` → `ipg240102.zip`)
- **Affiliate matching** uses `matchAffiliate()` in `uspto-import-service.ts` — prefix-matches assignee against `AffiliatePattern` table, with word-boundary enforcement
- **Prisma batch size limit**: Keep `findMany` with relations under ~20K rows per batch to avoid napi serialization failures
- **Expression index**: `lower(assignee) text_pattern_ops` on `indexed_patents` for fast case-insensitive prefix matching; created in `scripts/create-uspto-db.ts` since Prisma cannot define expression indexes
