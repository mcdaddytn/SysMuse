#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# score-wireless-gaps.sh — Fill WIRELESS scoring gaps for competitor portfolios
#
# Batch files already extracted to /tmp/batch-*-wireless-gap.json
# Run from project root: ./scripts/score-wireless-gaps.sh [portfolio] [--concurrency N]
#
# Usage:
#   ./scripts/score-wireless-gaps.sh                    # Show status of all gaps
#   ./scripts/score-wireless-gaps.sh qualcomm           # Score Qualcomm gap (681 patents)
#   ./scripts/score-wireless-gaps.sh intel cisco        # Score Intel + Cisco sequentially
#   ./scripts/score-wireless-gaps.sh all                # Score all gaps sequentially
#   ./scripts/score-wireless-gaps.sh qualcomm --concurrency 4
#
# Cost estimates (realtime Sonnet 4 @ ~$0.048/patent):
#   qualcomm: 681 patents → ~$33
#   cisco:    288 patents → ~$14
#   intel:    281 patents → ~$13
#   sony:      65 patents → ~$3
#   apple:     52 patents → ~$2.50
#   nvidia:    42 patents → ~$2
#   ────────────────────────
#   Total:  1,409 patents → ~$68
# ─────────────────────────────────────────────────────────────────────────────

set -e

CONCURRENCY=3
PORTFOLIOS=()

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --concurrency)
      CONCURRENCY="$2"
      shift 2
      ;;
    *)
      PORTFOLIOS+=("$1")
      shift
      ;;
  esac
done

ALL_PORTFOLIOS=(qualcomm cisco intel sony apple nvidia)

# Status mode — show gap info
if [ ${#PORTFOLIOS[@]} -eq 0 ]; then
  echo "═══════════════════════════════════════════════════════════"
  echo " WIRELESS Scoring Gaps — Competitor Portfolios"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  total=0
  for name in "${ALL_PORTFOLIOS[@]}"; do
    batch="/tmp/batch-${name}-wireless-gap.json"
    if [ -f "$batch" ]; then
      count=$(python3 -c "import json; print(len(json.load(open('$batch'))))")
      cost=$(python3 -c "print(f'\${$count * 0.048:.0f}')")
      printf "  %-12s %4d patents  %s (realtime)\n" "$name" "$count" "$cost"
      total=$((total + count))
    else
      printf "  %-12s  *** batch file missing ***\n" "$name"
    fi
  done
  total_cost=$(python3 -c "print(f'\${$total * 0.048:.0f}')")
  echo "  ────────────────────────────────────────"
  printf "  %-12s %4d patents  %s (realtime)\n" "TOTAL" "$total" "$total_cost"
  echo ""
  echo "Usage: $0 <portfolio|all> [--concurrency N]"
  echo ""
  echo "Recommended execution order:"
  echo "  1. $0 qualcomm --concurrency 3    # Biggest gap"
  echo "  2. $0 intel cisco --concurrency 3  # Medium gaps"
  echo "  3. $0 apple sony nvidia            # Small gaps"
  exit 0
fi

# Expand "all" to all portfolios
if [ "${PORTFOLIOS[0]}" = "all" ]; then
  PORTFOLIOS=("${ALL_PORTFOLIOS[@]}")
fi

# Validate batch files exist
for name in "${PORTFOLIOS[@]}"; do
  batch="/tmp/batch-${name}-wireless-gap.json"
  if [ ! -f "$batch" ]; then
    echo "ERROR: Batch file not found: $batch"
    echo "Re-extract with: ./scripts/extract-wireless-gaps.sh"
    exit 1
  fi
done

# Score each portfolio
echo "═══════════════════════════════════════════════════════════"
echo " Scoring WIRELESS gaps: ${PORTFOLIOS[*]}"
echo " Concurrency: $CONCURRENCY"
echo "═══════════════════════════════════════════════════════════"
echo ""

for name in "${PORTFOLIOS[@]}"; do
  batch="/tmp/batch-${name}-wireless-gap.json"
  count=$(python3 -c "import json; print(len(json.load(open('$batch'))))")
  echo "───────────────────────────────────────────────────────────"
  upper=$(echo "$name" | tr '[:lower:]' '[:upper:]')
  echo " ${upper}: $count patents"
  echo "───────────────────────────────────────────────────────────"
  echo ""

  npx tsx scripts/run-sector-scoring.ts "$batch" --concurrency "$CONCURRENCY"

  echo ""
  echo " ✓ ${name^^} complete"
  echo ""
done

echo "═══════════════════════════════════════════════════════════"
echo " All scoring complete: ${PORTFOLIOS[*]}"
echo "═══════════════════════════════════════════════════════════"
