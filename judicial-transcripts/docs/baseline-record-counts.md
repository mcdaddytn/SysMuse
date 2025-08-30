# Baseline Record Counts for Regression Testing

Generated: 2025-08-30

This document contains baseline record counts from the judicial_transcripts database (public schema) 
to be used for regression testing after refactoring.

## Table Record Counts

| Table Name | Record Count |
|------------|-------------|
| AccumulatorComponent | 0 |
| AccumulatorExpression | 6 |
| AccumulatorResult | 0 |
| Address | 7 |
| AnonymousSpeaker | 6 |
| Attorney | 19 |
| CourtDirectiveEvent | 157 |
| CourtDirectiveType | 29 |
| CourtReporter | 1 |
| ElasticSearchExpression | 104 |
| ElasticSearchResult | 0 |
| Judge | 1 |
| Juror | 39 |
| LawFirm | 6 |
| LawFirmOffice | 7 |
| Line | 38550 |
| Marker | 0 |
| MarkerSection | 0 |
| MarkerTemplate | 6 |
| Page | 1533 |
| SearchIndex | 0 |
| Session | 12 |
| SessionSection | 108 |
| Speaker | 81 |
| StatementEvent | 12265 |
| Trial | 1 |
| TrialAttorney | 19 |
| TrialEvent | 12480 |
| Witness | 16 |
| WitnessCalledEvent | 58 |
| _AccumulatorESExpressions | 0 |

## Total Records: 65,560

## SQL Query to Verify Counts

```sql
SELECT table_name, 
       (xpath('/row/cnt/text()', xml_count))[1]::text::int as row_count
FROM (
  SELECT table_name, table_schema, 
         query_to_xml(format('SELECT count(*) as cnt FROM %I.%I', table_schema, table_name), 
                      false, true, '') as xml_count
  FROM information_schema.tables
  WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
) t
ORDER BY table_name;
```

## Docker Command to Run Query

```bash
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts -c "SELECT table_name, (xpath('/row/cnt/text()', xml_count))[1]::text::int as row_count FROM (SELECT table_name, table_schema, query_to_xml(format('SELECT count(*) as cnt FROM %I.%I', table_schema, table_name), false, true, '') as xml_count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') t ORDER BY table_name;"
```