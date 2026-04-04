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

## Key Architecture Notes

- **USPTO Index DB**: 3.25M patents, 574 files, 2015-2025, with forward citations computed. Located at `prisma/uspto/schema.prisma`.
- **`xml_source` field** on `IndexedPatent` maps to weekly ZIP filename (e.g., `ipg240102` → `ipg240102.zip`)
- **Affiliate matching** uses `matchAffiliate()` in `uspto-import-service.ts` — prefix-matches assignee against `AffiliatePattern` table
- **Prisma batch size limit**: Keep `findMany` with relations under ~20K rows per batch to avoid napi serialization failures
