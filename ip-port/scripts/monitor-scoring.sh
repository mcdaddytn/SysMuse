#!/bin/bash
# Monitor scoring job progress and rate limits

echo "=== Scoring Job Monitor ==="
echo "Time: $(date)"
echo ""

# Count running jobs
JOBS=$(ps aux | grep -E "curl.*score-sector" | grep -v grep | wc -l | tr -d ' ')
echo "Running jobs: $JOBS"
echo ""

# List running jobs
echo "Active sectors:"
ps aux | grep -E "curl.*score-sector" | grep -v grep | awk '{print $NF}' | sed 's/.*score-sector\//  /' | sed 's/?.*//'
echo ""

# Check for rate limit errors in recent logs
echo "Rate limit check (last 100 lines of logs):"
RATE_ERRORS=$(find logs -name "*.log" -mmin -30 2>/dev/null | xargs grep -l -i "rate\|429\|too many" 2>/dev/null | wc -l | tr -d ' ')
if [ "$RATE_ERRORS" -gt 0 ]; then
    echo "  WARNING: Found rate limit errors in $RATE_ERRORS log files"
    find logs -name "*.log" -mmin -30 2>/dev/null | xargs grep -i "rate\|429" 2>/dev/null | tail -5
else
    echo "  No rate limit issues detected"
fi
echo ""

# Get scoring progress from database
echo "Scoring Progress:"
docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio -t -c "
SELECT
  sup.name as super_sector,
  sec.name as sector,
  COUNT(DISTINCT ps.patent_id) as scored,
  sec.patent_count as total,
  ROUND(100.0 * COUNT(DISTINCT ps.patent_id) / NULLIF(sec.patent_count, 0), 1) as pct
FROM sectors sec
JOIN super_sectors sup ON sec.super_sector_id = sup.id
LEFT JOIN sub_sectors ss ON ss.sector_id = sec.id
LEFT JOIN patent_sub_sector_scores ps ON ps.sub_sector_id = ss.id
WHERE sup.name IN ('IMAGING', 'AI_ML', 'VIDEO_STREAMING', 'COMPUTING')
GROUP BY sup.name, sec.name, sec.patent_count
ORDER BY sup.name, pct DESC;
" 2>/dev/null

echo ""
echo "=== End Monitor ==="
