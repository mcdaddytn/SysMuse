#!/bin/bash
# Final citation analysis batch - completes the portfolio
# Each batch: 1000 patents @ ~3s each = ~50 min per batch
# 12 batches = ~10 hours, covering patents 17670 to 28913
#
# Previous progress: 0-17670 complete (17,670 patents, 61%)
# This script: 17670 to 28913 (11,243 patents)
# After this: 100% portfolio coverage!

set -e

LOG_DIR="./logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/final-batch-$(date +%Y%m%d-%H%M).log"

# Redirect all output to log file AND console
exec > >(tee -a "$LOG_FILE") 2>&1

echo "═══════════════════════════════════════════════════════════════"
echo "  FINAL CITATION BATCH RUNNER"
echo "  Started: $(date)"
echo "  Estimated completion: $(date -v+10H 2>/dev/null || date -d '+10 hours')"
echo "  Log file: $LOG_FILE"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Portfolio size: 28,913 patents"
echo "  Already processed: 0-17670 (17,670 patents, 61%)"
echo "  This run: 17670-28913 (11,243 patents)"
echo "  After this: 100% portfolio coverage!"
echo ""

# Check if another batch is already running
if pgrep -f "citation-overlap-cached" > /dev/null 2>&1; then
  echo "WARNING: Another citation analysis is already running!"
  echo "Waiting for it to complete before starting..."
  while pgrep -f "citation-overlap-cached" > /dev/null 2>&1; do
    echo "  Still running... ($(date))"
    sleep 60
  done
  echo "Previous batch completed. Continuing..."
fi

# Define 12 batches to complete the portfolio
# Last batch is smaller (243 patents)
BATCHES=(
  "17670 1000"
  "18670 1000"
  "19670 1000"
  "20670 1000"
  "21670 1000"
  "22670 1000"
  "23670 1000"
  "24670 1000"
  "25670 1000"
  "26670 1000"
  "27670 1000"
  "28670 243"
)

TOTAL_BATCHES=${#BATCHES[@]}
CURRENT_BATCH=0

for batch in "${BATCHES[@]}"; do
  read -r start limit <<< "$batch"
  end=$((start + limit))
  CURRENT_BATCH=$((CURRENT_BATCH + 1))

  echo ""
  echo "───────────────────────────────────────────────────────────────"
  echo "  BATCH $CURRENT_BATCH of $TOTAL_BATCHES"
  echo "  Patents: $start to $end"
  echo "  Started: $(date)"
  echo "───────────────────────────────────────────────────────────────"

  # Run the batch
  npm run analyze:cached -- --start "$start" --limit "$limit"

  BATCH_END=$(date)
  echo ""
  echo "  Batch $CURRENT_BATCH complete at $BATCH_END"

  # Show intermediate cache stats every 4 batches
  if (( CURRENT_BATCH % 4 == 0 )); then
    echo ""
    echo "  --- Intermediate Cache Stats ---"
    npm run cache:stats
    echo ""
  fi

  # Brief pause between batches
  sleep 10
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ALL CITATION BATCHES COMPLETE!"
echo "  FULL PORTFOLIO ANALYSIS FINISHED!"
echo "  Finished: $(date)"
echo "  Total processed: 28,913 patents (100% coverage)"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Show final cache stats
echo "Final Cache Statistics:"
npm run cache:stats

echo ""
echo "Portfolio citation analysis complete!"
echo "You can now run comprehensive analysis on all patents."
