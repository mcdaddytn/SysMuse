# USPTO Patent APIs - Complete Reference Guide

## Table of Contents
1. [PatentsView API](#patentsview-api)
2. [USPTO ODP File Wrapper API](#uspto-odp-file-wrapper-api)
3. [USPTO ODP PTAB API](#uspto-odp-ptab-api)
4. [Common Patterns](#common-patterns)
5. [Error Handling](#error-handling)

---

## PatentsView API

### Overview
- **Base URL**: `https://search.patentsview.org/api/v1`
- **Authentication**: API Key in `X-Api-Key` header
- **Rate Limit**: 45 requests/minute per API key
- **Data Coverage**: Granted patents (1976-present), Published applications (2001-present)
- **Updates**: Quarterly

### Key Endpoints

#### 1. Patent Search
```
POST /patent/
```

**Request Body**:
```typescript
{
  q: PatentQuery,          // Query object (required)
  f: string[],             // Fields to return
  s: SortOption[],         // Sort options
  o: {
    size?: number,         // Results per page (default: 100, max: 1000)
    after?: string,        // Cursor for pagination
    exclude_withdrawn?: boolean,
    pad_patent_id?: boolean
  }
}
```

**Query Syntax**:
```typescript
// Basic equality
{ "patent_number": "10000000" }

// Comparison operators
{ "_gte": { "patent_date": "2023-01-01" } }  // Greater than or equal
{ "_lte": { "patent_date": "2023-12-31" } }  // Less than or equal
{ "_gt": { ... } }   // Greater than
{ "_lt": { ... } }   // Less than

// Text search
{ "_text_any": { "patent_title": "machine learning" } }     // Any word
{ "_text_all": { "patent_abstract": "neural network" } }    // All words
{ "_text_phrase": { "patent_title": "deep learning" } }     // Exact phrase

// String matching
{ "_begins": { "assignee_organization": "Apple" } }
{ "_contains": { "assignee_organization": "Technology" } }

// Boolean logic
{ "_and": [query1, query2, ...] }
{ "_or": [query1, query2, ...] }
{ "_not": query }

// Nested field access
{ "assignees.assignee_organization": "Apple Inc." }
{ "inventors.inventor_last_name": "Smith" }
{ "cpc.cpc_section_id": "H04" }
```

**Response**:
```typescript
{
  error: false,
  count: number,          // Results in this response
  total_hits: number,     // Total matching results
  patents: Patent[]
}
```

**Available Fields** (partial list - see full docs for all fields):
```
// Basic fields
patent_id, patent_number, patent_title, patent_abstract, patent_date,
patent_type, patent_kind, application_number, filing_date

// Assignees
assignees.assignee_id, assignees.assignee_organization,
assignees.assignee_country, assignees.assignee_state

// Inventors
inventors.inventor_id, inventors.inventor_name_first, 
inventors.inventor_name_last, inventors.inventor_country

// Citations
us_patent_citations.cited_patent_id, us_patent_citations.cited_patent_number,
foreign_citations, other_references

// Classifications
cpc.cpc_section_id, cpc.cpc_group_id, cpc.cpc_subgroup_id,
ipc.ipc_class, uspc.uspc_mainclass_id

// Claims
claims.claim_text, claims.claim_number, claims.claim_dependent
```

### Common Use Cases

#### 1. Find Patents by Date Range
```typescript
const result = await pvClient.searchPatents({
  query: {
    _and: [
      { _gte: { patent_date: "2023-01-01" } },
      { _lte: { patent_date: "2023-12-31" } }
    ]
  },
  fields: ["patent_id", "patent_number", "patent_title", "patent_date"]
});
```

#### 2. Find Patents by Assignee
```typescript
const result = await pvClient.searchPatents({
  query: {
    "assignees.assignee_organization": "Microsoft Corporation"
  },
  fields: ["patent_id", "patent_number", "patent_title", "assignees"]
});
```

#### 3. Get Citation Network
```typescript
// Get backward citations (what this patent cites)
const result = await pvClient.getPatent(patentId, ["us_patent_citations"]);

// Get forward citations (what cites this patent)
const forward = await pvClient.searchPatents({
  query: { "us_patent_citations.cited_patent_id": patentId }
});
```

#### 4. Technology Search with CPC
```typescript
const result = await pvClient.searchPatents({
  query: {
    _and: [
      { "cpc.cpc_section_id": "G06" },  // Computing
      { _gte: { patent_date: "2023-01-01" } }
    ]
  }
});
```

---

## USPTO ODP File Wrapper API

### Overview
- **Base URL**: `https://api.data.uspto.gov/patent-file-wrapper/v1`
- **Authentication**: API Key in `X-API-Key` header
- **Rate Limit**: ~60 requests/minute (conservative estimate)
- **Data Coverage**: Applications from 2001-present
- **Includes**: Prosecution history, office actions, file history documents

### Key Endpoints

#### 1. Search Applications
```
GET /applications/search?{params}
```

**Query Parameters**:
```
applicationNumber    - Application number (numeric only)
patentNumber        - Patent number (numeric only)
filingDateFrom      - ISO date (YYYY-MM-DD)
filingDateTo        - ISO date (YYYY-MM-DD)
inventionTitle      - Title search term
assignee            - Assignee name
inventor            - Inventor name
page                - Page number (0-indexed)
size                - Results per page (default: 100)
```

**Response**:
```typescript
{
  recordTotalQuantity: number,
  pageNumber: number,
  pageSize: number,
  applications: ApplicationBiblio[]
}
```

#### 2. Get Application Details
```
GET /applications/{applicationNumber}
```

**Response**: Single `ApplicationBiblio` object

#### 3. Get File History Documents
```
GET /applications/{applicationNumber}/documents
```

**Response**:
```typescript
{
  recordTotalQuantity: number,
  documents: FileHistoryDocument[]
}
```

**Document Codes** (Common):
```
CTNF  - Non-Final Rejection
CTFR  - Final Rejection
N417  - Notice of Allowance
ABEX  - Examiner's Amendment
A.P   - Amendment/Preliminary Amendment
RCEX  - Request for Continued Examination
IDS   - Information Disclosure Statement
SRFW  - Examiner Search Report
```

#### 4. Download Document
```
GET /applications/{applicationNumber}/documents/{documentIdentifier}
```

Returns binary document (usually PDF)

#### 5. Get Transaction History
```
GET /applications/{applicationNumber}/transactions
```

**Response**:
```typescript
{
  recordTotalQuantity: number,
  transactions: Transaction[]
}
```

### Common Use Cases

#### 1. Get Prosecution Timeline
```typescript
const timeline = await fwClient.getProsecutionTimeline(appNumber);
// Returns: application, transactions, key documents
```

#### 2. Find Office Actions
```typescript
const officeActions = await fwClient.getOfficeActions(appNumber);
// Returns only CTNF, CTFR, N417, etc.
```

#### 3. Search by Assignee
```typescript
const apps = await fwClient.searchByAssignee(
  "Apple Inc.",
  "2024-01-01",
  "2024-12-31"
);
```

#### 4. Check Application Status
```typescript
const status = await fwClient.getApplicationStatus(appNumber);
// Returns: { status, statusDate, isPending, isAbandoned, isPatented }
```

---

## USPTO ODP PTAB API

### Overview
- **Base URL**: `https://api.data.uspto.gov/ptab/v1`
- **Authentication**: API Key in `X-API-Key` header
- **Rate Limit**: ~60 requests/minute (conservative estimate)
- **Data Coverage**: PTAB proceedings (IPR, PGR, CBM, Appeals)
- **Real-time**: Syncs with PTAB E2E system

### Key Endpoints

#### 1. Search Trials
```
POST /trials/search
```

**Request Body**:
```typescript
{
  filters: [
    { name: "trialType", value: "IPR" },
    { name: "institutionDecision", value: "Instituted" },
    { name: "petitionerPartyName", value: "Apple Inc." }
  ],
  rangeFilters: [
    {
      field: "filingDate",
      valueFrom: "2023-01-01",
      valueTo: "2023-12-31"
    }
  ],
  sort: [
    { field: "filingDate", order: "desc" }
  ],
  searchText: "full text search",
  page: 0,
  size: 100
}
```

**Filter Fields**:
```
trialType                  - IPR, PGR, CBM, etc.
trialStatusCategory        - Active, Terminated, etc.
institutionDecision        - Instituted, Denied
petitionerPartyName        - Petitioner name
patentOwnerName            - Patent owner name
respondentPatentNumber     - Challenged patent number
```

**Range Filter Fields**:
```
filingDate
institutionDecisionDate
finalWrittenDecisionDate
respondentPatentIssueDate
```

**Response**:
```typescript
{
  totalHits: number,
  page: number,
  size: number,
  trials: PTABTrial[]
}
```

#### 2. Get Trial Details
```
GET /trials/{trialNumber}
```

Returns single `PTABTrial` object

#### 3. Get Trial Documents
```
GET /trials/{trialNumber}/documents
```

**Response**:
```typescript
{
  totalHits: number,
  documents: PTABDocument[]
}
```

#### 4. Download Document
```
GET /trials/{trialNumber}/documents/{documentIdentifier}
```

Returns binary document

#### 5. Search Decisions
```
POST /decisions/search
```

Similar structure to trial search

### Common Use Cases

#### 1. Find IPRs for a Patent
```typescript
const iprs = await ptabClient.searchIPRsByPatent("10000000");
```

#### 2. Get Instituted IPRs
```typescript
const instituted = await ptabClient.getInstitutedIPRs(
  "2023-01-01",
  "2023-12-31"
);
```

#### 3. Search by Petitioner
```typescript
const trials = await ptabClient.searchByPetitioner("Google LLC");
```

#### 4. Get Institution Statistics
```typescript
const trials = await getAllTrials();
const stats = ptabClient.calculateStatistics(trials);
// Returns: institution rate, settlement rate, avg duration
```

---

## Common Patterns

### Pagination

**PatentsView** (cursor-based):
```typescript
for await (const page of pvClient.searchPaginated(query, pageSize)) {
  // Process page
}
```

**File Wrapper** (offset-based):
```typescript
for await (const page of fwClient.searchPaginated(query, pageSize)) {
  // Process page
}
```

**PTAB** (offset-based):
```typescript
for await (const page of ptabClient.searchPaginated(query, pageSize)) {
  // Process page
}
```

### Rate Limiting

All clients implement automatic rate limiting:
```typescript
// Configure when creating client
const client = new PatentsViewClient({
  apiKey: key,
  rateLimit: {
    requestsPerMinute: 45,
    requestsPerHour: 2700
  }
});

// Automatic waiting happens transparently
```

### Retry Logic

All clients include exponential backoff retry:
```typescript
// Automatically retries on 5xx errors
// Does not retry on 4xx errors (client errors)
// Default: 3 attempts with exponential backoff
```

---

## Error Handling

### Common Error Types

#### Authentication Errors (401)
```typescript
try {
  const result = await client.search(...);
} catch (error) {
  if (error.statusCode === 401) {
    console.error('Invalid API key');
  }
}
```

#### Rate Limit Errors (429)
```typescript
// Automatically handled by rate limiter
// If exceeded, clients will wait before retrying
```

#### Not Found (404)
```typescript
const patent = await pvClient.getPatent('12345678');
if (!patent) {
  console.log('Patent not found');
}
```

#### Server Errors (5xx)
```typescript
// Automatically retried with exponential backoff
// After max attempts, error is thrown
```

### Best Practices

1. **Always handle null returns**:
```typescript
const patent = await pvClient.getPatent(id);
if (!patent) {
  // Handle not found
}
```

2. **Use try-catch for API calls**:
```typescript
try {
  const result = await client.search(...);
} catch (error) {
  console.error('API error:', error.message);
}
```

3. **Respect rate limits**:
```typescript
// Let the client handle rate limiting automatically
// Or add delays between requests manually
await new Promise(r => setTimeout(r, 1000));
```

4. **Paginate large result sets**:
```typescript
// Use pagination instead of requesting all at once
for await (const page of client.searchPaginated(...)) {
  // Process incrementally
}
```

---

## API Key Setup

### PatentsView
1. Request at: https://patentsview-support.atlassian.net/servicedesk/customer/portal/1/group/1/create/18
2. Fill form with project description
3. Receive key via email (usually within 24 hours)
4. Set `PATENTSVIEW_API_KEY` environment variable

### USPTO ODP
1. Create USPTO.gov account at: https://www.uspto.gov/
2. Complete ID.me verification (requires SSN + govt ID)
3. Login to: https://data.uspto.gov/myodp
4. Get API key from dashboard
5. Set `USPTO_ODP_API_KEY` environment variable

---

## Additional Resources

- **PatentsView Documentation**: https://search.patentsview.org/docs/
- **PatentsView Data Dictionary**: https://patentsview.org/download/data-download-tables
- **USPTO ODP Portal**: https://data.uspto.gov/
- **USPTO ODP API Docs**: https://data.uspto.gov/apis/
- **PTAB Portal**: https://data.uspto.gov/ptab
