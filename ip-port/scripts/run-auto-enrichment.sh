#!/bin/bash
#
# Automated Enrichment Script (with LLM import fix)
# Fills out enrichment data for top N patents with no intervention required
#
# Usage: ./scripts/run-auto-enrichment.sh [TOP_N] [MAX_HOURS]
#

set -e

TOP_N=${1:-6000}
MAX_HOURS=${2:-4}
LOG_DIR="logs"

START_TIME=$(date +%s)
MAX_RUNTIME_SECS=$((MAX_HOURS * 3600))
END_TIME=$((START_TIME + MAX_RUNTIME_SECS))

echo "═══════════════════════════════════════════════════════════"
echo "AUTOMATED ENRICHMENT - Top $TOP_N Patents"
echo "═══════════════════════════════════════════════════════════"
echo "Started: $(date)"
echo "Max runtime: $MAX_HOURS hours"
echo ""

# Function to import LLM results to cache
import_llm_results() {
    echo "  Importing LLM results to cache..."
    for f in output/llm-analysis-v3/combined-v3-*.json; do
        if [ -f "$f" ]; then
            npx tsx scripts/import-llm-scores.ts "$f" 2>/dev/null | grep -E "imported|skipped" | head -1 || true
        fi
    done
}

# Function to analyze gaps
analyze_gaps() {
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

# Main loop
while true; do
    current_time=$(date +%s)
    if [ $current_time -ge $END_TIME ]; then
        echo ""
        echo "Max runtime reached. Stopping."
        break
    fi

    remaining_mins=$(( (END_TIME - current_time) / 60 ))
    echo ""
    echo "─── Analysis ($remaining_mins min remaining) ───"
    
    # IMPORTANT: Import any pending LLM results first
    import_llm_results
    
    # Get current gaps
    GAPS=$(analyze_gaps $TOP_N)
    
    LLM_NEED=$(echo "$GAPS" | jq -r '.llm.need')
    PROS_NEED=$(echo "$GAPS" | jq -r '.pros.need')
    IPR_NEED=$(echo "$GAPS" | jq -r '.ipr.need')
    FAMILY_NEED=$(echo "$GAPS" | jq -r '.family.need')
    
    echo "Gaps: LLM=$LLM_NEED, Prosecution=$PROS_NEED, IPR=$IPR_NEED, Families=$FAMILY_NEED"
    
    # Check if all done
    if [ "$LLM_NEED" -eq 0 ] && [ "$PROS_NEED" -eq 0 ] && [ "$IPR_NEED" -eq 0 ] && [ "$FAMILY_NEED" -eq 0 ]; then
        echo ""
        echo "ALL ENRICHMENT COMPLETE for top $TOP_N patents!"
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

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "ENRICHMENT SESSION COMPLETE"
echo "Ended: $(date)"
echo "═══════════════════════════════════════════════════════════"
