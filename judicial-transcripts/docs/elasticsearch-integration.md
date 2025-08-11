# Elasticsearch Integration Documentation

## Overview
This feature integrates Elasticsearch with the judicial transcripts system to enable advanced search capabilities combining SQL filters with full-text search across statement events.

## Architecture

### Components
1. **ElasticSearchService** - Handles all Elasticsearch operations including indexing and searching
2. **SqlQueryService** - Manages SQL queries with flexible filtering
3. **CombinedSearchService** - Orchestrates combined SQL and Elasticsearch queries
4. **CLI Interface** - Command-line tools for executing searches

## Setup

### Prerequisites
- Elasticsearch 8.x running locally or remotely
- PostgreSQL database with transcript data
- Node.js environment configured

### Environment Variables
```bash
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_API_KEY=your-api-key-if-needed
DATABASE_URL=postgresql://user:password@localhost:5432/judicial_transcripts
```

## Usage

### 1. Sync Data to Elasticsearch
First, sync all statement events to Elasticsearch:

```bash
npm run parse sync-elasticsearch
# or
npm run search sync
```

### 2. Execute Single Query
Run a single search query from a JSON file:

```bash
npm run parse search -f config/queries/query-judge-statements.json -o output
# or
npm run search query -f config/queries/query-judge-statements.json
```

### 3. Execute Batch Queries
Run multiple queries from a directory:

```bash
npm run parse search-batch -d config/queries -o output
# or
npm run search batch -d config/queries -o output
```

### 4. Run Test Queries
Execute all predefined test queries:

```bash
ts-node src/scripts/executeTestQueries.ts
```

## Query Format

### Basic Structure
```json
{
  "trialName": "string or array",
  "sessionDate": "string or array (ISO date format)",
  "sessionType": "string or array",
  "speakerType": "string or array",
  "speakerPrefix": "string or array",
  "elasticSearchQueries": [
    {
      "name": "query_name",
      "query": "search text",
      "type": "match|match_phrase|term|wildcard|regexp|fuzzy",
      "field": "text (default)",
      "proximity": 3,
      "boost": 1.0
    }
  ]
}
```

### SQL Filters
- **trialName**: Filter by trial name(s)
- **sessionDate**: Filter by session date(s)
- **sessionType**: Filter by session type (MORNING, AFTERNOON, etc.)
- **speakerType**: Filter by speaker type (JUDGE, ATTORNEY, WITNESS, etc.)
- **speakerPrefix**: Filter by speaker prefix (MR. SMITH, MS. JONES, etc.)

### Elasticsearch Query Types
- **match**: Basic text matching
- **match_phrase**: Exact phrase matching
- **term**: Exact term matching
- **wildcard**: Pattern matching with wildcards
- **regexp**: Regular expression matching
- **fuzzy**: Fuzzy matching for typos

### Proximity Parameter
For `match_phrase` queries, the `proximity` parameter defines the maximum number of words allowed between terms (slop).

## Example Queries

### Judge Statements
```json
{
  "speakerType": "JUDGE",
  "elasticSearchQueries": [
    {
      "name": "objection_ruling",
      "query": "sustained OR overruled",
      "type": "match"
    }
  ]
}
```

### Attorney Objections
```json
{
  "speakerType": "ATTORNEY",
  "elasticSearchQueries": [
    {
      "name": "hearsay_objection",
      "query": "objection hearsay",
      "type": "match_phrase",
      "proximity": 2
    }
  ]
}
```

### Complex Filter
```json
{
  "trialName": "State v. Smith",
  "sessionType": ["MORNING", "AFTERNOON"],
  "speakerType": ["ATTORNEY", "WITNESS"],
  "elasticSearchQueries": [
    {
      "name": "exhibit_discussion",
      "query": "exhibit",
      "type": "match"
    }
  ]
}
```

## Output Format

### Search Results
```json
{
  "totalStatements": 500,
  "matchedStatements": 45,
  "results": [
    {
      "statementEventId": 123,
      "text": "Objection, your honor. Hearsay.",
      "trialName": "State v. Smith",
      "speakerType": "ATTORNEY",
      "speakerPrefix": "MR. JONES",
      "elasticSearchMatches": {
        "hearsay_objection": true,
        "relevance_objection": false
      }
    }
  ],
  "elasticSearchSummary": {
    "hearsay_objection": {
      "matched": 12,
      "percentage": 27
    }
  }
}
```

## Predefined Test Queries

The system includes several predefined test queries in the `config/queries/` directory:

1. **query-judge-statements.json** - All judge statements
2. **query-judge-by-trial.json** - Judge statements filtered by trial
3. **query-judge-by-session.json** - Judge statements by session date/type
4. **query-attorney-single.json** - Single attorney's statements
5. **query-attorney-multiple.json** - Multiple attorneys' statements
6. **query-witness-testimony.json** - Witness testimonies
7. **query-objections-analysis.json** - Different types of objections
8. **query-complex-filters.json** - Combined filters example
9. **query-proximity-search.json** - Proximity-based searches
10. **query-expert-witness.json** - Expert witness analysis

## Performance Considerations

1. **Indexing**: Initial sync may take time for large datasets
2. **Batch Size**: Elasticsearch bulk operations use batches of 100 documents
3. **Query Limits**: Default result limit is 100 statements per query
4. **Caching**: Elasticsearch provides built-in query caching

## Troubleshooting

### Common Issues

1. **Elasticsearch Connection Failed**
   - Check if Elasticsearch is running
   - Verify ELASTICSEARCH_URL in environment

2. **No Results Returned**
   - Ensure data is synced to Elasticsearch
   - Check that statements have elasticSearchId

3. **Query Syntax Errors**
   - Validate JSON format
   - Check field names match schema

### Logging
The system uses Winston logger with different levels:
- INFO: General operations
- WARN: Non-critical issues
- ERROR: Failures and exceptions

## API Integration

The search functionality can also be accessed via the REST API:

```typescript
POST /api/search
Content-Type: application/json

{
  "trialName": "State v. Smith",
  "speakerType": "JUDGE",
  "elasticSearchQueries": [...]
}
```

## Future Enhancements

1. Real-time indexing during transcript processing
2. Advanced aggregations and analytics
3. Machine learning-based relevance tuning
4. Export to additional formats (CSV, Excel)
5. Web-based query builder interface