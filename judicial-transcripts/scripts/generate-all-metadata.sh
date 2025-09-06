#!/bin/bash

# Script to generate metadata for all trials in output/multi-trial

OUTPUT_DIR="./output/multi-trial"
FAILED_TRIALS=""
SUCCESS_COUNT=0
SKIP_COUNT=0
FAIL_COUNT=0

echo "Starting metadata generation for all trials..."
echo "=========================================="

for trial_dir in "$OUTPUT_DIR"/*; do
  if [ -d "$trial_dir" ]; then
    trial_name=$(basename "$trial_dir")
    metadata_file="$trial_dir/trial-metadata.json"
    
    # Skip if metadata already exists
    if [ -f "$metadata_file" ]; then
      echo "✓ Skipping $trial_name (metadata exists)"
      ((SKIP_COUNT++))
      continue
    fi
    
    echo ""
    echo "Processing: $trial_name"
    echo "----------------------------------------"
    
    # Run the extraction
    if npx ts-node src/cli/override.ts extract \
      --trial-path "$trial_dir" \
      --output "$metadata_file" \
      --provider openai \
      --model gpt-4 \
      --save-prompt 2>&1 | grep -E "(validated successfully|Error|Failed)"; then
      echo "✓ Success: $trial_name"
      ((SUCCESS_COUNT++))
    else
      echo "✗ Failed: $trial_name"
      FAILED_TRIALS="$FAILED_TRIALS\n  - $trial_name"
      ((FAIL_COUNT++))
    fi
    
    # Add a small delay to avoid rate limiting
    sleep 2
  fi
done

echo ""
echo "=========================================="
echo "SUMMARY:"
echo "  Successful: $SUCCESS_COUNT"
echo "  Skipped: $SKIP_COUNT"
echo "  Failed: $FAIL_COUNT"

if [ ! -z "$FAILED_TRIALS" ]; then
  echo ""
  echo "Failed trials:"
  echo -e "$FAILED_TRIALS"
fi

echo ""
echo "Metadata generation complete!"