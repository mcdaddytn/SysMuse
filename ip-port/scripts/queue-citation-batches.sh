#!/bin/bash
# Wait for current batch to complete, then run sequential batches
# Run this in background: nohup ./scripts/queue-citation-batches.sh > logs/batch-queue.log 2>&1 &

set -e

LOG_DIR="./logs"
mkdir -p "$LOG_DIR"

echo "═══════════════════════════════════════════════════════════════"
echo "  CITATION BATCH QUEUE"
echo "  Started: $(date)"
echo "═══════════════════════════════════════════════════════════════"

# Wait for any running citation analysis to complete
echo "Checking for running citation processes..."
while pgrep -f "citation-overlap-cached" > /dev/null 2>&1; do
  echo "  Waiting for current batch to complete... ($(date))"
  sleep 60
done

echo "No running batches detected. Starting queue..."
echo ""

# Run the sequential batches
./scripts/run-citation-batches.sh

echo ""
echo "Queue complete at $(date)"
