# Development Queue

Consolidated and prioritized development roadmap for the Patent Portfolio Workstation.

**Top Priority**: Recreate the Excel spreadsheet output in the GUI — all metrics, scoring, and sector views that attorneys currently rely on. Establish a baseline that matches previous results before improving with new functionality.

---

## P-0: Spreadsheet Baseline Recreation (FIRST PRIORITY)

The existing system produces CSV/Excel output with ~28 columns of patent data, V2/V3 scoring across multiple user profiles, and within-sector rankings. This data lives in JSON output files but is not yet queryable through the API or visible in the GUI. The goal is to surface all of this in the web application.

### Analysis: Data Gaps for Spreadsheet Parity

**What we have:**
| Data | Coverage | Source |
|------|----------|--------|
| Patent records (title, abstract, date, assignee) | 28,913 (100%) | `cache/api/patentsview/patent/` |
| Forward citation counts | 28,913 (100%) | Patent cache files (from API) |
| Forward citation files (citing patents) | 28,014 (97%) | `cache/api/patentsview/forward-citations/` |
| Citing patent details | 28,013 (97%) | `cache/api/patentsview/citing-patent-details/` |
| Competitor list | 131 companies | `config/competitors.json` |
| Sector assignments (CPC-based) | All patents | `config/sector-breakout-v2.json` |
| Sector damages ratings | 25 sectors | `config/sector-damages.json` |
| User weight profiles | 6 profiles | `config/user-weight-profiles.json` |
| ES index with abstracts | 28,913 | Elasticsearch |

**What we need to build/compute:**
| Data | Gap | Action Needed |
|------|-----|---------------|
| Competitor citation counts per patent | Not in ES or DB | Compute from citation cache + competitor config |
| Affiliate citation counts per patent | Not tracked | Classify portfolio entities as affiliates |
| Neutral citation counts per patent | Not tracked | = total - competitor - affiliate |
| Competitor list (names per patent) | In JSON output only | Compute from citation cache |
| V3 scores per weight profile | In JSON output only | Implement scoring engine in API |
| Within-sector rankings | In CSV output only | Compute from scores + sector assignments |
| LLM analysis scores | ~500 patents (5%) | Sparse — use where available, show empty where not |
| IPR/prosecution scores | ~500 patents (5%) | Sparse — use where available |

### P-0a. Citation Classification Pipeline ✓ COMPLETE
**Priority**: CRITICAL (blocks scoring accuracy)
**Description**: Analyze cached citation data to produce per-patent citation breakdowns: competitor, affiliate, neutral.

**Deliverables**:
- [x] Define affiliate list — uses `excludePatterns` from `config/competitors.json` (covers Broadcom, VMware, LSI, Avago, Symantec, Brocade, CA Tech, etc.)
- [x] Script: `scripts/classify-citations.ts` — three-way classification from citing-patent-details cache
  - `competitor_citations` (count), `competitor_names` (list), `competitor_count` (distinct)
  - `affiliate_citations` (count)
  - `neutral_citations` (count)
  - `total_forward_citations`
- [x] Results stored as per-patent JSON files in `cache/citation-classification/` + summary in `output/citation-classification-2026-01-26.json`
- [x] **100% validation match** against existing citation-overlap output (26,957 patents compared, 0 mismatches)

**Results**: 28,913 patents processed (900 without citation data), 313,256 total citations:
- Competitor: 120,432 (38.4%)
- Affiliate: 35,090 (11.2%)
- Neutral: 157,734 (50.4%)

### P-0b. Scoring Engine in API ✓ COMPLETE
**Priority**: CRITICAL (core spreadsheet functionality)
**Description**: Implement V3 scoring as an API-side computation so the GUI can display scored patents.

**Deliverables**:
- [x] Backend scoring service: `src/api/services/scoring-service.ts`
- [x] 6 profiles: executive (default), aggressive, moderate, conservative, licensing, quick_wins
- [x] Normalization functions: `cc/20`, `sqrt(fc)/30`, `years/15`, `count/5`, LLM `(score-1)/4`
- [x] Year multiplier: `0.3 + 0.7 × (yearsFactor^0.8)`
- [x] Missing LLM metric weights redistributed proportionally among available metrics
- [x] API endpoints:
  - `GET /api/scores/v3?profile=&page=&limit=&sector=&minScore=` — scored rankings
  - `GET /api/scores/profiles` — list 6 profiles with weights
  - `GET /api/scores/sectors?profile=&topN=` — sector rankings with damages tiers
  - `POST /api/scores/reload` — clear caches
- [x] Default profile: "Executive" (balanced scoring)
- [x] Patent list enriched with citation classification data (competitor, affiliate, neutral)

**Test results**: Executive profile avg=16.84, max=85.37, 388 patents ≥50. Profile differentiation verified.

**Remaining (deferred)**:
- [ ] DB: Add `weightProfileId` field to User model
- [ ] Default new users to "Executive" profile
- [ ] Admin can assign profiles to users

### P-0c. Portfolio Grid: All Spreadsheet Columns — IN PROGRESS
**Priority**: CRITICAL (the actual GUI view)
**Description**: Expand the portfolio grid to show all columns from the Excel spreadsheets.

**Deliverables**:
- [x] API: Enrich patent response with all metrics (citations breakdown, sector, scores) — done in P-0b
- [ ] Frontend: Add columns to portfolio grid:
  - Patent ID, title, grant date, assignee, affiliate (normalized)
  - Years remaining
  - Forward citations (total), competitor citations, affiliate citations, neutral citations
  - Competitor count, competitors citing (list)
  - Sector, super-sector, CPC codes
  - V3 score (for active user's weight profile)
  - LLM scores where available (eligibility, validity, claim breadth, enforcement clarity, design around difficulty)
  - IPR risk, prosecution quality where available
  - Data availability flags (has LLM, has IPR, has prosecution)
- [ ] Sort by any column
- [ ] Filter by sector, super-sector, assignee/affiliate, score range, date range
- [ ] Column visibility toggle (users can show/hide columns)
- [ ] Within-sector rank column (rank relative to sector peers)

### P-0d. Sector Ranking View
**Priority**: HIGH (spreadsheet feature — Top 15 per sector)
**Description**: Recreate the within-sector ranking report.

**Deliverables**:
- [ ] Backend: Sector summary endpoint:
  - Patent count per sector
  - Average V3 score per sector
  - Top N patents per sector (sorted by score)
  - Sector damages tier
  - Super-sector grouping
- [ ] Frontend: Sector ranking page/tab:
  - Table: Sector name, patent count, avg score, damages tier, top patent titles
  - Sorted by damages tier then patent count (or configurable)
  - Drill-down: click sector → portfolio grid filtered to that sector
- [ ] Within-sector patent view: Top 15 patents per sector with scores, citations, competitors

### P-0e. CSV Export
**Priority**: MEDIUM (needed for attorney workflow, but after grid is working)
**Description**: Export current grid view to CSV matching the Excel format.

**Deliverables**:
- [ ] Export button on portfolio grid
- [ ] Export respects current filters and sort
- [ ] Column format matches existing CSV exports (`export-top250-for-excel.ts`, `export-within-sector-for-excel.ts`)
- [ ] Sector export: within-sector rankings as CSV

---

## P-1: Focus Area & Search Scope (Second Priority — Parallel Track)

These features are important but involve more exploratory development. Work on them after P-0 is functional.

### P-1a. Search Scope for Focus Areas [was N-1]
Auto-select and manage search scope when creating/editing focus areas and search terms.
**Design doc**: `FOCUS_AREA_SYSTEM_DESIGN.md` (Search Scope section)

### P-1b. Focus Area Search Term Testing Fix [was N-2]
Fix hit count calculation, wire scope selector, title/abstract/both toggle.
**Design doc**: `FOCUS_AREA_SYSTEM_DESIGN.md`

### P-1c. Word Count Extraction Grid [was N-4]
Interactive word×patent matrix for search term discovery (max ~20 patents).
**Design doc**: `FOCUS_AREA_SYSTEM_DESIGN.md` (Word Count Grid)

---

## P-2: Patent Families & Citation Enrichment (Third Priority)

### P-2a. Patent Family Builder [was M-1]
Build generational citation trees, on-demand patent loading.
**Design doc**: `PATENT_FAMILIES_DESIGN.md`

### P-2b. Citation Counting Dimensions [was M-2]
Competitor/affiliate/neutral breakdown in patent detail view. (Basic version needed in P-0a; this adds the full UI and multi-generational counts.)
**Design doc**: `PATENT_FAMILIES_DESIGN.md`

---

## P-3: LLM & Advanced Features (Fourth Priority)

### P-3a. Focus Area Auto-Naming [was M-3]
LLM-powered name and description suggestion.

### P-3b. LLM Search Term Generation [was M-4]
LLM-suggested search terms for focus area patent groups.

### P-3c. Sector Expansion Refactoring [was M-5]
Move sector definitions from code/config to database.

### P-3d. CPC Code Description Tooltips [was I-3]
Download complete CPC classification, add tooltips.

---

## Longer-Term (Unchanged)

- L-1. LLM Atomic Facet Jobs
- L-2. LLM Comparative Group Jobs
- L-3. Incremental ES Indexing
- L-4. Search Term Selectivity Tracking
- L-5. Word Count Caching per Scope
- L-6. Interactive Patent Family Visualization
- L-7. Multi-User Consensus Scoring (admin can adjust weights per user)
- L-8. Focus Area Set Operations
- L-9. Vendor Data Integration
- L-10. Export & Reporting

---

## Dependency Graph (Updated)

```
P-0a (Citation Classification) ──┬──── P-0b (Scoring Engine)
                                  │
                                  └──── P-0c (Portfolio Grid)
                                            │
P-0b (Scoring Engine) ───────────────── P-0c (Portfolio Grid)
                                            │
                                        P-0d (Sector Ranking)
                                            │
                                        P-0e (CSV Export)

P-1a (Search Scope) ─── P-1b (Search Term Testing) ─── P-1c (Word Count Grid)

P-0a (Citations) ─── P-2a (Patent Families)
P-0a (Citations) ─── P-2b (Citation Dimensions UI)

P-0b (Scoring) ─── L-7 (Multi-User Consensus)
```

---

## Implementation Order

1. ~~**P-0a**: Citation classification pipeline~~ ✓ COMPLETE (Session 5)
2. ~~**P-0b**: Scoring engine with weight profiles~~ ✓ COMPLETE (Session 5)
3. **P-0c**: Portfolio grid expansion — all spreadsheet columns — IN PROGRESS
4. **P-0d**: Sector ranking view
5. **P-0e**: CSV export

After P-0 baseline is established:
6. **P-1a-c**: Search scope and focus area improvements
7. **P-2a-b**: Patent families and citation enrichment

---

## Design Documents Index

| Document | Covers |
|----------|--------|
| `SCORING_METHODOLOGY_V3_DESIGN.md` | V3 scoring formula, weight profiles, normalization |
| `ATTORNEY_SPREADSHEET_GUIDE.md` | Spreadsheet columns, user guide, scoring interpretation |
| `EXCEL_WORKBOOK_GUIDE.md` | VBA setup, weight configuration, Excel formulas |
| `FOCUS_AREA_SYSTEM_DESIGN.md` | Focus areas, search scope, word count grid, LLM jobs, sectors |
| `PATENT_FAMILIES_DESIGN.md` | Patent families, citation counting, assignee classification |
| `FACET_SYSTEM_DESIGN.md` | Facet types, scoring as facets |
| `GUI_DESIGN.md` | GUI architecture, portfolio grid, scoring views |
| `CITATION_CATEGORIZATION_PROBLEM.md` | VMware self-citation inflation analysis |
| `DESIGN_DECISIONS.md` | V2→V3 migration, scoring philosophy |

---

*Updated: 2026-01-25 (Session 5 — P-0a and P-0b complete, P-0c in progress)*
