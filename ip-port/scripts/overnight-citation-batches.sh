#!/bin/bash
# Overnight citation analysis - 10 hours of batches
# Each batch: 1000 patents @ ~3s each = ~50 min per batch
# 12 batches = ~10 hours, covering patents 5670 to 17670
#
# Current progress: 0-5670 complete
# This script: 5670 to 17670 (12,000 patents)
# After this: 17670 to 28913 remaining (~11,243 patents)

set -e

LOG_DIR="./logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/overnight-$(date +%Y%m%d-%H%M).log"

# Redirect all output to log file AND console
exec > >(tee -a "$LOG_FILE") 2>&1

echo "═══════════════════════════════════════════════════════════════"
echo "  OVERNIGHT CITATION BATCH RUNNER"
echo "  Started: $(date)"
echo "  Estimated completion: $(date -v+10H 2>/dev/null || date -d '+10 hours')"
echo "  Log file: $LOG_FILE"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Portfolio size: 28,913 patents"
echo "  Already processed: 0-5670 (5,670 patents)"
echo "  This run: 5670-17670 (12,000 patents)"
echo "  Remaining after: 17670-28913 (~11,243 patents)"
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

# Define 12 batches of 1000 patents each
BATCHES=(
  "5670 1000"
  "6670 1000"
  "7670 1000"
  "8670 1000"
  "9670 1000"
  "10670 1000"
  "11670 1000"
  "12670 1000"
  "13670 1000"
  "14670 1000"
  "15670 1000"
  "16670 1000"
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
echo "  ALL OVERNIGHT BATCHES COMPLETE!"
echo "  Finished: $(date)"
echo "  Processed: 12,000 patents (5670 to 17670)"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Show final cache stats
echo "Final Cache Statistics:"
npm run cache:stats

echo ""
echo "Next steps:"
echo "  - Remaining patents: 17670 to 28913 (~11,243 patents)"
echo "  - Run another overnight batch to complete"
