#!/bin/bash
#
# Continuous LLM Enrichment Script (with import fix)
# Runs LLM analysis on patents that don't have it yet, in batches
# IMPORTS results to cache after each batch to prevent re-processing
#
# Usage: ./scripts/run-llm-continuous.sh [BATCH_SIZE] [MAX_HOURS]
#

set -e

BATCH_SIZE=${1:-100}
MAX_RUNTIME_HOURS=${2:-2}
LOG_DIR="logs"
CACHE_DIR="cache/llm-scores"
OUTPUT_DIR="output"

START_TIME=$(date +%s)
MAX_RUNTIME_SECS=$((MAX_RUNTIME_HOURS * 3600))
END_TIME=$((START_TIME + MAX_RUNTIME_SECS))

echo "=============================================="
echo "Continuous LLM Enrichment"
echo "=============================================="
echo "Batch size: $BATCH_SIZE"
echo "Max runtime: $MAX_RUNTIME_HOURS hours"
echo "Started at: $(date)"
echo ""

# Get latest candidates file
CANDIDATES_FILE=$(ls -t output/streaming-candidates-*.json | head -1)
echo "Source: $CANDIDATES_FILE"

batch_num=0
total_processed=0

while true; do
    current_time=$(date +%s)

    if [ $current_time -ge $END_TIME ]; then
        echo ""
        echo "=============================================="
        echo "Max runtime reached. Stopping."
        echo "Total patents processed: $total_processed"
        echo "=============================================="
        break
    fi

    remaining_secs=$((END_TIME - current_time))
    remaining_mins=$((remaining_secs / 60))

    batch_num=$((batch_num + 1))
    echo ""
    echo "--- Batch $batch_num (${remaining_mins} minutes remaining) ---"

    # IMPORTANT: Import any pending results first to get accurate gap count
    echo "Importing pending LLM results..."
    for f in output/llm-analysis-v3/combined-v3-*.json; do
        if [ -f "$f" ]; then
            npx tsx scripts/import-llm-scores.ts "$f" 2>/dev/null | grep -E "imported" | head -1 || true
        fi
    done

    # Get top patents by score that don't have LLM cache
    BATCH_FILE="/tmp/llm-batch-$batch_num.json"

    # Create batch of patents needing enrichment (checking cache AFTER import)
    cat "$CANDIDATES_FILE" | jq -r '.candidates | sort_by(-.score) | .[].patent_id' | while read id; do
        if [ ! -f "$CACHE_DIR/$id.json" ]; then
            echo "$id"
        fi
    done | head -$BATCH_SIZE > /tmp/batch_ids.txt

    batch_count=$(wc -l < /tmp/batch_ids.txt | tr -d ' ')

    if [ "$batch_count" -eq 0 ]; then
        echo "No more patents need LLM enrichment!"
        break
    fi

    echo "Processing $batch_count patents..."

    # Convert to JSON array
    jq -Rs 'split("\n") | map(select(length > 0))' < /tmp/batch_ids.txt > "$BATCH_FILE"

    # Run LLM analysis
    LOG_FILE="$LOG_DIR/llm-batch-$batch_num-$(date +%Y%m%d-%H%M%S).log"
    echo "Log: $LOG_FILE"

    npx tsx scripts/run-llm-analysis-v3.ts "$BATCH_FILE" > "$LOG_FILE" 2>&1

    # Check result and import immediately
    if grep -q "Total patents analyzed:" "$LOG_FILE"; then
        analyzed=$(grep "Total patents analyzed:" "$LOG_FILE" | awk '{print $NF}')
        total_processed=$((total_processed + analyzed))
        echo "Completed: $analyzed patents (total: $total_processed)"

        # IMPORTANT: Import results to cache immediately
        echo "Importing batch results to cache..."
        for f in output/llm-analysis-v3/combined-v3-*.json; do
            if [ -f "$f" ]; then
                npx tsx scripts/import-llm-scores.ts "$f" 2>/dev/null | grep -E "imported" | head -1 || true
            fi
        done
    else
        echo "Batch may have had issues - check log"
        tail -5 "$LOG_FILE"
    fi

    sleep 5
done

echo ""
echo "=============================================="
echo "LLM Enrichment Complete"
echo "Total batches: $batch_num"
echo "Total patents processed: $total_processed"
echo "Ended at: $(date)"
echo "=============================================="
