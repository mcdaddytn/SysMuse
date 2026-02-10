#!/bin/bash
# Export high unique_value (dark horse) patents
# Usage: ./scripts/export-dark-horse.sh [min_score] [format]
# Examples:
#   ./scripts/export-dark-horse.sh           # Score >= 8, CSV format
#   ./scripts/export-dark-horse.sh 7 json    # Score >= 7, JSON format

MIN_SCORE=${1:-8}
FORMAT=${2:-"csv"}
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_DIR="/Users/gmcaveney/Documents/dev/SysMuse/ip-port/exports"

mkdir -p "$OUTPUT_DIR"

PSQL="docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio"

FILENAME="dark_horse_score${MIN_SCORE}_${TIMESTAMP}"

if [ "$FORMAT" = "json" ]; then
    $PSQL -t -c "
    SELECT json_agg(row_to_json(t))
    FROM (
        SELECT
            pss.patent_id,
            s.name as sector,
            ss.name as super_sector,
            pss.composite_score,
            (pss.metrics->'unique_value'->>'score')::int as dark_horse_score,
            pss.metrics->'unique_value'->>'reasoning' as dark_horse_reasoning,
            pss.metrics->'unique_value'->>'confidence' as dark_horse_confidence,
            (pss.metrics->'technical_novelty'->>'score')::int as technical_novelty,
            (pss.metrics->'market_relevance'->>'score')::int as market_relevance,
            (pss.metrics->'claim_breadth'->>'score')::int as claim_breadth,
            pss.executed_at
        FROM patent_sub_sector_scores pss
        JOIN sub_sectors sub ON pss.sub_sector_id = sub.id
        JOIN sectors s ON sub.sector_id = s.id
        JOIN super_sectors ss ON s.super_sector_id = ss.id
        WHERE (pss.metrics->'unique_value'->>'score')::int >= $MIN_SCORE
        ORDER BY (pss.metrics->'unique_value'->>'score')::int DESC, pss.composite_score DESC
    ) t;
    " > "$OUTPUT_DIR/${FILENAME}.json"
    echo "Exported to $OUTPUT_DIR/${FILENAME}.json"
else
    $PSQL -c "
    COPY (
        SELECT
            pss.patent_id,
            s.name as sector,
            ss.name as super_sector,
            pss.composite_score,
            (pss.metrics->'unique_value'->>'score')::int as dark_horse_score,
            (pss.metrics->'technical_novelty'->>'score')::int as technical_novelty,
            (pss.metrics->'market_relevance'->>'score')::int as market_relevance,
            (pss.metrics->'claim_breadth'->>'score')::int as claim_breadth,
            pss.metrics->'unique_value'->>'reasoning' as dark_horse_reasoning
        FROM patent_sub_sector_scores pss
        JOIN sub_sectors sub ON pss.sub_sector_id = sub.id
        JOIN sectors s ON sub.sector_id = s.id
        JOIN super_sectors ss ON s.super_sector_id = ss.id
        WHERE (pss.metrics->'unique_value'->>'score')::int >= $MIN_SCORE
        ORDER BY (pss.metrics->'unique_value'->>'score')::int DESC, pss.composite_score DESC
    ) TO STDOUT WITH CSV HEADER;
    " > "$OUTPUT_DIR/${FILENAME}.csv"
    echo "Exported to $OUTPUT_DIR/${FILENAME}.csv"
fi

# Summary
echo ""
echo "Dark Horse Summary (unique_value >= $MIN_SCORE):"
$PSQL -c "
SELECT
    ss.name as super_sector,
    COUNT(*) as dark_horse_count,
    ROUND(AVG(pss.composite_score)::numeric, 2) as avg_composite
FROM patent_sub_sector_scores pss
JOIN sub_sectors sub ON pss.sub_sector_id = sub.id
JOIN sectors s ON sub.sector_id = s.id
JOIN super_sectors ss ON s.super_sector_id = ss.id
WHERE (pss.metrics->'unique_value'->>'score')::int >= $MIN_SCORE
GROUP BY ss.name
ORDER BY dark_horse_count DESC;
"
