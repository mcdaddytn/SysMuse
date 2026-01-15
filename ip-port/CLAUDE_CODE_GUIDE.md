# USPTO Patent APIs - Claude Code Quick Start

## What This Is

Complete TypeScript implementation for accessing three USPTO patent data APIs:
1. **PatentsView** - Patent data, citations, inventors, assignees
2. **File Wrapper** - Prosecution history, office actions
3. **PTAB** - IPR proceedings, PTAB decisions

## Setup (5 minutes)

### 1. Install Dependencies
```bash
cd /path/to/uspto-api-docs
npm install
```

### 2. Get API Keys

**PatentsView** (Easy - 24 hour approval):
- Request: https://patentsview-support.atlassian.net/servicedesk/customer/portal/1/group/1/create/18
- Fill simple form, receive key by email

**USPTO ODP** (Requires ID.me verification):
- Create account: https://www.uspto.gov/
- Verify with ID.me (govt ID + SSN required)
- Get key: https://data.uspto.gov/myodp

### 3. Configure Environment
```bash
cp .env.example .env
# Edit .env and add your API keys
```

## Test Your Setup

```bash
# Test PatentsView (only requires PatentsView key)
npm run test:patentsview

# Test File Wrapper (requires USPTO ODP key)
npm run test:filewrapper

# Test PTAB (requires USPTO ODP key)
npm run test:ptab

# Run comprehensive example (requires both keys)
npm run example:analysis
```

## Basic Usage Examples

### PatentsView - Find Patents
```typescript
import { createPatentsViewClient } from './clients/patentsview-client.js';

const pvClient = createPatentsViewClient();

// Search by date range
const patents = await pvClient.searchByDateRange(
  '2024-01-01',
  '2024-12-31'
);

// Search by assignee
const applePatents = await pvClient.searchByAssignee('Apple Inc.');

// Get citation network
const citations = await pvClient.getPatentCitations('10000000');
```

### File Wrapper - Get Prosecution History
```typescript
import { createFileWrapperClient } from './clients/odp-file-wrapper-client.js';

const fwClient = createFileWrapperClient();

// Get application details
const app = await fwClient.getApplication('16123456');

// Get all file history documents
const docs = await fwClient.getDocuments('16123456');

// Get only office actions
const officeActions = await fwClient.getOfficeActions('16123456');

// Get complete prosecution timeline
const timeline = await fwClient.getProsecutionTimeline('16123456');
```

### PTAB - Find IPR Proceedings
```typescript
import { createPTABClient } from './clients/odp-ptab-client.js';

const ptabClient = createPTABClient();

// Find IPRs for a patent
const iprs = await ptabClient.searchIPRsByPatent('10000000');

// Get instituted IPRs
const instituted = await ptabClient.getInstitutedIPRs('2024-01-01', '2024-12-31');

// Search by petitioner
const trials = await ptabClient.searchByPetitioner('Google LLC');
```

## Key Features

✓ **Type-safe** - Full TypeScript types for all responses
✓ **Rate limiting** - Automatic rate limit handling
✓ **Retry logic** - Exponential backoff on failures
✓ **Pagination** - Easy iteration through large result sets
✓ **Error handling** - Comprehensive error types

## Project Structure

```
clients/
  ├── base-client.ts           # Shared HTTP/rate limiting
  ├── patentsview-client.ts    # PatentsView API
  ├── odp-file-wrapper-client.ts  # Prosecution history
  └── odp-ptab-client.ts       # PTAB/IPR data

examples/
  ├── test-patentsview.ts      # PatentsView examples
  ├── test-file-wrapper.ts     # File Wrapper examples
  ├── test-ptab.ts             # PTAB examples
  └── comprehensive-patent-analysis.ts  # Full workflow

docs/
  └── API_REFERENCE.md         # Complete API documentation
```

## Common Tasks

### Find All Patents for Company in Date Range
```typescript
const patents = await pvClient.searchByAssignee(
  'Microsoft Corporation',
  { _and: [
    { _gte: { patent_date: '2024-01-01' } },
    { _lte: { patent_date: '2024-12-31' } }
  ]}
);
```

### Get Prosecution History for Patent
```typescript
const app = await fwClient.getApplicationByPatentNumber('11000000');
if (app) {
  const timeline = await fwClient.getProsecutionTimeline(app.applicationNumber);
}
```

### Check if Patent Has Been Challenged
```typescript
const iprs = await ptabClient.searchIPRsByPatent('10000000');
const isChallenged = iprs.trials.length > 0;
const isInstituted = iprs.trials.some(t => t.institutionDecision === 'Instituted');
```

### Complete Patent Analysis
```typescript
// See examples/comprehensive-patent-analysis.ts for full workflow:
// 1. Get patent data
// 2. Analyze citations
// 3. Get prosecution history
// 4. Check for IPR challenges
// 5. Calculate risk score
```

## API Limits

| API | Rate Limit | Coverage |
|-----|------------|----------|
| PatentsView | 45/min | 1976-present |
| File Wrapper | ~60/min | 2001-present |
| PTAB | ~60/min | All proceedings |

## Troubleshooting

**"PATENTSVIEW_API_KEY not found"**
→ Check .env file exists and has key

**"401 Unauthorized"**
→ Verify API key is correct and active

**"429 Too Many Requests"**
→ Rate limiter should prevent this, but if it happens, reduce request frequency

**"Application not found in File Wrapper"**
→ File Wrapper only has applications from 2001+

## Next Steps

1. Review `examples/comprehensive-patent-analysis.ts` for complete workflow
2. Read `docs/API_REFERENCE.md` for detailed API documentation
3. Adapt clients for your specific use case
4. Build analysis tools on top of these APIs

## For Claude Code

This entire repository is designed to be used as context in Claude Code for:
- Building patent analysis tools
- E-discovery document analysis
- Prior art research
- IPR challenge analysis
- Patent portfolio management
- Litigation risk assessment

All code is production-ready TypeScript with comprehensive error handling and type safety.
