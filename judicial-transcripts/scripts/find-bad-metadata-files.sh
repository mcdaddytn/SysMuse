#!/bin/bash

echo "Finding trial-metadata.json files with bad attorney data..."
echo "============================================"

# Track trials with bad data
declare -a bad_trials=()

# Check each trial-metadata.json file
for file in output/multi-trial/*/trial-metadata.json; do
  if [ -f "$file" ]; then
    trial_dir=$(dirname "$file")
    trial_name=$(basename "$trial_dir")
    
    # Check for patterns that indicate bad attorney data:
    # - Addresses (numbers, Street, Avenue, Suite, Floor)
    # - Law firms (LLP, LLC, P.C., & )
    # - Cities/states (CA, TX patterns)
    # - Missing titles (entries without MR./MS./DR.)
    
    if grep -q '"name".*[0-9][0-9][0-9].*Street\|"name".*Suite [0-9]\|"name".*Floor\|"name".*Avenue' "$file" 2>/dev/null; then
      bad_trials+=("$trial_name (contains addresses)")
      echo "❌ $trial_name - Contains address as attorney"
    elif grep -q '"name".*LLP\|"name".*LLC\|"name".*P\.C\.\|"name".*Law Firm\|"name".*& ' "$file" 2>/dev/null; then
      bad_trials+=("$trial_name (contains law firms)")
      echo "❌ $trial_name - Contains law firm as attorney"
    elif grep -q '"name".*CA   [0-9]\|"name".*TX   [0-9]\|"name".*D\.C\.' "$file" 2>/dev/null; then
      bad_trials+=("$trial_name (contains locations)")
      echo "❌ $trial_name - Contains location as attorney"
    elif grep -E '"name": "[^M][^RS]' "$file" | grep -v '"name": "THE HONORABLE\|"name": "JUDGE' 2>/dev/null | grep -q .; then
      # Check for names that don't start with MR/MS/DR (excluding judges)
      bad_trials+=("$trial_name (missing titles)")
      echo "❌ $trial_name - Has attorneys without proper titles"
    fi
  fi
done

echo ""
echo "Summary: Found ${#bad_trials[@]} trials with bad attorney data"
echo "============================================"

if [ ${#bad_trials[@]} -gt 0 ]; then
  echo ""
  echo "Trials needing fixes:"
  for trial in "${bad_trials[@]}"; do
    echo "  - $trial"
  done
fi

# List specific bad patterns found
echo ""
echo "Specific bad patterns found:"
echo "----------------------------"
for file in output/multi-trial/*/trial-metadata.json; do
  if [ -f "$file" ]; then
    trial_name=$(basename $(dirname "$file"))
    
    # Show actual bad entries
    bad_entries=$(grep -o '"name": "[^"]*"' "$file" | grep -E 'Street|Avenue|Suite|Floor|LLP|LLC|P\.C\.|Law Firm|& |CA   [0-9]|TX   [0-9]' | sed 's/"name": "/  - /')
    if [ ! -z "$bad_entries" ]; then
      echo ""
      echo "$trial_name:"
      echo "$bad_entries"
    fi
  fi
done