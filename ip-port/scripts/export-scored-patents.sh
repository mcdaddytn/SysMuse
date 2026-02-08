#!/bin/bash
# Export scored patent data with all structured question answers
# Usage: ./scripts/export-scored-patents.sh [sector_name] [output_format]
# Examples:
#   ./scripts/export-scored-patents.sh                     # Export all to CSV
#   ./scripts/export-scored-patents.sh video-codec         # Export single sector
#   ./scripts/export-scored-patents.sh all json            # Export all as JSON

SECTOR=${1:-"all"}
FORMAT=${2:-"csv"}
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_DIR="/Users/gmcaveney/Documents/dev/SysMuse/ip-port/exports"

mkdir -p "$OUTPUT_DIR"

# PostgreSQL connection
PSQL="docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio"

if [ "$SECTOR" = "all" ]; then
    WHERE_CLAUSE=""
    FILENAME="all_scored_patents_${TIMESTAMP}"
else
    WHERE_CLAUSE="WHERE pss.template_config_id = '$SECTOR' OR (pss.template_config_id IS NULL AND s.name = '$SECTOR')"
    FILENAME="${SECTOR}_scored_${TIMESTAMP}"
fi

if [ "$FORMAT" = "json" ]; then
    # JSON export - full metrics as JSON
    $PSQL -t -c "
    SELECT json_agg(row_to_json(t))
    FROM (
        SELECT
            pss.patent_id,
            s.name as sector,
            ss.name as super_sector,
            pss.template_config_id,
            pss.composite_score,
            pss.executed_at,
            pss.metrics
        FROM patent_sub_sector_scores pss
        JOIN sub_sectors sub ON pss.sub_sector_id = sub.id
        JOIN sectors s ON sub.sector_id = s.id
        JOIN super_sectors ssc ON s.super_sector_id = ssc.id
        JOIN super_sectors ss ON s.super_sector_id = ss.id
        $WHERE_CLAUSE
        ORDER BY pss.composite_score DESC
    ) t;
    " > "$OUTPUT_DIR/${FILENAME}.json"
    echo "Exported to $OUTPUT_DIR/${FILENAME}.json"
else
    # CSV export - flattened metrics
    $PSQL -c "
    COPY (
        SELECT
            pss.patent_id,
            s.name as sector,
            ss.name as super_sector,
            pss.template_config_id,
            pss.composite_score,
            pss.executed_at,
            -- Base questions
            (pss.metrics->'technical_novelty'->>'score')::int as technical_novelty,
            (pss.metrics->'claim_breadth'->>'score')::int as claim_breadth,
            (pss.metrics->'market_relevance'->>'score')::int as market_relevance,
            (pss.metrics->'unique_value'->>'score')::int as unique_value,
            (pss.metrics->'design_around_difficulty'->>'score')::int as design_around,
            (pss.metrics->'implementation_clarity'->>'score')::int as implementation_clarity,
            (pss.metrics->'standards_relevance'->>'score')::int as standards_relevance,
            -- VIDEO_STREAMING super-sector
            (pss.metrics->'streaming_protocol'->>'score')::int as streaming_protocol,
            (pss.metrics->'codec_compression'->>'score')::int as codec_compression,
            (pss.metrics->'delivery_scalability'->>'score')::int as delivery_scalability,
            (pss.metrics->'user_experience'->>'score')::int as user_experience,
            -- WIRELESS super-sector
            (pss.metrics->'spectrum_value'->>'score')::int as spectrum_value,
            (pss.metrics->'interference_handling'->>'score')::int as interference_handling,
            (pss.metrics->'link_budget_impact'->>'score')::int as link_budget_impact,
            (pss.metrics->'technology_generation'->>'score')::int as technology_generation,
            -- SECURITY super-sector
            (pss.metrics->'defense_posture'->>'score')::int as defense_posture,
            (pss.metrics->'security_layer'->>'score')::int as security_layer,
            (pss.metrics->'threat_sophistication'->>'score')::int as threat_sophistication,
            (pss.metrics->'deployment_context'->>'score')::int as deployment_context,
            -- Dark horse reasoning
            LEFT(pss.metrics->'unique_value'->>'reasoning', 500) as unique_value_reasoning
        FROM patent_sub_sector_scores pss
        JOIN sub_sectors sub ON pss.sub_sector_id = sub.id
        JOIN sectors s ON sub.sector_id = s.id
        JOIN super_sectors ss ON s.super_sector_id = ss.id
        $WHERE_CLAUSE
        ORDER BY pss.composite_score DESC
    ) TO STDOUT WITH CSV HEADER;
    " > "$OUTPUT_DIR/${FILENAME}.csv"
    echo "Exported to $OUTPUT_DIR/${FILENAME}.csv"
fi

# Show summary
echo ""
echo "Export Summary:"
$PSQL -c "
SELECT
    COALESCE(pss.template_config_id, 'early-scoring') as template,
    COUNT(*) as count,
    ROUND(AVG(pss.composite_score)::numeric, 2) as avg_score,
    ROUND(MIN(pss.composite_score)::numeric, 2) as min_score,
    ROUND(MAX(pss.composite_score)::numeric, 2) as max_score
FROM patent_sub_sector_scores pss
JOIN sub_sectors sub ON pss.sub_sector_id = sub.id
JOIN sectors s ON sub.sector_id = s.id
$WHERE_CLAUSE
GROUP BY pss.template_config_id
ORDER BY count DESC;
"
