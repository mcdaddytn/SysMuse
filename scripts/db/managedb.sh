#!/usr/bin/env bash
set -euo pipefail

DEBUG="${DEBUG:-0}"
log(){ [ "$DEBUG" = "1" ] && echo "[DBG] $*"; }
usage(){ echo "Usage: $0 <backup|restore> [suffix=current] [backup_dir=./backups]"; exit 2; }

op="${1:-}"; shift || true
[ -z "${op:-}" ] && usage
[ "$op" != "backup" ] && [ "$op" != "restore" ] && usage

SUFFIX="${1:-current}"
BACKUP_DIR="${2:-./backups}"

# --- Load .env from CWD ---
if [ -f ".env" ]; then
  log "Loading .env"
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
else
  log ".env not found; relying on env/DATABASE_URL"
fi

# --- URL decode without python (Bash 3.2 friendly) ---
urldecode() { local s="${1//+/ }"; printf '%b' "${s//%/\\x}"; }

# --- Parse DATABASE_URL if present and fill missing PG* ---
if [ -n "${DATABASE_URL:-}" ]; then
  log "Parsing DATABASE_URL"
  dbu="${DATABASE_URL%\"}"; dbu="${dbu#\"}"
  rest="${dbu#*://}"
  base="${rest%%\?*}"
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
  if [ -z "${PGPORT:-}" ] || [ "$PGPORT" = "$PGHOST" ]; then PGPORT="5432"; fi
fi

: "${PGHOST:?Missing PGHOST (or DATABASE_URL)}"
: "${PGPORT:?Missing PGPORT (or DATABASE_URL)}"
: "${PGUSER:?Missing PGUSER (or DATABASE_URL)}"
: "${PGPASSWORD:?Missing PGPASSWORD (or DATABASE_URL)}"
: "${PGDATABASE:?Missing PGDATABASE (or DATABASE_URL)}"

# --- Absolute outfile path (clear logs) ---
mkdir -p "$BACKUP_DIR"
BACKUP_DIR_ABS="$(cd "$BACKUP_DIR" && pwd -P)"
OUTFILE="${BACKUP_DIR_ABS}/${PGDATABASE}_${SUFFIX}.sql"
log "Absolute outfile: $OUTFILE"

# --- Docker detection (robust, no `docker info`) ---
docker_exec=""
docker_client=""
cid=""

if command -v docker >/dev/null 2>&1; then
  # 1) Prefer explicit container name
  if [ -n "${POSTGRES_CONTAINER:-}" ]; then
    if [ "$(docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER" 2>/dev/null || echo false)" = "true" ]; then
      cid="$POSTGRES_CONTAINER"
      docker_exec="docker exec -i \"$cid\""
      log "Using specified container: $cid"
    else
      log "Specified POSTGRES_CONTAINER=$POSTGRES_CONTAINER not running; try auto-detect"
    fi
  fi

  # 2) Auto-detect postgres-like container; prefer published :PGPORT->
  if [ -z "$docker_exec" ]; then
    while IFS=$'\t' read -r id image ports; do
      [ -z "$id" ] && continue
      case "$image" in
        *postgres*|*timescale*|*bitnami/postgres*) ;;
        *) continue ;;
      esac
      if echo "$ports" | grep -E "(:${PGPORT}->(5432|${PGPORT})/tcp)" >/dev/null 2>&1; then
        cid="$id"; docker_exec="docker exec -i \"$cid\""; log "Selected by port match: $cid"; break
      fi
      if [ -z "$cid" ]; then cid="$id"; docker_exec="docker exec -i \"$cid\""; fi
    done < <(docker ps --format '{{.ID}}	{{.Image}}	{{.Ports}}')
    [ -n "$cid" ] && log "Auto-selected container: $cid"
  fi
fi

# 3) Ephemeral docker client if no local pg_dump and no docker_exec
if [ -z "$docker_exec" ] && ! command -v pg_dump >/dev/null 2>&1 && command -v docker >/dev/null 2>&1; then
  DOCKER_CLIENT_HOST="$PGHOST"
  case "$DOCKER_CLIENT_HOST" in
    localhost|127.0.0.1) DOCKER_CLIENT_HOST="host.docker.internal" ;;
  esac
  docker_client="docker run --rm -i -e PGPASSWORD=\"$PGPASSWORD\" postgres:16"
  log "Using ephemeral docker client to reach ${DOCKER_CLIENT_HOST}:${PGPORT}"
fi

# 4) If we still have no way to run pg_dump, fail with guidance
if [ -z "$docker_exec" ] && [ -z "$docker_client" ] && ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump not found and no Docker client available." >&2
  echo "Install Postgres client tools (e.g. brew install libpq && add bin to PATH) or set POSTGRES_CONTAINER." >&2
  exit 1
fi

# --- Preflight diagnostics (versions + conninfo) ---
if [ "$DEBUG" = "1" ]; then
  if [ -n "$docker_exec" ]; then
    log "Preflight: docker exec path selected: $docker_exec"
    # shellcheck disable=SC2086
    eval $docker_exec sh -lc "pg_dump --version || true; psql --version || true; PGPASSWORD='$PGPASSWORD' psql -h '$PGHOST' -p '$PGPORT' -U '$PGUSER' -d '$PGDATABASE' -Atqc '\conninfo' || true"
  elif [ -n "$docker_client" ]; then
    log "Preflight: ephemeral docker client"
    # shellcheck disable=SC2086
    eval $docker_client sh -lc "pg_dump --version || true; psql --version || true; PGPASSWORD='\$PGPASSWORD' psql -h '$DOCKER_CLIENT_HOST' -p '$PGPORT' -U '$PGUSER' -d '$PGDATABASE' -Atqc '\conninfo' || true"
  else
    log "Preflight: local binaries"
    (pg_dump --version || true)
    (psql --version || true)
    PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -Atqc '\conninfo' || true
  fi
fi

# --- Helpers that surface stderr and fail on empty files ---
backup_run() {
  local tmp_err; tmp_err="$(mktemp)"
  if [ -n "$docker_exec" ]; then
    # shellcheck disable=SC2086
    if ! eval $docker_exec sh -lc "PGPASSWORD='$PGPASSWORD' pg_dump -h '$PGHOST' -p '$PGPORT' -U '$PGUSER' -d '$PGDATABASE' --clean --if-exists --no-owner --no-privileges" \
          > "$OUTFILE" 2>"$tmp_err"; then
      echo "pg_dump failed. Error:" >&2; sed -n '1,200p' "$tmp_err" >&2; rm -f "$tmp_err"; return 1
    fi
  elif [ -n "$docker_client" ]; then
    # shellcheck disable=SC2086
    if ! eval $docker_client sh -lc "pg_dump -h '$DOCKER_CLIENT_HOST' -p '$PGPORT' -U '$PGUSER' -d '$PGDATABASE' --clean --if-exists --no-owner --no-privileges" \
          > "$OUTFILE" 2>"$tmp_err"; then
      echo "pg_dump failed. Error:" >&2; sed -n '1,200p' "$tmp_err" >&2; rm -f "$tmp_err"; return 1
    fi
  else
    if ! PGPASSWORD="$PGPASSWORD" pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
          --clean --if-exists --no-owner --no-privileges > "$OUTFILE" 2>"$tmp_err"; then
      echo "pg_dump failed. Error:" >&2; sed -n '1,200p' "$tmp_err" >&2; rm -f "$tmp_err"; return 1
    fi
  fi
  if [ ! -s "$OUTFILE" ]; then
    echo "Backup produced an empty file: $OUTFILE" >&2
    [ -s "$tmp_err" ] && { echo "pg_dump stderr:" >&2; sed -n '1,200p' "$tmp_err" >&2; }
    rm -f "$tmp_err"; return 1
  fi
  rm -f "$tmp_err"; return 0
}

restore_run() {
  local tmp_err; tmp_err="$(mktemp)"
  if [ -n "$docker_exec" ]; then
    # shellcheck disable=SC2086
    if ! cat "$OUTFILE" | eval $docker_exec sh -lc "PGPASSWORD='$PGPASSWORD' psql -h '$PGHOST' -p '$PGPORT' -U '$PGUSER' -d '$PGDATABASE' -v ON_ERROR_STOP=1" \
          2>"$tmp_err"; then
      echo "psql restore failed. Error:" >&2; sed -n '1,200p' "$tmp_err" >&2; rm -f "$tmp_err"; return 1
    fi
  elif [ -n "$docker_client" ]; then
    # shellcheck disable=SC2086
    if ! cat "$OUTFILE" | eval $docker_client sh -lc "psql -h '$DOCKER_CLIENT_HOST' -p '$PGPORT' -U '$PGUSER' -d '$PGDATABASE' -v ON_ERROR_STOP=1" \
          2>"$tmp_err"; then
      echo "psql restore failed. Error:" >&2; sed -n '1,200p' "$tmp_err" >&2; rm -f "$tmp_err"; return 1
    fi
  else
    if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -f "$OUTFILE" \
          2>"$tmp_err"; then
      echo "psql restore failed. Error:" >&2; sed -n '1,200p' "$tmp_err" >&2; rm -f "$tmp_err"; return 1
    fi
  fi
  rm -f "$tmp_err"; return 0
}

# --- Run operation ---
if [ "$op" = "backup" ]; then
  echo "Backing up ${PGDATABASE} -> ${OUTFILE}"
  backup_run || exit 1
  echo "Done. Wrote: $OUTFILE"
  exit 0
fi

[ -f "$OUTFILE" ] || { echo "Restore file not found: $OUTFILE" >&2; exit 1; }
echo "Restoring ${PGDATABASE} <- ${OUTFILE}"
restore_run || exit 1
echo "Done."
