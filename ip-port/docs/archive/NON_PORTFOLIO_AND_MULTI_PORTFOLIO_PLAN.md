# Non-Portfolio Patent Access & Multi-Portfolio Groundwork

**Date**: 2026-02-04
**Status**: Planning

---

## Context

The system is currently **portfolio-centric**: all patents come from a single `streaming-candidates-*.json` file (28,913 Broadcom patents). Non-portfolio patents exist in the system as citation references (parents, citing patents) but are not directly accessible. The user is receiving small batches of new patents (5-50 at a time) and needs to:

1. View any patent in the system, not just portfolio patents
2. Use focus areas and prompt templates on non-portfolio patents
3. Eventually manage multiple portfolios

This document covers three levels of approach: no-change workarounds, minimal code changes, and multi-portfolio design groundwork.

---

## Level 0: What Works Today (No Code Changes)

### What You CAN Do

| Capability | How | Limitation |
|-----------|-----|------------|
| **View non-portfolio patent data in citations** | Navigate to a portfolio patent → Backward Citations tab → see parent patent title, assignee, date | Cannot click through to a full detail page |
| **See which non-portfolio patents have been downloaded** | Parent patents from family enrichment show title/assignee/date when data is cached | Only ~59K parent-details cached; citing-patent-details are sparse |
| **Create a focus area with arbitrary patent IDs** | POST to `/api/focus-areas` with manually added patent IDs | Focus area will contain the IDs but template execution will have minimal data for non-portfolio patents |
| **Search terms still evaluate in ES** | Focus area search terms run against the ES index (28,913 portfolio patents only) | Non-portfolio patents are NOT in the ES index |
| **Export portfolio data with filters** | Use CSV export from portfolio page with sector/affiliate/score filters | Only exports portfolio patents |

### What You CANNOT Do Today

| Capability | Blocker |
|-----------|---------|
| **Click a non-portfolio citation to see its detail page** | `/api/patents/:id` returns 404 for non-portfolio patents |
| **Browse/search non-portfolio patents** | Portfolio page and ES index only contain portfolio patents |
| **Run prompt templates on non-portfolio patents with data** | `loadEnrichedPatents()` only loads from candidates file; non-portfolio patents get stub records with only `patent_id` |
| **See non-portfolio patents in any grid/table view** | No page or API serves non-portfolio patent listings |
| **Add non-portfolio patents to ES for search** | No import mechanism for ad-hoc patents |

### Workaround for Small Batches (5-50 patents)

Today, the only way to work with non-portfolio patents is:

1. **Manual lookup**: Use the backward-citations view of a related portfolio patent to see basic info
2. **Google Patents**: Non-portfolio citations link to Google Patents for external viewing
3. **Direct cache inspection**: Patent data may exist in `cache/patent-families/parent-details/` as JSON files that can be read manually

**Verdict**: The current system provides very limited visibility into non-portfolio patents. Even basic viewing requires code changes.

---

## Level 1: Minimal Code Changes (Quick Wins)

These changes are small, low-risk, and would significantly improve non-portfolio patent usability.

### 1A. Make Patent Detail Page Work for Cached Non-Portfolio Patents

**Scope**: Backend route change + minor frontend fix
**Effort**: Small

**Current behavior**: `GET /api/patents/:id` → `loadPatents()` (candidates only) → 404 if not found

**Proposed change**: Add fallback logic to the patent detail endpoint:

```
GET /api/patents/:id
  1. Check portfolio (candidates file) — if found, return enriched data as today
  2. If not found, check cache/patent-families/parent-details/{id}.json
  3. If not found, check cache/api/patentsview/patent/{id}.json (abstract cache)
  4. If found in any cache, return with { ...data, in_portfolio: false }
  5. If not found anywhere, return 404
```

**Files to modify**:
- `src/api/routes/patents.routes.ts` — Add fallback logic to `/:id` handler
- `frontend/src/pages/PatentDetailPage.vue` — Show "Not in portfolio" badge instead of error; conditionally hide tabs that require portfolio data (scoring, etc.)

**Impact**: Citation links for downloaded patents become clickable. Users can view any patent that's been encountered through family exploration or citation analysis.

### 1B. Make Citation Links Clickable for Cached Patents

**Scope**: Frontend change
**Effort**: Small

**Current behavior**: Non-portfolio patents in forward/backward citations show as non-clickable text with `link_off` icon

**Proposed change**: Check whether the patent has cached data (the API could return this info) and make the link clickable if data exists, greyed out only if truly unknown.

**Approach**: The backward-citations endpoint already returns rich data for cached parents. Add a `has_cached_data: true` flag in the citation responses, and make the frontend render those as clickable links.

**Files to modify**:
- `src/api/routes/patents.routes.ts` — Add `has_cached_data` to citation responses
- `frontend/src/pages/PatentDetailPage.vue` — Make links clickable when `has_cached_data` is true

### 1C. "All Patents" Page (or Portfolio Page in "All" Mode)

**Scope**: New page or portfolio page extension
**Effort**: Medium

**Two options**:

**Option A: Add "All Patents" toggle to existing Portfolio Page**
- Add a toggle/dropdown at the top: "Portfolio Patents" / "All Known Patents"
- When "All Known Patents" is selected, load from a new API endpoint that includes cached non-portfolio patents
- Show an `in_portfolio` column
- Filters work the same but on the expanded set

**Option B: Create a separate "Patent Browser" page**
- New route `/patents` (vs. existing `/` for portfolio)
- Simpler grid focused on viewing/filtering
- No scoring columns (non-portfolio patents won't have scores)
- Columns: Patent ID, Title, Date, Assignee, Source (portfolio / citation / family), In Portfolio

**Recommendation**: Option A is more practical for now. The portfolio page infrastructure already handles filtering, pagination, column selection, and export. Adding a mode toggle is less work than building a new page.

**Data source**: Create a new API endpoint `GET /api/patents/all` that:
1. Loads portfolio patents (existing)
2. Scans `cache/patent-families/parent-details/` for additional patents
3. Merges, deduplicates, and returns with `in_portfolio` flag
4. Supports pagination and basic filtering

**Files to modify**:
- `src/api/routes/patents.routes.ts` — New `/all` endpoint
- `frontend/src/pages/PortfolioPage.vue` — Toggle for patent source
- `frontend/src/services/api.ts` — New API call

### 1D. Import Small Patent Batches into the System

**Scope**: Script + API endpoint
**Effort**: Medium

For incoming batches of 5-50 patents, provide a mechanism to:
1. Accept a list of patent IDs (or a small JSON/CSV file)
2. Fetch patent data from PatentsView API for each
3. Cache the data in `cache/patent-families/parent-details/` (or a new `cache/imported-patents/` directory)
4. Optionally add to Elasticsearch index
5. Optionally create a focus area containing these patents

**Implementation**:
- New script: `scripts/import-patent-batch.ts` — Takes a file of patent IDs, fetches data, caches it
- New API endpoint: `POST /api/patents/import` — Accepts patent IDs, returns status
- Focus area integration: After import, user can create a focus area via existing UI

**This is the key feature for the user's immediate workflow**: receive 5-50 patents, import them, create a focus area, run prompt templates, see results.

### 1E. Focus Area Results Viewer for Non-Portfolio Patents

**Scope**: Existing focus area + prompt template infrastructure
**Effort**: Small (after 1A and 1D)

Once patents are importable and viewable (1A, 1D), the existing focus area system handles the rest:
1. Create focus area → add imported patent IDs
2. Run prompt templates (structured or free-form) against the focus area
3. View results in the Focus Area Detail Page → LLM Results tab

**The missing piece** is that `loadEnrichedPatents()` in `prompt-template-service.ts` needs the same fallback logic as the patent detail endpoint (1A): if a patent isn't in the candidates file, try cache sources.

**Files to modify**:
- `src/api/services/prompt-template-service.ts` — `loadEnrichedPatents()` should fall back to cache/parent-details and cache/imported-patents

---

## Level 1 Implementation Priority

| Change | Priority | Dependencies | Effort |
|--------|----------|-------------|--------|
| **1D. Import small batches** | Highest | None | Medium |
| **1A. Patent detail for cached patents** | High | None | Small |
| **1E. Template execution for non-portfolio** | High | 1A, 1D | Small |
| **1B. Clickable citation links** | Medium | 1A | Small |
| **1C. All Patents page/mode** | Medium | 1A | Medium |

**Recommended order**: 1D → 1A → 1E → 1B → 1C

This order prioritizes the user's immediate workflow: import patents → view them → run LLM templates → see results. The "All Patents" browsing page is useful but less urgent.

---

## Level 2: Multi-Portfolio Groundwork

### Current Architecture Limitation

The system assumes a single portfolio defined by one `streaming-candidates-*.json` file. This is baked into:

| Component | Single-Portfolio Assumption |
|-----------|---------------------------|
| `loadPatents()` in patents.routes.ts | Reads the most recent candidates file |
| `loadEnrichedPatents()` in prompt-template-service.ts | Same candidates file |
| Elasticsearch index | One flat index of all portfolio patents |
| Scoring engine | Scores computed across the single portfolio |
| Sector assignments | CPC-based sectors assume single portfolio context |
| Portfolio page | Implicitly shows "the portfolio" |

### Design Direction: Portfolio as a First-Class Entity

To support multiple portfolios, introduce a `Portfolio` entity:

```
Portfolio
  - id: string
  - name: string (e.g., "Broadcom Core", "Acquired Batch 2026-02", "Competitor: Apple")
  - description: string
  - source: string ("candidates_file" | "imported" | "citation_discovery")
  - patentCount: number (cached)
  - createdAt: datetime
  - updatedAt: datetime
```

**Patent-to-Portfolio relationship**: Many-to-many (a patent can appear in multiple portfolios)

```
PortfolioPatent
  - portfolioId: string
  - patentId: string
  - addedAt: datetime
  - source: string ("initial_load" | "manual" | "batch_import" | "family_expansion")
```

### Migration Path

**Phase 1: Introduce Portfolio model without breaking existing flow**
1. Add `Portfolio` and `PortfolioPatent` models to Prisma schema
2. Create a "default" portfolio from the current candidates file
3. Existing pages continue to use the default portfolio
4. New "import batch" feature (1D) creates a new portfolio for each batch
5. Portfolio selector appears in header/nav but defaults to "Broadcom Core"

**Phase 2: Portfolio-aware API layer**
1. Add `?portfolioId=` query parameter to patent list, scoring, and search endpoints
2. If omitted, use default portfolio (backward compatible)
3. Focus areas gain an optional `portfolioId` field
4. ES index gains a `portfolio_ids` array field for multi-portfolio filtering

**Phase 3: Portfolio management UI**
1. Portfolio list page (name, patent count, date, source)
2. Portfolio detail page (patent list, stats, comparison)
3. Import wizard (upload patent IDs → fetch data → create portfolio)
4. Cross-portfolio operations (union, diff, compare)

### Key Design Decisions (Deferred)

These decisions don't need to be made now but should be considered:

| Decision | Options | Notes |
|----------|---------|-------|
| **Scoring across portfolios** | Per-portfolio scores vs. global scores | Scores are relative to a population; mixing portfolios changes the baseline |
| **Sector assignments** | Shared sectors vs. per-portfolio sectors | CPC-based sectors are universal; custom sectors might be portfolio-specific |
| **ES indexing** | One index with portfolio_ids vs. index-per-portfolio | Single index with filters is simpler; separate indices if portfolios are very different |
| **Focus area scope** | Can a focus area span portfolios? | Probably yes — focus areas are about technology clusters, not ownership |
| **Default portfolio** | Implicit vs. explicit selection | Start implicit (backward compatible), add explicit selector later |

### What to Build Now (Groundwork Only)

1. **Add `Portfolio` model to Prisma schema** — Just the model definition and migration. No API endpoints yet.
2. **Seed a "Broadcom Core" default portfolio** — Migration script that creates the default.
3. **Add `portfolioId` to patent import** — When 1D imports patents, tag them with a portfolio ID.
4. **Design the patent data abstraction** — Currently `loadPatents()` reads one file. Refactor to `loadPatents(portfolioId?)` that can load from DB or file.

This groundwork doesn't change any existing behavior but creates the schema foundation for multi-portfolio support.

---

## Summary: Recommended Implementation Plan

### Immediate (This Session / Next Session)

1. **Document tournament lessons** — DONE (added to DEVELOPMENT_QUEUE_V2.md)
2. **1D: Import small patent batches** — Script to fetch and cache patent data from a list of IDs
3. **1A: Patent detail fallback** — Make `/api/patents/:id` work for cached non-portfolio patents
4. **1E: Template execution fallback** — Make `loadEnrichedPatents()` work with cached data

### Near-Term (Next Few Sessions)

5. **1B: Clickable citation links** — Frontend improvement
6. **1C: All Patents page/mode** — Portfolio page toggle or separate page
7. **Portfolio schema groundwork** — Add Prisma models, seed default

### Future (Design Phase)

8. **Portfolio-aware API layer** — Query parameters, multi-portfolio filtering
9. **Portfolio management UI** — List, detail, import wizard
10. **Cross-portfolio operations** — Compare, union, diff

---

## User's Immediate Workflow (After Level 1 Changes)

```
1. Receive batch of 5-50 patent IDs
2. Run import: npx tsx scripts/import-patent-batch.ts batch-file.txt
   → Fetches patent data from PatentsView API
   → Caches in system
   → Optionally indexes in ES
3. Create focus area in UI → add imported patent IDs
4. Configure search scope (optional)
5. Select/create prompt template
6. Execute template against focus area patents
7. View results in Focus Area Detail → LLM Results tab
8. Export results if needed
```

This workflow requires changes 1D, 1A, and 1E — all achievable with moderate effort.

---

*Last Updated: 2026-02-04*
