#!/bin/bash

# Script to fix trial-metadata.json files in source directories
# Removes caseHandle and changes overrideAction to upsert

echo "Fixing trial-metadata.json files in source directories..."

# Counter for tracking
count=0
failed=0

# Process all trial-metadata.json files in source directory
for metadata_file in "/Users/gmcaveney/GrassLabel Dropbox/Grass Label Home/docs/transcripts/pdf/"*/trial-metadata.json; do
    if [ -f "$metadata_file" ]; then
        trial_dir=$(dirname "$metadata_file")
        trial_name=$(basename "$trial_dir")
        
        echo "Processing: $trial_name"
        
        # Use jq to remove caseHandle and set overrideAction to upsert
        # Handle the capital T in Trial array
        jq '.Trial[0] |= (del(.caseHandle) | .overrideAction = "upsert")' "$metadata_file" > "$metadata_file.tmp" 2>/dev/null
        
        if [ $? -eq 0 ] && [ -s "$metadata_file.tmp" ]; then
            mv "$metadata_file.tmp" "$metadata_file"
            echo "  ✓ Fixed"
            ((count++))
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
echo "Script completed."