#!/bin/bash

# Script to update all trial-metadata.json files to use shortName for override

SOURCE_DIR="/Users/gmcaveney/GrassLabel Dropbox/Grass Label Home/docs/transcripts/pdf"
OUTPUT_DIR="./output/multi-trial"

echo "Updating trial-metadata.json files to use shortName..."

# Process each trial directory
for trial_dir in "$SOURCE_DIR"/*/ ; do
    if [ -d "$trial_dir" ]; then
        trial_name=$(basename "$trial_dir")
        metadata_file="$trial_dir/trial-metadata.json"
        
        if [ -f "$metadata_file" ]; then
            echo "Processing: $trial_name"
            
            # Update the Trial object with shortName and overrideKey
            jq --arg shortName "$trial_name" '
                .Trial[0].shortName = $shortName |
                .Trial[0].overrideKey = "shortName"
            ' "$metadata_file" > "$metadata_file.tmp" && mv "$metadata_file.tmp" "$metadata_file"
            
            echo "✅ Updated $trial_name"
        fi
    fi
done

# Also update output directory files
for trial_dir in "$OUTPUT_DIR"/*/ ; do
    if [ -d "$trial_dir" ]; then
        trial_name=$(basename "$trial_dir")
        metadata_file="$trial_dir/trial-metadata.json"
        
        if [ -f "$metadata_file" ]; then
            echo "Processing output: $trial_name"
            
            # Update the Trial object with shortName and overrideKey
            jq --arg shortName "$trial_name" '
                .Trial[0].shortName = $shortName |
                .Trial[0].overrideKey = "shortName"
            ' "$metadata_file" > "$metadata_file.tmp" && mv "$metadata_file.tmp" "$metadata_file"
            
            echo "✅ Updated output/$trial_name"
        fi
    fi
done

echo "✨ All trial-metadata.json files updated!"