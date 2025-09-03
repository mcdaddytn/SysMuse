#!/bin/bash

# Run workflow to Phase 2 for all trials in configuration
# This will automatically run any prerequisite steps

echo "Starting workflow execution to Phase 2..."
echo "======================================="

# Check if configuration file exists
CONFIG_FILE="config/multi-trial-config-mac.json"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: Configuration file not found: $CONFIG_FILE"
    exit 1
fi

# Run workflow to Phase 2
npx ts-node src/cli/workflow.ts run \
  --phase phase2 \
  --config "$CONFIG_FILE" \
  --verbose

# Check exit status
if [ $? -eq 0 ]; then
    echo ""
    echo "Workflow completed successfully to Phase 2"
    echo "Use 'npm run workflow:status' to check trial states"
else
    echo ""
    echo "Workflow failed. Check logs for details."
    exit 1
fi