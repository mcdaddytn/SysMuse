#!/bin/bash
# VIDEO_STREAMING sector scoring batch
# Runs all 7 VIDEO_STREAMING sectors with new sector templates

LOG_FILE="/tmp/video-streaming-sectors-batch.log"

echo "============================================================" | tee $LOG_FILE
echo "=== VIDEO_STREAMING Sector Scoring Batch ===" | tee -a $LOG_FILE
echo "=== Started: $(date) ===" | tee -a $LOG_FILE
echo "============================================================" | tee -a $LOG_FILE

# VIDEO_STREAMING sectors ordered by size (smallest first for quick wins)
SECTORS=(
  "display-control"           # 68 patents
  "video-drm-conditional"     # 121 patents
  "video-storage"             # 212 patents
  "video-broadcast"           # 229 patents
  "video-codec"               # 377 patents
  "video-client-processing"   # 394 patents
  "video-server-cdn"          # 456 patents
)

CUMULATIVE=0

for SECTOR in "${SECTORS[@]}"; do
  echo "" | tee -a $LOG_FILE
  echo "============================================================" | tee -a $LOG_FILE
  echo "=== Starting: $SECTOR ===" | tee -a $LOG_FILE
  echo "Time: $(date)" | tee -a $LOG_FILE
  echo "============================================================" | tee -a $LOG_FILE

  # Score sector WITH CLAIMS (rescore=true to overwrite previous non-claims scores)
  RESULT=$(curl -s -X POST "http://localhost:3001/api/scoring-templates/llm/score-sector/$SECTOR?useClaims=true&rescore=true" \
    -H "Content-Type: application/json")

  TOTAL=$(echo $RESULT | jq -r '.total // 0')
  SUCCESSFUL=$(echo $RESULT | jq -r '.successful // 0')
  FAILED=$(echo $RESULT | jq -r '.failed // 0')

  CUMULATIVE=$((CUMULATIVE + SUCCESSFUL))

  echo "Completed: $SECTOR" | tee -a $LOG_FILE
  echo "  Total: $TOTAL, Successful: $SUCCESSFUL, Failed: $FAILED" | tee -a $LOG_FILE
  echo "  Cumulative: $CUMULATIVE scored" | tee -a $LOG_FILE
  echo "Time: $(date)" | tee -a $LOG_FILE
done

echo "" | tee -a $LOG_FILE
echo "============================================================" | tee -a $LOG_FILE
echo "=== VIDEO_STREAMING Batch Complete ===" | tee -a $LOG_FILE
echo "=== Total patents scored: $CUMULATIVE ===" | tee -a $LOG_FILE
echo "=== Finished: $(date) ===" | tee -a $LOG_FILE
echo "============================================================" | tee -a $LOG_FILE

# Summary by sector
echo "" | tee -a $LOG_FILE
echo "=== Per-Sector Summary ===" | tee -a $LOG_FILE
for SECTOR in "${SECTORS[@]}"; do
  COUNT=$(docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio -t -c \
    "SELECT COUNT(*) FROM patent_sub_sector_scores WHERE template_config_id = '$SECTOR';")
  SAMPLE=$(docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio -t -c \
    "SELECT ROUND(AVG(composite_score)::numeric, 2) FROM patent_sub_sector_scores WHERE template_config_id = '$SECTOR';")
  echo "$SECTOR: $COUNT scored (avg composite: $SAMPLE)" | tee -a $LOG_FILE
done

echo "" | tee -a $LOG_FILE
echo "Log saved to: $LOG_FILE" | tee -a $LOG_FILE
