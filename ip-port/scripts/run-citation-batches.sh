#!/bin/bash
# Run citation analysis batches sequentially
# Each batch processes 1000 patents at ~3s each = ~50 min per batch
# This script queues ~4 hours of work

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "  SEQUENTIAL CITATION BATCH RUNNER"
echo "  Started: $(date)"
echo "═══════════════════════════════════════════════════════════════"

# Define batches (start position, limit)
# Current batch bb1cb6b is running 670-1670
# These pick up from 1670 onwards
BATCHES=(
  "1670 1000"
  "2670 1000"
  "3670 1000"
  "4670 1000"
)

for batch in "${BATCHES[@]}"; do
  read -r start limit <<< "$batch"
  end=$((start + limit))

  echo ""
  echo "───────────────────────────────────────────────────────────────"
  echo "  Starting batch: patents $start to $end"
  echo "  Time: $(date)"
  echo "───────────────────────────────────────────────────────────────"

  npm run analyze:cached -- --start "$start" --limit "$limit"

  echo "  Batch $start-$end complete at $(date)"
  echo ""

  # Brief pause between batches to avoid rate limit carryover
  sleep 10
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ALL BATCHES COMPLETE"
echo "  Finished: $(date)"
echo "═══════════════════════════════════════════════════════════════"

# Show final cache stats
npm run cache:stats
