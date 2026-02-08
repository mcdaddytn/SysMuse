#!/bin/bash
# Check claims availability for a sector before scoring
# Usage: ./check-claims-availability.sh <sector-name>
#
# This script checks which patents in a sector have claims XML available
# and outputs a list of patents missing claims.

SECTOR=${1:-"video-storage"}
USPTO_XML_DIR=${USPTO_PATENT_GRANT_XML_DIR:-"/Volumes/PortFat4/uspto/bulkdata/export"}

echo "============================================================"
echo "Claims Availability Check for: $SECTOR"
echo "USPTO XML Directory: $USPTO_XML_DIR"
echo "============================================================"

# Get patent IDs for the sector from focus_area_patents
PATENTS=$(docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio -t -c "
  SELECT DISTINCT fap.patent_id
  FROM focus_area_patents fap
  JOIN focus_areas fa ON fap.focus_area_id = fa.id
  JOIN sub_sectors ss ON fa.sub_sector_id = ss.id
  WHERE ss.name = '$SECTOR'
  ORDER BY fap.patent_id;
")

if [ -z "$PATENTS" ]; then
  echo "No patents found for sector: $SECTOR"
  echo "Trying direct sub_sector query..."
  PATENTS=$(docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio -t -c "
    SELECT DISTINCT patent_id FROM patent_sub_sector_scores
    WHERE template_config_id = '$SECTOR';
  ")
fi

TOTAL=0
WITH_CLAIMS=0
MISSING_CLAIMS=""

for PATENT_ID in $PATENTS; do
  PATENT_ID=$(echo $PATENT_ID | tr -d ' ')
  if [ -z "$PATENT_ID" ]; then continue; fi

  TOTAL=$((TOTAL + 1))

  # Check if XML file exists (check common year directories)
  FOUND=false
  for YEAR in 2024 2023 2022 2021 2020 2019 2018 2017 2016 2015; do
    if [ -f "$USPTO_XML_DIR/$YEAR/$PATENT_ID.xml" ] || [ -f "$USPTO_XML_DIR/$YEAR/US$PATENT_ID.xml" ]; then
      FOUND=true
      break
    fi
  done

  if [ "$FOUND" = true ]; then
    WITH_CLAIMS=$((WITH_CLAIMS + 1))
  else
    MISSING_CLAIMS="$MISSING_CLAIMS $PATENT_ID"
  fi
done

WITHOUT_CLAIMS=$((TOTAL - WITH_CLAIMS))
PERCENT=$((WITH_CLAIMS * 100 / TOTAL))

echo ""
echo "Summary:"
echo "  Total patents: $TOTAL"
echo "  With claims XML: $WITH_CLAIMS ($PERCENT%)"
echo "  Missing claims: $WITHOUT_CLAIMS"
echo ""

if [ $WITHOUT_CLAIMS -gt 0 ]; then
  echo "Patents missing claims XML:"
  echo "$MISSING_CLAIMS" | tr ' ' '\n' | grep -v '^$' | sort
  echo ""
  echo "Export missing patents to file:"
  echo "$MISSING_CLAIMS" | tr ' ' '\n' | grep -v '^$' | sort > "/tmp/${SECTOR}-missing-claims.txt"
  echo "  Saved to: /tmp/${SECTOR}-missing-claims.txt"
fi
