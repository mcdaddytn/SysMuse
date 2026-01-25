# Patent Portfolio Analysis - Session Context (2026-01-25)

## Current State Summary

### Portfolio Data

| Metric | Value |
|--------|-------|
| **Unique Patents** | **28,913** |
| Active Patents | 24,668 (85.3%) |
| Expired Patents | 4,245 |
| Date Range | 1982-06-29 to 2025-09-30 |
| Status | Complete + Deduplicated |

### Citation Cache Progress

| Batch | Range | Status |
|-------|-------|--------|
| Queue 1 | 1670-2670 | Complete |
| Queue 2 | 2670-3670 | Complete |
| Queue 3 | 3670-4670 | Complete |
| Queue 4 | 4670-5670 | Complete |
| Gap Fill | 813-1669 | **Complete** |

**Cache Status:**
- API entries: ~11,344
- Size: ~172 MB

**All citation batches complete through patent index 5670.**

---

## GUI Development Status

### Backend API Server

**Status:** Port 3001

```bash
npm run api:dev    # With auto-reload
```

**Endpoints Available:**
| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `GET /api/patents` | List patents with filters/pagination |
| `GET /api/patents/:id` | Patent detail |
| `GET /api/patents/:id/preview` | **NEW** Lightweight patent preview |
| `POST /api/patents/batch-preview` | **NEW** Batch preview for multiple patents |
| `GET /api/patents/:id/citations` | Citation data |
| `GET /api/patents/affiliates` | List affiliates with counts |
| `GET /api/patents/super-sectors` | List super-sectors with counts |
| `GET /api/scores/v2` | v2 scoring with custom weights |
| `GET /api/scores/weights/presets` | Weight presets |
| `GET/POST /api/focus-areas` | Focus area CRUD |
| `GET/PUT/DELETE /api/focus-areas/:id` | Focus area operations |
| `GET/POST/DELETE /api/focus-areas/:id/patents` | Patent membership |
| `POST/DELETE /api/focus-areas/:id/search-terms` | Search terms |
| `POST /api/focus-areas/extract-keywords` | **NEW** Keyword extraction |
| `POST /api/focus-areas/:id/extract-keywords` | **NEW** Extract from focus area |
| `GET/POST/PUT/DELETE /api/focus-groups/*` | Focus group CRUD |
| `POST /api/focus-groups/:id/formalize` | Convert to focus area |

### Frontend App

**Status:** Port 3000

```bash
cd frontend && npm run dev
```

**Pages Complete:**
| Page | Route | Description |
|------|-------|-------------|
| `PortfolioPage.vue` | `/` | Grid with filters, column selector |
| `PatentDetailPage.vue` | `/patent/:id` | Detail with Overview, Citations tabs |
| `V2ScoringPage.vue` | `/v2-scoring` | Weight sliders, presets, rank changes |
| `FocusAreasPage.vue` | `/focus-areas` | List/create/manage focus areas |
| `FocusAreaDetailPage.vue` | `/focus-areas/:id` | View/edit, patents, search terms, **keyword extraction** |

**Pages UI Only (need API wiring):**
| Page | Route |
|------|-------|
| `V3ScoringPage.vue` | `/v3-scoring` |
| `SectorRankingsPage.vue` | `/sectors` |
| `JobQueuePage.vue` | `/jobs` |
| `LoginPage.vue` | `/login` |

**Components:**
| Component | Description |
|-----------|-------------|
| `ColumnSelector.vue` | Grouped column visibility with search |
| `PatentPreviewTooltip.vue` | **NEW** Hover preview for patent IDs |
| `KeywordExtractionPanel.vue` | **NEW** Keyword extraction from patents |

---

## Database Schema

**PostgreSQL running on localhost:5432**

Tables via Prisma:
- `api_request_cache` - API response cache metadata
- `llm_response_cache` - LLM response cache metadata
- `users` - User accounts with access levels
- `focus_groups` - Exploratory patent groupings (drafts)
- `focus_areas` - Formalized focus areas
- `focus_area_patents` - Patent membership junction
- `search_terms` - Search expressions for focus areas
- `facet_definitions` - Atomic/derived facet definitions
- `facet_values` - Facet values per patent

---

## Files Created/Modified This Session

### New Backend Files
| File | Description |
|------|-------------|
| `src/api/services/keyword-extractor.ts` | **NEW** TF-IDF keyword extraction service |

### New Frontend Components
| File | Description |
|------|-------------|
| `frontend/src/components/PatentPreviewTooltip.vue` | **NEW** Hover tooltip for patent summaries |
| `frontend/src/components/KeywordExtractionPanel.vue` | **NEW** Keyword extraction UI for focus areas |

### Modified Files
| File | Changes |
|------|---------|
| `src/api/routes/patents.routes.ts` | Added batch-preview and preview endpoints |
| `src/api/routes/focus-areas.routes.ts` | Added keyword extraction endpoints |
| `frontend/src/services/api.ts` | Added PatentPreview types, batch preview, keyword extraction |
| `frontend/src/pages/FocusAreaDetailPage.vue` | Enhanced Add Patents dialog with previews, keyword panel |

---

## Quick Start for Next Session

```bash
# 1. Check cache status
npm run cache:stats

# 2. Start backend API
npm run api:dev

# 3. Start frontend (new terminal)
cd frontend && npm run dev

# 4. Open browser
open http://localhost:3000
open http://localhost:3000/focus-areas
```

---

## Development Queue

### Completed This Session
- [x] Gap fill citation batch (813-1669) - Complete
- [x] Patent preview API endpoint (single + batch)
- [x] PatentPreviewTooltip component with hover summaries
- [x] Enhanced Add Patents dialog with patent previews
- [x] Keyword extraction service (TF-IDF based)
- [x] Keyword extraction API endpoints
- [x] KeywordExtractionPanel component for focus areas

### Short-term (Next Up)
1. **"Create Focus Group from Selection"** - Button in Portfolio grid for selected patents
2. **Elasticsearch Integration** - Search term preview across scopes
3. **Export CSV** - From portfolio grid
4. **Queue next citation batch** - Indices 5670-6670

### Medium-term
1. Focus Area filter in portfolio grid
2. LLM suggestion endpoint for focus groups
3. Facet definition UI
4. v3 Consensus scoring (multi-user weights)

---

## Key Features Added

### Patent Preview Tooltips
- Hover over any patent ID to see summary
- Shows: title, assignee, sector, CPC codes, citations, remaining years
- Works in Add Patents dialog and Patents table
- Validates patents against portfolio before adding

### Keyword Extraction
- TF-IDF based keyword extraction from patent titles
- Optional: include abstracts from cache
- Contrast scoring vs portfolio (how distinctive is term)
- Includes bigram extraction
- Direct "Add as Search Term" action

---

## Key Design Decisions

### Focus Areas
- **Focus Group** = exploratory draft, **Focus Area** = stable/formalized
- Search terms use Elasticsearch (already integrated)
- Single owner initially, multi-user voting later
- Facets can be atomic (LLM) or derived (calculated)
- Scope hierarchy: Patent -> Focus Area -> Sector -> Portfolio

### Scoring
- **v2** = weighted formula (citation, years, competitor)
- **v3** = personal weights per user + consensus aggregation
- Facets from any source can drive scoring

---

## Design Documents

| Document | Purpose |
|----------|---------|
| `docs/FOCUS_AREA_SYSTEM_DESIGN.md` | Focus Group/Area lifecycle, search terms, facets |
| `docs/FACET_SYSTEM_DESIGN.md` | Facet terminology, scoring concepts |
| `docs/GUI_DESIGN.md` | Overall GUI architecture |
| `docs/DATABASE_SCHEMA_DESIGN.md` | Full schema design |

---

## Reference Projects

| Project | Path | Key Patterns |
|---------|------|--------------|
| judicial-transcripts | `/Users/gmac/Documents/GitHub/avflegal/judicial-transcripts` | QVirtualScroll, faceted filters, LLM |
| matter-tracker | `/Users/gmac/Documents/GitHub/avflegal/matter-tracker` | Auth, RBAC, per-user settings |

---

*Last Updated: 2026-01-25 (Patent Previews + Keyword Extraction)*
