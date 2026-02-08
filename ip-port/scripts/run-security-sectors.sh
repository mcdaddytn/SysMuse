#!/bin/bash
# Run all SECURITY sectors in sequence
# Total: ~4,400 patents across 8 sectors

LOG_FILE="/tmp/security-sectors-batch.log"

echo "=== SECURITY Super-Sector Batch Run ===" | tee $LOG_FILE
echo "Started: $(date)" | tee -a $LOG_FILE
echo "" | tee -a $LOG_FILE

# Sectors ordered smallest to largest
# Small sectors have already been partially scored, so we'll re-run them fully
SECTORS=(
  "wireless-security"           # 28 patents   (16 questions)
  "network-crypto"              # 103 patents  (16 questions)
  "computing-data-protection"   # 210 patents  (16 questions)
  "computing-auth-boot"         # 414 patents  (16 questions)
  "network-secure-compute"      # 433 patents  (16 questions)
  "computing-os-security"       # 682 patents  (19 questions) - ENHANCED
  "network-threat-protection"   # 703 patents  (18 questions) - ENHANCED
  "network-auth-access"         # 1809 patents (18 questions) - ENHANCED
)

# Track totals
total_patents=0
total_successful=0
total_failed=0

for sector in "${SECTORS[@]}"; do
  echo "" | tee -a $LOG_FILE
  echo "============================================================" | tee -a $LOG_FILE
  echo "=== Starting: $sector ===" | tee -a $LOG_FILE
  echo "Time: $(date)" | tee -a $LOG_FILE
  echo "============================================================" | tee -a $LOG_FILE

  result=$(curl -s -X POST "http://localhost:3001/api/scoring-templates/llm/score-sector/$sector" \
    -H "Content-Type: application/json" 2>&1)

  count=$(echo "$result" | jq -r '.total // 0')
  successful=$(echo "$result" | jq -r '.successful // 0')
  failed=$(echo "$result" | jq -r '.failed // 0')

  total_patents=$((total_patents + count))
  total_successful=$((total_successful + successful))
  total_failed=$((total_failed + failed))

  echo "" | tee -a $LOG_FILE
  echo "Completed: $sector" | tee -a $LOG_FILE
  echo "  Total: $count, Successful: $successful, Failed: $failed" | tee -a $LOG_FILE
  echo "  Cumulative: $total_successful/$total_patents scored" | tee -a $LOG_FILE
  echo "Time: $(date)" | tee -a $LOG_FILE
done

echo "" | tee -a $LOG_FILE
echo "============================================================" | tee -a $LOG_FILE
echo "=== All SECURITY sectors complete ===" | tee -a $LOG_FILE
echo "Finished: $(date)" | tee -a $LOG_FILE
echo "============================================================" | tee -a $LOG_FILE

# Final Summary
echo "" | tee -a $LOG_FILE
echo "=== FINAL SUMMARY ===" | tee -a $LOG_FILE
echo "Total Patents: $total_patents" | tee -a $LOG_FILE
echo "Successful: $total_successful" | tee -a $LOG_FILE
echo "Failed: $total_failed" | tee -a $LOG_FILE
echo "Success Rate: $(echo "scale=2; $total_successful * 100 / $total_patents" | bc)%" | tee -a $LOG_FILE
echo "" | tee -a $LOG_FILE

# Per-sector summary
echo "=== Per-Sector Summary ===" | tee -a $LOG_FILE
for sector in "${SECTORS[@]}"; do
  # Get count of scored patents for this sector
  sample_pid=$(curl -s "http://localhost:3001/api/patents?sector=$sector&limit=1" | jq -r '.data[0].patent_id')
  if [ -n "$sample_pid" ]; then
    result=$(curl -s "http://localhost:3001/api/scoring-templates/scores/patent/$sample_pid" 2>/dev/null)
    if echo "$result" | jq -e '.scored' >/dev/null 2>&1; then
      composite=$(echo "$result" | jq -r '.compositeScore // 0')
      echo "$sector: scored (sample composite: $composite)" | tee -a $LOG_FILE
    fi
  fi
done

echo "" | tee -a $LOG_FILE
echo "Log saved to: $LOG_FILE" | tee -a $LOG_FILE
