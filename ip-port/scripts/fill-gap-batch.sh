#!/bin/bash
# Fill the gap from 813-1669 (857 patents)
# Run after the main queue completes, or in parallel if rate limits allow

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "  FILLING GAP: patents 813 to 1670"
echo "  Started: $(date)"
echo "═══════════════════════════════════════════════════════════════"

# Wait for any running citation analysis to complete
echo "Waiting for other batches to complete..."
while pgrep -f "citation-overlap-cached" > /dev/null 2>&1; do
  echo "  Other batch running, waiting... ($(date))"
  sleep 60
done

echo "Starting gap fill batch..."
npm run analyze:cached -- --start 813 --limit 857

echo ""
echo "Gap fill complete at $(date)"
npm run cache:stats
