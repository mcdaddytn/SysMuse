#!/usr/bin/env bash
set -euo pipefail

# Debug logging: set DEBUG=1 to enable
DEBUG="${DEBUG:-0}"
log(){ [ "$DEBUG" = "1" ] && echo "[DBG] $*"; }

usage(){ echo "Usage: $0 <backup|restore> [suffix=current] [backup_dir=./backups]"; exit 2; }

op="${1:-}"; shift || true
[ -z "${op:-}" ] && usage
[ "$op" != "backup" ] && [ "$op" != "restore" ] && usage

SUFFIX="${1:-current}"
BACKUP_DIR="${2:-./backups}"

# --- Load .env ---
if [ -f ".env" ]; then
  log "Loading .env"
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
else
  log ".env not found; relying on environment/DATABASE_URL"
fi

# --- Minimal URL decode using Python (for credentials with %xx) ---
#urldecode() { python3 - <<'PY' "$1"; import sys,urllib.parse as u; print(u.unquote(sys.argv[1])) ; PY; }

# Replace the old urldecode() with this bash-only version
urldecode() {
  # decode %xx and turn + into space (good enough for DATABASE_URL creds)
  local s="${1//+/ }"
  printf '%b' "${s//%/\\x}"
}

# --- Parse DATABASE_URL if present and fill missing PG* ---
if [ -n "${DATABASE_URL:-}" ]; then
  log "Parsing DATABASE_URL"
  dbu="${DATABASE_URL%\"}"; dbu="${dbu#\"}"
  rest="${dbu#*://}"              # user:pass@host:port/db?...
  base="${rest%%\?*}"             # strip query
  userinfo="${base%%@*}"
  hostpath="${base#*@}"
  if [ "$userinfo" = "$base" ]; then userinfo=""; hostpath="$base"; fi
  hostport="${hostpath%%/*}"
  dbname="${hostpath#*/}"

  if [ -z "${PGUSER:-}" ] && [ -n "$userinfo" ]; then
    PGUSER="$(urldecode "${userinfo%%:*}")"
    PGPASSWORD="$(urldecode "${userinfo#*:}")"
  fi
  [ -z "${PGHOST:-}" ]     && PGHOST="${hostport%%:*}"
  [ -z "${PGPORT:-}" ]     && PGPORT="${hostport#*:}"
  [ -z "${PGDATABASE:-}" ] && PGDATABASE="${dbname}"

  # defaults if port missing
  if [ -z "${PGPORT:-}" ] || [ "$PGPORT" = "$PGHOST" ]; then PGPORT="5432"; fi
fi

: "${PGHOST:?Missing PGHOST (or DATABASE_URL) in .env}"
: "${PGPORT:?Missing PGPORT (or DATABASE_URL) in .env}"
: "${PGUSER:?Missing PGUSER (or DATABASE_URL) in .env}"
: "${PGPASSWORD:?Missing PGPASSWORD (or DATABASE_URL) in .env}"
: "${PGDATABASE:?Missing PGDATABASE (or DATABASE_URL) in .env}"

mkdir -p "$BACKUP_DIR"
OUTFILE="${BACKUP_DIR%/}/${PGDATABASE}_${SUFFIX}.sql"
log "Outfile: $OUTFILE"

# --- Docker detection (robust, no 'docker info' needed) ---
docker_exec=""
cid=""

# 1) If POSTGRES_CONTAINER is set, prefer it
if [ -n "${POSTGRES_CONTAINER:-}" ] && command -v docker >/dev/null 2>&1; then
  if [ "$(docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER" 2>/dev/null || true)" = "true" ]; then
    cid="$POSTGRES_CONTAINER"
    docker_exec="docker exec -i \"$cid\""
    log "Using specified container: $cid"
  else
    log "Specified POSTGRES_CONTAINER=$POSTGRES_CONTAINER not running; will try auto-detect"
  fi
fi

# 2) Auto-detect a postgres-like container, prefer matching published port
if [ -z "$docker_exec" ] && command -v docker >/dev/null 2>&1; then
  while IFS=$' ' read -r id image ports; do
    [ -z "$id" ] && continue
    case "$image" in
      *postgres*|*timescale*|*bitnami/postgres*) ;;
      *) continue ;;
    esac
    if echo "$ports" | grep -E "(:${PGPORT}->(5432|${PGPORT})/tcp)" >/dev/null 2>&1; then
      cid="$id"; docker_exec="docker exec -i \"$cid\""; log "Selected by port match: $cid"; break
    fi
    # fallback to first match if none publish the expected port
    if [ -z "$cid" ]; then cid="$id"; docker_exec="docker exec -i \"$cid\""; fi
  done < <(docker ps --format '{{.ID}} {{.Image}} {{.Ports}}')
  [ -n "$cid" ] && log "Auto-selected container: $cid"
fi

# 3) If no docker and no local pg_dump, fail with guidance
if [ -z "$docker_exec" ] && ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump not found on PATH and no running postgres container detected." >&2
  echo "Install Postgres client tools (e.g. apt install postgresql-client) or set POSTGRES_CONTAINER to a running container name." >&2
  exit 1
fi

# --- Run ops ---
if [ "$op" = "backup" ]; then
  echo "Backing up ${PGDATABASE} -> ${OUTFILE}"
  if [ -n "$docker_exec" ]; then
    # shellcheck disable=SC2086
    eval $docker_exec sh -lc "PGPASSWORD='$PGPASSWORD' pg_dump -h '$PGHOST' -p '$PGPORT' -U '$PGUSER' -d '$PGDATABASE' --clean --if-exists --no-owner --no-privileges" > "$OUTFILE"
  else
    PGPASSWORD="$PGPASSWORD" pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
      --clean --if-exists --no-owner --no-privileges > "$OUTFILE"
  fi
  echo "Done."
  exit 0
fi

# restore
[ -f "$OUTFILE" ] || { echo "Restore file not found: $OUTFILE" >&2; exit 1; }
echo "Restoring ${PGDATABASE} <- ${OUTFILE}"
if [ -n "$docker_exec" ]; then
  # shellcheck disable=SC2086
  cat "$OUTFILE" | eval $docker_exec sh -lc "PGPASSWORD='$PGPASSWORD' psql -h '$PGHOST' -p '$PGPORT' -U '$PGUSER' -d '$PGDATABASE' -v ON_ERROR_STOP=1"
else
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -f "$OUTFILE"
fi
echo "Done."
