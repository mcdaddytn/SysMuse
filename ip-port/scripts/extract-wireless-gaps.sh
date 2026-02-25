#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# extract-wireless-gaps.sh — Extract unscored WIRELESS patent IDs per portfolio
#
# Writes batch files to /tmp/batch-<name>-wireless-gap.json
# Run before score-wireless-gaps.sh to refresh after partial scoring runs.
#
# Usage:
#   ./scripts/extract-wireless-gaps.sh           # Extract all
#   ./scripts/extract-wireless-gaps.sh qualcomm   # Extract one
# ─────────────────────────────────────────────────────────────────────────────

set -e

CONTAINER="ip-port-postgres"
DB_USER="ip_admin"
DB_NAME="ip_portfolio"

# Portfolio name → ID mapping (bash 3 compatible)
get_portfolio_id() {
  case "$1" in
    qualcomm) echo "cmlwuv1id1wo9121g0q0wrd17" ;;
    intel)    echo "cmlybm2qm0qpjyzvo5ffk3t0d" ;;
    cisco)    echo "cmlxuchnk14wfjz88ukxpt60y" ;;
    apple)    echo "cmlw0w108002gj59lluvu20zy" ;;
    sony)     echo "cmlwtj7gn11gs121g1tg8w8dg" ;;
    nvidia)   echo "cmlxtc62y078rjz889ni2sdv9" ;;
    *)        echo "" ;;
  esac
}

ALL_PORTFOLIOS="qualcomm cisco intel sony apple nvidia"

# If specific portfolios given, use those; otherwise extract all
if [ $# -gt 0 ]; then
  TARGETS="$*"
else
  TARGETS="$ALL_PORTFOLIOS"
fi

echo "Extracting WIRELESS scoring gaps..."
echo ""

for name in $TARGETS; do
  pid=$(get_portfolio_id "$name")
  if [ -z "$pid" ]; then
    echo "  ERROR: Unknown portfolio '$name'"
    echo "  Known: $ALL_PORTFOLIOS"
    exit 1
  fi

  outfile="/tmp/batch-${name}-wireless-gap.json"

  docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "
    SELECT json_agg(p.patent_id)
    FROM patents p
    JOIN portfolio_patents pp ON p.patent_id = pp.patent_id
    LEFT JOIN patent_sub_sector_scores pss ON p.patent_id = pss.patent_id
    WHERE pp.portfolio_id = '${pid}'
      AND p.super_sector = 'WIRELESS'
      AND pss.patent_id IS NULL
      AND (p.is_quarantined = false OR p.is_quarantined IS NULL)
  " > "$outfile"

  count=$(python3 -c "import json; d=json.load(open('$outfile')); print(len(d))" 2>/dev/null || echo "0")
  printf "  %-12s  %4s patents  (%s)\n" "$name" "$count" "$outfile"
done

echo ""
echo "Done. Run: ./scripts/score-wireless-gaps.sh"
