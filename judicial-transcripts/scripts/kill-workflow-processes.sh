#!/bin/bash

# Kill all judicial transcript workflow processes
echo "Killing all judicial transcript workflow processes..."

# Kill ts-node processes running parse.ts or workflow.ts
pkill -f "ts-node.*parse\.ts" 2>/dev/null
pkill -f "ts-node.*workflow\.ts" 2>/dev/null
pkill -f "ts-node.*override\.ts" 2>/dev/null
pkill -f "ts-node.*phase3\.ts" 2>/dev/null

# Kill npm processes running our scripts
pkill -f "npm run convert-pdf" 2>/dev/null
pkill -f "npm run workflow" 2>/dev/null
pkill -f "npm run parse" 2>/dev/null

# Kill node processes that might be stuck
pkill -f "node.*judicial-transcripts" 2>/dev/null

# Count remaining processes
REMAINING=$(pgrep -f "judicial-transcripts" | wc -l)

if [ $REMAINING -eq 0 ]; then
  echo "✓ All workflow processes killed successfully"
else
  echo "⚠ $REMAINING processes may still be running. Checking..."
  ps aux | grep -E "judicial-transcripts|parse\.ts|workflow\.ts" | grep -v grep
  
  echo ""
  echo "To force kill remaining processes, run:"
  echo "  pkill -9 -f judicial-transcripts"
fi