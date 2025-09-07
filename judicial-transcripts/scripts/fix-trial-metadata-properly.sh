#!/bin/bash

# Script to properly fix trial-metadata.json files in source directories
# - Sets overrideAction to "upsert" in Trial[0] object
# - Removes caseHandle from Trial[0] object
# - Sets userReviewed to true in metadata section
# - Sets reviewedBy and reviewedAt in metadata section

echo "Fixing trial-metadata.json files in source directories..."

# Counter for tracking
count=0
failed=0

# Get current timestamp
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

# Process all trial-metadata.json files in source directory
for metadata_file in "/Users/gmcaveney/GrassLabel Dropbox/Grass Label Home/docs/transcripts/pdf/"*/trial-metadata.json; do
    if [ -f "$metadata_file" ]; then
        trial_dir=$(dirname "$metadata_file")
        trial_name=$(basename "$trial_dir")
        
        echo "Processing: $trial_name"
        
        # Use jq to properly modify the JSON structure
        jq --arg timestamp "$TIMESTAMP" '
          # Fix Trial array - first element
          if .Trial then
            .Trial[0] |= (
              del(.caseHandle) | 
              .overrideAction = "upsert" |
              .overrideKey = "caseNumber"
            )
          else . end |
          
          # Remove any top-level trial object (incorrect location)
          if .trial then del(.trial) else . end |
          
          # Fix metadata section
          if .metadata then
            .metadata |= (
              .userReviewed = true |
              .reviewedAt = $timestamp |
              .reviewedBy = "workflow-fix-script"
            )
          else
            . + {
              "metadata": {
                "userReviewed": true,
                "reviewedAt": $timestamp,
                "reviewedBy": "workflow-fix-script"
              }
            }
          end
        ' "$metadata_file" > "$metadata_file.tmp" 2>/dev/null
        
        if [ $? -eq 0 ] && [ -s "$metadata_file.tmp" ]; then
            # Verify the JSON is valid
            if jq empty "$metadata_file.tmp" 2>/dev/null; then
                mv "$metadata_file.tmp" "$metadata_file"
                echo "  ✓ Fixed successfully"
                ((count++))
            else
                rm -f "$metadata_file.tmp"
                echo "  ✗ Invalid JSON after transformation"
                ((failed++))
            fi
        else
            rm -f "$metadata_file.tmp"
            echo "  ✗ Failed to process"
            ((failed++))
        fi
    fi
done

echo ""
echo "========================================="
echo "SUMMARY"
echo "========================================="
echo "Files fixed: $count"
echo "Files failed: $failed"
echo ""

if [ $count -gt 0 ]; then
    echo "Successfully fixed $count files."
    echo ""
    echo "Next steps:"
    echo "1. Review a sample file to verify changes"
    echo "2. Touch all files to update timestamps if needed"
    echo "3. Optionally change reviewedBy to 'user' for manual review indication"
fi

if [ $failed -gt 0 ]; then
    echo ""
    echo "WARNING: $failed files failed to process"
fi

echo ""
echo "Script completed."