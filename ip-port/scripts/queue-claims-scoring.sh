#!/bin/bash
# Queue claims-enhanced scoring for multiple VIDEO_STREAMING sectors
# Waits for each to complete before starting next

API_BASE="http://localhost:3001/api/scoring-templates/llm/score-sector"
LOG_DIR="/tmp"

# Restart API server to load new code
echo "Restarting API server..."
pkill -f "tsx src/api/server.ts" 2>/dev/null
sleep 2
cd /Users/gmcaveney/Documents/dev/SysMuse/ip-port
npm run api:start > /tmp/api-server.log 2>&1 &
sleep 5

# Wait for API to be ready
until curl -s http://localhost:3001/api/health > /dev/null 2>&1; do
  echo "Waiting for API..."
  sleep 2
done
echo "API ready"

# Queue of sectors to score (in order)
# Format: sector:limit:minYear
SECTORS=(
  "video-server-cdn:500:2010"
  "video-client-processing:500:2010"
  "video-broadcast:300:2010"
  "video-storage:300:2010"
  "video-drm-conditional:150:2010"
)

for entry in "${SECTORS[@]}"; do
  IFS=':' read -r sector limit minYear <<< "$entry"

  echo ""
  echo "=========================================="
  echo "Starting: $sector (limit=$limit, minYear=$minYear)"
  echo "Time: $(date)"
  echo "=========================================="

  # Run scoring with claims enabled
  curl -s -X POST "${API_BASE}/${sector}?limit=${limit}&useClaims=true&minYear=${minYear}&concurrency=2" \
    -o "${LOG_DIR}/scoring-${sector}.json"

  # Show result summary
  echo "Completed: $sector"
  cat "${LOG_DIR}/scoring-${sector}.json" | jq '{total, successful, failed, totalTokens}'
  echo ""
done

echo "All VIDEO_STREAMING sectors complete!"
echo "Results in ${LOG_DIR}/scoring-*.json"
