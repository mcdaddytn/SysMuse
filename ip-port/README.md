# IP-PORT: Intellectual Property Portfolio Tools

## Overview

Production-ready TypeScript toolset for USPTO patent data analysis, portfolio building, and IP litigation research.

This project provides comprehensive TypeScript integration for accessing USPTO patent data through three primary APIs:

1. **PatentsView API** - Patent bibliographic data, citations, inventors, assignees
2. **USPTO Open Data Portal (ODP) File Wrapper API** - Prosecution history, office actions, application documents
3. **USPTO ODP PTAB API** - Inter Partes Review (IPR), Patent Trial and Appeal Board proceedings

## Quick Start

### API Keys Required

1. **PatentsView API Key**
   - Request at: https://patentsview-support.atlassian.net/servicedesk/customer/portal/1/group/1/create/18
   - No complex authentication required
   - Typical approval: 24 hours
   - Set as environment variable: `PATENTSVIEW_API_KEY`

2. **USPTO ODP API Key**
   - Requires USPTO.gov account + ID.me verification
   - Request at: https://data.uspto.gov/myodp
   - Set as environment variable: `USPTO_ODP_API_KEY`

### Environment Setup

```bash
# .env file
PATENTSVIEW_API_KEY=your_patentsview_key_here
USPTO_ODP_API_KEY=your_uspto_odp_key_here
```

## Architecture

### API Endpoints Base URLs

```typescript
// PatentsView API
const PATENTSVIEW_BASE = 'https://search.patentsview.org/api/v1';

// USPTO ODP APIs
const ODP_BASE = 'https://api.data.uspto.gov';
const ODP_FILE_WRAPPER_BASE = `${ODP_BASE}/patent-file-wrapper/v1`;
const ODP_PTAB_BASE = `${ODP_BASE}/ptab/v1`;
```

### Rate Limits

| API | Rate Limit | Notes |
|-----|------------|-------|
| PatentsView | 45 requests/min per key | Per API key |
| USPTO ODP | TBD (monitor headers) | Apply rate limiting |

## File Structure

```
uspto-api-docs/
├── README.md                          # This file
├── clients/
│   ├── patentsview-client.ts         # PatentsView API client
│   ├── odp-file-wrapper-client.ts    # File Wrapper/Prosecution History client
│   ├── odp-ptab-client.ts            # PTAB/IPR client
│   └── base-client.ts                # Shared HTTP client utilities
├── types/
│   ├── patentsview-types.ts          # PatentsView response types
│   ├── file-wrapper-types.ts         # File Wrapper response types
│   └── ptab-types.ts                 # PTAB response types
├── examples/
│   ├── test-patentsview.ts           # Test PatentsView connection
│   ├── test-file-wrapper.ts          # Test File Wrapper API
│   ├── test-ptab.ts                  # Test PTAB API
│   └── comprehensive-patent-analysis.ts  # Full workflow example
└── docs/
    ├── PATENTSVIEW_API.md            # PatentsView API documentation
    ├── FILE_WRAPPER_API.md           # Prosecution history API docs
    └── PTAB_API.md                   # PTAB/IPR API documentation
```

## Use Cases

### 1. Prior Art Analysis (PatentsView)
```typescript
// Search for patents by technology area and date range
// Get citation networks
// Analyze assignee portfolios
```

### 2. Prosecution Strategy Analysis (File Wrapper)
```typescript
// Retrieve office actions for application
// Download examiner rejections and applicant responses
// Track claim amendments over prosecution
```

### 3. IPR Challenge Research (PTAB)
```typescript
// Find IPR proceedings for specific patents
// Retrieve PTAB decisions and institution decisions
// Analyze challenge success rates
```

## Key Features

- **Type-safe** - Full TypeScript type definitions for all API responses
- **Error handling** - Comprehensive error types and retry logic
- **Rate limiting** - Built-in rate limit management
- **Pagination** - Automatic cursor-based pagination support
- **Caching** - Optional response caching to reduce API calls
- **Logging** - Configurable logging for debugging

## Dependencies

```json
{
  "dependencies": {
    "node-fetch": "^3.3.2",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "typescript": "^5.3.3"
  }
}
```

## Next Steps

1. Set up API keys (see Quick Start)
2. Review individual API documentation in `/docs`
3. Run test examples in `/examples`
4. Integrate clients into your analysis workflow

## Additional Resources

- [PatentsView Documentation](https://search.patentsview.org/docs/)
- [USPTO ODP Portal](https://data.uspto.gov/)
- [PTAB Public Portal](https://data.uspto.gov/ptab)
