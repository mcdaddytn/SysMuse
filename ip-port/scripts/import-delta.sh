#!/bin/bash
#
# Import delta (incremental) changes from delta export
#
# Usage: ./scripts/import-delta.sh <delta-dir>
#

set -e

IMPORT_DIR="${1:?Usage: import-delta.sh <delta-directory>}"

if [ ! -f "$IMPORT_DIR/delta-manifest.json" ]; then
  echo "Error: Not a valid delta export (missing delta-manifest.json)"
  echo "For full imports, use: ./scripts/import-system.sh"
  exit 1
fi

echo "═══════════════════════════════════════════════════════════"
echo "DELTA IMPORT"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Importing from: $IMPORT_DIR"
echo ""
echo "Delta manifest:"
cat "$IMPORT_DIR/delta-manifest.json" | jq .
echo ""

read -p "Continue with delta import? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Import cancelled."
  exit 1
fi

echo ""

# Import cache files (merge, don't replace)
echo "Importing delta files..."

if [ -d "$IMPORT_DIR/cache/llm-scores" ]; then
  mkdir -p cache/llm-scores
  cp -n "$IMPORT_DIR/cache/llm-scores/"*.json cache/llm-scores/ 2>/dev/null || true
  COUNT=$(ls "$IMPORT_DIR/cache/llm-scores/"*.json 2>/dev/null | wc -l | tr -d ' ')
  echo "  LLM scores: $COUNT files"
fi

if [ -d "$IMPORT_DIR/cache/prosecution-scores" ]; then
  mkdir -p cache/prosecution-scores
  cp -n "$IMPORT_DIR/cache/prosecution-scores/"*.json cache/prosecution-scores/ 2>/dev/null || true
  COUNT=$(ls "$IMPORT_DIR/cache/prosecution-scores/"*.json 2>/dev/null | wc -l | tr -d ' ')
  echo "  Prosecution: $COUNT files"
fi

if [ -d "$IMPORT_DIR/cache/ipr-scores" ]; then
  mkdir -p cache/ipr-scores
  cp -n "$IMPORT_DIR/cache/ipr-scores/"*.json cache/ipr-scores/ 2>/dev/null || true
  COUNT=$(ls "$IMPORT_DIR/cache/ipr-scores/"*.json 2>/dev/null | wc -l | tr -d ' ')
  echo "  IPR: $COUNT files"
fi

if [ -d "$IMPORT_DIR/cache/patent-families/parents" ]; then
  mkdir -p cache/patent-families/parents
  cp -n "$IMPORT_DIR/cache/patent-families/parents/"*.json cache/patent-families/parents/ 2>/dev/null || true
  COUNT=$(ls "$IMPORT_DIR/cache/patent-families/parents/"*.json 2>/dev/null | wc -l | tr -d ' ')
  echo "  Families: $COUNT files"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "DELTA IMPORT COMPLETE"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Current cache counts:"
echo "  LLM scores:    $(ls cache/llm-scores/*.json 2>/dev/null | wc -l | tr -d ' ') files"
echo "  Prosecution:   $(ls cache/prosecution-scores/*.json 2>/dev/null | wc -l | tr -d ' ') files"
echo "  IPR:           $(ls cache/ipr-scores/*.json 2>/dev/null | wc -l | tr -d ' ') files"
echo "  Families:      $(ls cache/patent-families/parents/*.json 2>/dev/null | wc -l | tr -d ' ') files"
echo ""
echo "Restart the API server to pick up new data:"
echo "  pkill -f 'tsx.*server' && npm run api:start"
