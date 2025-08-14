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

# --- Outfile: use absolute path for clarity ---
mkdir -p "$BACKUP_DIR"
BACKUP_DIR_ABS="$(cd "$BACKUP_DIR" && pwd -P)"
OUTFILE="${BACKUP_DIR_ABS}/${PGDATABASE}_${SUFFIX}.sql"
log "Absolute outfile: $OUTFILE"

# --- Optional preflight when DEBUG=1 ---
if [ "${DEBUG:-0}" = "1" ]; then
  if [ -n "${docker_exec:-}" ]; then
    log "Preflight: docker exec path selected: $docker_exec"
    eval $docker_exec sh -lc "pg_dump --version || true"
    eval $docker_exec sh -lc "psql --version || true"
    eval $docker_exec sh -lc "PGPASSWORD='$PGPASSWORD' psql -h '$PGHOST' -p '$PGPORT' -U '$PGUSER' -d '$PGDATABASE' -Atqc '\conninfo' || true"
  else
    log "Preflight: local binaries"
    (pg_dump --version || true)
    (psql --version || true)
    PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -Atqc '\conninfo' || true
  fi
fi

# --- Helper to run a command and surface stderr if empty output ---
backup_run() {
  local tmp_err; tmp_err="$(mktemp)"
  if [ -n "${docker_exec:-}" ]; then
    # shellcheck disable=SC2086
    if ! eval $docker_exec sh -lc "PGPASSWORD='$PGPASSWORD' pg_dump -h '$PGHOST' -p '$PGPORT' -U '$PGUSER' -d '$PGDATABASE' --clean --if-exists --no-owner --no-privileges" \
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
    if [ -s "$tmp_err" ]; then echo "pg_dump stderr:" >&2; sed -n '1,200p' "$tmp_err" >&2; fi
    rm -f "$tmp_err"; return 1
  fi
  rm -f "$tmp_err"; return 0
}

restore_run() {
  local tmp_err; tmp_err="$(mktemp)"
  if [ -n "${docker_exec:-}" ]; then
    # shellcheck disable=SC2086
    if ! cat "$OUTFILE" | eval $docker_exec sh -lc "PGPASSWORD='$PGPASSWORD' psql -h '$PGHOST' -p '$PGPORT' -U '$PGUSER' -d '$PGDATABASE' -v ON_ERROR_STOP=1" \
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
