#!/bin/bash
# Export patents needing XML claims data in USPTO bulk download format
# Usage: ./export-patents-needing-xml.sh [sector]
#
# Output format: Patent ID,Grant Date
# Use this CSV to fetch XML from USPTO bulk repository

SECTOR=$1
OUTPUT_DIR="exports/missing-claims"
mkdir -p $OUTPUT_DIR

echo "============================================================"
echo "Patents Needing XML Claims Data"
echo "============================================================"

if [ -n "$SECTOR" ]; then
  echo "Sector filter: $SECTOR"
  WHERE_CLAUSE="WHERE pss.template_config_id = '$SECTOR'"
  OUTPUT_FILE="$OUTPUT_DIR/${SECTOR}-needs-xml.csv"
else
  WHERE_CLAUSE=""
  OUTPUT_FILE="$OUTPUT_DIR/all-needs-xml.csv"
fi

# Get patents scored without claims, with grant date from cache
# Note: Grant date comes from PatentsView API cache
docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio -t -A -F',' -c "
SELECT DISTINCT pss.patent_id
FROM patent_sub_sector_scores pss
WHERE pss.with_claims = false
ORDER BY pss.patent_id;
" > /tmp/patents-without-claims.txt

# Create header
echo "Patent ID,Grant Date" > "$OUTPUT_FILE"

# For each patent, try to get grant date from cache
while read -r PATENT_ID; do
  if [ -z "$PATENT_ID" ]; then continue; fi

  CACHE_FILE="cache/api/patentsview/patent/${PATENT_ID}.json"
  if [ -f "$CACHE_FILE" ]; then
    # Extract grant date from cache (format: YYYY-MM-DD -> M/D/YYYY)
    GRANT_DATE=$(jq -r '.patent_date // empty' "$CACHE_FILE" 2>/dev/null)
    if [ -n "$GRANT_DATE" ] && [ "$GRANT_DATE" != "null" ]; then
      # Convert YYYY-MM-DD to M/D/YYYY
      FORMATTED=$(date -j -f "%Y-%m-%d" "$GRANT_DATE" "+%-m/%-d/%Y" 2>/dev/null || echo "$GRANT_DATE")
      echo "${PATENT_ID},${FORMATTED}" >> "$OUTPUT_FILE"
    else
      echo "${PATENT_ID}," >> "$OUTPUT_FILE"
    fi
  else
    echo "${PATENT_ID}," >> "$OUTPUT_FILE"
  fi
done < /tmp/patents-without-claims.txt

TOTAL=$(tail -n +2 "$OUTPUT_FILE" | wc -l | tr -d ' ')

echo ""
echo "Summary by sector:"
docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio -c "
SELECT
  template_config_id as sector,
  COUNT(*) as needs_xml
FROM patent_sub_sector_scores
WHERE with_claims = false
GROUP BY template_config_id
ORDER BY COUNT(*) DESC;"

echo ""
echo "Total patents needing XML: $TOTAL"
echo "Exported to: $OUTPUT_FILE"
echo ""
echo "Use this CSV to fetch XML files from USPTO bulk repository."
