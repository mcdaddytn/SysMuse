#!/bin/bash

# Script to find attorneys with null titles in trial-metadata.json files

output_file="bad-attorneys-report.txt"
csv_file="bad-attorneys.csv"

echo "Finding attorneys with null/missing titles in trial-metadata.json files..." 
echo "================================================================" > "$output_file"
echo "ATTORNEYS WITH NULL TITLES IN TRIAL-METADATA.JSON FILES" >> "$output_file"
echo "Generated: $(date)" >> "$output_file"
echo "================================================================" >> "$output_file"
echo "" >> "$output_file"

# Create CSV header
echo "Trial,Attorney Name,Title Field,File Path" > "$csv_file"

total_null_title=0
trials_with_null=0

# Process each trial-metadata.json file
for file in output/multi-trial/*/trial-metadata.json; do
  if [ -f "$file" ]; then
    trial_dir=$(dirname "$file")
    trial_name=$(basename "$trial_dir")
    
    # Count attorneys with null or empty title in this file
    null_count=$(jq '[.Attorney[]? | select(.title == null or .title == "")] | length' "$file" 2>/dev/null)
    
    if [ "$null_count" -gt 0 ]; then
      trials_with_null=$((trials_with_null + 1))
      total_null_title=$((total_null_title + null_count))
      
      echo "" >> "$output_file"
      echo "TRIAL: $trial_name" >> "$output_file"
      echo "FILE: $file" >> "$output_file"
      echo "Attorneys with null/missing titles ($null_count):" >> "$output_file"
      echo "----------------------------------------" >> "$output_file"
      
      # List each attorney with null title
      jq -r '.Attorney[]? | select(.title == null or .title == "") | 
        "  - " + .name + " (title: " + (if .title == "" then "empty" else "null" end) + ")"' "$file" 2>/dev/null >> "$output_file"
      
      # Add to CSV
      jq -r --arg trial "$trial_name" --arg path "$file" '.Attorney[]? | select(.title == null or .title == "") | 
        "\"\($trial)\",\"\(.name)\",\"\(if .title == "" then "empty" else "null" end)\",\"\($path)\""' "$file" 2>/dev/null >> "$csv_file"
      
      echo "Found $null_count attorneys with null title in $trial_name"
    fi
  fi
done

echo "" >> "$output_file"
echo "================================================================" >> "$output_file"
echo "SUMMARY" >> "$output_file"
echo "================================================================" >> "$output_file"
echo "Total attorneys with null/missing titles: $total_null_title" >> "$output_file"
echo "Across $trials_with_null trials" >> "$output_file"

# Show summary table
echo "" >> "$output_file"
echo "Summary by trial:" >> "$output_file"
echo "-----------------" >> "$output_file"

for file in output/multi-trial/*/trial-metadata.json; do
  if [ -f "$file" ]; then
    trial_name=$(basename $(dirname "$file"))
    null_count=$(jq '[.Attorney[]? | select(.title == null or .title == "")] | length' "$file" 2>/dev/null)
    
    if [ "$null_count" -gt 0 ]; then
      printf "  %-45s: %3d attorneys with null title\n" "$trial_name" "$null_count" >> "$output_file"
    fi
  fi
done

echo ""
echo "✅ Report saved to: $output_file"
echo "✅ CSV saved to: $csv_file"
echo ""
echo "Summary:"
echo "--------"
echo "Total attorneys with null/missing titles: $total_null_title"
echo "Across $trials_with_null trials"
echo ""

# Show top trials with most null titles
echo "Top trials with null title attorneys:"
echo "--------------------------------------"
for file in output/multi-trial/*/trial-metadata.json; do
  if [ -f "$file" ]; then
    trial_name=$(basename $(dirname "$file"))
    null_count=$(jq '[.Attorney[]? | select(.title == null or .title == "")] | length' "$file" 2>/dev/null)
    
    if [ "$null_count" -gt 0 ]; then
      echo "$null_count $trial_name"
    fi
  fi
done | sort -rn | head -10 | while read count trial; do
  printf "  %3d - %s\n" "$count" "$trial"
done

echo ""
echo "To sync ALL trial-metadata.json files back to source with backup:"
echo "  npx ts-node src/cli/sync.ts overrides --config config/multi-trial-config-mac.json"
echo ""
echo "Note: Edit the trial-metadata.json files to add proper titles (Mr./Ms./Dr./etc.)"