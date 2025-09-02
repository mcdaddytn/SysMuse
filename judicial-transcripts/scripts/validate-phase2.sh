#!/bin/bash
# Comprehensive Phase 2 Validation Script
# Usage: ./validate-phase2.sh <trial_id>

TRIAL_ID=${1:-1}

echo "=========================================="
echo "Phase 2 Validation Report for Trial $TRIAL_ID"
echo "=========================================="
echo ""

# 1. Witness Detection Validation
echo "1. WITNESS DETECTION ANALYSIS"
echo "------------------------------"
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts -t <<EOF
WITH phase1_witnesses AS (
  SELECT COUNT(DISTINCT l.text) as potential_witnesses
  FROM "Line" l
  JOIN "Page" p ON l."pageId" = p.id
  JOIN "Session" s ON p."sessionId" = s.id
  WHERE s."trialId" = $TRIAL_ID
    AND l.text LIKE '%WITNESS%'
    AND (l.text LIKE '%PLAINTIFF%' OR l.text LIKE '%DEFENDANT%' OR l.text LIKE '%DEFENSE%')
    AND l.text NOT LIKE '%THE WITNESS%'
),
phase2_witnesses AS (
  SELECT 
    COUNT(DISTINCT w.id) as detected_witnesses,
    COUNT(DISTINCT e.id) as witness_events
  FROM "Witness" w
  LEFT JOIN "TrialEvent" e ON e."trialId" = w."trialId" 
    AND e."eventType" = 'WITNESS_CALLED'
  WHERE w."trialId" = $TRIAL_ID
)
SELECT 
  'Phase 1 Potential: ' || p1.potential_witnesses || E'\n' ||
  'Phase 2 Detected: ' || p2.detected_witnesses || E'\n' ||
  'Witness Events: ' || p2.witness_events || E'\n' ||
  'Detection Rate: ' || ROUND(100.0 * p2.detected_witnesses / NULLIF(p1.potential_witnesses, 0), 1) || '%'
FROM phase1_witnesses p1, phase2_witnesses p2;
EOF

echo ""
echo "Examination Type Distribution:"
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts -t <<EOF
SELECT 
  w.name || ' (' || w."witnessCaller" || ')' || E'\n' ||
  '  Direct: ' || COUNT(CASE WHEN e."rawText" LIKE '%DIRECT%' THEN 1 END) ||
  ', Cross: ' || COUNT(CASE WHEN e."rawText" LIKE '%CROSS%' AND e."rawText" NOT LIKE '%RECROSS%' THEN 1 END) ||
  ', Redirect: ' || COUNT(CASE WHEN e."rawText" LIKE '%REDIRECT%' THEN 1 END) ||
  ', Recross: ' || COUNT(CASE WHEN e."rawText" LIKE '%RECROSS%' THEN 1 END)
FROM "Witness" w
LEFT JOIN "TrialEvent" e ON e."trialId" = w."trialId" 
  AND e."eventType" = 'WITNESS_CALLED'
  AND e."rawText" LIKE '%' || w.name || '%'
WHERE w."trialId" = $TRIAL_ID
GROUP BY w.id, w.name, w."witnessCaller"
ORDER BY w.id
LIMIT 10;
EOF

echo ""
echo "2. STATEMENT EVENT STATISTICS"
echo "------------------------------"
echo "Overall Statistics:"
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts -t <<EOF
WITH all_statements AS (
  SELECT e."lineCount" as line_count
  FROM "TrialEvent" e
  WHERE e."trialId" = $TRIAL_ID 
    AND e."eventType" = 'STATEMENT' 
    AND e."lineCount" IS NOT NULL
)
SELECT 
  'Total Statements: ' || COUNT(*) || E'\n' ||
  'Total Lines: ' || SUM(line_count) || E'\n' ||
  'Mean Lines: ' || ROUND(AVG(line_count), 2) || E'\n' ||
  'Median Lines: ' || PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY line_count) || E'\n' ||
  'Mode Lines: ' || MODE() WITHIN GROUP (ORDER BY line_count) || E'\n' ||
  'Range: ' || MIN(line_count) || '-' || MAX(line_count) || E'\n' ||
  'Q1-Q3 (IQR): ' || PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY line_count) || '-' || 
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY line_count) || E'\n' ||
  'Std Dev: ' || ROUND(STDDEV(line_count), 2)
FROM all_statements;
EOF

echo ""
echo "By Speaker Type:"
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts <<EOF
SELECT 
  s."speakerType" as "Type",
  COUNT(*) as "Stmts",
  ROUND(AVG(e."lineCount"), 2) as "Mean",
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY e."lineCount") as "Median",
  MODE() WITHIN GROUP (ORDER BY e."lineCount") as "Mode",
  MIN(e."lineCount") as "Min",
  MAX(e."lineCount") as "Max",
  ROUND(STDDEV(e."lineCount"), 2) as "StdDev"
FROM "TrialEvent" e
JOIN "StatementEvent" se ON se."eventId" = e.id
JOIN "Speaker" s ON s.id = se."speakerId"
WHERE e."trialId" = $TRIAL_ID 
  AND e."eventType" = 'STATEMENT'
GROUP BY s."speakerType"
ORDER BY AVG(e."lineCount") DESC;
EOF

echo ""
echo "Top 5 Longest Statements (Potential Opening/Closing):"
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts -t <<EOF
SELECT 
  s."speakerPrefix" || ': ' || e."lineCount" || ' lines'
FROM "TrialEvent" e
JOIN "StatementEvent" se ON se."eventId" = e.id
JOIN "Speaker" s ON s.id = se."speakerId"
WHERE e."trialId" = $TRIAL_ID 
  AND e."eventType" = 'STATEMENT'
ORDER BY e."lineCount" DESC
LIMIT 5;
EOF

echo ""
echo "3. COURT DIRECTIVE PATTERNS"
echo "----------------------------"
echo "Directive Type Frequency:"
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts <<EOF
SELECT 
  LEFT(e."rawText", 50) as "Directive",
  COUNT(*) as "Count"
FROM "TrialEvent" e
WHERE e."trialId" = $TRIAL_ID 
  AND e."eventType" = 'COURT_DIRECTIVE'
GROUP BY e."rawText"
ORDER BY COUNT(*) DESC
LIMIT 10;
EOF

echo ""
echo "New Directives Found (not in DirectiveType table):"
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts -t <<EOF
WITH found_directives AS (
  SELECT DISTINCT 
    TRIM(REPLACE(REPLACE(e."rawText", '(', ''), ')', '')) as directive
  FROM "TrialEvent" e
  WHERE e."trialId" = $TRIAL_ID 
    AND e."eventType" = 'COURT_DIRECTIVE'
)
SELECT 
  '• ' || f.directive
FROM found_directives f
WHERE LOWER(f.directive) NOT IN (
  SELECT LOWER(name) FROM "DirectiveType"
)
LIMIT 10;
EOF

echo ""
echo "4. DATA QUALITY CHECKS"
echo "----------------------"
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts -t <<EOF
WITH quality_checks AS (
  SELECT 
    (SELECT COUNT(*) FROM "TrialEvent" WHERE "trialId" = $TRIAL_ID AND "speakerId" IS NULL AND "eventType" = 'STATEMENT') as orphan_statements,
    (SELECT COUNT(*) FROM "Witness" w1 JOIN "Witness" w2 ON w1."trialId" = w2."trialId" AND w1.id < w2.id AND LOWER(w1.name) = LOWER(w2.name) WHERE w1."trialId" = $TRIAL_ID) as duplicate_witnesses,
    (SELECT COUNT(*) FROM "TrialEvent" WHERE "trialId" = $TRIAL_ID AND "lineCount" = 0) as zero_line_events,
    (SELECT COUNT(*) FROM "TrialEvent" WHERE "trialId" = $TRIAL_ID AND "lineCount" > 100) as very_long_statements
)
SELECT 
  'Orphan Statements (no speaker): ' || orphan_statements || E'\n' ||
  'Duplicate Witnesses: ' || duplicate_witnesses || E'\n' ||
  'Zero-line Events: ' || zero_line_events || E'\n' ||
  'Very Long Statements (>100 lines): ' || very_long_statements
FROM quality_checks;
EOF

echo ""
echo "5. OUTLIER ANALYSIS"
echo "-------------------"
echo "Statistical Outliers (High):"
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts -t <<EOF
WITH statement_lines AS (
  SELECT 
    s."speakerType",
    s."speakerPrefix",
    e."lineCount"
  FROM "TrialEvent" e
  JOIN "StatementEvent" se ON se."eventId" = e.id
  JOIN "Speaker" s ON s.id = se."speakerId"
  WHERE e."trialId" = $TRIAL_ID 
    AND e."eventType" = 'STATEMENT'
),
quartiles AS (
  SELECT 
    "speakerType",
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY "lineCount") as q1,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY "lineCount") as q3
  FROM statement_lines
  GROUP BY "speakerType"
)
SELECT 
  sl."speakerPrefix" || ' (' || sl."speakerType" || '): ' || sl."lineCount" || ' lines'
FROM statement_lines sl
JOIN quartiles q ON sl."speakerType" = q."speakerType"
WHERE sl."lineCount" > (q.q3 + 1.5 * (q.q3 - q.q1))
ORDER BY sl."lineCount" DESC
LIMIT 5;
EOF

echo ""
echo "=========================================="
echo "Validation Complete"
echo "=========================================="