#!/bin/bash
# Cleanup script to complete SECURITY sectors that were cut short by the 500 limit
# Run this after the main batch completes
# Uses new 2000 limit (updated in llm-scoring-service.ts)

LOG_FILE="/tmp/security-cleanup-batch.log"

echo "============================================================" | tee -a $LOG_FILE
echo "=== SECURITY Cleanup Batch ===" | tee -a $LOG_FILE
echo "=== Started: $(date) ===" | tee -a $LOG_FILE
echo "============================================================" | tee -a $LOG_FILE

# Sectors that need completion (hit the 500 limit)
SECTORS=(
  "computing-os-security"       # ~157 remaining
  "network-threat-protection"   # ~178 remaining
  "network-auth-access"         # ~1,309 remaining
)

CUMULATIVE=0

for SECTOR in "${SECTORS[@]}"; do
  echo "" | tee -a $LOG_FILE
  echo "============================================================" | tee -a $LOG_FILE
  echo "=== Completing: $SECTOR ===" | tee -a $LOG_FILE
  echo "Time: $(date)" | tee -a $LOG_FILE
  echo "============================================================" | tee -a $LOG_FILE

  # Score remaining unscored patents (limit=2000 is now the default)
  RESULT=$(curl -s -X POST "http://localhost:3001/api/scoring-templates/llm/score-sector/$SECTOR?useClaims=true" \
    -H "Content-Type: application/json")

  TOTAL=$(echo $RESULT | jq -r '.total // 0')
  SUCCESSFUL=$(echo $RESULT | jq -r '.successful // 0')
  FAILED=$(echo $RESULT | jq -r '.failed // 0')

  CUMULATIVE=$((CUMULATIVE + SUCCESSFUL))

  echo "Completed: $SECTOR" | tee -a $LOG_FILE
  echo "  Total: $TOTAL, Successful: $SUCCESSFUL, Failed: $FAILED" | tee -a $LOG_FILE
  echo "  Cumulative additional: $CUMULATIVE scored" | tee -a $LOG_FILE
  echo "Time: $(date)" | tee -a $LOG_FILE
done

echo "" | tee -a $LOG_FILE
echo "============================================================" | tee -a $LOG_FILE
echo "=== SECURITY Cleanup Complete ===" | tee -a $LOG_FILE
echo "=== Total additional patents scored: $CUMULATIVE ===" | tee -a $LOG_FILE
echo "=== Finished: $(date) ===" | tee -a $LOG_FILE
echo "============================================================" | tee -a $LOG_FILE
