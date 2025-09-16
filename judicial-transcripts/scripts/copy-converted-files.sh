#!/bin/bash

# Script to copy converted PDF text files based on conversion-summary.json
# Usage: ./copy-converted-files.sh <destination_directory>

set -e  # Exit on error

# Check if destination directory argument is provided
if [ $# -eq 0 ]; then
    echo "Error: Please provide a destination directory as an argument"
    echo "Usage: $0 <destination_directory>"
    exit 1
fi

DEST_BASE="$1"
SOURCE_BASE="output/multi-trial"
COPY_COUNT=0
TRIAL_COUNT=0
SKIP_COUNT=0

# Create destination directory if it doesn't exist
if [ ! -d "$DEST_BASE" ]; then
    echo "Creating destination directory: $DEST_BASE"
    mkdir -p "$DEST_BASE"
fi

echo "========================================="
echo "PDF Conversion Copy Utility"
echo "========================================="
echo "Source: $SOURCE_BASE"
echo "Destination: $DEST_BASE"
echo ""

# Process each trial directory
for trial_dir in "$SOURCE_BASE"/*; do
    if [ -d "$trial_dir" ]; then
        trial_name=$(basename "$trial_dir")
        summary_file="$trial_dir/conversion-summary.json"

        # Check if conversion-summary.json exists
        if [ -f "$summary_file" ]; then
            echo "Processing: $trial_name"

            # Check if conversion was complete
            is_complete=$(jq -r '.complete' "$summary_file" 2>/dev/null || echo "false")

            if [ "$is_complete" != "true" ]; then
                echo "  ⚠️  Warning: Conversion not marked as complete"
            fi

            # Create destination trial directory if it doesn't exist
            dest_trial_dir="$DEST_BASE/$trial_name"
            if [ ! -d "$dest_trial_dir" ]; then
                echo "  Creating directory: $dest_trial_dir"
                mkdir -p "$dest_trial_dir"
            fi

            # Get list of converted files
            converted_files=$(jq -r '.filesConverted[]' "$summary_file" 2>/dev/null)

            if [ -z "$converted_files" ]; then
                echo "  ⚠️  No files were converted in the last run"
                SKIP_COUNT=$((SKIP_COUNT + 1))
            else
                file_count=0

                # Copy each converted file
                while IFS= read -r filename; do
                    source_file="$trial_dir/$filename"
                    dest_file="$dest_trial_dir/$filename"

                    if [ -f "$source_file" ]; then
                        echo "  ✓ Copying: $filename"
                        cp "$source_file" "$dest_file"
                        file_count=$((file_count + 1))
                        COPY_COUNT=$((COPY_COUNT + 1))
                    else
                        echo "  ✗ Source file not found: $filename"
                    fi
                done <<< "$converted_files"

                echo "  Copied $file_count files to $dest_trial_dir"
            fi

            TRIAL_COUNT=$((TRIAL_COUNT + 1))
            echo ""
        else
            echo "Skipping: $trial_name (no conversion-summary.json found)"
            echo ""
        fi
    fi
done

echo "========================================="
echo "Copy Complete!"
echo "========================================="
echo "Trials processed: $TRIAL_COUNT"
echo "Files copied: $COPY_COUNT"
echo "Trials skipped (no conversions): $SKIP_COUNT"
echo ""
echo "Destination: $DEST_BASE"