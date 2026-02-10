#!/bin/bash
# Quick monitoring script for scoring jobs
# Usage: ./scripts/monitor-scoring.sh [interval_seconds]

INTERVAL=${1:-10}
API_BASE="http://localhost:3001/api"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

while true; do
    clear
    echo -e "${BLUE}=== LLM Scoring Monitor ===${NC}"
    echo "$(date)"
    echo ""

    # Get recent activity from log
    echo -e "${YELLOW}Active Jobs (last 30 seconds):${NC}"
    strings /tmp/api-server.log 2>/dev/null | grep "\[LLM Scoring\] Sector" | tail -20 | \
        awk '{print $4, $5}' | sort -u | while read line; do
        echo "  $line"
    done

    echo ""
    echo -e "${YELLOW}Overall Progress:${NC}"

    # Get all sectors and show summary
    total_scored=0
    total_patents=0

    for sector in $(curl -s "$API_BASE/sectors" 2>/dev/null | jq -r '.[].name'); do
        result=$(curl -s "$API_BASE/scoring-templates/llm/sector-progress/$sector" 2>/dev/null)
        scored=$(echo "$result" | jq -r '.scored // 0')
        total=$(echo "$result" | jq -r '.total // 0')

        if [ "$scored" -gt 0 ]; then
            pct=$(echo "$result" | jq -r '.percentComplete // 0')
            remaining=$((total - scored))

            if [ "$pct" -eq 100 ]; then
                echo -e "  ${GREEN}[DONE]${NC} $sector: $scored/$total"
            elif [ "$remaining" -gt 0 ]; then
                echo "  [${pct}%] $sector: $scored/$total ($remaining left)"
            fi

            total_scored=$((total_scored + scored))
            total_patents=$((total_patents + total))
        fi
    done

    echo ""
    echo -e "${GREEN}Total: $total_scored patents scored${NC}"
    echo ""
    echo "Press Ctrl+C to exit. Refreshing in ${INTERVAL}s..."

    sleep $INTERVAL
done
