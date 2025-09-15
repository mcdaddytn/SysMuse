#!/bin/bash

echo "=== LLM Summary Status Report ==="
echo "Generated: $(date)"
echo ""

# Trials to check
trials=(
  "01 Genband"
  "04 Intellectual Ventures"
  "05 Personalized Media v Zynga"
  "07 Usa Re Joshua Harman V Trinity Industries"
  "11 Dataquill Limited V. Zte Corporation Et Al"
)

# Components to check
components=(
  "Plaintiff_Opening_Statement"
  "Plaintiff_Closing_Statement"
  "Defense_Opening_Statement"
  "Defense_Closing_Statement"
)

echo "Trial Summary Dependencies:"
echo "=========================="
for trial in "${trials[@]}"; do
  trial_file=$(echo "$trial" | sed 's/ /_/g')
  summary_file="output/trialSummaries/${trial_file}_summary_response.txt"
  if [ -f "$summary_file" ]; then
    echo "✅ $trial - has trial summary"
  else
    echo "❌ $trial - NO trial summary"
  fi
done

echo ""
echo "Component Summary Status:"
echo "========================"

for trial in "${trials[@]}"; do
  echo ""
  echo "Trial: $trial"
  echo "-------------------"

  # Check if directory exists
  trial_dir="output/markersections/$trial"
  if [ ! -d "$trial_dir" ]; then
    echo "  ❌ Trial directory not found"
    continue
  fi

  # Check FullText sources
  echo "  Source Files (FullText):"
  missing_source=0
  for component in "${components[@]}"; do
    source_file="$trial_dir/FullText/$component.txt"
    if [ -f "$source_file" ]; then
      size=$(wc -c < "$source_file" | tr -d ' ')
      echo "    ✅ $component (${size} bytes)"
    else
      echo "    ❌ $component - NOT FOUND"
      missing_source=$((missing_source + 1))
    fi
  done

  # Check LLMSummary1 outputs
  echo "  Generated Summaries (LLMSummary1):"
  missing_summary=0
  if [ -d "$trial_dir/LLMSummary1" ]; then
    for component in "${components[@]}"; do
      summary_file="$trial_dir/LLMSummary1/$component.txt"
      if [ -f "$summary_file" ]; then
        size=$(wc -c < "$summary_file" | tr -d ' ')
        echo "    ✅ $component (${size} bytes)"
      else
        echo "    ❌ $component - NOT GENERATED"
        missing_summary=$((missing_summary + 1))
      fi
    done
  else
    echo "    ❌ LLMSummary1 directory not found"
    missing_summary=4
  fi

  # Summary
  echo "  Status: $((4 - missing_source)) sources, $((4 - missing_summary)) summaries generated"
  if [ $missing_summary -gt 0 ] && [ $missing_source -eq 0 ]; then
    echo "  ⚠️  Can generate $missing_summary more summaries"
  elif [ $missing_summary -gt 0 ] && [ $missing_source -gt 0 ]; then
    echo "  ⚠️  Can generate $((missing_summary - missing_source)) more summaries (limited by missing sources)"
  fi
done

echo ""
echo "=== Summary ==="
echo "To continue incomplete summaries, use:"
echo "npm run background-llm -- trial-components --batch --trials=\"01 Genband,04 Intellectual Ventures,05 Personalized Media v Zynga,07 Usa Re Joshua Harman V Trinity Industries,11 Dataquill Limited V. Zte Corporation Et Al\""