#!/bin/bash

# Batch processing script for LLM summaries with resume capability
# This script can continue incomplete batches and track progress

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
BATCH_LOG="output/batch-llm-summaries.log"
BATCH_STATE="output/batch-llm-state.json"

# Default trials for initial batch
DEFAULT_TRIALS=(
  "01 Genband"
  "04 Intellectual Ventures"
  "05 Personalized Media v Zynga"
  "07 Usa Re Joshua Harman V Trinity Industries"
  "11 Dataquill Limited V. Zte Corporation Et Al"
)

# Function to check if a component needs generation
needs_generation() {
  local trial="$1"
  local component="$2"

  local source_file="output/markersections/$trial/FullText/$component.txt"
  local summary_file="output/markersections/$trial/LLMSummary1/$component.txt"

  # Check if source exists
  if [ ! -f "$source_file" ]; then
    return 1  # Cannot generate without source
  fi

  # Check if summary already exists
  if [ -f "$summary_file" ]; then
    return 1  # Already generated
  fi

  return 0  # Needs generation
}

# Function to count pending summaries for a trial
count_pending() {
  local trial="$1"
  local count=0

  for component in "Plaintiff_Opening_Statement" "Plaintiff_Closing_Statement" "Defense_Opening_Statement" "Defense_Closing_Statement"; do
    if needs_generation "$trial" "$component"; then
      count=$((count + 1))
    fi
  done

  echo $count
}

# Function to generate summaries for a single trial
process_trial() {
  local trial="$1"

  echo -e "${CYAN}Processing: $trial${NC}"

  # Check trial summary dependency first
  local trial_file=$(echo "$trial" | sed 's/ /_/g')
  local summary_file="output/trialSummaries/${trial_file}_summary_response.txt"

  if [ ! -f "$summary_file" ]; then
    echo -e "${RED}  ✗ Missing trial summary dependency${NC}"
    echo "  Run: npm run background-llm -- trials --full"
    return 1
  fi

  # Run the command
  echo "  Running: npm run background-llm -- trial-components --trial=\"$trial\" --all"

  if npm run background-llm -- trial-components --trial="$trial" --all 2>&1 | tee -a "$BATCH_LOG"; then
    echo -e "${GREEN}  ✓ Completed${NC}"
    return 0
  else
    echo -e "${RED}  ✗ Failed${NC}"
    return 1
  fi
}

# Main execution
main() {
  echo -e "${CYAN}=== LLM Summary Batch Processing ===${NC}"
  echo "Log file: $BATCH_LOG"
  echo ""

  # Initialize log
  echo "=== Batch started at $(date) ===" >> "$BATCH_LOG"

  # Determine which trials to process
  if [ "$1" == "--all" ]; then
    # Process all trials with markersections
    mapfile -t TRIALS < <(ls -d output/markersections/*/ 2>/dev/null | xargs -n1 basename)
  elif [ "$1" == "--continue" ]; then
    # Continue with default trials
    TRIALS=("${DEFAULT_TRIALS[@]}")
  elif [ -n "$1" ]; then
    # Custom trial list
    IFS=',' read -ra TRIALS <<< "$1"
  else
    # Default trials
    TRIALS=("${DEFAULT_TRIALS[@]}")
  fi

  # Status report
  echo -e "${YELLOW}Trials to process:${NC}"
  total_pending=0
  for trial in "${TRIALS[@]}"; do
    trial=$(echo "$trial" | xargs)  # Trim whitespace
    pending=$(count_pending "$trial")
    total_pending=$((total_pending + pending))

    if [ $pending -gt 0 ]; then
      echo "  • $trial ($pending pending)"
    else
      echo "  • $trial (complete)"
    fi
  done

  echo ""
  echo -e "${YELLOW}Total pending summaries: $total_pending${NC}"
  echo ""

  if [ $total_pending -eq 0 ]; then
    echo -e "${GREEN}All summaries are complete!${NC}"
    exit 0
  fi

  # Process trials
  processed=0
  failed=0

  for trial in "${TRIALS[@]}"; do
    trial=$(echo "$trial" | xargs)  # Trim whitespace
    pending=$(count_pending "$trial")

    if [ $pending -gt 0 ]; then
      if process_trial "$trial"; then
        processed=$((processed + 1))
      else
        failed=$((failed + 1))
      fi

      # Small delay between trials to avoid rate limiting
      sleep 2
    fi
  done

  # Final report
  echo ""
  echo -e "${CYAN}=== Batch Complete ===${NC}"
  echo "Processed: $processed trials"
  echo "Failed: $failed trials"
  echo "Log: $BATCH_LOG"

  # Check final status
  echo ""
  ./scripts/check-llm-summary-status.sh
}

# Run main with arguments
main "$@"