#!/bin/bash
# AI_ML sector scoring batch
# Runs AI_ML sector with sector-specific templates and claims

LOG_FILE="/tmp/ai-ml-sector-batch.log"

echo "============================================================" | tee $LOG_FILE
echo "=== AI_ML Sector Scoring Batch ===" | tee -a $LOG_FILE
echo "=== Started: $(date) ===" | tee -a $LOG_FILE
echo "============================================================" | tee -a $LOG_FILE

SECTOR="ai-ml"  # 69 patents

echo "" | tee -a $LOG_FILE
echo "=== Starting: $SECTOR ===" | tee -a $LOG_FILE
echo "Time: $(date)" | tee -a $LOG_FILE

# Score sector WITH CLAIMS
RESULT=$(curl -s -X POST "http://localhost:3001/api/scoring-templates/llm/score-sector/$SECTOR?useClaims=true" \
  -H "Content-Type: application/json")

TOTAL=$(echo $RESULT | jq -r '.total // 0')
SUCCESSFUL=$(echo $RESULT | jq -r '.successful // 0')
FAILED=$(echo $RESULT | jq -r '.failed // 0')

echo "Completed: $SECTOR" | tee -a $LOG_FILE
echo "  Total: $TOTAL, Successful: $SUCCESSFUL, Failed: $FAILED" | tee -a $LOG_FILE
echo "Time: $(date)" | tee -a $LOG_FILE

echo "" | tee -a $LOG_FILE
echo "============================================================" | tee -a $LOG_FILE
echo "=== AI_ML Batch Complete ===" | tee -a $LOG_FILE
echo "=== Finished: $(date) ===" | tee -a $LOG_FILE
echo "============================================================" | tee -a $LOG_FILE

# Summary
COUNT=$(docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio -t -c \
  "SELECT COUNT(*) FROM patent_sub_sector_scores WHERE template_config_id = '$SECTOR';")
AVG_SCORE=$(docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio -t -c \
  "SELECT ROUND(AVG(composite_score)::numeric, 2) FROM patent_sub_sector_scores WHERE template_config_id = '$SECTOR';")
echo "$SECTOR: $COUNT scored (avg composite: $AVG_SCORE)" | tee -a $LOG_FILE

echo "" | tee -a $LOG_FILE
echo "Log saved to: $LOG_FILE" | tee -a $LOG_FILE
