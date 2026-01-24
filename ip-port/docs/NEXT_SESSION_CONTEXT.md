# Patent Portfolio Analysis - Session Context (2026-01-24)

## Current State Summary

### System Architecture Redesign (NEW)

Redesigned the system to use a relational database with file-based caching:

| Component | Status | Description |
|-----------|--------|-------------|
| PostgreSQL | Running (port 5432) | Database for metadata and relationships |
| Elasticsearch | Running (port 9200) | Full-text search for patent content |
| Prisma Schema | Minimal (cache only) | Will expand incrementally |
| File Cache | Implemented | API responses stored on disk, metadata in DB |

### Cache System Design

**File-based storage for portability:**
```
cache/
├── api/
│   ├── patentsview/
│   │   ├── patent/           # Basic patent info
│   │   ├── forward-citations/ # Who cites this patent
│   │   └── citing-patent-details/ # Combined citation + assignee data
│   ├── file-wrapper/
│   │   └── application/
│   └── ptab/
│       └── ipr-by-patent/
└── llm/
    ├── patent-analysis/
    └── sector-classification/
```

**Database stores metadata only:**
- Request identification (endpoint, type, key)
- File path reference
- Status codes, timestamps
- Token counts for LLM responses

**Export/Import workflow:**
1. Copy `cache/` folder to new machine
2. Run `npm run cache:sync` to populate DB metadata
3. Continue analysis with cached data

### Current Cache Statistics
| Metric | Value |
|--------|-------|
| API Cache Entries | ~200+ (growing) |
| Cache Size | ~0.02 MB |
| Patents Analyzed | 100 complete, 500 in progress |

---

## Recent Accomplishments (2026-01-24)

### Database & Infrastructure Setup

1. **Docker Compose configured:**
   - PostgreSQL 16 on port 5432
   - Elasticsearch 8.11 on port 9200
   - Volumes for data persistence

2. **Prisma schema (cache-focused):**
   - `ApiRequestCache` - API response metadata
   - `LlmResponseCache` - LLM response metadata
   - Both reference files on disk (no long text in DB)

3. **Environment configured:**
   - `.env` with PatentsView, USPTO ODP, Anthropic keys
   - Database URL pointing to Docker postgres

### Cache Service Implementation

Created `services/cache-service.ts` with:
- `setApiCache()` / `getApiCache()` / `isApiCached()`
- `setLlmCache()` / `getLlmCache()` / `isLlmCached()`
- `syncApiCacheFromFiles()` - Import after copying cache folder
- `syncLlmCacheFromFiles()` - Same for LLM cache
- `getCacheStats()` - Show statistics

### Cached API Clients

Created `clients/cached-clients.ts` wrapping:

| Client | Cached Methods |
|--------|---------------|
| `CachedPatentsViewClient` | `getPatent()`, `getPatentCitations()`, `getForwardCitations()`, `getCitingPatentDetails()` |
| `CachedFileWrapperClient` | `getApplication()`, `getApplicationByPatentNumber()`, `getDocuments()`, `getOfficeActions()` |
| `CachedPTABClient` | `getTrial()`, `searchIPRsByPatent()`, `getTrialDocuments()` |

**Key addition for overnight runs:**
- `getForwardCitations(patentId)` - Returns citing patent IDs
- `getCitingPatentDetails(patentId)` - Combined: forward citations + assignee details

### Portfolio Download Script

Created `scripts/download-full-portfolio.ts`:
- Downloads all Broadcom portfolio patents (27K+)
- Sorts by grant date (newest first)
- Creates candidates file for citation analysis
- Resume support with progress checkpoints

### Citation Analysis Script (Cached)

Created `scripts/citation-overlap-cached.ts`:
- Uses cached clients to avoid redundant API calls
- Rate limiting (3s between uncached patents)
- Progress tracking with ETA
- Resume capability via `--start` parameter

---

## In Progress

### Citation Analysis Batch Running

Currently processing patents 100-600:
- 500 patents at ~3s each = ~25 minutes
- Will cache forward citations for future runs

### Portfolio Status

| Metric | Value |
|--------|-------|
| Downloaded | 1,000 patents (newest first) |
| Citation Analysis Complete | 100 patents |
| Citation Analysis In Progress | 500 patents |
| Remaining to Download | ~26,000 patents |

---

## New NPM Scripts

```bash
# Cache management
npm run cache:stats           # Show cache statistics
npm run cache:sync            # Sync files to DB after copying cache folder
npm run cache:test            # Test cached clients

# Portfolio download
npm run download:portfolio         # Download full portfolio
npm run download:portfolio:test    # Download 100 patents (test)

# Citation analysis (cached)
npm run analyze:cached             # Run citation analysis with caching
npm run analyze:cached:dry         # Check cache status only
```

---

## Key Files Created

### New Services
| File | Description |
|------|-------------|
| `services/cache-service.ts` | File cache with DB metadata |
| `clients/cached-clients.ts` | Cached API client wrappers |

### New Scripts
| File | Description |
|------|-------------|
| `scripts/download-full-portfolio.ts` | Download all portfolio patents |
| `scripts/citation-overlap-cached.ts` | Citation analysis with caching |
| `scripts/test-cache.ts` | Test cache functionality |
| `scripts/test-forward-citations.ts` | Test forward citations caching |
| `scripts/test-cached-clients.ts` | Test cached client wrappers |

### Schema
| File | Description |
|------|-------------|
| `prisma/schema.prisma` | Minimal cache schema (ApiRequestCache, LlmResponseCache) |

### Configuration
| File | Description |
|------|-------------|
| `.env` | API keys, database URL |
| `docker-compose.yml` | PostgreSQL + Elasticsearch + Kibana |

---

## Next Steps

### Immediate
1. **Complete current batch** (500 patents in progress)
2. **Download remaining portfolio** (~26K patents)
3. **Run overnight citation analysis** on full portfolio

### Short-term
1. **Add LLM response caching** - Same pattern as API cache
2. **Expand Prisma schema** - Add patent tables as needed
3. **Import existing JSON data** - Migrate to database

### Database Schema Evolution Plan

| Phase | Schema | Purpose |
|-------|--------|---------|
| 1 (Current) | `ip-port-cache` | API/LLM response caching |
| 2 | `ip-port` | Main patent data (basic info, relationships) |
| 3 | `ip-port-llm` | LLM workflow state (multi-stage prompts) |
| 4 | `ip-port-facet` | Dynamic attributes, scoring, metrics |

---

## Commands Quick Reference

```bash
# Start infrastructure
npm run docker:up              # Start postgres + elasticsearch

# Database
npm run db:push                # Push schema to database
npm run db:studio              # Open Prisma Studio

# Cache operations
npm run cache:stats            # Show cache statistics
npm run cache:sync             # Sync files after copying cache folder

# Download portfolio (newest first)
npm run download:portfolio:test    # 100 patents
npm run download:portfolio         # Full portfolio

# Citation analysis
npm run analyze:cached -- --limit 100     # First 100
npm run analyze:cached -- --start 100 --limit 500  # Next 500
npm run analyze:cached:dry                # Check cache status only
```

---

## Session History

| Date | Key Activity |
|------|--------------|
| 2026-01-24 | **System redesign**: PostgreSQL + file-based caching |
| 2026-01-24 | Created cache service, cached API clients |
| 2026-01-24 | Added forward citations caching for overnight runs |
| 2026-01-24 | Started portfolio download and citation analysis |
| 2026-01-22 | Citation categorization analysis: VMware 10x self-citation rate |
| 2026-01-22 | Heat map batch generation V2 |
| 2026-01-21 | VMware patent integration fix |
| 2026-01-20 | Full portfolio merge (22,589 patents) |

---

## Design Decisions

### Why File-Based Cache?

1. **Portability** - Copy folder between dev machines
2. **Database stays small** - Only metadata, no long text
3. **Easy inspection** - JSON files readable
4. **Export/import** - Simple file copy + sync command
5. **Production flexibility** - Can use cold/warm/hot storage

### Why Separate Schemas?

1. **Independent evolution** - Cache schema stable, patent schema evolving
2. **Different lifecycle** - Cache can be rebuilt, patent data persists
3. **Clear boundaries** - Each schema has single responsibility

---

*Last Updated: 2026-01-24 (Database Redesign + Cache Implementation)*
