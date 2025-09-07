#!/bin/bash

# Script to touch all trial-metadata.json files and optionally mark them as user-reviewed
# This ensures the source files are newer than destination files

echo "Updating trial-metadata.json files in source directories..."

# Parse command line options
MARK_USER=false
if [ "$1" = "--mark-user" ]; then
    MARK_USER=true
    echo "Will mark files as reviewed by 'user'"
fi

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
        
        echo -n "Processing: $trial_name"
        
        if [ "$MARK_USER" = true ]; then
            # Update reviewedBy to "user" and update timestamp
            jq --arg timestamp "$TIMESTAMP" '
              if .metadata then
                .metadata |= (
                  .reviewedAt = $timestamp |
                  .reviewedBy = "user"
                )
              else . end
            ' "$metadata_file" > "$metadata_file.tmp" 2>/dev/null
            
            if [ $? -eq 0 ] && [ -s "$metadata_file.tmp" ]; then
                mv "$metadata_file.tmp" "$metadata_file"
                echo " - ✓ Marked as user-reviewed"
            else
                rm -f "$metadata_file.tmp"
                echo " - ✗ Failed to update"
                ((failed++))
                continue
            fi
        else
            echo -n " - "
        fi
        
        # Touch the file to update its timestamp
        touch "$metadata_file"
        echo "✓ Timestamp updated"
        ((count++))
    fi
done

echo ""
echo "========================================="
echo "SUMMARY"
echo "========================================="
echo "Files updated: $count"
echo "Files failed: $failed"
echo ""

if [ "$MARK_USER" = true ]; then
    echo "All files marked as reviewed by 'user' with current timestamp"
else
    echo "All files touched to update timestamps"
    echo ""
    echo "To also mark as user-reviewed, run:"
    echo "  $0 --mark-user"
fi

echo ""
echo "Script completed."