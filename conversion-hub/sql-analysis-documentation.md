# SQL Boolean Aggregation Analysis

## Overview

The SQL Boolean Aggregation Analysis feature performs nested aggregation queries on boolean fields in your exported data. This allows you to discover interesting patterns and relationships in your boolean data by creating hierarchical subsets based on field combinations.

## How It Works

The analysis works by:

1. **Identifying Boolean Fields**: Automatically detects boolean fields (or binary 0/1 fields) in your exported SQL table
2. **Depth 0 Analysis**: Performs initial aggregation counting occurrences of each boolean field
3. **Nested Drilling**: For each field with counts above a threshold, creates sub-aggregations with that field constrained to `true`
4. **Recursive Analysis**: Continues drilling down through multiple levels based on configuration parameters

## Configuration

### System Configuration (sysconfig.json)

Add the following section to your `sysconfig.json`:

```json
{
  "sqlAnalysis": {
    "booleanAggregation": true,
    "maxDepth": 3,
    "subsetThreshold": 500,
    "maxAggregateRecords": 200
  }
}
```

### Parameters

- **booleanAggregation**: Enable/disable the analysis
- **maxDepth**: Maximum depth levels to drill down (default: 1)
- **subsetThreshold**: Minimum count required to drill down further (default: 500)
- **maxAggregateRecords**: Maximum total number of result records (default: 200)

### Application Properties

You can also configure via `application.properties`:

```properties
sql.aggregation.enabled=true
sql.aggregation.maxDepth=3
sql.aggregation.subsetThreshold=500
sql.aggregation.maxAggregateRecords=200
```

## Usage

### Integrated with ConversionHub

When SQL export is enabled, the analysis will run automatically after export if configured:

```bash
java -jar conversion-hub.jar input.csv
```

### Standalone Analysis

Run analysis on existing exported data:

```bash
java -cp conversion-hub.jar com.sysmuse.util.SqlAggregationAnalysisRunner [maxDepth] [subsetThreshold] [maxAggregateRecords]
```

Example:
```bash
java -cp conversion-hub.jar com.sysmuse.util.SqlAggregationAnalysisRunner 3 500 200
```

## Output

The analysis generates a CSV file named `{tableName}_nested_aggregation.csv` containing:

### Columns

- **Depth**: The nesting level (0, 1, 2, etc.)
- **TotalCount**: Total records matching the constraints
- **Constraint_{FieldName}**: Shows which fields are constrained (1=true, 0=false, empty=no constraint)
- **Sum_{FieldName}**: Aggregated counts for each boolean field (empty for constrained fields)

### Example Output

```csv
Depth,TotalCount,Constraint_Spam,Constraint_Newsletter,Sum_Spam,Sum_Newsletter,Sum_Promotional
0,10000,,,1170,1175,66
1,3276,,1,1170,1175,66
1,1175,1,,170,,45
2,150,1,1,,,20
```

This shows:
- Depth 0: Overall counts across all 10,000 records
- Depth 1: 3,276 records where Newsletter=true, 1,175 records where Spam=true
- Depth 2: 150 records where both Spam=true AND Newsletter=true

## Example Queries Generated

The tool generates queries like:

**Depth 0 (No constraints):**
```sql
SELECT SUM(Spam) AS Spam, SUM(Newsletter) AS Newsletter, SUM(Promotional) AS Promotional 
FROM exported_data;
```

**Depth 1 (Newsletter = true):**
```sql
SELECT SUM(Spam) AS Spam, NULL AS Newsletter, SUM(Promotional) AS Promotional 
FROM exported_data 
WHERE Newsletter = 1 
GROUP BY Newsletter;
```

**Depth 2 (Newsletter = true AND Spam = true):**
```sql
SELECT NULL AS Spam, NULL AS Newsletter, SUM(Promotional) AS Promotional 
FROM exported_data 
WHERE Newsletter = 1 AND Spam = 1 
GROUP BY Newsletter, Spam;
```

## Use Cases

This analysis is particularly useful for:

1. **Pattern Discovery**: Finding common combinations of boolean flags
2. **Data Quality Analysis**: Identifying unexpected relationships between fields
3. **Segmentation**: Understanding how different boolean criteria overlap
4. **Reporting**: Creating hierarchical views of categorical data

## Performance Considerations

- Analysis time depends on table size and number of boolean fields
- Use appropriate `subsetThreshold` to limit deep drilling on small subsets
- Monitor `maxAggregateRecords` to prevent excessive output
- Consider indexing boolean fields for better performance

## Troubleshooting

### Common Issues

1. **No Boolean Fields Found**: 
   - Check if fields are properly typed as BOOLEAN/TINYINT(1)
   - The tool will attempt to detect binary 0/1 fields automatically

2. **Analysis Takes Too Long**:
   - Reduce `maxDepth` parameter
   - Increase `subsetThreshold`
   - Reduce `maxAggregateRecords`

3. **Connection Issues**:
   - Verify database connection properties
   - Ensure the exported table exists
   - Check schema/table name configuration