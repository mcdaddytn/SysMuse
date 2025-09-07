#!/bin/bash

# Script to sync trial-metadata.json files between destination and source directories
# and apply necessary edits for proper workflow operation

echo "Starting trial-metadata.json sync and edit process..."

# Arrays to track operations
declare -a copied_files=()
declare -a edited_files=()
declare -a failed_operations=()

# Function to copy and edit trial-metadata.json
process_trial() {
    local trial_name="$1"
    local dest_file="output/multi-trial/$trial_name/trial-metadata.json"
    local source_dir="/Users/gmcaveney/GrassLabel Dropbox/Grass Label Home/docs/transcripts/pdf/$trial_name"
    local source_file="$source_dir/trial-metadata.json"
    
    # Check if destination file exists
    if [ -f "$dest_file" ]; then
        echo "Processing: $trial_name"
        
        # Create source directory if it doesn't exist
        if [ ! -d "$source_dir" ]; then
            echo "  WARNING: Source directory doesn't exist: $source_dir"
            failed_operations+=("$trial_name - source dir missing")
            return
        fi
        
        # Copy file to source
        echo "  Copying to source..."
        cp "$dest_file" "$source_file"
        if [ $? -eq 0 ]; then
            copied_files+=("$trial_name")
            
            # Edit the file: remove caseHandle and change overrideAction to upsert
            echo "  Editing file..."
            
            # Use jq to modify the JSON
            if command -v jq &> /dev/null; then
                # Remove caseHandle from trial object and change overrideAction to upsert
                jq '.trial |= (del(.caseHandle) | .overrideAction = "upsert")' "$source_file" > "$source_file.tmp" && mv "$source_file.tmp" "$source_file"
                
                if [ $? -eq 0 ]; then
                    edited_files+=("$trial_name")
                    echo "  ✓ Successfully processed"
                else
                    echo "  ✗ Failed to edit file"
                    failed_operations+=("$trial_name - edit failed")
                fi
            else
                echo "  WARNING: jq not installed, manual editing required"
                failed_operations+=("$trial_name - jq not available")
            fi
        else
            echo "  ✗ Failed to copy file"
            failed_operations+=("$trial_name - copy failed")
        fi
    fi
}

# Get all trials with trial-metadata.json files
for metadata_file in output/multi-trial/*/trial-metadata.json; do
    if [ -f "$metadata_file" ]; then
        # Extract trial name from path
        trial_dir=$(dirname "$metadata_file")
        trial_name=$(basename "$trial_dir")
        process_trial "$trial_name"
    fi
done

# Summary report
echo ""
echo "========================================="
echo "SYNC AND EDIT SUMMARY"
echo "========================================="
echo "Files copied: ${#copied_files[@]}"
echo "Files edited: ${#edited_files[@]}"
echo "Failed operations: ${#failed_operations[@]}"

if [ ${#copied_files[@]} -gt 0 ]; then
    echo ""
    echo "Successfully copied:"
    for trial in "${copied_files[@]}"; do
        echo "  - $trial"
    done
fi

if [ ${#failed_operations[@]} -gt 0 ]; then
    echo ""
    echo "Failed operations:"
    for failure in "${failed_operations[@]}"; do
        echo "  - $failure"
    done
fi

echo ""
echo "Script completed."