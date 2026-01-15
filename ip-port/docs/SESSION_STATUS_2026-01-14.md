# Session Status - January 14, 2026

## Summary

This document captures the current state of the IP Portfolio project after the initial setup session, including what's working, known issues, and open questions for future sessions.

---

## API Status

### PatentsView API - FULLY WORKING

| Test | Status |
|------|--------|
| Patent lookup by ID | ✓ |
| Date range search | ✓ |
| Assignee search | ✓ |
| Full text search (title) | ✓ |
| Citation counts | ✓ |
| Advanced queries | ✓ |
| Pagination | ✓ |

**Configuration:**
- Base URL: `https://search.patentsview.org/api/v1/`
- Auth Header: `X-Api-Key` (mixed case)
- Rate Limit: 45 requests/minute
- Env Variable: `PATENTSVIEW_API_KEY`

**Fixes Applied:**
- Added `Accept: application/json` header (required for POST)
- Changed `patent_number` field to `patent_id` (API field name change)
- Fixed nested field queries (e.g., `assignees.assignee_organization`)
- Updated citation method to use count fields instead of deprecated nested citations

### USPTO File Wrapper API - FULLY WORKING

| Test | Status |
|------|--------|
| Application search | ✓ |
| Date filtering | ✓ |
| Get specific application | ✓ |
| Event history | ✓ |

**Configuration:**
- Base URL: `https://api.uspto.gov/api/v1/patent`
- Auth Header: `x-api-key` (lowercase)
- Rate Limit: 60 requests/minute
- Env Variable: `USPTO_ODP_API_KEY`

**Response Structure:**
```json
{
  "count": 12657510,
  "patentFileWrapperDataBag": [
    {
      "applicationNumberText": "...",
      "applicationMetaData": {
        "filingDate": "...",
        "inventionTitle": "...",
        "applicationStatusDescriptionText": "..."
      },
      "eventDataBag": [...],
      "assignmentBag": [...]
    }
  ]
}
```

### USPTO PTAB API - FULLY WORKING (v3)

| Test | Status |
|------|--------|
| Trial search | ✓ |
| IPR search by date range | ✓ |
| Search by petitioner | ✓ |
| Search by patent owner | ✓ |
| Get trial details | ✓ |
| Get trial documents | ✓ |
| Search decisions | ✓ |
| Pagination | ✓ |

**Configuration (v3 - Updated Jan 2026):**
- Base URL: `https://api.uspto.gov/api/v1/patent`
- Auth Header: `x-api-key` (lowercase)
- Rate Limit: 60 requests/minute (estimated)
- Env Variable: `USPTO_ODP_API_KEY`

**Key v3 API Differences (Nov 2025 migration):**
- Endpoint paths: `/trials/proceedings/search`, `/trials/decisions/search`, `/trials/documents/search`
- Filter values must be arrays: `{ name: 'field', value: ['value'] }`
- Response uses `patentTrialProceedingDataBag`, `patentTrialDecisionDataBag`
- 404 response means "no matching records" (not an error)
- Max pagination limit: 100 records per request
- Full text search not supported in v3

**Working Endpoints:**
- POST `/api/v1/patent/trials/proceedings/search` - Search trials
- GET `/api/v1/patent/trials/proceedings/{trialNumber}` - Get specific trial
- POST `/api/v1/patent/trials/documents/search` - Search documents
- POST `/api/v1/patent/trials/decisions/search` - Search decisions
- POST `/api/v1/patent/appeals/decisions/search` - Search appeals

---

## Data Downloaded

### Streaming Video Patents (Complete)

**Location:** `output/streaming-video/`

| Metric | Value |
|--------|-------|
| Total Patents | 10,276 |
| Date Range | 1984-05-29 to 2025-09-09 |
| Download Time | 81.5 seconds |
| File Count | 16 batch files |
| Total Size | ~100 MB |

**CPC Breakdown:**
- H04L (Streaming Protocols): 4,848 patents
- H04W (Mobile Video): 1,372 patents
- H04N (Video Coding): 1,259 patents
- G06F (Computing): 943 patents
- H04B: 515 patents
- G11B (Storage): 240 patents
- G06T (Image Processing): 140 patents

**Fields Captured:**
- patent_id, patent_title, patent_date, patent_abstract
- assignees (organization, location)
- inventors (names, locations)
- cpc_current (classifications)

---

## Open Questions for Next Session

### 1. Full Text Search Capabilities

**Question:** Can we search for specific phrases within patent claims or specifications through the APIs?

**Current Understanding:**
- PatentsView supports `_text_any`, `_text_all`, `_text_phrase` operators
- These work on `patent_title` and `patent_abstract` fields
- Full claims text and specification text do NOT appear to be searchable via PatentsView

**To Investigate:**
- Does File Wrapper API provide access to full claims text?
- Are there specific endpoints for claims/specification search?
- What text fields are actually indexed and searchable?

### 2. Bulk Patent Document Download

**Question:** How can we download full patent documents (claims, specifications, drawings) for loading into Elasticsearch or similar?

**Potential Sources:**
1. **USPTO Bulk Data** (https://bulkdata.uspto.gov/)
   - Full patent grant XML files
   - Weekly/yearly archives
   - Free but large downloads (GB per year)

2. **Google Patents Public Datasets**
   - BigQuery access to patent data
   - Full text available
   - May require Google Cloud account

3. **USPTO PatFT/AppFT**
   - Individual patent lookup
   - HTML/text format
   - Rate limited for bulk access

4. **File Wrapper Documents API**
   - Individual document download
   - PDF format (office actions, claims, etc.)
   - Rate limited: 4 requests/minute for PDFs

**To Investigate:**
- Which bulk source has the most complete text data?
- What's the best format for Elasticsearch ingestion?
- Can we correlate bulk data with our PatentsView metadata?

### 3. Analysis Capabilities Needed

**For Streaming Video Portfolio Analysis:**
- Claim term frequency analysis
- Technology clustering
- Citation network analysis
- Competitive landscape mapping
- Patent family relationships
- Prosecution timeline analysis

**Data Gaps:**
- Full claims text (for claim mapping)
- Prosecution documents (for validity analysis)
- IPR/PTAB decisions (blocked by auth issue)
- Foreign counterparts

---

## Code Fixes Applied This Session

### tsconfig.json
- Changed `moduleResolution` from `node` to `NodeNext`
- Changed `module` from `ESNext` to `NodeNext`

### package.json
- Switched from `ts-node --esm` to `tsx` for all scripts
- Added `tsx` as dev dependency

### clients/base-client.ts
- Added `Accept: application/json` header to all requests

### clients/patentsview-client.ts
- Changed all `patent_number` references to `patent_id`
- Fixed nested field queries (`assignees.assignee_organization`, `inventors.inventor_name_last`)
- Removed duplicate field entries from defaults
- Updated citation method to use count fields

### clients/odp-file-wrapper-client.ts
- Changed base URL to `https://api.uspto.gov/api/v1/patent`
- Changed auth header to lowercase `x-api-key`
- Updated response interfaces to match actual API structure
- Added `PatentFileWrapperRecord` and `ApplicationMetaData` types

---

## Commands Reference

### Run Tests
```bash
npm run test:patentsview     # PatentsView API tests
npm run test:filewrapper     # File Wrapper API tests
npm run test:ptab            # PTAB API tests (currently failing)
```

### Download Patents
```bash
# Streaming video patents (completed)
npm run download:streaming

# Test download (100 patents)
npm run download:streaming:test

# Full Broadcom portfolio (run overnight)
nohup npx tsx examples/broadcom-portfolio-builder.ts > broadcom-full.log 2>&1 &
```

### Monitor Downloads
```bash
# Check progress
cat output/streaming-video/progress.json

# Watch log
tail -f streaming-download.log
tail -f broadcom-full.log
```

---

## Environment Setup Checklist

- [x] Node.js installed
- [x] npm install completed
- [x] .env file configured with API keys
- [x] PatentsView API key working
- [x] USPTO ODP API key working (File Wrapper)
- [x] PTAB API v3 working (same ODP key)
- [x] Output directories created

---

## Files Created/Modified

```
ip-port/
├── docs/
│   └── SESSION_STATUS_2026-01-14.md (this file)
├── output/
│   └── streaming-video/
│       ├── patents-batch-0001-2026-01-15.json through 0016
│       └── progress.json
├── examples/
│   ├── streaming-video-downloader.ts (new)
│   ├── test-patentsview.ts (updated)
│   ├── test-file-wrapper.ts (updated)
│   └── debug-test.ts (new, can delete)
├── clients/
│   ├── base-client.ts (updated)
│   ├── patentsview-client.ts (updated)
│   └── odp-file-wrapper-client.ts (updated)
├── tsconfig.json (updated)
└── package.json (updated)
```

---

## Next Session Priorities

1. ~~**Investigate PTAB authentication**~~ - RESOLVED: PTAB v3 API now working
2. **Research bulk download options** - For full patent text to load into Elasticsearch
3. **Implement text analysis** - Once we have full text data
4. **Build analysis pipeline** - Using the 10K+ streaming patents already downloaded
5. **Run full portfolio download** - 22K+ Broadcom patents (now ready to run)
