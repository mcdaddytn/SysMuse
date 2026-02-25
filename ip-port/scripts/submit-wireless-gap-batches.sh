#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# submit-wireless-gap-batches.sh — Submit Anthropic Batch API jobs for all
# WIRELESS scoring gaps across competitor portfolios.
#
# Uses POST /api/scoring-templates/llm/batch-score-sector/:sectorName
# with portfolioId in body. 50% cost savings, ~24h turnaround.
#
# Requires API server running on localhost:3001.
#
# Usage:
#   ./scripts/submit-wireless-gap-batches.sh                  # Show plan
#   ./scripts/submit-wireless-gap-batches.sh --submit         # Submit all
#   ./scripts/submit-wireless-gap-batches.sh --submit qualcomm  # Submit one portfolio
#   ./scripts/submit-wireless-gap-batches.sh --status         # Check batch statuses
# ─────────────────────────────────────────────────────────────────────────────

set -e

API_BASE="http://localhost:3001/api/scoring-templates"

CONTAINER="ip-port-postgres"
DB_USER="ip_admin"
DB_NAME="ip_portfolio"

# Portfolio name → ID mapping (bash 3 compatible — no associative arrays)
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

ALL_PORTFOLIOS="qualcomm cisco intel apple sony nvidia"

# ─── Helper: query DB for unscored sector counts ─────────────────────────────
get_gap_sectors() {
  local pid="$1"
  docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "
    SELECT p.primary_sector || '|' || COUNT(*)
    FROM patents p
    JOIN portfolio_patents pp ON p.patent_id = pp.patent_id
    LEFT JOIN patent_sub_sector_scores pss ON p.patent_id = pss.patent_id
    WHERE pp.portfolio_id = '${pid}'
      AND p.super_sector = 'WIRELESS'
      AND p.primary_sector IS NOT NULL
      AND pss.patent_id IS NULL
      AND (p.is_quarantined = false OR p.is_quarantined IS NULL)
    GROUP BY p.primary_sector
    ORDER BY COUNT(*) DESC
  "
}

# ─── Status mode ─────────────────────────────────────────────────────────────
if [ "${1:-}" = "--status" ]; then
  echo "Checking batch job statuses..."
  curl -s "$API_BASE/llm/batch-jobs" | python3 -c "
import sys, json
jobs = json.load(sys.stdin)
if not jobs:
    print('  No batch jobs found')
    sys.exit(0)
jobs.sort(key=lambda j: j.get('submittedAt', ''), reverse=True)
hdr = f\"  {'Status':<12} {'Sector':<28} {'Portfolio':<12} {'Patents':>7}  Batch ID\"
print(hdr)
print('  ' + chr(9472) * 90)
for j in jobs[:30]:
    status = j.get('status', '?')
    sector = j.get('sectorName', '?')
    port = j.get('portfolioId', '-')[:10] if j.get('portfolioId') else '-'
    count = j.get('patentCount', '?')
    bid = j.get('batchId', '?')
    r = j.get('results', {})
    extra = ''
    if r.get('succeeded', 0) > 0:
        extra = f'  ok:{r[\"succeeded\"]}'
    if r.get('errored', 0) > 0:
        extra += f'  err:{r[\"errored\"]}'
    print(f'  {status:<12} {sector:<28} {port:<12} {count:>7}  {bid}{extra}')
"
  exit 0
fi

# ─── Plan mode (default) ────────────────────────────────────────────────────
if [ "${1:-}" != "--submit" ]; then
  echo "═══════════════════════════════════════════════════════════════"
  echo " WIRELESS Gap-Fill — Anthropic Batch API Submission Plan"
  echo " (50% cost savings, ~24h turnaround)"
  echo "═══════════════════════════════════════════════════════════════"
  echo ""

  grand_total=0
  batch_count=0

  for name in $ALL_PORTFOLIOS; do
    pid=$(get_portfolio_id "$name")
    sectors=$(get_gap_sectors "$pid")

    if [ -z "$sectors" ]; then
      printf "  %-12s  (no gaps)\n" "$name"
      continue
    fi

    portfolio_total=0
    upper=$(echo "$name" | tr '[:lower:]' '[:upper:]')
    printf "  %-12s\n" "$upper"
    while IFS= read -r line; do
      sector=$(echo "$line" | cut -d'|' -f1)
      count=$(echo "$line" | cut -d'|' -f2)
      cost=$(python3 -c "print(f'\${int(${count}) * 0.024:.2f}')")
      printf "    %-28s %4d patents  %s\n" "$sector" "$count" "$cost"
      portfolio_total=$((portfolio_total + count))
      batch_count=$((batch_count + 1))
    done <<< "$sectors"

    pcost=$(python3 -c "print(f'\${int(${portfolio_total}) * 0.024:.2f}')")
    printf "    %-28s %4d patents  %s\n" "SUBTOTAL" "$portfolio_total" "$pcost"
    echo ""
    grand_total=$((grand_total + portfolio_total))
  done

  gcost=$(python3 -c "print(f'\${int(${grand_total}) * 0.024:.2f}')")
  echo "  ────────────────────────────────────────────────────────"
  printf "  TOTAL: %d patents across %d batch jobs  %s (batch)\n" "$grand_total" "$batch_count" "$gcost"
  echo ""
  echo "  To submit all:  $0 --submit"
  echo "  One portfolio:  $0 --submit qualcomm"
  echo "  Check status:   $0 --status"
  exit 0
fi

# ─── Submit mode ─────────────────────────────────────────────────────────────
shift  # remove --submit

# Check API server is running
if ! curl -s --max-time 2 "http://localhost:3001/api/scoring-templates/llm/batch-jobs" > /dev/null 2>&1; then
  echo "ERROR: API server not responding on localhost:3001"
  echo "Start with: npm run dev"
  exit 1
fi

# Filter to specific portfolio if given
if [ $# -gt 0 ]; then
  TARGETS="$*"
else
  TARGETS="$ALL_PORTFOLIOS"
fi

echo "═══════════════════════════════════════════════════════════════"
echo " Submitting WIRELESS gap-fill batch jobs: $TARGETS"
echo "═══════════════════════════════════════════════════════════════"
echo ""

submitted=0
total_patents=0

for name in $TARGETS; do
  pid=$(get_portfolio_id "$name")
  if [ -z "$pid" ]; then
    echo "  ERROR: Unknown portfolio '$name'"
    continue
  fi

  sectors=$(get_gap_sectors "$pid")
  if [ -z "$sectors" ]; then
    upper=$(echo "$name" | tr '[:lower:]' '[:upper:]')
    echo "  ${upper}: no unscored WIRELESS patents — skipping"
    continue
  fi

  upper=$(echo "$name" | tr '[:lower:]' '[:upper:]')
  echo "  ${upper} (portfolio: $pid)"

  while IFS= read -r line; do
    sector=$(echo "$line" | cut -d'|' -f1)
    count=$(echo "$line" | cut -d'|' -f2)

    printf "    %-28s %4d patents ... " "$sector" "$count"

    # Submit batch job
    result=$(curl -s -X POST \
      "${API_BASE}/llm/batch-score-sector/${sector}" \
      -H "Content-Type: application/json" \
      -d "{\"portfolioId\": \"${pid}\"}")

    success=$(echo "$result" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('success', False))" 2>/dev/null || echo "False")
    batch_id=$(echo "$result" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('batchId', 'UNKNOWN'))" 2>/dev/null || echo "ERROR")

    if [ "$success" = "True" ]; then
      echo "OK $batch_id"
      submitted=$((submitted + 1))
      total_patents=$((total_patents + count))
    else
      error=$(echo "$result" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('error', str(r)))" 2>/dev/null || echo "$result")
      echo "FAIL: $error"
    fi

    # Small delay between submissions
    sleep 1
  done <<< "$sectors"

  echo ""
done

cost=$(python3 -c "print(f'\${int(${total_patents}) * 0.024:.2f}')")
echo "═══════════════════════════════════════════════════════════════"
echo " Submitted $submitted batch jobs ($total_patents patents, ~$cost batch cost)"
echo ""
echo " Check status:     $0 --status"
echo " Refresh all:      curl -s -X POST $API_BASE/llm/batch-refresh-all"
echo " Process results:  curl -s -X POST $API_BASE/llm/batch-process/<batchId>"
echo "═══════════════════════════════════════════════════════════════"
