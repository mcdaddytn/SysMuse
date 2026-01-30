#!/bin/bash
#
# Automated Enrichment Script (with sector support)
# Fills out enrichment data for patents with various targeting modes
#
# Usage:
#   ./scripts/run-auto-enrichment.sh [TOP_N] [MAX_HOURS]                    # Tier-based (default)
#   ./scripts/run-auto-enrichment.sh --super-sector "Video & Streaming" [MAX_HOURS]  # Super-sector
#   ./scripts/run-auto-enrichment.sh --sector "video-codec" [MAX_HOURS]              # Sector
#   ./scripts/run-auto-enrichment.sh --queue queue-file.json                         # Queue mode
#
# Queue file format:
#   [
#     { "mode": "tier", "topN": 6000, "maxHours": 2 },
#     { "mode": "super-sector", "name": "Video & Streaming", "maxHours": 4 },
#     { "mode": "sector", "name": "video-codec", "maxHours": 1 }
#   ]
#

set -e

LOG_DIR="logs"
mkdir -p "$LOG_DIR"

# Parse arguments
MODE="tier"
TOP_N=6000
MAX_HOURS=4
SECTOR_NAME=""
QUEUE_FILE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --super-sector)
            MODE="super-sector"
            SECTOR_NAME="$2"
            shift 2
            ;;
        --sector)
            MODE="sector"
            SECTOR_NAME="$2"
            shift 2
            ;;
        --queue)
            MODE="queue"
            QUEUE_FILE="$2"
            shift 2
            ;;
        *)
            if [ "$MODE" = "tier" ]; then
                if [ -z "$TOP_N_SET" ]; then
                    TOP_N="$1"
                    TOP_N_SET=1
                else
                    MAX_HOURS="$1"
                fi
            else
                MAX_HOURS="$1"
            fi
            shift
            ;;
    esac
done

# Function to import LLM results to cache
import_llm_results() {
    echo "  Importing LLM results to cache..."
    for f in output/llm-analysis-v3/combined-v3-*.json; do
        if [ -f "$f" ]; then
            npx tsx scripts/import-llm-scores.ts "$f" 2>/dev/null | grep -E "imported|skipped" | head -1 || true
        fi
    done
}

# Function to analyze gaps for tier-based mode
analyze_gaps_tier() {
    local top_n=$1
    npx tsx -e "
const fs = require('fs');
const candidatesFile = fs.readdirSync('output')
  .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
  .sort().pop();
const data = JSON.parse(fs.readFileSync('output/' + candidatesFile, 'utf-8'));
const patents = data.candidates.sort((a, b) => b.score - a.score).slice(0, $top_n);

function getCacheSet(dir) {
  if (!fs.existsSync(dir)) return new Set();
  return new Set(fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')));
}

const llmSet = getCacheSet('cache/llm-scores');
const prosSet = getCacheSet('cache/prosecution-scores');
const iprSet = getCacheSet('cache/ipr-scores');
const familySet = getCacheSet('cache/patent-families/parents');

const needLlm = patents.filter(p => !llmSet.has(p.patent_id));
const needPros = patents.filter(p => !prosSet.has(p.patent_id));
const needIpr = patents.filter(p => !iprSet.has(p.patent_id));
const needFamily = patents.filter(p => !familySet.has(p.patent_id));

console.log(JSON.stringify({
  llm: { need: needLlm.length, ids: needLlm.map(p => p.patent_id) },
  pros: { need: needPros.length, ids: needPros.map(p => p.patent_id) },
  ipr: { need: needIpr.length, ids: needIpr.map(p => p.patent_id) },
  family: { need: needFamily.length, ids: needFamily.map(p => p.patent_id) }
}));
"
}

# Function to analyze gaps for sector-based mode
analyze_gaps_sector() {
    local filter_type=$1  # "super-sector" or "sector"
    local filter_name=$2
    npx tsx -e "
const fs = require('fs');
const candidatesFile = fs.readdirSync('output')
  .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
  .sort().pop();
const data = JSON.parse(fs.readFileSync('output/' + candidatesFile, 'utf-8'));

// Filter by sector
const filterType = '$filter_type';
const filterName = '$filter_name';

let patents;
if (filterType === 'super-sector') {
  patents = data.candidates.filter(p => p.super_sector === filterName);
} else {
  patents = data.candidates.filter(p => p.primary_sector === filterName);
}

// Sort by score descending
patents = patents.sort((a, b) => b.score - a.score);

function getCacheSet(dir) {
  if (!fs.existsSync(dir)) return new Set();
  return new Set(fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')));
}

const llmSet = getCacheSet('cache/llm-scores');
const prosSet = getCacheSet('cache/prosecution-scores');
const iprSet = getCacheSet('cache/ipr-scores');
const familySet = getCacheSet('cache/patent-families/parents');

const needLlm = patents.filter(p => !llmSet.has(p.patent_id));
const needPros = patents.filter(p => !prosSet.has(p.patent_id));
const needIpr = patents.filter(p => !iprSet.has(p.patent_id));
const needFamily = patents.filter(p => !familySet.has(p.patent_id));

console.log(JSON.stringify({
  totalInSector: patents.length,
  llm: { need: needLlm.length, ids: needLlm.map(p => p.patent_id) },
  pros: { need: needPros.length, ids: needPros.map(p => p.patent_id) },
  ipr: { need: needIpr.length, ids: needIpr.map(p => p.patent_id) },
  family: { need: needFamily.length, ids: needFamily.map(p => p.patent_id) }
}));
"
}

# Function to run enrichment loop
run_enrichment_loop() {
    local mode=$1
    local max_hours=$2
    local top_n=$3
    local sector_name=$4

    local start_time=$(date +%s)
    local max_runtime_secs=$((max_hours * 3600))
    local end_time=$((start_time + max_runtime_secs))

    echo ""
    echo "═══════════════════════════════════════════════════════════"
    if [ "$mode" = "tier" ]; then
        echo "ENRICHMENT MODE: Tier-Based (Top $top_n)"
    elif [ "$mode" = "super-sector" ]; then
        echo "ENRICHMENT MODE: Super-Sector \"$sector_name\""
    else
        echo "ENRICHMENT MODE: Sector \"$sector_name\""
    fi
    echo "═══════════════════════════════════════════════════════════"
    echo "Started: $(date)"
    echo "Max runtime: $max_hours hours"

    while true; do
        current_time=$(date +%s)
        if [ $current_time -ge $end_time ]; then
            echo ""
            echo "Max runtime reached for this job. Moving on."
            break
        fi

        remaining_mins=$(( (end_time - current_time) / 60 ))
        echo ""
        echo "─── Analysis ($remaining_mins min remaining) ───"

        # IMPORTANT: Import any pending LLM results first
        import_llm_results

        # Get current gaps based on mode
        if [ "$mode" = "tier" ]; then
            GAPS=$(analyze_gaps_tier "$top_n")
        else
            GAPS=$(analyze_gaps_sector "$mode" "$sector_name")
            TOTAL_IN_SECTOR=$(echo "$GAPS" | jq -r '.totalInSector')
            echo "Total patents in sector: $TOTAL_IN_SECTOR"
        fi

        LLM_NEED=$(echo "$GAPS" | jq -r '.llm.need')
        PROS_NEED=$(echo "$GAPS" | jq -r '.pros.need')
        IPR_NEED=$(echo "$GAPS" | jq -r '.ipr.need')
        FAMILY_NEED=$(echo "$GAPS" | jq -r '.family.need')

        echo "Gaps: LLM=$LLM_NEED, Prosecution=$PROS_NEED, IPR=$IPR_NEED, Families=$FAMILY_NEED"

        # Check if all done
        if [ "$LLM_NEED" -eq 0 ] && [ "$PROS_NEED" -eq 0 ] && [ "$IPR_NEED" -eq 0 ] && [ "$FAMILY_NEED" -eq 0 ]; then
            echo ""
            if [ "$mode" = "tier" ]; then
                echo "ALL ENRICHMENT COMPLETE for top $top_n patents!"
            else
                echo "ALL ENRICHMENT COMPLETE for $mode \"$sector_name\"!"
            fi
            break
        fi

        # Check what jobs are running
        LLM_RUNNING=$(pgrep -f "run-llm-analysis" > /dev/null && echo "1" || echo "0")
        PROS_RUNNING=$(pgrep -f "check-prosecution" > /dev/null && echo "1" || echo "0")
        IPR_RUNNING=$(pgrep -f "check-ipr" > /dev/null && echo "1" || echo "0")
        FAMILY_RUNNING=$(pgrep -f "enrich-citations" > /dev/null && echo "1" || echo "0")

        # Start LLM if not running and needed
        if [ "$LLM_RUNNING" -eq 0 ] && [ "$LLM_NEED" -gt 0 ]; then
            BATCH_SIZE=$(( LLM_NEED < 500 ? LLM_NEED : 500 ))
            echo "Starting LLM for $BATCH_SIZE patents..."
            echo "$GAPS" | jq -r ".llm.ids[:$BATCH_SIZE] | .[]" | jq -Rs 'split("\n") | map(select(length > 0))' > /tmp/auto-llm-batch.json
            nohup npx tsx scripts/run-llm-analysis-v3.ts /tmp/auto-llm-batch.json > "$LOG_DIR/auto-llm-$(date +%Y%m%d-%H%M%S).log" 2>&1 &
            echo "  Started LLM job (PID: $!)"
        fi

        # Start Prosecution if not running and needed
        if [ "$PROS_RUNNING" -eq 0 ] && [ "$PROS_NEED" -gt 0 ]; then
            BATCH_SIZE=$(( PROS_NEED < 500 ? PROS_NEED : 500 ))
            echo "Starting Prosecution for $BATCH_SIZE patents..."
            echo "$GAPS" | jq -r ".pros.ids[:$BATCH_SIZE] | .[]" | jq -Rs 'split("\n") | map(select(length > 0))' > /tmp/auto-pros-batch.json
            nohup npx tsx scripts/check-prosecution-history.ts /tmp/auto-pros-batch.json > "$LOG_DIR/auto-pros-$(date +%Y%m%d-%H%M%S).log" 2>&1 &
            echo "  Started Prosecution job (PID: $!)"
        fi

        # Start IPR if not running and needed
        if [ "$IPR_RUNNING" -eq 0 ] && [ "$IPR_NEED" -gt 0 ]; then
            BATCH_SIZE=$(( IPR_NEED < 500 ? IPR_NEED : 500 ))
            echo "Starting IPR for $BATCH_SIZE patents..."
            echo "$GAPS" | jq -r ".ipr.ids[:$BATCH_SIZE] | .[]" | jq -Rs 'split("\n") | map(select(length > 0))' > /tmp/auto-ipr-batch.json
            nohup npx tsx scripts/check-ipr-risk.ts /tmp/auto-ipr-batch.json > "$LOG_DIR/auto-ipr-$(date +%Y%m%d-%H%M%S).log" 2>&1 &
            echo "  Started IPR job (PID: $!)"
        fi

        # Start Family/Citation if not running and needed
        if [ "$FAMILY_RUNNING" -eq 0 ] && [ "$FAMILY_NEED" -gt 0 ]; then
            BATCH_SIZE=$(( FAMILY_NEED < 500 ? FAMILY_NEED : 500 ))
            echo "Starting Family/Citation for $BATCH_SIZE patents..."
            echo "$GAPS" | jq -r ".family.ids[:$BATCH_SIZE] | .[]" | head -500 | tr '\n' ',' | sed 's/,$//' > /tmp/auto-family-ids.txt
            nohup npx tsx scripts/enrich-citations.ts --patent-ids "$(cat /tmp/auto-family-ids.txt)" > "$LOG_DIR/auto-family-$(date +%Y%m%d-%H%M%S).log" 2>&1 &
            echo "  Started Family job (PID: $!)"
        fi

        # Wait before next check
        echo "Waiting 5 minutes before next check..."
        sleep 300
    done

    # Final import of any remaining LLM results
    echo ""
    echo "Final LLM import..."
    import_llm_results
}

# Queue mode: run multiple jobs in sequence
run_queue() {
    local queue_file=$1

    echo "═══════════════════════════════════════════════════════════"
    echo "ENRICHMENT QUEUE MODE"
    echo "═══════════════════════════════════════════════════════════"
    echo "Queue file: $queue_file"
    echo "Started: $(date)"
    echo ""

    # Parse queue file and run each job
    local job_count=$(jq '. | length' "$queue_file")
    echo "Total jobs in queue: $job_count"

    for i in $(seq 0 $((job_count - 1))); do
        local job_mode=$(jq -r ".[$i].mode" "$queue_file")
        local job_hours=$(jq -r ".[$i].maxHours // 4" "$queue_file")

        echo ""
        echo "─── Queue Job $((i+1))/$job_count ───"

        case $job_mode in
            tier)
                local job_topn=$(jq -r ".[$i].topN // 6000" "$queue_file")
                run_enrichment_loop "tier" "$job_hours" "$job_topn" ""
                ;;
            super-sector)
                local job_name=$(jq -r ".[$i].name" "$queue_file")
                run_enrichment_loop "super-sector" "$job_hours" "" "$job_name"
                ;;
            sector)
                local job_name=$(jq -r ".[$i].name" "$queue_file")
                run_enrichment_loop "sector" "$job_hours" "" "$job_name"
                ;;
            *)
                echo "Unknown mode: $job_mode, skipping"
                ;;
        esac
    done

    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "QUEUE COMPLETE"
    echo "Ended: $(date)"
    echo "═══════════════════════════════════════════════════════════"
}

# Main execution
case $MODE in
    queue)
        if [ ! -f "$QUEUE_FILE" ]; then
            echo "Queue file not found: $QUEUE_FILE"
            exit 1
        fi
        run_queue "$QUEUE_FILE"
        ;;
    tier)
        run_enrichment_loop "tier" "$MAX_HOURS" "$TOP_N" ""
        echo ""
        echo "═══════════════════════════════════════════════════════════"
        echo "ENRICHMENT SESSION COMPLETE"
        echo "Ended: $(date)"
        echo "═══════════════════════════════════════════════════════════"
        ;;
    super-sector|sector)
        run_enrichment_loop "$MODE" "$MAX_HOURS" "" "$SECTOR_NAME"
        echo ""
        echo "═══════════════════════════════════════════════════════════"
        echo "ENRICHMENT SESSION COMPLETE"
        echo "Ended: $(date)"
        echo "═══════════════════════════════════════════════════════════"
        ;;
esac
