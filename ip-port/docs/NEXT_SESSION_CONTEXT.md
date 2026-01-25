# Patent Portfolio Analysis - Session Context (2026-01-25)

## Current State Summary

### Portfolio Data

| Metric | Value |
|--------|-------|
| **Unique Patents** | **28,913** |
| Active Patents | 24,668 (85.3%) |
| Expired Patents | 4,245 |
| Date Range | 1982-06-29 to 2025-09-30 |
| Cache Pages | 79 |
| Status | Complete + Deduplicated |

### Citation Batch Progress (Running in Background)

| Batch | Range | Status |
|-------|-------|--------|
| Queue 1 | 1670-2670 | ✅ Complete |
| Queue 2 | 2670-3670 | ✅ Complete |
| Queue 3 | 3670-4670 | ✅ Running |
| Queue 4 | 4670-5670 | Queued |
| Gap Fill | 813-1669 | Queued (after main) |

**Cache Status:**
- API entries: ~5,000+
- Competitor citations found: 500+

**Batch logs:** `logs/batch-queue.log`, `logs/gap-fill.log`
**Queue scripts running:** `scripts/queue-citation-batches.sh`, `scripts/run-citation-batches.sh`

---

## GUI Development - READY FOR TESTING

### Backend API Server

**Status:** ✅ WORKING (port 3001)

```bash
# Start API server
npm run api:dev    # With auto-reload
npm run api:start  # Production
```

**Endpoints Available:**
| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `GET /api/patents?page=1&limit=50&sortBy=score&descending=true` | List patents |
| `GET /api/patents?affiliates=VMware&superSectors=Security` | Filter by affiliate/sector |
| `GET /api/patents/stats` | Portfolio stats (with bySuperSector, topAffiliates) |
| `GET /api/patents/affiliates` | List affiliates with counts |
| `GET /api/patents/super-sectors` | List super-sectors with counts |
| `GET /api/patents/assignees` | Unique assignees (raw) |
| `GET /api/patents/:id` | Patent detail |
| `GET /api/patents/:id/citations` | Citation data (from cache) |
| `GET /api/scores/v2?citation=50&years=30&competitor=20` | v2 scoring |
| `GET /api/scores/weights/presets` | Weight presets |
| `POST /api/auth/login` | Login (demo users below) |
| `GET /api/auth/me` | Current user |

**Demo Users:**
| Email | Password | Access Level |
|-------|----------|--------------|
| admin@example.com | admin123 | ADMIN |
| manager@example.com | manager123 | MANAGER |
| analyst@example.com | analyst123 | ANALYST |
| demo@example.com | demo123 | VIEWER |

### Frontend App

**Status:** ✅ WORKING

```bash
# Install and start frontend
cd frontend
npm install
npm run dev    # Starts on http://localhost:3000
```

**Pages Working:**
- `PortfolioPage.vue` - Main grid with Affiliate/Super-Sector dropdowns, click-to-filter, column selector
- `PatentDetailPage.vue` - Detail view with Overview (Basic Info, Classification, Metrics), Citations tab

**Pages Created (need API connection):**
- `V2ScoringPage.vue` - Weight sliders with real-time scoring
- `V3ScoringPage.vue` - Consensus voting (tabs for personal/consensus/all users)
- `SectorRankingsPage.vue` - Sector-based rankings
- `JobQueuePage.vue` - Job management
- `LoginPage.vue` - Authentication

**Tech Stack:**
- Vue 3 + Composition API
- Quasar 2.x (Material Design)
- Pinia (state management)
- Vite (build tool)
- TypeScript

---

## Files Created This Session

### Backend API
| File | Description |
|------|-------------|
| `src/api/server.ts` | Express server with session auth |
| `src/api/routes/patents.routes.ts` | Patent CRUD with filtering/pagination |
| `src/api/routes/scores.routes.ts` | v2/v3 scoring with custom weights |
| `src/api/routes/auth.routes.ts` | Session auth with demo users |

### Frontend
| File | Description |
|------|-------------|
| `frontend/package.json` | Dependencies |
| `frontend/vite.config.ts` | Vite + Quasar config |
| `frontend/src/main.ts` | App entry |
| `frontend/src/App.vue` | Root component |
| `frontend/src/router/index.ts` | Routes |
| `frontend/src/layouts/MainLayout.vue` | Nav layout |
| `frontend/src/types/index.ts` | TypeScript types |
| `frontend/src/services/api.ts` | Axios client |
| `frontend/src/stores/patents.ts` | Pinia store |
| `frontend/src/pages/*.vue` | All page components |

### Scripts & Analysis
| File | Description |
|------|-------------|
| `scripts/analyze-portfolio-breakdown.ts` | Affiliate/expiration analysis |
| `scripts/analyze-duplicates.ts` | Duplicate detection |
| `scripts/run-citation-batches.sh` | Sequential batch runner |
| `scripts/queue-citation-batches.sh` | Batch queue with wait |
| `scripts/fill-gap-batch.sh` | Gap fill batch |

### Documentation
| File | Description |
|------|-------------|
| `docs/GUI_DESIGN.md` | Comprehensive GUI design document (updated) |
| `docs/FACET_SYSTEM_DESIGN.md` | Facet system, Focus Areas, terminology |

---

## Quick Start for Next Session

```bash
# 1. Check batch progress
grep "Progress:" logs/batch-queue.log | tail -1
npm run cache:stats

# 2. Start backend API
npm run api:dev

# 3. Start frontend (new terminal)
cd frontend && npm run dev

# 4. Open browser
open http://localhost:3000
```

---

## Design Updates This Session

### New Design Document: `docs/FACET_SYSTEM_DESIGN.md`

Defines the facet-based categorization and scoring system:

**Key Terminology:**
| Term | Definition |
|------|------------|
| **Affiliate** | Normalized entity name (show by default instead of Assignee) |
| **Super-Sector** | Top-level domain (mutually exclusive) |
| **Primary Sector** | Actionable breakout (mutually exclusive within super-sector) |
| **Focus Area** | User-definable interest (non-exclusive, multi-assign) |
| **Facet** | Any computable/assignable attribute on a patent |

**Key Insight:** Scoring is really just facet calculation - facet values from API, LLM, or user input feed into further calculations.

### Updated: `docs/GUI_DESIGN.md`

**Column Changes:**
- Affiliate visible by default (replaces Assignee)
- Super-Sector visible by default
- Assignee (raw) hidden by default
- Attorney Question columns (5) - hidden by default
- LLM Analysis columns - hidden by default
- Focus Area-specific columns appear when Focus Area selected

---

## Next Development Steps

### Completed (2026-01-25)
1. ✅ **API Changes** - Added affiliate, super_sector, primary_sector, cpc_codes to patents
2. ✅ **Sector Enrichment** - download-full-portfolio.ts now extracts CPC and computes sectors
3. ✅ **Frontend Updates** - PortfolioPage shows Affiliate and Super-Sector by default
4. ✅ **Filtering** - Click on Affiliate or Super-Sector to filter
5. ✅ **Filter Dropdowns** - Multi-select dropdowns for Affiliate and Super-Sector with counts
6. ✅ **Patent Detail Page** - Connected to API with Overview, Classifications, Metrics cards

### Short-term
1. Implement column selector with grouped facets
2. Add Focus Area filter (multi-select, non-exclusive)
3. Export CSV functionality
4. v2 Scoring page - connect weight sliders to API

### Medium-term
1. Focus Area management UI (create/edit/delete)
2. Focus Area-specific LLM questions
3. Search term extraction → Focus Area creation
4. v3 scoring with LLM facets

---

## Reference Projects

| Project | Path | Key Patterns |
|---------|------|--------------|
| judicial-transcripts | `/Users/gmac/Documents/GitHub/avflegal/judicial-transcripts` | QVirtualScroll, faceted filters, LLM |
| matter-tracker | `/Users/gmac/Documents/GitHub/avflegal/matter-tracker` | Auth, RBAC, per-user settings |

---

*Last Updated: 2026-01-25 (Portfolio Grid + Patent Detail Page Working)*
