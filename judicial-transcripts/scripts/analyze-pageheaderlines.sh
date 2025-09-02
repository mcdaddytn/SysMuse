#!/bin/bash

# Analyze remaining trials to determine pageHeaderLines configuration
# by examining the first transcript file in each trial directory

echo "Analyzing pageHeaderLines for remaining trials..."
echo "================================================"
echo ""

# List of trials that have already been analyzed (from 01-40)
analyzed_trials="01 02 03 04 05 06 07 10 11 12 14 15 16 17 18 19 20 21 22 23 24 28 29 30 31 32 33 34 35 36 37 39 40"

# Function to check if trial has been analyzed
is_analyzed() {
  local prefix="$1"
  for analyzed in $analyzed_trials; do
    if [ "$prefix" = "$analyzed" ]; then
      return 0
    fi
  done
  return 1
}

# Function to analyze a trial's first transcript
analyze_trial() {
  local trial_dir="$1"
  local prefix=$(echo "$trial_dir" | grep -o '^[0-9]*')
  
  # Skip if already analyzed
  if is_analyzed "$prefix"; then
    return
  fi
  
  # Skip invalid trials
  if [[ "$trial_dir" == "23 Flexuspine V. Globus Medical" ]] || 
     [[ "$trial_dir" == "50 Packet"* ]] || 
     [[ "$trial_dir" == "68 Contentguard Holdings"* ]] || 
     [[ "$trial_dir" == "72 Taylor V Turner" ]]; then
    echo "[$prefix] $trial_dir - SKIPPED (invalid trial)"
    return
  fi
  
  # Find first .txt file in the directory
  first_txt=$(ls "./output/multi-trial/$trial_dir"/*.txt 2>/dev/null | head -1)
  
  if [ -z "$first_txt" ]; then
    echo "[$prefix] $trial_dir - NO TXT FILES FOUND"
    return
  fi
  
  echo "[$prefix] $trial_dir"
  echo "  File: $(basename "$first_txt")"
  
  # Extract first 10 lines to analyze header structure
  echo "  First 10 lines:"
  head -10 "$first_txt" | nl -ba | sed 's/^/    /'
  
  # Look for common header patterns
  # Pattern 1: Case number on first line
  if head -1 "$first_txt" | grep -q "Case.*Document.*Filed.*Page.*PageID"; then
    echo "  → Detected: Case header on line 1"
    
    # Check if there are blank lines or additional headers
    line2=$(sed -n '2p' "$first_txt")
    line3=$(sed -n '3p' "$first_txt")
    line4=$(sed -n '4p' "$first_txt")
    line5=$(sed -n '5p' "$first_txt")
    
    # Count non-content lines before actual transcript starts
    header_count=1
    
    # Check for page number pattern (single digit at start)
    if [[ "$line2" =~ ^[0-9]+[[:space:]]*$ ]]; then
      echo "  → Line 2 appears to be page number"
      header_count=2
    elif [ -z "$line2" ] || [[ "$line2" =~ ^[[:space:]]*$ ]]; then
      echo "  → Line 2 is blank"
      if [[ "$line3" =~ ^[0-9]+[[:space:]]*$ ]]; then
        echo "  → Line 3 appears to be page number"
        header_count=3
      fi
    fi
    
    echo "  RECOMMENDATION: pageHeaderLines=$header_count"
  else
    # Check for other patterns
    echo "  → No standard case header detected on line 1"
    
    # Check if first line is just a page number
    if [[ "$(head -1 "$first_txt")" =~ ^[0-9]+[[:space:]]*$ ]]; then
      echo "  → Line 1 appears to be just a page number"
      echo "  RECOMMENDATION: pageHeaderLines=1"
    else
      echo "  RECOMMENDATION: pageHeaderLines=1 (default)"
    fi
  fi
  
  echo ""
}

# Process all trial directories
for dir in ./output/multi-trial/*/; do
  if [ -d "$dir" ]; then
    trial_name=$(basename "$dir")
    # Skip 'logs' directory
    if [ "$trial_name" != "logs" ]; then
      analyze_trial "$trial_name"
    fi
  fi
done

echo "================================================"
echo "Analysis complete!"
echo ""
echo "Summary of recommendations for trials 41+:"
echo ""

# Generate summary for easy copying
for dir in ./output/multi-trial/*/; do
  if [ -d "$dir" ]; then
    trial_name=$(basename "$dir")
    prefix=$(echo "$trial_name" | grep -o '^[0-9]*')
    
    # Only process trials 41 and above
    if [ "$prefix" -ge 41 ] 2>/dev/null; then
      # Skip invalid trials
      if [[ "$trial_name" != "50 Packet"* ]] && 
         [[ "$trial_name" != "68 Contentguard Holdings"* ]] && 
         [[ "$trial_name" != "72 Taylor V Turner" ]]; then
        echo "$prefix $trial_name"
        echo "pageHeaderLines=1  # TODO: Verify"
      fi
    fi
  fi
done