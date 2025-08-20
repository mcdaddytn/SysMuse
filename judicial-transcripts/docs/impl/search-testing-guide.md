# Search Testing Guide

## Overview

The judicial transcripts system includes comprehensive search and query testing capabilities. This guide explains how to run searches, execute test queries, and analyze results.

## Quick Start

### Running All Queries

The simplest way to run all configured test queries:

```bash
npm run run-all-queries
```

This will:
- Execute all query files in `config/queries/`
- Generate output files in `output/batch-results-[timestamp]/`
- Create a summary report with statistics
- Save both JSON and text outputs for each query

### Running Individual Queries

To run a single query:

```bash
npm run enhanced-search query -f config/queries/query-objections-detailed.json
```

### Viewing Results

After running queries, results are saved in the `output/` directory:

```bash
cd output/batch-results-[timestamp]/
ls -la
```

Each query generates:
- **JSON file**: Raw search results with all metadata
- **Text file**: Formatted output using the specified template
- **Summary report**: Overall statistics and success/failure information

## Query Configuration

### Query File Structure

Query files are JSON documents in `config/queries/` with these key fields:

```json
{
  "trialName": "Trial name or array of names",
  "speakerType": "JUDGE|ATTORNEY|WITNESS|COURT_REPORTER",
  "maxResults": 50,
  "surroundingStatements": 5,
  "outputFileNameTemplate": "filename-{Speaker.speakerPrefix}.txt",
  "outputFileTemplate": "template-name.txt",
  "elasticSearchQueries": [
    {
      "name": "query_identifier",
      "query": "search terms",
      "type": "match|match_phrase",
      "proximity": 2
    }
  ]
}
```

### Key Parameters

- **maxResults**: Limits the number of matching statements returned
- **surroundingStatements**: Number of context statements before/after matches (useful for courtroom interchanges)
- **outputFileTemplate**: Template file from `config/templates/` for formatting output
- **elasticSearchQueries**: Array of search terms with different matching strategies

## Output Templates

Templates control how results are formatted. Available templates:

### minimal-metadata.txt
Compact single-line format with essential metadata:
```
2024-01-15 | Morning | Line 1234
ATTORNEY-HADDEN: Your Honor, I object to the form of the question.
```

### interchange-context.txt
Full context for courtroom dialogues:
```
--- 2024-01-15 | Morning | Lines 1234-1238 ---
MR. HADDEN (ATTORNEY):
Your Honor, I object to the form of the question.
```

### speaker-focused.txt
Emphasizes speaker identification:
```
[ATTORNEY/HADDEN] 2024-01-15:1234
Your Honor, I object to the form of the question.
```

## Search Optimization

### Hit Rate Guidelines

For optimal results, queries should return:
- **0-5%** of total statements for specific searches
- **Higher tolerance** (up to 10%) for judge statements
- **Use multiple search terms** to refine results

### Query Types

1. **Procedural Queries**: Objections, motions, rulings
2. **Examination Queries**: Direct, cross, redirect examination
3. **Administrative Queries**: Exhibit handling, jury instructions
4. **Interchange Queries**: Sidebar discussions, bench approaches

## Example Commands

### Basic Search
```bash
npm run enhanced-search query -f config/queries/query-objections-detailed.json
```

### Batch Processing
```bash
npm run run-all-queries
```

### Custom Output Directory
```bash
npm run enhanced-search query -f config/queries/query-exhibit-handling.json -o ./custom-output
```

### Include Raw JSON
```bash
npm run enhanced-search query -f config/queries/query-jury-instructions.json --json
```

## Analyzing Results

### Query Statistics

Each query execution provides:
- Total statements found (SQL filter results)
- Matched statements (Elasticsearch matches)
- Hit rate percentage for each search term

### Batch Summary

The batch runner generates:
- `query-run-summary.json`: Machine-readable results
- `query-run-report.md`: Human-readable markdown report

### Creating Archives

To save results for analysis:
```bash
cd output/
zip -r results-archive.zip batch-results-*
```

## Troubleshooting

### Common Issues

1. **No results returned**: Check that the trial name/case number matches exactly
2. **Too many results**: Add more specific search terms or reduce maxResults
3. **Missing context**: Increase surroundingStatements parameter
4. **Template errors**: Verify template file exists in config/templates/

### Database Connection

Ensure services are running:
```bash
docker-compose up -d  # Start PostgreSQL and Elasticsearch
npm run prisma:studio # View database contents
```

## Best Practices

1. **Start with focused queries**: Use specific legal terms and phrases
2. **Use appropriate templates**: Match template to query purpose
3. **Test incrementally**: Run individual queries before batch processing
4. **Review hit rates**: Adjust search terms if getting too many/few results
5. **Archive results**: Save outputs for comparison and analysis

## Advanced Usage

### Creating Custom Queries

1. Copy an existing query file as a template
2. Modify search terms and filters
3. Select appropriate output template
4. Test with a small maxResults value first
5. Adjust based on hit rate and quality of results

### Template Customization

Templates use placeholder syntax:
- `{StatementEvent.text}`: Statement content
- `{Speaker.speakerPrefix}`: Speaker name/identifier
- `{Session.sessionDate}`: Date of session
- `{TrialEvent.startLineNumber}`: Line number reference

## Support

For issues or questions:
1. Check the main README.md for setup instructions
2. Review sample queries in config/queries/
3. Examine template examples in config/templates/
4. Check logs in the output directory for error details