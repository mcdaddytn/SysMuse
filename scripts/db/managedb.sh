#!/usr/bin/env bash
set -euo pipefail

usage(){ echo "Usage: $0 <backup|restore> [suffix=current] [backup_dir=./backups]"; exit 2; }

op="${1:-}"; shift || true
[[ -z "${op:-}" || ( "$op" != "backup" && "$op" != "restore" ) ]] && usage

SUFFIX="${1:-current}"
BACKUP_DIR="${2:-./backups}"

# --- Load .env (simple KEY=VALUE, supports quoted values) ---
if [[ -f ".env" ]]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi

# --- Minimal URL decode (for %xx in user/pass) ---
urldecode() { python3 - <<'PY' "$1"; 
import sys, urllib.parse as u; print(u.unquote(sys.argv[1])) 
PY
}

# --- Parse DATABASE_URL if present and any PG* are missing ---
if [[ -n "${DATABASE_URL:-}" ]]; then
  dbu="$DATABASE_URL"
  # strip quotes if .env had them
  dbu="${dbu%\"}"; dbu="${dbu#\"}"

  proto="${dbu%%://*}"
  rest="${dbu#*://}"
  # split query
  base="${rest%%\?*}"
  # userinfo@host:port/db
  userinfo="${base%%@*}"
  hostpath="${base#*@}"
  # If no '@' present, userinfo==base (detect)
  if [[ "$userinfo" == "$base" ]]; then
    userinfo=""
    hostpath="$base"
  fi
  hostport="${hostpath%%/*}"
  dbname="${hostpath#*/}"

  if [[ -z "${PGUSER:-}" && -n "$userinfo" ]]; then
    PGUSER="$(urldecode "${userinfo%%:*}")"
    PGPASSWORD="$(urldecode "${userinfo#*:}")"
  fi
  if [[ -z "${PGHOST:-}" ]]; then PGHOST="${hostport%%:*}"; fi
  if [[ -z "${PGPORT:-}" ]]; then PGPORT="${hostport#*:}"; fi
  if [[ -z "${PGDATABASE:-}" ]]; then PGDATABASE="${dbname}"; fi

  # defaults if port missing
  [[ -z "${PGPORT:-}" || "$PGPORT" == "$PGHOST" ]] && PGPORT="5432"
fi

: "${PGHOST:?Missing PGHOST (or DATABASE_URL) in .env}"
: "${PGPORT:?Missing PGPORT (or DATABASE_URL) in .env}"
: "${PGUSER:?Missing PGUSER (or DATABASE_URL) in .env}"
: "${PGPASSWORD:?Missing PGPASSWORD (or DATABASE_URL) in .env}"
: "${PGDATABASE:?Missing PGDATABASE (or DATABASE_URL) in .env}"

mkdir -p "$BACKUP_DIR"
OUTFILE="${BACKUP_DIR%/}/${PGDATABASE}_${SUFFIX}.sql"

# --- Docker autodetect (prefer container publishing expected port) ---
docker_exec=""
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  # Gather postgres-like containers
  mapfile -t rows < <(docker ps --format '{{.ID}} {{.Image}} {{.Names}} {{.Ports}}' | grep -Ei ' postgres|timescale|bitnami/postgres' || true)
  if ((${#rows[@]})); then
    chosen=""
    for r in "${rows[@]}"; do
      id="${r%% *}"; rest="${r#* }"
      ports="${r##* }"  # crude but fine for matching
      # Prefer a container that publishes our host port to 5432/tcp
      if echo "$ports" | grep -Eq "(0\.0\.0\.0|::|\*)?:${PGPORT}->(5432|$PGPORT)/tcp"; then
        chosen="$id"; break
      fi
    done
    # fallback: first postgres-ish container
    [[ -z "$chosen" ]] && chosen="${rows[0]%% *}"
    if [[ -n "$chosen" ]]; then
      docker_exec="docker exec -i $chosen"
    fi
  fi
fi

run_in_docker() {
  local cmd="$1"
  [[ -n "$docker_exec" ]] || return 1
  # shellcheck disable=SC2086
  $docker_exec env PGPASSWORD="$PGPASSWORD" sh -lc "$cmd"
}

if [[ "$op" == "backup" ]]; then
  echo "Backing up ${PGDATABASE} ? ${OUTFILE}"
  if [[ -n "$docker_exec" ]]; then
    run_in_docker "pg_dump -h \"$PGHOST\" -p \"$PGPORT\" -U \"$PGUSER\" -d \"$PGDATABASE\" --clean --if-exists --no-owner --no-privileges" >"$OUTFILE"
  else
    PGPASSWORD="$PGPASSWORD" pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" --clean --if-exists --no-owner --no-privileges >"$OUTFILE"
  fi
  echo "Done."
  exit 0
fi

# restore
[[ -f "$OUTFILE" ]] || { echo "Restore file not found: $OUTFILE" >&2; exit 1; }
echo "Restoring ${PGDATABASE} ? ${OUTFILE}"
if [[ -n "$docker_exec" ]]; then
  cat "$OUTFILE" | run_in_docker "psql -h \"$PGHOST\" -p \"$PGPORT\" -U \"$PGUSER\" -d \"$PGDATABASE\" -v ON_ERROR_STOP=1"
else
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -f "$OUTFILE"
fi
echo "Done."
