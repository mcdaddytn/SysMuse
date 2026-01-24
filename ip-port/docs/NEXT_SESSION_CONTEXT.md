# Patent Portfolio Analysis - Session Context (2026-01-24)

## Current State Summary

### Portfolio Download Complete (CORRECTED)

| Metric | Value |
|--------|-------|
| **Unique Patents** | **28,913** |
| Active Patents | 24,668 (85.3%) |
| Expired Patents | 4,245 |
| Date Range | 1982-06-29 to 2025-09-30 |
| Cache Pages | 79 |
| Status | Complete + Deduplicated |

**Discrepancy Resolved:**
- Raw API returned: 39,413 patent rows
- Duplicates removed: 10,500 (API returns same patent for each matching assignee variant)
- **Unique patents: 28,913** (matches expected ~27K)
- Fix applied: `scripts/download-full-portfolio.ts` now deduplicates by patent_id

**Top Assignees (deduplicated):**
| Assignee (Normalized) | Count | Active | Expired |
|-----------------------|-------|--------|---------|
| Broadcom | 10,831 | 9,867 | 964 |
| VMware | 5,325 | 5,320 | 5 |
| LSI | 3,674 | 581 | 3,093 |
| Symantec | 2,973 | 2,902 | 71 |
| Avago | 2,844 | 2,844 | 0 |
| CA Technologies | 1,362 | 1,358 | 4 |
| Nicira (VMware) | 1,007 | 1,007 | 0 |

### Cache Status

| Data Type | Cached | Location |
|-----------|--------|----------|
| Portfolio (28.9K unique) | Complete | `cache/api/patentsview/portfolio-query/` |
| Forward citations | ~670 patents | `cache/api/patentsview/forward-citations/` |
| Citing patent details | ~670 patents | `cache/api/patentsview/citing-patent-details/` |
| Total API entries | ~1,340 | |

### Citation Analysis Progress

| Range | Status | Notes |
|-------|--------|-------|
| 0-670 | Complete (cached) | ~20 competitor cites found |
| 670-1670 | **Running** (task bb1cb6b) | Batch of 1000 |
| 1670+ | Pending | ~27,243 remaining |

### Revised Time Estimate
- Unique patents: 28,913
- Already cached: ~670
- Remaining: ~28,243
- At 3s/patent: **~23.5 hours** for full analysis

---

## System Architecture

| Component | Status | Description |
|-----------|--------|-------------|
| PostgreSQL | Running (port 5432) | Database for metadata |
| Elasticsearch | Running (port 9200) | Full-text search |
| File Cache | Complete | API responses on disk, metadata in DB |

### Cache Structure

```
cache/
├── api/
│   ├── patentsview/
│   │   ├── portfolio-query/
│   │   │   └── broadcom-portfolio/
│   │   │       ├── _manifest.json     # complete: true
│   │   │       └── page-0001..0079.json
│   │   ├── forward-citations/
│   │   └── citing-patent-details/
│   ├── file-wrapper/
│   └── ptab/
└── llm/
```

---

## Key Commands

```bash
# Portfolio (instant - fully cached, deduplicated)
npm run download:portfolio           # Loads 28.9K unique patents from cache

# Citation analysis (continues from cache)
npm run analyze:cached -- --start 670 --limit 1000   # Next batch
npm run analyze:cached:dry                           # Check cache status

# Cache management
npm run cache:stats                  # Show statistics
npm run cache:sync                   # Sync after copying cache folder

# Analysis
npx tsx scripts/analyze-portfolio-breakdown.ts      # Affiliate/expiration breakdown
npx tsx scripts/analyze-duplicates.ts               # Check for duplicates
```

---

## Files Updated This Session

| File | Change |
|------|--------|
| `scripts/download-full-portfolio.ts` | Added deduplication by patent_id |
| `scripts/analyze-portfolio-breakdown.ts` | New: affiliate/expiration analysis |
| `scripts/analyze-duplicates.ts` | New: duplicate detection |
| `clients/cached-clients.ts` | Added `getPortfolioPatents()` with page caching |
| `services/cache-service.ts` | Added `getCachePath()` export |

---

## Next Steps

### Immediate
1. **Continue citation analysis batches** of 1000 at a time
2. **Monitor for rate limiting** (429 errors - script uses 3s between calls)
3. Cache is interrupt-safe (each API response saved immediately)

### Overnight Run Strategy
- 28,243 patents remaining
- ~3 seconds per uncached patent
- ~23.5 hours for full analysis
- Run multiple sequential batches

### Machine Portability
```bash
# To use on new machine:
cp -r cache/ /new/machine/ip-port/cache/
npm run cache:sync
npm run download:portfolio   # Instant (from cache, deduplicated)
npm run analyze:cached       # Continues from cached citations
```

---

## Session History

| Date | Key Activity |
|------|--------------|
| 2026-01-24 | **Deduplication fix**: Removed 10,500 duplicates, true count is 28,913 |
| 2026-01-24 | **Portfolio complete**: 79 pages cached, dedup applied |
| 2026-01-24 | **Citation batches**: Running 1000 at a time |
| 2026-01-24 | **System redesign**: PostgreSQL + file-based caching |
| 2026-01-22 | Citation categorization analysis |
| 2026-01-22 | Heat map batch generation V2 |

---

*Last Updated: 2026-01-24 (Deduplication Fix + Citation Batch Running)*
