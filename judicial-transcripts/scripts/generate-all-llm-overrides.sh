#!/bin/bash

# Script to generate LLM overrides for all trials that need them
# Run from project root: ./scripts/generate-all-llm-overrides.sh

echo "================================================"
echo "LLM Override Generation for All Trials"
echo "================================================"
echo ""

# Counter variables
TOTAL=0
SUCCESS=0
FAILED=0
SKIPPED=0

# Process each trial directory
for dir in output/multi-trial/*/; do
  if [ -d "$dir" ]; then
    TRIAL_NAME=$(basename "$dir")
    METADATA_FILE="$dir/trial-metadata.json"
    
    TOTAL=$((TOTAL + 1))
    
    # Check if metadata already exists
    if [ -f "$METADATA_FILE" ]; then
      echo "[$TOTAL] ⏭️  Skipping $TRIAL_NAME - metadata already exists"
      SKIPPED=$((SKIPPED + 1))
    else
      echo "[$TOTAL] 🔄 Processing $TRIAL_NAME..."
      
      # Run the extraction
      if npx ts-node src/cli/override.ts extract \
        --trial-path "$dir" \
        --output "$METADATA_FILE" 2>/dev/null; then
        echo "    ✅ Successfully generated metadata"
        SUCCESS=$((SUCCESS + 1))
      else
        echo "    ❌ Failed to generate metadata"
        FAILED=$((FAILED + 1))
      fi
    fi
    
    # Add a small delay to avoid overwhelming the API
    sleep 2
  fi
done

echo ""
echo "================================================"
echo "Summary"
echo "================================================"
echo "Total trials:    $TOTAL"
echo "✅ Successful:   $SUCCESS"
echo "❌ Failed:       $FAILED"
echo "⏭️  Skipped:      $SKIPPED"
echo ""

# Update database workflow states
echo "Updating database workflow states..."
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts -c "
  UPDATE \"TrialWorkflowState\" tw
  SET \"llmOverrideCompleted\" = true
  FROM \"Trial\" t
  WHERE tw.\"trialId\" = t.id
  AND EXISTS (
    SELECT 1 FROM unnest(string_to_array('$(ls -1 output/multi-trial/*/trial-metadata.json 2>/dev/null | xargs -I {} dirname {} | xargs -I {} basename {})', E'\\n')) AS dir
    WHERE t.\"shortName\" = dir
  );" 2>/dev/null

echo "Done!"