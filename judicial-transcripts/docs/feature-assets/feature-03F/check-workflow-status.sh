#!/bin/bash

# Check workflow status for trials
# Can check specific trial or all trials

echo "Workflow Status Check"
echo "===================="

# Parse command line arguments
TRIAL_ID=""
ALL_TRIALS=false
FORMAT="table"  # table, json, summary

while [[ $# -gt 0 ]]; do
    case $1 in
        --trial-id|-t)
            TRIAL_ID="$2"
            shift 2
            ;;
        --all|-a)
            ALL_TRIALS=true
            shift
            ;;
        --format|-f)
            FORMAT="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  --trial-id, -t ID   Check specific trial by ID"
            echo "  --all, -a           Check all trials"
            echo "  --format, -f TYPE   Output format (table|json|summary)"
            echo "  --help, -h          Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Build command
if [ -n "$TRIAL_ID" ]; then
    echo "Checking status for Trial ID: $TRIAL_ID"
    CMD="npx ts-node src/cli/workflow.ts status --trial-id $TRIAL_ID --format $FORMAT"
elif [ "$ALL_TRIALS" = true ]; then
    echo "Checking status for all trials..."
    CMD="npx ts-node src/cli/workflow.ts status --all --format $FORMAT"
else
    echo "Checking status for active trials..."
    CMD="npx ts-node src/cli/workflow.ts status --format $FORMAT"
fi

echo ""

# Execute command
eval $CMD

# Add summary information if table format
if [ "$FORMAT" = "table" ] && [ $? -eq 0 ]; then
    echo ""
    echo "Legend:"
    echo "  ✓ - Completed"
    echo "  ⏳ - In Progress"
    echo "  ⏸ - Pending"
    echo "  ✗ - Failed"
    echo "  ⏭ - Skipped"
    echo ""
    echo "Use --format json for detailed information"
fi