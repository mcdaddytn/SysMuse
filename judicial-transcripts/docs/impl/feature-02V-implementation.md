# Feature 02V Implementation Guide: Witness Detection and Phase 2 Validation

## Overview
This guide documents the implementation of comprehensive witness detection patterns and validation procedures for Phase 2 processing. It includes testing methodologies, validation queries, and metrics for ensuring data quality.

## Witness Detection Patterns

### Pattern Coverage
The system now detects all variations found in 58 trials (65,003 pages):

#### Side Variations (All Handled)
- `PLAINTIFF'S WITNESS` - 333 instances
- `PLAINTIFFS' WITNESS` - 52 instances  
- `PLAINTIFFS WITNESS` - 3 instances
- `DEFENDANT'S WITNESS` - 186 instances
- `DEFENDANTS' WITNESS` - 140 instances
- `DEFENSE WITNESS` - Alternative term

#### Regex Patterns Implemented
```javascript
// Case-sensitive patterns for structural markers
witnessName: /^([A-Z][A-Z\s,'"\.\-]+?),?\s+(PLAINTIFF'?S?'?|DEFENDANT'?S?'?|DEFENSE)\s+WITNESS(?:ES)?(?:\s|,|$)/
```

## Validation Test Suite

### 1. Witness Count Validation

#### Phase 1 Raw Count Query
```sql
-- Count potential witness events in Phase 1 data
WITH witness_lines AS (
  SELECT 
    t.id as trial_id,
    t."caseNumber",
    COUNT(DISTINCT l.text) as unique_witness_lines,
    COUNT(*) as total_witness_lines
  FROM "Trial" t
  JOIN "Session" s ON s."trialId" = t.id
  JOIN "Page" p ON p."sessionId" = s.id
  JOIN "Line" l ON l."pageId" = p.id
  WHERE l.text LIKE '%WITNESS%' 
    AND (l.text LIKE '%PLAINTIFF%' OR l.text LIKE '%DEFENDANT%' OR l.text LIKE '%DEFENSE%')
    AND l.text NOT LIKE '%THE WITNESS%'
  GROUP BY t.id, t."caseNumber"
)
SELECT * FROM witness_lines WHERE trial_id = $1;
```

#### Phase 2 Event Count Query
```sql
-- Count WitnessCalledEvent records from Phase 2
SELECT 
  t.id as trial_id,
  t."caseNumber",
  COUNT(DISTINCT w.id) as unique_witnesses,
  COUNT(e.id) as witness_events,
  STRING_AGG(DISTINCT w.name, ', ') as witness_names
FROM "Trial" t
LEFT JOIN "Witness" w ON w."trialId" = t.id
LEFT JOIN "TrialEvent" e ON e."trialId" = t.id AND e."eventType" = 'WITNESS_CALLED'
WHERE t.id = $1
GROUP BY t.id, t."caseNumber";
```

#### Examination Type Distribution
```sql
-- Analyze examination types per witness
SELECT 
  w.name,
  w."witnessCaller",
  COUNT(CASE WHEN e.metadata->>'examinationType' = 'DIRECT_EXAMINATION' THEN 1 END) as direct_count,
  COUNT(CASE WHEN e.metadata->>'examinationType' = 'CROSS_EXAMINATION' THEN 1 END) as cross_count,
  COUNT(CASE WHEN e.metadata->>'examinationType' = 'REDIRECT_EXAMINATION' THEN 1 END) as redirect_count,
  COUNT(CASE WHEN e.metadata->>'examinationType' = 'RECROSS_EXAMINATION' THEN 1 END) as recross_count
FROM "Witness" w
JOIN "TrialEvent" e ON e."trialId" = w."trialId" 
  AND e."eventType" = 'WITNESS_CALLED'
  AND e.metadata->>'witnessId' = w.id::text
WHERE w."trialId" = $1
GROUP BY w.id, w.name, w."witnessCaller"
ORDER BY w.id;
```

### 2. Statement Event Validation

#### Lines Per Statement Statistics
```sql
-- Calculate comprehensive statistics for lines per statement by speaker type
WITH statement_lines AS (
  SELECT 
    s."speakerType",
    s."speakerPrefix",
    (e.metadata->>'lineCount')::int as line_count
  FROM "TrialEvent" e
  JOIN "Speaker" s ON s.id = e."speakerId"
  WHERE e."trialId" = $1 
    AND e."eventType" = 'STATEMENT'
),
statement_stats AS (
  SELECT 
    "speakerType",
    "speakerPrefix",
    COUNT(*) as statement_count,
    SUM(line_count) as total_lines,
    ROUND(AVG(line_count), 2) as mean_lines,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY line_count) as median_lines,
    MODE() WITHIN GROUP (ORDER BY line_count) as mode_lines,
    MIN(line_count) as min_lines,
    MAX(line_count) as max_lines,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY line_count) as q1_lines,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY line_count) as q3_lines,
    ROUND(STDDEV(line_count), 2) as std_dev
  FROM statement_lines
  GROUP BY "speakerType", "speakerPrefix"
)
SELECT * FROM statement_stats
ORDER BY mean_lines DESC;
```

#### Overall Trial Statistics
```sql
-- Overall statement statistics for the trial
WITH all_statements AS (
  SELECT (e.metadata->>'lineCount')::int as line_count
  FROM "TrialEvent" e
  WHERE e."trialId" = $1 AND e."eventType" = 'STATEMENT'
)
SELECT 
  COUNT(*) as total_statements,
  SUM(line_count) as total_lines,
  ROUND(AVG(line_count), 2) as mean_lines,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY line_count) as median_lines,
  MODE() WITHIN GROUP (ORDER BY line_count) as mode_lines,
  MIN(line_count) as min_lines,
  MAX(line_count) as max_lines,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY line_count) as q1,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY line_count) as q3,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY line_count) - 
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY line_count) as iqr,
  ROUND(STDDEV(line_count), 2) as std_dev,
  ROUND(VARIANCE(line_count), 2) as variance
FROM all_statements;
```

#### Distribution Analysis
```sql
-- Analyze distribution of statement lengths
WITH line_distribution AS (
  SELECT 
    s."speakerType",
    (e.metadata->>'lineCount')::int as line_count,
    COUNT(*) as frequency
  FROM "TrialEvent" e
  JOIN "Speaker" s ON s.id = e."speakerId"
  WHERE e."trialId" = $1 AND e."eventType" = 'STATEMENT'
  GROUP BY s."speakerType", line_count
)
SELECT 
  "speakerType",
  line_count,
  frequency,
  ROUND(100.0 * frequency / SUM(frequency) OVER (PARTITION BY "speakerType"), 2) as percentage,
  SUM(frequency) OVER (PARTITION BY "speakerType" ORDER BY line_count) as cumulative_freq
FROM line_distribution
ORDER BY "speakerType", line_count;
```

#### Outlier Detection
```sql
-- Identify statistical outliers using IQR method
WITH statement_lines AS (
  SELECT 
    s."speakerType",
    s."speakerPrefix",
    e.id as event_id,
    (e.metadata->>'lineCount')::int as line_count
  FROM "TrialEvent" e
  JOIN "Speaker" s ON s.id = e."speakerId"
  WHERE e."trialId" = $1 AND e."eventType" = 'STATEMENT'
),
quartiles AS (
  SELECT 
    "speakerType",
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY line_count) as q1,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY line_count) as q3
  FROM statement_lines
  GROUP BY "speakerType"
)
SELECT 
  sl."speakerType",
  sl."speakerPrefix",
  sl.line_count,
  CASE 
    WHEN sl.line_count < (q.q1 - 1.5 * (q.q3 - q.q1)) THEN 'LOW_OUTLIER'
    WHEN sl.line_count > (q.q3 + 1.5 * (q.q3 - q.q1)) THEN 'HIGH_OUTLIER'
    ELSE 'NORMAL'
  END as outlier_status
FROM statement_lines sl
JOIN quartiles q ON sl."speakerType" = q."speakerType"
WHERE sl.line_count < (q.q1 - 1.5 * (q.q3 - q.q1))
   OR sl.line_count > (q.q3 + 1.5 * (q.q3 - q.q1))
ORDER BY sl."speakerType", sl.line_count DESC
LIMIT 20;
```

#### Expected Statistical Ranges
- **Overall**: 
  - Mean: 3-4 lines
  - Median: 2-3 lines (typically lower than mean due to right skew)
  - Mode: 1 line (single line responses common)
  
- **Judge (THE COURT)**: 
  - Mean: 5-10 lines
  - Median: 4-7 lines
  - High variance due to instructions vs. brief rulings
  
- **Attorneys (Opening/Closing)**: 
  - Mean: 10-50+ lines
  - Very high variance
  - Strong right skew
  
- **Attorneys (Q&A)**: 
  - Mean: 1-3 lines
  - Median: 1-2 lines
  - Mode: 1 line
  
- **Witnesses (A.)**: 
  - Mean: 2-5 lines
  - Median: 1-3 lines
  - Mode: 1 line
  
- **Anonymous/Clerk**: 
  - Mean: 1-2 lines
  - Low variance

### 3. Court Directive Pattern Discovery

#### Find All Directive Variations
```sql
-- Discover all court directive patterns
SELECT 
  DISTINCT e.metadata->>'directiveText' as directive,
  COUNT(*) as occurrences
FROM "TrialEvent" e
WHERE e."eventType" = 'COURT_DIRECTIVE'
  AND e."trialId" = $1
GROUP BY e.metadata->>'directiveText'
ORDER BY occurrences DESC;
```

#### Expected vs New Directives
```sql
-- Compare against pre-seeded directives
WITH found_directives AS (
  SELECT DISTINCT e.metadata->>'directiveText' as directive
  FROM "TrialEvent" e
  WHERE e."eventType" = 'COURT_DIRECTIVE'
    AND e."trialId" = $1
),
expected_directives AS (
  SELECT name FROM "DirectiveType"
)
SELECT 
  'NEW' as status,
  f.directive
FROM found_directives f
WHERE f.directive NOT IN (SELECT name FROM expected_directives)
UNION ALL
SELECT 
  'EXPECTED' as status,
  e.name as directive
FROM expected_directives e
WHERE e.name IN (SELECT directive FROM found_directives);
```

## Phase 2 Batch Processing Test Protocol

### Test Configuration
```json
{
  "enableElasticSearch": false,
  "logLevel": "info",
  "batchSize": 5
}
```

### Batch Test Trials (Groups of 5)

#### Batch 1: High Witness Count
- Trial 1: Genband (14 witnesses expected)
- Trial 2: Core Wireless (varied patterns)
- Trial 10: Mixed PLAINTIFFS'/DEFENDANTS'
- Trial 55: Heavy PLAINTIFFS' usage
- Trial 31: DEFENDANTS' patterns

#### Batch 2: Pattern Variations
- Trial 20: Mixed apostrophe usage
- Trial 47: PLAINTIFFS pattern
- Trial 21: DEFENDANTS' pattern
- Trial 51: Mixed patterns
- Trial 3: High defendant count

### Validation Script
```bash
#!/bin/bash
# run-phase2-validation.sh

TRIAL_ID=$1

echo "=== Phase 2 Validation for Trial $TRIAL_ID ==="

# Run Phase 2
npx ts-node src/cli/parse.ts parse --phase2 --config config/multi-trial-config-mac.json --trial-id $TRIAL_ID

# Validate witness counts
echo "Comparing Phase 1 vs Phase 2 witness detection..."
psql -h localhost -U judicial_user -d judicial_transcripts <<EOF
-- Phase 1 potential witnesses
WITH p1_witnesses AS (
  SELECT COUNT(DISTINCT l.text) as phase1_count
  FROM "Line" l
  JOIN "Page" p ON l."pageId" = p.id
  JOIN "Session" s ON p."sessionId" = s.id
  WHERE s."trialId" = $TRIAL_ID
    AND l.text LIKE '%WITNESS%'
    AND (l.text LIKE '%PLAINTIFF%' OR l.text LIKE '%DEFENDANT%')
),
-- Phase 2 detected witnesses
p2_witnesses AS (
  SELECT COUNT(*) as phase2_count
  FROM "Witness" 
  WHERE "trialId" = $TRIAL_ID
)
SELECT 
  p1.phase1_count as "Phase 1 Potential",
  p2.phase2_count as "Phase 2 Detected",
  ROUND(100.0 * p2.phase2_count / NULLIF(p1.phase1_count, 0), 1) as "Detection Rate %"
FROM p1_witnesses p1, p2_witnesses p2;
EOF

# Check statement ratios
echo "Analyzing statement event ratios..."
psql -h localhost -U judicial_user -d judicial_transcripts <<EOF
SELECT 
  COUNT(*) as total_statements,
  AVG((metadata->>'lineCount')::int) as avg_lines,
  MIN((metadata->>'lineCount')::int) as min_lines,
  MAX((metadata->>'lineCount')::int) as max_lines
FROM "TrialEvent"
WHERE "trialId" = $TRIAL_ID AND "eventType" = 'STATEMENT';
EOF
```

## Success Metrics

### Witness Detection
- **Target**: 80%+ detection rate from Phase 1 potential witnesses
- **Examination Coverage**: Each witness should have at least DIRECT and CROSS
- **No Duplicates**: Each witness name should appear once in Witness table

### Statement Events
- **Average Lines**: 3-4 lines per statement overall
- **Speaker Distribution**: All major speakers should have statements
- **No Orphans**: All statements should have valid speakerId

### Court Directives
- **Paired Directives**: Opening/closing pairs should match
- **New Discovery**: Document any new directive patterns found
- **Context Preservation**: Directives should maintain session context

## Troubleshooting

### Common Issues

#### Missing Witnesses
1. Check for non-standard apostrophe usage
2. Verify case sensitivity (must be uppercase WITNESS)
3. Look for line-break issues in multi-line patterns

#### Low Statement Counts
1. Verify speaker detection is working
2. Check for Q./A. contextual mapping
3. Ensure BY MR./MS. patterns are handled

#### Directive Mismatches
1. Check parenthetical parsing
2. Verify multi-line directive handling
3. Look for special characters in directive text

## Future Enhancements

### Pattern Abstraction (Feature Request)
- Move all regex patterns to configuration files
- Create pattern testing framework
- Build pattern discovery tools

### Machine Learning Opportunities
- Train model on verified witness patterns
- Predict examination sequences
- Identify speaker changes automatically

### Reporting Enhancements
- Create automated validation reports
- Build pattern coverage dashboards
- Generate trial complexity metrics

## Testing Checklist

- [ ] Run witness count validation for each trial
- [ ] Verify examination type distribution
- [ ] Check statement event ratios
- [ ] Document new court directives found
- [ ] Compare Phase 1 vs Phase 2 metrics
- [ ] Review speaker type distribution
- [ ] Validate no duplicate witnesses
- [ ] Check for orphaned events
- [ ] Document any pattern failures
- [ ] Update pattern documentation

## Appendix: SQL Validation Queries

### Complete Validation Suite
```sql
-- Save as: scripts/validate-phase2.sql

-- 1. Witness validation
\echo 'WITNESS VALIDATION'
SELECT 
  (SELECT COUNT(DISTINCT text) FROM "Line" l 
   JOIN "Page" p ON l."pageId" = p.id 
   JOIN "Session" s ON p."sessionId" = s.id 
   WHERE s."trialId" = :trial_id 
   AND text LIKE '%WITNESS%' 
   AND (text LIKE '%PLAINTIFF%' OR text LIKE '%DEFENDANT%')) as phase1_potential,
  (SELECT COUNT(*) FROM "Witness" WHERE "trialId" = :trial_id) as phase2_detected,
  (SELECT COUNT(*) FROM "TrialEvent" WHERE "trialId" = :trial_id AND "eventType" = 'WITNESS_CALLED') as witness_events;

-- 2. Statement ratios
\echo 'STATEMENT RATIOS BY SPEAKER TYPE'
SELECT 
  s."speakerType",
  COUNT(*) as statements,
  AVG((e.metadata->>'lineCount')::int) as avg_lines
FROM "TrialEvent" e
JOIN "Speaker" s ON s.id = e."speakerId"
WHERE e."trialId" = :trial_id AND e."eventType" = 'STATEMENT'
GROUP BY s."speakerType"
ORDER BY statements DESC;

-- 3. New directives
\echo 'NEW COURT DIRECTIVES DISCOVERED'
SELECT e.metadata->>'directiveText' as new_directive
FROM "TrialEvent" e
WHERE e."eventType" = 'COURT_DIRECTIVE' 
  AND e."trialId" = :trial_id
  AND e.metadata->>'directiveText' NOT IN (SELECT name FROM "DirectiveType");
```

Run with: `psql -v trial_id=1 -f scripts/validate-phase2.sql`