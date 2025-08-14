#!/usr/bin/env bash
set -euo pipefail

# Debug logs (enable with: DEBUG=1)
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

# --- URL decode (no python) ---
urldecode(){ local s="${1//+/ }"; printf '%b' "${s//%/\\x}"; }

# --- Parse DATABASE_URL to PG* if present ---
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

# --- Absolute output path (clear in logs) ---
mkdir -p "$BACKUP_DIR"
BACKUP_DIR_ABS="$(cd "$BACKUP_DIR" && pwd -P)"
OUTFILE="${BACKUP_DIR_ABS}/${PGDATABASE}_${SUFFIX}.sql"
log "Absolute outfile: $OUTFILE"

# --- Decide how to run pg_dump/psql ---
MODE="local"      # local | exec | run_net | run_host
CID=""
DOCKER_CLIENT_HOST=""

have_docker=0
if command -v docker >/dev/null 2>&1; then have_docker=1; fi

if [ $have_docker -eq 1 ]; then
  # Prefer explicit container name if provided
  if [ -n "${POSTGRES_CONTAINER:-}" ]; then
    if docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER" >/dev/null 2>&1; then
      CID="$POSTGRES_CONTAINER"
      log "Using specified container: $CID"
    else
      log "Specified POSTGRES_CONTAINER=$POSTGRES_CONTAINER not running; will auto-detect"
    fi
  fi

  # Auto-detect postgres-like container (match by image OR name), prefer one publishing :PGPORT->
  if [ -z "$CID" ]; then
    rows="$(docker ps --format '{{.ID}};{{.Names}};{{.Image}};{{.Ports}}' 2>/dev/null || true)"
    SEL_REASON=""
    if [ -n "$rows" ]; then
      while IFS=';' read -r id name image ports; do
        [ -z "${id:-}" ] && continue
        case "$image $name" in
          *postgres*|*timescale*|*bitnami/postgres*|*pgvector* ) ;;
          *) continue ;;
        esac
        if printf '%s' "$ports" | grep -E "(^|,).*:${PGPORT}->[0-9]+/tcp" >/dev/null 2>&1; then
          CID="$id"; SEL_REASON="port"; break
        fi
        if [ -z "$CID" ]; then CID="$id"; SEL_REASON="first"; fi
      done <<EOF
$rows
EOF
      [ -n "$CID" ] && log "Auto-selected container (${SEL_REASON:-first} match): $CID"
    else
      log "docker ps returned no containers"
    fi
  fi

  # If chosen container has client tools, use docker exec; else ephemeral client on its network
  if [ -n "$CID" ]; then
    if docker exec -i "$CID" pg_dump --version >/dev/null 2>&1 \
       && docker exec -i "$CID" psql --version >/dev/null 2>&1; then
      MODE="exec"
      log "Container has client tools; will use docker exec"
    else
      MODE="run_net"
      DOCKER_CLIENT_HOST="127.0.0.1"
      log "Container lacks client tools; will use ephemeral client on container network"
    fi
  fi

  # If no container chosen and no local pg_dump, ephemeral client to host
  if [ "$MODE" = "local" ] && ! command -v pg_dump >/dev/null 2>&1; then
    MODE="run_host"
    DOCKER_CLIENT_HOST="$PGHOST"
    case "$DOCKER_CLIENT_HOST" in
      localhost|127.0.0.1) DOCKER_CLIENT_HOST="host.docker.internal" ;;
    esac
    log "No local pg_dump; using ephemeral client to host ${DOCKER_CLIENT_HOST}:${PGPORT}"
  fi
fi

# Final guard
if [ "$MODE" = "local" ] && ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump not found and Docker not available/usable." >&2
  echo "Install client tools (e.g., brew install libpq; add bin to PATH) or run Docker." >&2
  exit 1
fi

# --- Preflight (informational only) ---
if [ "$DEBUG" = "1" ]; then
  case "$MODE" in
    exec)
      log "Preflight (exec):"
      docker exec -i "$CID" pg_dump --version || true
      docker exec -i "$CID" psql --version || true
      docker exec -i "$CID" env PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -Atqc '\conninfo' || true
      ;;
    run_net)
      log "Preflight (ephemeral on container network):"
      docker run --rm -i --network "container:${CID}" postgres:16 pg_dump --version || true
      docker run --rm -i --network "container:${CID}" postgres:16 psql --version || true
      docker run --rm -i --network "container:${CID}" -e PGPASSWORD="$PGPASSWORD" postgres:16 \
        psql -h "$DOCKER_CLIENT_HOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -Atqc '\conninfo' || true
      ;;
    run_host)
      log "Preflight (ephemeral to host):"
      docker run --rm -i postgres:16 pg_dump --version || true
      docker run --rm -i postgres:16 psql --version || true
      docker run --rm -i -e PGPASSWORD="$PGPASSWORD" postgres:16 \
        psql -h "$DOCKER_CLIENT_HOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -Atqc '\conninfo' || true
      ;;
    local)
      log "Preflight (local):"
      (pg_dump --version || true)
      (psql --version || true)
      PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -Atqc '\conninfo' || true
      ;;
  esac
fi

# --- Helpers that capture stderr and fail on empty file ---
backup_run() {
  local tmp_err; tmp_err="$(mktemp)"
  case "$MODE" in
    exec)
      if ! docker exec --env PGPASSWORD="$PGPASSWORD" -i "$CID" \
           pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
           --clean --if-exists --no-owner --no-privileges >"$OUTFILE" 2>"$tmp_err"; then
        echo "pg_dump failed. Error:" >&2; sed -n '1,200p' "$tmp_err" >&2; rm -f "$tmp_err"; return 1
      fi
      ;;
    run_net)
      if ! docker run --rm -i --network "container:${CID}" -e PGPASSWORD="$PGPASSWORD" postgres:16 \
           pg_dump -h "$DOCKER_CLIENT_HOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
           --clean --if-exists --no-owner --no-privileges >"$OUTFILE" 2>"$tmp_err"; then
        echo "pg_dump failed. Error:" >&2; sed -n '1,200p' "$tmp_err" >&2; rm -f "$tmp_err"; return 1
      fi
      ;;
    run_host)
      if ! docker run --rm -i -e PGPASSWORD="$PGPASSWORD" postgres:16 \
           pg_dump -h "$DOCKER_CLIENT_HOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
           --clean --if-exists --no-owner --no-privileges >"$OUTFILE" 2>"$tmp_err"; then
        echo "pg_dump failed. Error:" >&2; sed -n '1,200p' "$tmp_err" >&2; rm -f "$tmp_err"; return 1
      fi
      ;;
    local)
      if ! PGPASSWORD="$PGPASSWORD" pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
           --clean --if-exists --no-owner --no-privileges >"$OUTFILE" 2>"$tmp_err"; then
        echo "pg_dump failed. Error:" >&2; sed -n '1,200p' "$tmp_err" >&2; rm -f "$tmp_err"; return 1
      fi
      ;;
  esac
  if [ ! -s "$OUTFILE" ]; then
    echo "Backup produced an empty file: $OUTFILE" >&2
    [ -s "$tmp_err" ] && { echo "pg_dump stderr:" >&2; sed -n '1,200p' "$tmp_err" >&2; }
    rm -f "$tmp_err"; return 1
  fi
  rm -f "$tmp_err"; return 0
}

restore_run() {
  local tmp_err; tmp_err="$(mktemp)"
  case "$MODE" in
    exec)
      if ! docker exec --env PGPASSWORD="$PGPASSWORD" -i "$CID" \
           psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 <"$OUTFILE" \
           2>"$tmp_err"; then
        echo "psql restore failed. Error:" >&2; sed -n '1,200p' "$tmp_err" >&2; rm -f "$tmp_err"; return 1
      fi
      ;;
    run_net)
      if ! docker run --rm -i --network "container:${CID}" -e PGPASSWORD="$PGPASSWORD" postgres:16 \
           psql -h "$DOCKER_CLIENT_HOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 <"$OUTFILE" \
           2>"$tmp_err"; then
        echo "psql restore failed. Error:" >&2; sed -n '1,200p' "$tmp_err" >&2; rm -f "$tmp_err"; return 1
      fi
      ;;
    run_host)
      if ! docker run --rm -i -e PGPASSWORD="$PGPASSWORD" postgres:16 \
           psql -h "$DOCKER_CLIENT_HOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 <"$OUTFILE" \
           2>"$tmp_err"; then
        echo "psql restore failed. Error:" >&2; sed -n '1,200p' "$tmp_err" >&2; rm -f "$tmp_err"; return 1
      fi
      ;;
    local)
      if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
           -v ON_ERROR_STOP=1 -f "$OUTFILE" 2>"$tmp_err"; then
        echo "psql restore failed. Error:" >&2; sed -n '1,200p' "$tmp_err" >&2; rm -f "$tmp_err"; return 1
      fi
      ;;
  esac
  rm -f "$tmp_err"; return 0
}

# --- Run operation (always prints progress) ---
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
