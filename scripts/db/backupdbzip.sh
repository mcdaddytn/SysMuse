#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SUFFIX="${1:-current}"
BACKUP_DIR="${2:-./backups}"

# Run normal backup (managedb.sh always prints "Done. Wrote: <path>")
out="$("$SCRIPT_DIR/managedb.sh" backup "$SUFFIX" "$BACKUP_DIR")"
echo "$out"

# Extract path and gzip it
file="$(printf "%s\n" "$out" | awk '/^Done\. Wrote: /{print $3}')"
if [ -z "${file:-}" ] || [ ! -f "$file" ]; then
  # Fallback: derive expected path
  if [ -f ".env" ]; then set -a; . ./.env; set +a; fi
  if [ -z "${PGDATABASE:-}" ] && [ -n "${DATABASE_URL:-}" ]; then
    dbu="${DATABASE_URL%\"}"; dbu="${dbu#\"}"; rest="${dbu#*://}"
    base="${rest%%\?*}"; hostpath="${base#*@}"; PGDATABASE="${hostpath#*/}"
  fi
  file="${BACKUP_DIR%/}/${PGDATABASE}_${SUFFIX}.sql"
fi

gzip -f "$file"
echo "Compressed: ${file}.gz"
