#!/bin/bash
# Run remaining WIRELESS sectors in sequence
# Started: $(date)

API_URL="http://localhost:3001/api/scoring-templates/llm/score-sector"
LOG_FILE="/tmp/wireless-sectors-batch.log"

echo "=== WIRELESS Sectors Batch Run ===" | tee $LOG_FILE
echo "Started: $(date)" | tee -a $LOG_FILE

# Function to run a sector and log results
run_sector() {
    local sector=$1
    local limit=$2

    echo "" | tee -a $LOG_FILE
    echo "=== Starting $sector ===" | tee -a $LOG_FILE
    echo "Time: $(date)" | tee -a $LOG_FILE

    result=$(curl -s -X POST "$API_URL/$sector?limit=$limit&useClaims=true&concurrency=3")

    total=$(echo $result | jq -r '.total // 0')
    successful=$(echo $result | jq -r '.successful // 0')
    failed=$(echo $result | jq -r '.failed // 0')

    echo "Completed: $sector" | tee -a $LOG_FILE
    echo "  Total: $total, Successful: $successful, Failed: $failed" | tee -a $LOG_FILE
    echo "Time: $(date)" | tee -a $LOG_FILE

    # Save full result
    echo $result > "/tmp/wireless-$sector-result.json"
}

# Wait for wireless-transmission to complete (check every 30 seconds)
echo "Waiting for wireless-transmission to complete..." | tee -a $LOG_FILE
while true; do
    progress=$(grep -a "Sector wireless-transmission" /tmp/api-server.log 2>/dev/null | tail -1)
    if echo "$progress" | grep -q "100%"; then
        echo "wireless-transmission complete!" | tee -a $LOG_FILE
        break
    fi
    # Also check if the job finished (no new progress for a while means done)
    sleep 30
    new_progress=$(grep -a "Sector wireless-transmission" /tmp/api-server.log 2>/dev/null | tail -1)
    if [ "$progress" = "$new_progress" ]; then
        # Check if we're at 100% or job ended
        if echo "$progress" | grep -q "1339/1339"; then
            echo "wireless-transmission complete!" | tee -a $LOG_FILE
            break
        fi
    fi
done

# Small delay before next sector
sleep 5

# Run remaining sectors in sequence
run_sector "wireless-infrastructure" 1000
sleep 5

run_sector "wireless-scheduling" 500
sleep 5

run_sector "wireless-mimo-antenna" 300

echo "" | tee -a $LOG_FILE
echo "=== All WIRELESS sectors complete ===" | tee -a $LOG_FILE
echo "Finished: $(date)" | tee -a $LOG_FILE

# Summary
echo "" | tee -a $LOG_FILE
echo "=== Summary ===" | tee -a $LOG_FILE
for sector in wireless-infrastructure wireless-scheduling wireless-mimo-antenna; do
    if [ -f "/tmp/wireless-$sector-result.json" ]; then
        result=$(cat "/tmp/wireless-$sector-result.json")
        total=$(echo $result | jq -r '.total // 0')
        successful=$(echo $result | jq -r '.successful // 0')
        echo "$sector: $successful/$total successful" | tee -a $LOG_FILE
    fi
done
