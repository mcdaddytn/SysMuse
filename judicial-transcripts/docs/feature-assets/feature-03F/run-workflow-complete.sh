#!/bin/bash

# Run complete workflow with optional system reset
# This script will process all trials through all phases

echo "Complete Workflow Execution"
echo "==========================="

# Parse command line arguments
RESET_SYSTEM=false
VERBOSE=false
CONFIG_FILE="config/multi-trial-config-mac.json"

while [[ $# -gt 0 ]]; do
    case $1 in
        --reset-system)
            RESET_SYSTEM=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --config)
            CONFIG_FILE="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--reset-system] [--verbose] [--config file]"
            exit 1
            ;;
    esac
done

# Check if configuration file exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: Configuration file not found: $CONFIG_FILE"
    exit 1
fi

echo "Configuration: $CONFIG_FILE"
echo "Reset System: $RESET_SYSTEM"
echo "Verbose: $VERBOSE"
echo ""

# Build command
CMD="npx ts-node src/cli/workflow.ts run --phase phase3 --config \"$CONFIG_FILE\""

if [ "$RESET_SYSTEM" = true ]; then
    CMD="$CMD --reset-system"
    echo "WARNING: System will be reset before processing!"
    echo "This will clear the database and reload seed data."
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
fi

if [ "$VERBOSE" = true ]; then
    CMD="$CMD --verbose"
fi

# Execute workflow
echo "Starting workflow..."
echo "Command: $CMD"
echo ""

eval $CMD

# Check exit status
if [ $? -eq 0 ]; then
    echo ""
    echo "========================================="
    echo "Workflow completed successfully!"
    echo "All trials processed through Phase 3"
    echo ""
    echo "Next steps:"
    echo "  - Check status: npm run workflow:status"
    echo "  - Generate reports: npm run reports:all"
    echo "  - Query data: npm run query"
else
    echo ""
    echo "========================================="
    echo "Workflow failed. Check logs for details."
    echo "To resume, run: npm run workflow:resume"
    exit 1
fi