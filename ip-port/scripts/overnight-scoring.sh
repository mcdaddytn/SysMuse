#!/bin/zsh
# Overnight LLM Scoring Script
# Runs scoring jobs for all sectors, maintaining N parallel jobs
# Usage: ./scripts/overnight-scoring.sh [max_parallel] [top_n]
#   max_parallel: number of parallel jobs (default: 8)
#   top_n: patents per batch, 0 = all remaining (default: 0 for overnight)

set -e

MAX_PARALLEL=${1:-8}
TOP_N=${2:-0}  # 0 = score all remaining patents
API_BASE="http://localhost:3001/api"
LOG_FILE="/tmp/overnight-scoring-$(date +%Y%m%d-%H%M%S).log"
POLL_INTERVAL=60  # seconds between status checks

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log_color() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ${1}${2}${NC}" | tee -a "$LOG_FILE"
}

# Check if API is running
check_api() {
    if ! curl -s "$API_BASE/health" > /dev/null 2>&1; then
        log_color "$RED" "ERROR: API server not responding at $API_BASE"
        exit 1
    fi
}

# Get sector progress
get_sector_progress() {
    local sector=$1
    curl -s "$API_BASE/scoring-templates/llm/sector-progress/$sector" 2>/dev/null
}

# Start a scoring job for a sector
start_job() {
    local sector=$1
    local top_n=$2

    log_color "$GREEN" "Starting job: $sector (topN=$top_n, useClaims=true)"

    local url="$API_BASE/scoring-templates/llm/score-sector/$sector?useClaims=true"
    if [ "$top_n" -gt 0 ]; then
        url="$url&topN=$top_n"
    fi

    # Start job in background
    curl -s -X POST "$url" > /dev/null 2>&1 &
}

# Count active jobs from log
count_active_jobs() {
    strings /tmp/api-server.log 2>/dev/null | grep "\[LLM Scoring\] Sector" | tail -100 | awk '{print $4}' | tr -d ':' | sort -u | wc -l | tr -d ' '
}

# Check if a sector is currently being scored (has recent log activity)
is_sector_active() {
    local sector=$1
    local recent=$(strings /tmp/api-server.log 2>/dev/null | grep "\[LLM Scoring\] Sector $sector:" | tail -1)
    [ -n "$recent" ]
}

# Main function
main() {
    log "=========================================="
    log "Overnight Scoring Script Started"
    log "Max Parallel Jobs: $MAX_PARALLEL"
    log "Patents per batch: $([ $TOP_N -eq 0 ] && echo 'ALL' || echo $TOP_N)"
    log "Log file: $LOG_FILE"
    log "=========================================="

    check_api
    log_color "$GREEN" "API server is healthy"

    # Get sectors ordered by remaining patents (largest first)
    log "Analyzing sectors..."

    typeset -a sectors_to_score
    typeset -a sectors_remaining

    local all_sectors=$(curl -s "$API_BASE/sectors" 2>/dev/null | jq -r '.[].name')

    for sector in ${(f)all_sectors}; do
        local prog=$(get_sector_progress "$sector")
        local total=$(echo "$prog" | jq -r '.total // 0')
        local scored=$(echo "$prog" | jq -r '.scored // 0')
        local remaining=$((total - scored))

        if [ "$remaining" -gt 0 ]; then
            sectors_to_score+=("$sector")
            sectors_remaining+=("$remaining")
            log "  - $sector: $scored/$total scored, $remaining remaining"
        fi
    done

    local total_sectors=${#sectors_to_score[@]}
    log ""
    log "Found $total_sectors sectors with remaining patents"
    log ""
    log "Starting scoring jobs..."

    # Track queued sectors
    typeset -a queued
    local sector_index=1  # zsh arrays start at 1

    while true; do
        # Check current active jobs
        local active=$(count_active_jobs)

        # Queue new jobs if we have capacity
        while [ "$active" -lt "$MAX_PARALLEL" ] && [ "$sector_index" -le "$total_sectors" ]; do
            local sector="${sectors_to_score[$sector_index]}"

            # Check if already fully scored
            local prog=$(get_sector_progress "$sector")
            local total=$(echo "$prog" | jq -r '.total // 0')
            local scored=$(echo "$prog" | jq -r '.scored // 0')

            if [ "$scored" -lt "$total" ]; then
                start_job "$sector" "$TOP_N"
                queued+=("$sector")
                sleep 3  # Brief pause between starting jobs
                active=$((active + 1))
            fi

            sector_index=$((sector_index + 1))
        done

        # Show progress update
        log ""
        log_color "$BLUE" "=== Progress Update ($(date '+%H:%M:%S')) ==="

        local any_running=false
        local all_complete=true

        for sector in $queued; do
            local prog=$(get_sector_progress "$sector")
            local total=$(echo "$prog" | jq -r '.total // 0')
            local scored=$(echo "$prog" | jq -r '.scored // 0')
            local pct=$(echo "$prog" | jq -r '.percentComplete // 0')

            if [ "$scored" -lt "$total" ]; then
                all_complete=false
                if is_sector_active "$sector"; then
                    log "  [RUNNING] $sector: $scored/$total ($pct%)"
                    any_running=true
                else
                    log "  [WAITING] $sector: $scored/$total ($pct%)"
                fi
            else
                log_color "$GREEN" "  [DONE] $sector: $scored/$total (100%)"
            fi
        done

        # Check if all done
        if [ "$sector_index" -gt "$total_sectors" ] && [ "$all_complete" = true ]; then
            log ""
            log_color "$GREEN" "=========================================="
            log_color "$GREEN" "All scoring jobs completed!"
            log_color "$GREEN" "=========================================="
            break
        fi

        # If nothing running but more to do, we might have hit rate limits - wait longer
        if [ "$any_running" = false ] && [ "$all_complete" = false ]; then
            log "  (No active jobs detected - waiting for API...)"
        fi

        sleep $POLL_INTERVAL
    done

    # Final summary
    log ""
    log "=========================================="
    log "Final Summary"
    log "=========================================="

    local total_scored=0
    for sector in $queued; do
        local prog=$(get_sector_progress "$sector")
        local scored=$(echo "$prog" | jq -r '.scored // 0')
        local total=$(echo "$prog" | jq -r '.total // 0')
        local avg=$(echo "$prog" | jq -r '.avgScore // "N/A"')
        log "  $sector: $scored/$total, avg score: $avg"
        total_scored=$((total_scored + scored))
    done

    log ""
    log "Total patents scored: $total_scored"
    log "Overnight scoring complete at $(date)"
    log "Full log saved to: $LOG_FILE"
}

# Handle interrupts gracefully
trap 'log_color "$YELLOW" "Script interrupted. Jobs may still be running in background."; exit 1' INT TERM

# Run main function
main
