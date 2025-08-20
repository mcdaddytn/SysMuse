#!/bin/bash
set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <revision> or <rev1..rev2>"
  exit 1
fi

REV="$1"
OUTDIR="diffs"

rm -rf "$OUTDIR"
mkdir -p "$OUTDIR"

git diff --name-only "$REV" | while read -r file; do
  safe_name=$(echo "$file" | tr '/\\.' '___')
  git diff "$REV" -- "$file" > "$OUTDIR/$safe_name.diff"
done

echo "Success Diffs saved to $OUTDIR/"
