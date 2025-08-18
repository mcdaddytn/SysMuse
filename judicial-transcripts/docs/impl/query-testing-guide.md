# Query Testing Guide

## Overview

This guide covers how to create, test, and execute search queries using both the CLI and API interfaces. The system supports combined SQL filtering with Elasticsearch full-text search capabilities.

## Table of Contents
1. [Query Format](#query-format)
2. [Available Test Queries](#available-test-queries)
3. [Running Queries via CLI](#running-queries-via-cli)
4. [Running Queries via API](#running-queries-via-api)
5. [Creating Custom Queries](#creating-custom-queries)
6. [Understanding Results](#understanding-results)

## Query Format

### Basic Structure
All queries are defined in JSON format with the following structure:

```json
{
  "trialName": "string or array",
  "sessionDate": "string or array (ISO date)",
  "sessionType": "string or array",
  "speakerType": "string or array",
  "speakerPrefix": "string or array",
  "elasticSearchQueries": [
    {
      "name": "unique_query_name",
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
- **trialName**: Filter by trial name(s) - exact match
- **sessionDate**: Filter by session date(s) - ISO format (YYYY-MM-DD)
- **sessionType**: Filter by session type - MORNING, AFTERNOON, SPECIAL, BENCH_TRIAL, JURY_VERDICT, OTHER
- **speakerType**: Filter by speaker type - JUDGE, ATTORNEY, WITNESS, JUROR, ANONYMOUS
- **speakerPrefix**: Filter by speaker prefix - exact match (e.g., "MR. JONES", "THE COURT")

### Elasticsearch Query Types
- **match**: Basic text matching with word analysis
- **match_phrase**: Exact phrase matching
- **term**: Exact term matching without analysis
- **wildcard**: Pattern matching with * and ? wildcards
- **regexp**: Regular expression matching
- **fuzzy**: Fuzzy matching for typos and variations

## Available Test Queries

The following pre-configured test queries are available in `config/queries/`:

### 1. Judge Statements (`query-judge-statements.json`)
Searches for all statements by judges with specific ruling patterns.
```json
{
  "speakerType": "JUDGE",
  "elasticSearchQueries": [
    {
      "name": "objection_ruling",
      "query": "sustained overruled",
      "type": "match"
    },
    {
      "name": "jury_instructions",
      "query": "members of the jury",
      "type": "match_phrase"
    }
  ]
}
```

### 2. Judge by Trial (`query-judge-by-trial.json`)
Judge statements filtered by specific trial.
```json
{
  "trialName": "State v. Smith",
  "speakerType": "JUDGE",
  "elasticSearchQueries": [
    {
      "name": "evidentiary_rulings",
      "query": "admitted excluded strike",
      "type": "match"
    }
  ]
}
```

### 3. Judge by Session (`query-judge-by-session.json`)
Judge statements filtered by session dates and types.
```json
{
  "trialName": "State v. Smith",
  "sessionDate": ["2024-01-15", "2024-01-16"],
  "sessionType": "MORNING",
  "speakerType": "JUDGE"
}
```

### 4. Attorney Single (`query-attorney-single.json`)
Statements by a specific attorney.
```json
{
  "speakerPrefix": "MR. JONES",
  "elasticSearchQueries": [
    {
      "name": "objections",
      "query": "objection",
      "type": "match"
    },
    {
      "name": "exhibit_references",
      "query": "exhibit",
      "type": "match"
    }
  ]
}
```

### 5. Attorney Multiple (`query-attorney-multiple.json`)
Statements by multiple attorneys with cross-examination patterns.
```json
{
  "speakerPrefix": ["MR. JONES", "MS. SMITH", "MR. DAVIS"],
  "elasticSearchQueries": [
    {
      "name": "cross_examination",
      "query": "isn't it true",
      "type": "match_phrase"
    },
    {
      "name": "leading_questions",
      "query": "didn't you",
      "type": "match_phrase"
    }
  ]
}
```

### 6. Witness Testimony (`query-witness-testimony.json`)
Witness statements with uncertainty and affirmative patterns.
```json
{
  "speakerType": "WITNESS",
  "elasticSearchQueries": [
    {
      "name": "uncertainty",
      "query": "I don't remember I don't recall",
      "type": "match"
    },
    {
      "name": "affirmative",
      "query": "yes correct that's right",
      "type": "match"
    }
  ]
}
```

### 7. Objections Analysis (`query-objections-analysis.json`)
Different types of objections by attorneys.
```json
{
  "speakerType": "ATTORNEY",
  "elasticSearchQueries": [
    {
      "name": "hearsay_objection",
      "query": "objection hearsay",
      "type": "match_phrase",
      "proximity": 2
    },
    {
      "name": "relevance_objection",
      "query": "objection relevance",
      "type": "match_phrase",
      "proximity": 2
    }
  ]
}
```

### 8. Complex Filters (`query-complex-filters.json`)
Combined filtering with multiple criteria.
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

### 9. Proximity Search (`query-proximity-search.json`)
Searches using word proximity.
```json
{
  "elasticSearchQueries": [
    {
      "name": "sustained_objections",
      "query": "objection sustained",
      "type": "match_phrase",
      "proximity": 5
    },
    {
      "name": "approach_bench",
      "query": "approach bench",
      "type": "match_phrase",
      "proximity": 2
    }
  ]
}
```

### 10. Expert Witness (`query-expert-witness.json`)
Expert witness testimony patterns.
```json
{
  "speakerType": "WITNESS",
  "elasticSearchQueries": [
    {
      "name": "expert_opinion",
      "query": "opinion conclusion analysis",
      "type": "match"
    },
    {
      "name": "reasonable_certainty",
      "query": "reasonable degree of certainty",
      "type": "match_phrase",
      "proximity": 3
    }
  ]
}
```

## Running Queries via CLI

### Prerequisites
1. Ensure Elasticsearch is running:
```bash
docker-compose up -d elasticsearch
```

2. Sync data to Elasticsearch:
```bash
npm run parse sync-elasticsearch
# or
make sync-es
```

### Execute Single Query
```bash
# Using npm script
npm run search query -f config/queries/query-judge-statements.json -o output

# Using make
make search FILE=config/queries/query-judge-statements.json

# Using CLI directly
npx ts-node src/cli/search.ts query -f config/queries/query-judge-statements.json -o output
```

### Execute All Test Queries
```bash
# Run all queries in batch
npm run search batch -d config/queries -o output
# or
make search-batch

# Run test suite
npx ts-node src/scripts/executeTestQueries.ts
# or
make test-search
```

### Generate Example Queries
```bash
npm run search example -o config/queries
# or
make search-examples
```

## Running Queries via API

### Start the API Server
```bash
npm run api
# Server runs on http://localhost:3000
```

### Execute Queries via curl

#### 1. Judge Statements
```bash
curl -X POST http://localhost:3000/api/search/advanced \
  -H "Content-Type: application/json" \
  -d '{
    "speakerType": "JUDGE",
    "elasticSearchQueries": [
      {
        "name": "objection_ruling",
        "query": "sustained overruled",
        "type": "match"
      },
      {
        "name": "jury_instructions",
        "query": "members of the jury",
        "type": "match_phrase"
      }
    ]
  }'
```

#### 2. Judge by Trial
```bash
curl -X POST http://localhost:3000/api/search/advanced \
  -H "Content-Type: application/json" \
  -d '{
    "trialName": "State v. Smith",
    "speakerType": "JUDGE",
    "elasticSearchQueries": [
      {
        "name": "evidentiary_rulings",
        "query": "admitted excluded strike",
        "type": "match"
      }
    ]
  }'
```

#### 3. Attorney Objections
```bash
curl -X POST http://localhost:3000/api/search/advanced \
  -H "Content-Type: application/json" \
  -d '{
    "speakerType": "ATTORNEY",
    "elasticSearchQueries": [
      {
        "name": "hearsay_objection",
        "query": "objection hearsay",
        "type": "match_phrase",
        "proximity": 2
      },
      {
        "name": "relevance_objection",
        "query": "objection relevance",
        "type": "match_phrase",
        "proximity": 2
      }
    ]
  }'
```

#### 4. Witness Testimony
```bash
curl -X POST http://localhost:3000/api/search/advanced \
  -H "Content-Type: application/json" \
  -d '{
    "speakerType": "WITNESS",
    "elasticSearchQueries": [
      {
        "name": "uncertainty",
        "query": "I don'\''t remember I don'\''t recall",
        "type": "match"
      }
    ]
  }'
```

#### 5. Complex Filter Search
```bash
curl -X POST http://localhost:3000/api/search/advanced \
  -H "Content-Type: application/json" \
  -d '{
    "trialName": "State v. Smith",
    "sessionType": ["MORNING", "AFTERNOON"],
    "speakerType": ["ATTORNEY", "WITNESS"],
    "elasticSearchQueries": [
      {
        "name": "exhibit_discussion",
        "query": "exhibit",
        "type": "match"
      }
    ],
    "limit": 50
  }'
```

#### 6. Using Config Files with curl
You can directly use the config files as input:

```bash
# Read from config file and send to API
curl -X POST http://localhost:3000/api/search/advanced \
  -H "Content-Type: application/json" \
  -d @config/queries/query-judge-statements.json

# With pretty output
curl -X POST http://localhost:3000/api/search/advanced \
  -H "Content-Type: application/json" \
  -d @config/queries/query-judge-statements.json | python -m json.tool
```

#### 7. Save API Results
```bash
# Save to file
curl -X POST http://localhost:3000/api/search/advanced \
  -H "Content-Type: application/json" \
  -d @config/queries/query-judge-statements.json \
  -o output/api-results-judge.json

# Save with timestamp
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
curl -X POST http://localhost:3000/api/search/advanced \
  -H "Content-Type: application/json" \
  -d @config/queries/query-witness-testimony.json \
  -o output/api-results-witness-$TIMESTAMP.json
```

### Batch Processing via API
Create a shell script to run all queries:

```bash
#!/bin/bash
# batch-api-queries.sh

OUTPUT_DIR="output/api-batch-$(date +%Y%m%d-%H%M%S)"
mkdir -p $OUTPUT_DIR

for query_file in config/queries/query-*.json; do
  filename=$(basename "$query_file" .json)
  echo "Processing $filename..."
  
  curl -s -X POST http://localhost:3000/api/search/advanced \
    -H "Content-Type: application/json" \
    -d @"$query_file" \
    -o "$OUTPUT_DIR/${filename}-result.json"
    
  echo "Saved to $OUTPUT_DIR/${filename}-result.json"
done

echo "All queries completed. Results in $OUTPUT_DIR"
```

## Creating Custom Queries

### Step 1: Define Your Requirements
Determine what you want to search for:
- Which speakers?
- Which trial or session?
- What keywords or phrases?
- How precise should matches be?

### Step 2: Create JSON Configuration
Create a new file in `config/queries/`:

```json
{
  "trialName": "Your Trial Name",
  "speakerType": ["ATTORNEY", "JUDGE"],
  "elasticSearchQueries": [
    {
      "name": "your_query_name",
      "query": "your search terms",
      "type": "match_phrase",
      "proximity": 3
    }
  ]
}
```

### Step 3: Test Your Query
```bash
# Via CLI
npm run search query -f config/queries/your-query.json -o output

# Via API
curl -X POST http://localhost:3000/api/search/advanced \
  -H "Content-Type: application/json" \
  -d @config/queries/your-query.json
```

### Step 4: Analyze Results
Check the output for:
- Total statements found (SQL filter results)
- Matched statements (Elasticsearch matches)
- Match percentages for each named query
- Individual results with match indicators

## Understanding Results

### Result Structure
```json
{
  "totalStatements": 1500,        // Total after SQL filters
  "matchedStatements": 45,        // Matched by Elasticsearch
  "elasticSearchSummary": {       // Summary by query name
    "query_name": {
      "matched": 25,
      "percentage": 56
    }
  },
  "results": [                    // Individual results
    {
      "statementEventId": 123,
      "text": "Full statement text...",
      "speakerType": "ATTORNEY",
      "speakerPrefix": "MR. JONES",
      "elasticSearchMatches": {   // Which queries matched
        "query_name": true,
        "other_query": false
      }
    }
  ]
}
```

### Interpreting Match Indicators
- **elasticSearchMatches**: Shows which named queries matched each statement
- **elasticSearchSummary**: Provides statistics for each query
- **percentage**: Percentage of SQL-filtered results that matched the Elasticsearch query

## Tips and Best Practices

1. **Start with SQL Filters**: Narrow down your dataset first using SQL filters before applying text searches

2. **Use Appropriate Query Types**:
   - `match`: For general keyword searches
   - `match_phrase`: For exact phrases
   - `proximity`: For words that should appear near each other

3. **Test Incrementally**: Start with simple queries and add complexity

4. **Monitor Performance**: Large result sets may take time to process

5. **Use Named Queries**: Give meaningful names to track which patterns match

6. **Combine Filters**: Use multiple filters together for precise results

7. **Export Results**: Save results for further analysis or reporting

## Troubleshooting

### No Results Returned
- Check if data is synced to Elasticsearch
- Verify filter values match your data
- Try broader search terms

### Elasticsearch Errors
- Ensure Elasticsearch is running
- Check index exists: `curl localhost:9200/_cat/indices`
- Verify data is indexed

### Performance Issues
- Limit result size with `limit` parameter
- Use more specific filters
- Consider indexing optimization

## Examples Repository

All example queries are maintained in:
```
config/queries/
├── query-attorney-multiple.json
├── query-attorney-single.json
├── query-complex-filters.json
├── query-expert-witness.json
├── query-judge-by-session.json
├── query-judge-by-trial.json
├── query-judge-statements.json
├── query-objections-analysis.json
├── query-proximity-search.json
└── query-witness-testimony.json
```

These can be used as templates for creating your own custom queries.