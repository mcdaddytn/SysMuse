#!/bin/bash
# Export patents that were scored without claims
# Usage: ./export-patents-missing-claims.sh [sector]
#
# If sector is specified, only exports that sector
# Otherwise exports all patents scored without claims

SECTOR=$1
OUTPUT_DIR="/tmp/missing-claims"
mkdir -p $OUTPUT_DIR

echo "============================================================"
echo "Patents Scored Without Claims"
echo "============================================================"

if [ -n "$SECTOR" ]; then
  echo "Sector filter: $SECTOR"
  WHERE_CLAUSE="AND template_config_id = '$SECTOR'"
  OUTPUT_FILE="$OUTPUT_DIR/${SECTOR}-scored-without-claims.csv"
else
  WHERE_CLAUSE=""
  OUTPUT_FILE="$OUTPUT_DIR/all-scored-without-claims.csv"
fi

# Query patents scored without claims
docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio -c "
COPY (
  SELECT
    patent_id,
    template_config_id as sector,
    composite_score,
    executed_at
  FROM patent_sub_sector_scores
  WHERE with_claims = false
    $WHERE_CLAUSE
  ORDER BY template_config_id, patent_id
) TO STDOUT WITH CSV HEADER
" > "$OUTPUT_FILE"

# Summary
echo ""
docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio -c "
SELECT
  template_config_id as sector,
  COUNT(*) as scored_without_claims
FROM patent_sub_sector_scores
WHERE with_claims = false
  $WHERE_CLAUSE
GROUP BY template_config_id
ORDER BY template_config_id;"

TOTAL=$(wc -l < "$OUTPUT_FILE")
TOTAL=$((TOTAL - 1))  # Subtract header

echo ""
echo "Total patents scored without claims: $TOTAL"
echo "Exported to: $OUTPUT_FILE"
echo ""
echo "These patents should be rescored once claims are available."
