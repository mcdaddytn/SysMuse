#!/bin/bash
# Analyze scored patent data for quality and insights
# Usage: ./scripts/analyze-scored-patents.sh [analysis_type]
# Examples:
#   ./scripts/analyze-scored-patents.sh summary          # Overall summary
#   ./scripts/analyze-scored-patents.sh dark-horse       # High unique_value patents
#   ./scripts/analyze-scored-patents.sh outliers         # Score distribution anomalies
#   ./scripts/analyze-scored-patents.sh hallucination    # Check for potential hallucinations

ANALYSIS=${1:-"summary"}
PSQL="docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio"

case $ANALYSIS in
    summary)
        echo "=== SCORING SUMMARY ==="
        $PSQL -c "
        SELECT
            ss.name as super_sector,
            s.name as sector,
            s.patent_count as total_patents,
            COUNT(pss.id) as scored,
            s.patent_count - COUNT(pss.id) as remaining,
            ROUND(100.0 * COUNT(pss.id) / NULLIF(s.patent_count, 0), 1) as pct_complete
        FROM sectors s
        JOIN super_sectors ss ON s.super_sector_id = ss.id
        LEFT JOIN sub_sectors sub ON sub.sector_id = s.id
        LEFT JOIN patent_sub_sector_scores pss ON pss.sub_sector_id = sub.id
        WHERE ss.name IN ('WIRELESS', 'SECURITY', 'VIDEO_STREAMING')
        GROUP BY ss.name, s.name, s.patent_count
        ORDER BY ss.name, s.patent_count DESC;
        "
        ;;

    dark-horse)
        echo "=== HIGH UNIQUE_VALUE (DARK HORSE) PATENTS ==="
        $PSQL -c "
        SELECT
            pss.patent_id,
            s.name as sector,
            pss.composite_score,
            (pss.metrics->'unique_value'->>'score')::int as dark_horse_score,
            LEFT(pss.metrics->'unique_value'->>'reasoning', 400) as insight
        FROM patent_sub_sector_scores pss
        JOIN sub_sectors sub ON pss.sub_sector_id = sub.id
        JOIN sectors s ON sub.sector_id = s.id
        WHERE (pss.metrics->'unique_value'->>'score')::int >= 8
        ORDER BY (pss.metrics->'unique_value'->>'score')::int DESC, pss.composite_score DESC
        LIMIT 25;
        "
        ;;

    outliers)
        echo "=== SCORE DISTRIBUTION ANALYSIS ==="
        echo ""
        echo "Score distribution by super-sector:"
        $PSQL -c "
        SELECT
            ss.name as super_sector,
            COUNT(*) as count,
            ROUND(AVG(pss.composite_score)::numeric, 2) as avg,
            ROUND(STDDEV(pss.composite_score)::numeric, 2) as stddev,
            ROUND(MIN(pss.composite_score)::numeric, 2) as min,
            ROUND(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY pss.composite_score)::numeric, 2) as p25,
            ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY pss.composite_score)::numeric, 2) as median,
            ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY pss.composite_score)::numeric, 2) as p75,
            ROUND(MAX(pss.composite_score)::numeric, 2) as max
        FROM patent_sub_sector_scores pss
        JOIN sub_sectors sub ON pss.sub_sector_id = sub.id
        JOIN sectors s ON sub.sector_id = s.id
        JOIN super_sectors ss ON s.super_sector_id = ss.id
        GROUP BY ss.name
        ORDER BY count DESC;
        "

        echo ""
        echo "Potential outliers (very high or low scores):"
        $PSQL -c "
        SELECT
            pss.patent_id,
            s.name as sector,
            pss.composite_score,
            CASE
                WHEN pss.composite_score > 70 THEN 'HIGH'
                WHEN pss.composite_score < 30 THEN 'LOW'
            END as outlier_type
        FROM patent_sub_sector_scores pss
        JOIN sub_sectors sub ON pss.sub_sector_id = sub.id
        JOIN sectors s ON sub.sector_id = s.id
        WHERE pss.composite_score > 70 OR pss.composite_score < 30
        ORDER BY pss.composite_score DESC
        LIMIT 20;
        "
        ;;

    hallucination)
        echo "=== POTENTIAL HALLUCINATION CHECK ==="
        echo ""
        echo "Patents with very high confidence on all metrics (potential overconfidence):"
        $PSQL -c "
        SELECT
            pss.patent_id,
            s.name as sector,
            pss.composite_score,
            (pss.metrics->'technical_novelty'->>'confidence')::float as tech_conf,
            (pss.metrics->'claim_breadth'->>'confidence')::float as claim_conf,
            (pss.metrics->'market_relevance'->>'confidence')::float as market_conf
        FROM patent_sub_sector_scores pss
        JOIN sub_sectors sub ON pss.sub_sector_id = sub.id
        JOIN sectors s ON sub.sector_id = s.id
        WHERE
            (pss.metrics->'technical_novelty'->>'confidence')::float >= 1.0
            AND (pss.metrics->'claim_breadth'->>'confidence')::float >= 1.0
            AND (pss.metrics->'market_relevance'->>'confidence')::float >= 1.0
        ORDER BY pss.composite_score DESC
        LIMIT 10;
        "

        echo ""
        echo "Patents with extreme score variance across metrics (possible inconsistency):"
        $PSQL -c "
        SELECT
            pss.patent_id,
            s.name as sector,
            pss.composite_score,
            (pss.metrics->'technical_novelty'->>'score')::int as novelty,
            (pss.metrics->'claim_breadth'->>'score')::int as claims,
            (pss.metrics->'market_relevance'->>'score')::int as market,
            (pss.metrics->'unique_value'->>'score')::int as unique_val
        FROM patent_sub_sector_scores pss
        JOIN sub_sectors sub ON pss.sub_sector_id = sub.id
        JOIN sectors s ON sub.sector_id = s.id
        WHERE (
            ABS((pss.metrics->'technical_novelty'->>'score')::int - (pss.metrics->'claim_breadth'->>'score')::int) > 5
            OR ABS((pss.metrics->'market_relevance'->>'score')::int - (pss.metrics->'unique_value'->>'score')::int) > 5
        )
        ORDER BY pss.composite_score DESC
        LIMIT 15;
        "

        echo ""
        echo "Checking for suspiciously generic reasoning patterns:"
        $PSQL -c "
        SELECT
            COUNT(*) as generic_count,
            'Contains generic filler language' as pattern
        FROM patent_sub_sector_scores pss
        WHERE
            pss.metrics->'technical_novelty'->>'reasoning' ILIKE '%patent covers%important%'
            OR pss.metrics->'market_relevance'->>'reasoning' ILIKE '%highly relevant%'
            OR pss.metrics->'unique_value'->>'reasoning' ILIKE '%unique value lies%';
        "
        ;;

    themes)
        echo "=== EMERGING THEMES FROM UNIQUE_VALUE ==="
        echo ""
        echo "Common themes in dark horse reasoning (top keywords):"
        $PSQL -c "
        SELECT
            s.name as sector,
            COUNT(*) FILTER (WHERE pss.metrics->'unique_value'->>'reasoning' ILIKE '%cloud%') as cloud_mentions,
            COUNT(*) FILTER (WHERE pss.metrics->'unique_value'->>'reasoning' ILIKE '%AI%' OR pss.metrics->'unique_value'->>'reasoning' ILIKE '%machine learning%') as ai_ml_mentions,
            COUNT(*) FILTER (WHERE pss.metrics->'unique_value'->>'reasoning' ILIKE '%5G%') as fiveG_mentions,
            COUNT(*) FILTER (WHERE pss.metrics->'unique_value'->>'reasoning' ILIKE '%IoT%') as iot_mentions,
            COUNT(*) FILTER (WHERE pss.metrics->'unique_value'->>'reasoning' ILIKE '%standard%essential%') as standards_essential,
            COUNT(*) FILTER (WHERE pss.metrics->'unique_value'->>'reasoning' ILIKE '%blockchain%') as blockchain_mentions
        FROM patent_sub_sector_scores pss
        JOIN sub_sectors sub ON pss.sub_sector_id = sub.id
        JOIN sectors s ON sub.sector_id = s.id
        GROUP BY s.name
        HAVING COUNT(*) > 50
        ORDER BY cloud_mentions DESC;
        "
        ;;

    *)
        echo "Usage: $0 [summary|dark-horse|outliers|hallucination|themes]"
        ;;
esac
