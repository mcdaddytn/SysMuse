#!/bin/bash

# Batch processing script for running Phase 2 and Phase 3 on multiple trials
# With Elasticsearch lifecycle management

set -e  # Exit on error

# Configuration
LOG_DIR="./logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/phase23-batch-$TIMESTAMP.log"

# Create log directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Function to log messages
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Function to process a single trial
process_trial() {
    local TRIAL_ID=$1
    local TRIAL_NAME=$2
    local CONFIG_FILE=$3
    
    log_message "=========================================="
    log_message "Processing Trial $TRIAL_ID: $TRIAL_NAME"
    log_message "=========================================="
    
    # Run Phase 2
    log_message "Starting Phase 2 for trial $TRIAL_ID..."
    if npx ts-node src/cli/parse.ts parse --phase2 --config "$CONFIG_FILE" --trial-id "$TRIAL_ID" >> "$LOG_FILE" 2>&1; then
        log_message "✓ Phase 2 completed for trial $TRIAL_ID"
    else
        log_message "✗ Phase 2 failed for trial $TRIAL_ID"
        return 1
    fi
    
    # Run Phase 3 with cleanup
    log_message "Starting Phase 3 for trial $TRIAL_ID..."
    if npx ts-node src/cli/phase3.ts process -t "$TRIAL_ID" --cleanup-after >> "$LOG_FILE" 2>&1; then
        log_message "✓ Phase 3 completed for trial $TRIAL_ID (ES data cleaned)"
    else
        log_message "✗ Phase 3 failed for trial $TRIAL_ID"
        return 1
    fi
    
    log_message "✓ Successfully processed trial $TRIAL_ID"
    return 0
}

# Main script
main() {
    log_message "Starting batch processing of Phase 2 and Phase 3"
    log_message "Log file: $LOG_FILE"
    
    # Check for arguments
    if [ $# -eq 0 ]; then
        echo "Usage: $0 <start_trial_id> <end_trial_id> [config_file]"
        echo "Example: $0 2 10 config/example-trial-config-mac.json"
        exit 1
    fi
    
    START_TRIAL=$1
    END_TRIAL=$2
    CONFIG_FILE=${3:-"config/example-trial-config-mac.json"}
    
    if [ ! -f "$CONFIG_FILE" ]; then
        log_message "Error: Configuration file not found: $CONFIG_FILE"
        exit 1
    fi
    
    log_message "Configuration:"
    log_message "  - Start Trial ID: $START_TRIAL"
    log_message "  - End Trial ID: $END_TRIAL"
    log_message "  - Config File: $CONFIG_FILE"
    
    # Get trial information from database
    log_message "Fetching trial information..."
    
    # Track statistics
    TOTAL_TRIALS=0
    SUCCESSFUL_TRIALS=0
    FAILED_TRIALS=0
    
    # Process each trial in range
    for TRIAL_ID in $(seq $START_TRIAL $END_TRIAL); do
        # Get trial name from database
        TRIAL_NAME=$(npx ts-node -e "
            const { PrismaClient } = require('@prisma/client');
            const prisma = new PrismaClient();
            prisma.trial.findUnique({ where: { id: $TRIAL_ID } })
                .then(t => console.log(t ? t.name : 'NOT_FOUND'))
                .finally(() => prisma.\$disconnect());
        " 2>/dev/null)
        
        if [ "$TRIAL_NAME" == "NOT_FOUND" ] || [ -z "$TRIAL_NAME" ]; then
            log_message "Warning: Trial $TRIAL_ID not found in database, skipping..."
            continue
        fi
        
        TOTAL_TRIALS=$((TOTAL_TRIALS + 1))
        
        if process_trial "$TRIAL_ID" "$TRIAL_NAME" "$CONFIG_FILE"; then
            SUCCESSFUL_TRIALS=$((SUCCESSFUL_TRIALS + 1))
        else
            FAILED_TRIALS=$((FAILED_TRIALS + 1))
            log_message "Warning: Failed to process trial $TRIAL_ID, continuing with next trial..."
        fi
        
        # Check Elasticsearch status periodically
        if [ $((TOTAL_TRIALS % 5)) -eq 0 ]; then
            log_message "Checking Elasticsearch status..."
            npx ts-node src/cli/es-lifecycle.ts status >> "$LOG_FILE" 2>&1
        fi
    done
    
    # Final summary
    log_message "=========================================="
    log_message "BATCH PROCESSING COMPLETE"
    log_message "=========================================="
    log_message "Total trials processed: $TOTAL_TRIALS"
    log_message "Successful: $SUCCESSFUL_TRIALS"
    log_message "Failed: $FAILED_TRIALS"
    
    # Final Elasticsearch status
    log_message "Final Elasticsearch status:"
    npx ts-node src/cli/es-lifecycle.ts status | tee -a "$LOG_FILE"
    
    if [ $FAILED_TRIALS -gt 0 ]; then
        log_message "⚠️  Some trials failed. Check the log for details: $LOG_FILE"
        exit 1
    else
        log_message "✅ All trials processed successfully!"
    fi
}

# Run main function with all arguments
main "$@"