#!/bin/bash

# Script to run phase1 parsing on all converted trials
# Feature 03C - Mass trial processing

echo "Starting Phase 1 parsing on all trials..."
echo "========================================="

# Counter for processed trials
SUCCESS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

# Create a log file
LOG_FILE="phase1-all-$(date +%Y%m%d-%H%M%S).log"
echo "Log file: $LOG_FILE"
echo ""

# Process each trial directory
for dir in ./output/multi-trial/*/; do
  TRIAL_NAME=$(basename "$dir")
  echo "Processing: $TRIAL_NAME"
  
  # Check if trialstyle.json exists
  if [ ! -f "$dir/trialstyle.json" ]; then
    echo "  ⚠️  Skipping - no trialstyle.json found"
    ((SKIP_COUNT++))
    continue
  fi
  
  # Check if there are ordered files
  ORDERED_COUNT=$(jq '.orderedFiles | length' "$dir/trialstyle.json")
  if [ "$ORDERED_COUNT" -eq 0 ]; then
    echo "  ⚠️  Skipping - no ordered files"
    ((SKIP_COUNT++))
    continue
  fi
  
  # Create trial-specific config
  CONFIG_FILE="config/trial-${TRIAL_NAME//[^a-zA-Z0-9]/_}.json"
  cat > "$CONFIG_FILE" << EOFC
{
  "inputDir": "$dir",
  "outputDir": "$dir",
  "logLevel": "info",
  "parserMode": "multi-pass",
  "trialName": "$TRIAL_NAME"
}
EOFC
  
  # Run phase1 parsing
  echo "  Running phase1 with multi-pass parser..."
  if npx ts-node src/cli/parse.ts parse --phase1 --config "$CONFIG_FILE" --parser-mode multi-pass >> "$LOG_FILE" 2>&1; then
    echo "  ✅ Success"
    ((SUCCESS_COUNT++))
  else
    echo "  ❌ Failed (see log for details)"
    ((FAIL_COUNT++))
  fi
  
  echo ""
done

echo "========================================="
echo "Phase 1 Parsing Complete!"
echo "  Successful: $SUCCESS_COUNT trials"
echo "  Failed: $FAIL_COUNT trials"
echo "  Skipped: $SKIP_COUNT trials"
echo ""
echo "Check $LOG_FILE for detailed output"
