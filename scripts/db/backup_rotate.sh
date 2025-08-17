#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RET="${1:-7}"
BACKUP_DIR="${2:-./backups}"
STAMP="$(date +%Y%m%d_%H%M%S)"

"$SCRIPT_DIR/backupdb.sh" "$STAMP" "$BACKUP_DIR"

# Determine DB name
if [ -f ".env" ]; then set -a; . ./.env; set +a; fi
if [ -z "${PGDATABASE:-}" ] && [ -n "${DATABASE_URL:-}" ]; then
  dbu="${DATABASE_URL%\"}"; dbu="${dbu#\"}"; rest="${dbu#*://}"
  base="${rest%%\?*}"; hostpath="${base#*@}"; PGDATABASE="${hostpath#*/}"
fi

find "$BACKUP_DIR" -type f -name "${PGDATABASE}_*.sql" -mtime +"$RET" -print -delete
echo "Pruned .sql older than ${RET} days in $BACKUP_DIR"
