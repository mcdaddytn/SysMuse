#!/bin/bash

echo "=== Renaming trial summary files to match new handle format ==="
echo ""

cd output/trialSummaries || exit 1

# Rename files that have periods after V
for file in *V.*; do
  if [ -f "$file" ]; then
    # Replace V. with V_
    newname="${file//V./V_}"
    if [ "$file" != "$newname" ]; then
      echo "Renaming: $file -> $newname"
      mv "$file" "$newname"
    fi
  fi
done

echo ""
echo "Files after renaming:"
ls -la *Dataquill* *Fractus* *Core_Wireless* 2>/dev/null || echo "No matching files found"

echo ""
echo "Done!"