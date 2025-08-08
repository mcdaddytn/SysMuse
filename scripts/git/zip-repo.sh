#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./zip-repo.sh
#   ./zip-repo.sh <ref>
#   ./zip-repo.sh <ref> --include-untracked

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "Not a git repository."; exit 1; }

REF="${1:-HEAD}"
FLAG="${2:-}"

REPO_NAME="$(basename "$PWD")"
TS="$(date +"%m%d%Y%H%M%S")"
OUTDIR="backups"
ZIP="${OUTDIR}/${REPO_NAME}_${TS}.zip"

mkdir -p "$OUTDIR"

echo "Creating clean archive from ${REF} ..."
git archive -o "$ZIP" "$REF"

if [[ "$FLAG" == "--include-untracked" ]]; then
  echo "Appending untracked files (not ignored) ..."
  while IFS= read -r -d '' f; do
    zip -q -g "$ZIP" "$f"
  done < <(git ls-files --others --exclude-standard -z || true)
fi

echo "Created $ZIP"
