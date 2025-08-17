#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SUFFIX="${1:-current}"
BACKUP_DIR="${2:-./backups}"

# Determine DB name in the same way managedb.sh does
if [ -f ".env" ]; then set -a; . ./.env; set +a; fi
if [ -z "${PGDATABASE:-}" ] && [ -n "${DATABASE_URL:-}" ]; then
  dbu="${DATABASE_URL%\"}"; dbu="${dbu#\"}"; rest="${dbu#*://}"
  base="${rest%%\?*}"; hostpath="${base#*@}"; PGDATABASE="${hostpath#*/}"
fi

gz="${BACKUP_DIR%/}/${PGDATABASE}_${SUFFIX}.sql.gz"
sql="${BACKUP_DIR%/}/${PGDATABASE}_${SUFFIX}.sql"

[ -f "$gz" ] || { echo "Not found: $gz" >&2; exit 1; }

# Decompress to the exact file restore expects
gzip -dc "$gz" > "$sql"
trap 'rm -f "$sql"' EXIT

"$SCRIPT_DIR/managedb.sh" restore "$SUFFIX" "$BACKUP_DIR"
echo "Restored from: $gz"
