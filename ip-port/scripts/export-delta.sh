#!/bin/bash
#
# Export delta (incremental) changes since last export
#
# Usage:
#   ./scripts/export-delta.sh <output-dir>                    # Since last recorded export
#   ./scripts/export-delta.sh <output-dir> --since "2026-01-30 17:00"  # Since specific time
#   ./scripts/export-delta.sh <output-dir> --manifest <prev-manifest.json>  # Compare to manifest
#

set -e

EXPORT_DIR="${1:?Usage: export-delta.sh <output-dir> [--since <datetime>] [--manifest <file>]}"
shift

# Parse options
SINCE_TIME=""
PREV_MANIFEST=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --since)
      SINCE_TIME="$2"
      shift 2
      ;;
    --manifest)
      PREV_MANIFEST="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

# Track last export time
LAST_EXPORT_FILE=".last-export-timestamp"

if [ -z "$SINCE_TIME" ] && [ -z "$PREV_MANIFEST" ]; then
  if [ -f "$LAST_EXPORT_FILE" ]; then
    SINCE_TIME=$(cat "$LAST_EXPORT_FILE")
    echo "Using last export timestamp: $SINCE_TIME"
  else
    echo "No previous export timestamp found."
    echo "Use --since <datetime> or --manifest <file>, or run a full export first."
    exit 1
  fi
fi

mkdir -p "$EXPORT_DIR"

echo "═══════════════════════════════════════════════════════════"
echo "DELTA EXPORT"
echo "═══════════════════════════════════════════════════════════"
echo "Output: $EXPORT_DIR"
if [ -n "$SINCE_TIME" ]; then
  echo "Since: $SINCE_TIME"
fi
if [ -n "$PREV_MANIFEST" ]; then
  echo "Comparing to manifest: $PREV_MANIFEST"
fi
echo ""

# Function to find files newer than timestamp
find_newer_files() {
  local dir="$1"
  local since="$2"
  # Strip timezone for macOS compatibility
  since=$(echo "$since" | sed 's/[-+][0-9][0-9]:[0-9][0-9]$//')
  if [ -d "$dir" ]; then
    find "$dir" -type f -name "*.json" -newermt "$since" 2>/dev/null
  fi
}

# Function to find files not in manifest
find_new_files_vs_manifest() {
  local dir="$1"
  local cache_type="$2"
  local manifest="$3"

  if [ ! -d "$dir" ]; then
    return
  fi

  # Extract existing IDs from manifest
  local existing_ids=$(jq -r ".cache_contents.${cache_type}[]?" "$manifest" 2>/dev/null || echo "")

  # List current files and find those not in manifest
  for f in "$dir"/*.json; do
    if [ -f "$f" ]; then
      local id=$(basename "$f" .json)
      if ! echo "$existing_ids" | grep -q "^${id}$"; then
        echo "$f"
      fi
    fi
  done
}

# Collect delta files
DELTA_FILES_LLM=""
DELTA_FILES_PROS=""
DELTA_FILES_IPR=""
DELTA_FILES_FAMILY=""

echo "1. Finding changed files..."

if [ -n "$PREV_MANIFEST" ] && [ -f "$PREV_MANIFEST" ]; then
  # Manifest-based comparison
  echo "   Comparing against manifest..."
  DELTA_FILES_LLM=$(find_new_files_vs_manifest "cache/llm-scores" "llm_scores" "$PREV_MANIFEST")
  DELTA_FILES_PROS=$(find_new_files_vs_manifest "cache/prosecution-scores" "prosecution_scores" "$PREV_MANIFEST")
  DELTA_FILES_IPR=$(find_new_files_vs_manifest "cache/ipr-scores" "ipr_scores" "$PREV_MANIFEST")
  DELTA_FILES_FAMILY=$(find_new_files_vs_manifest "cache/patent-families/parents" "patent_families" "$PREV_MANIFEST")
else
  # Timestamp-based comparison
  echo "   Finding files newer than: $SINCE_TIME"
  DELTA_FILES_LLM=$(find_newer_files "cache/llm-scores" "$SINCE_TIME")
  DELTA_FILES_PROS=$(find_newer_files "cache/prosecution-scores" "$SINCE_TIME")
  DELTA_FILES_IPR=$(find_newer_files "cache/ipr-scores" "$SINCE_TIME")
  DELTA_FILES_FAMILY=$(find_newer_files "cache/patent-families/parents" "$SINCE_TIME")
fi

# Count files (handle empty strings)
count_lines() {
  local input="$1"
  if [ -z "$input" ]; then
    echo 0
  else
    echo "$input" | wc -l | tr -d ' '
  fi
}

COUNT_LLM=$(count_lines "$DELTA_FILES_LLM")
COUNT_PROS=$(count_lines "$DELTA_FILES_PROS")
COUNT_IPR=$(count_lines "$DELTA_FILES_IPR")
COUNT_FAMILY=$(count_lines "$DELTA_FILES_FAMILY")

echo ""
echo "   LLM scores:    $COUNT_LLM new files"
echo "   Prosecution:   $COUNT_PROS new files"
echo "   IPR:           $COUNT_IPR new files"
echo "   Families:      $COUNT_FAMILY new files"

TOTAL_FILES=$((COUNT_LLM + COUNT_PROS + COUNT_IPR + COUNT_FAMILY))

if [ "$TOTAL_FILES" -eq 0 ]; then
  echo ""
  echo "No new files to export."
  exit 0
fi

# Create delta directories
echo ""
echo "2. Copying delta files..."

if [ "$COUNT_LLM" -gt 0 ]; then
  mkdir -p "$EXPORT_DIR/cache/llm-scores"
  echo "$DELTA_FILES_LLM" | while read f; do
    [ -f "$f" ] && cp "$f" "$EXPORT_DIR/cache/llm-scores/"
  done
  echo "   LLM scores copied"
fi

if [ "$COUNT_PROS" -gt 0 ]; then
  mkdir -p "$EXPORT_DIR/cache/prosecution-scores"
  echo "$DELTA_FILES_PROS" | while read f; do
    [ -f "$f" ] && cp "$f" "$EXPORT_DIR/cache/prosecution-scores/"
  done
  echo "   Prosecution scores copied"
fi

if [ "$COUNT_IPR" -gt 0 ]; then
  mkdir -p "$EXPORT_DIR/cache/ipr-scores"
  echo "$DELTA_FILES_IPR" | while read f; do
    [ -f "$f" ] && cp "$f" "$EXPORT_DIR/cache/ipr-scores/"
  done
  echo "   IPR scores copied"
fi

if [ "$COUNT_FAMILY" -gt 0 ]; then
  mkdir -p "$EXPORT_DIR/cache/patent-families/parents"
  echo "$DELTA_FILES_FAMILY" | while read f; do
    [ -f "$f" ] && cp "$f" "$EXPORT_DIR/cache/patent-families/parents/"
  done
  echo "   Families copied"
fi

# Create delta manifest
echo ""
echo "3. Creating manifest..."

cat > "$EXPORT_DIR/delta-manifest.json" << EOF
{
  "export_type": "delta",
  "export_date": "$(date -Iseconds)",
  "source_machine": "$(hostname)",
  "since_time": "${SINCE_TIME:-null}",
  "compared_to_manifest": "${PREV_MANIFEST:-null}",
  "delta_counts": {
    "llm_scores": $COUNT_LLM,
    "prosecution_scores": $COUNT_PROS,
    "ipr_scores": $COUNT_IPR,
    "patent_families": $COUNT_FAMILY,
    "total": $TOTAL_FILES
  },
  "git_commit": "$(git rev-parse HEAD 2>/dev/null || echo 'unknown')"
}
EOF

# Update last export timestamp
date -Iseconds > "$LAST_EXPORT_FILE"

# Summary
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "DELTA EXPORT COMPLETE"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Contents:"
du -sh "$EXPORT_DIR"/* 2>/dev/null | head -20
echo ""
echo "Total: $(du -sh "$EXPORT_DIR" | cut -f1) ($TOTAL_FILES files)"
echo ""
echo "To apply on target machine:"
echo "  ./scripts/import-delta.sh $EXPORT_DIR"
