#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# db.sh — Reusable database access script for IP Portfolio
#
# Usage:
#   ./scripts/db.sh                      # Interactive psql shell
#   ./scripts/db.sh "SELECT count(*) FROM patents"
#   ./scripts/db.sh tables               # List all tables
#   ./scripts/db.sh describe patents      # Show table columns
#   ./scripts/db.sh counts               # Row counts for all tables
#   ./scripts/db.sh sql file.sql         # Run a SQL file
#   ./scripts/db.sh push                 # prisma db push (sync schema)
#   ./scripts/db.sh diff                 # Show pending schema changes
#   ./scripts/db.sh generate             # Regenerate Prisma client
# ─────────────────────────────────────────────────────────────────────────────

set -e

CONTAINER="ip-port-postgres"
DB_USER="ip_admin"
DB_NAME="ip_portfolio"
DB_URL="postgresql://${DB_USER}:ip_dev_password@localhost:5432/${DB_NAME}?schema=public"

# Helper: run psql command
run_psql() {
  docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" "$@"
}

# No arguments → interactive shell
if [ $# -eq 0 ]; then
  docker exec -it "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME"
  exit 0
fi

case "$1" in
  tables)
    run_psql -c "\dt"
    ;;
  describe|desc)
    if [ -z "$2" ]; then
      echo "Usage: db.sh describe <table_name>"
      exit 1
    fi
    run_psql -c "\d+ $2"
    ;;
  counts)
    # Row counts for all tables, sorted by count descending
    run_psql -t -A -c "
      SELECT schemaname||'.'||relname AS table, n_live_tup AS row_count
      FROM pg_stat_user_tables
      ORDER BY n_live_tup DESC;
    "
    ;;
  sql)
    if [ -z "$2" ]; then
      echo "Usage: db.sh sql <file.sql>"
      exit 1
    fi
    # Read the SQL file and pipe it in (avoids docker exec stdin issues)
    cat "$2" | docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME"
    ;;
  push)
    # Sync Prisma schema to database (no migration files)
    npx prisma db push
    ;;
  diff)
    # Show what would change if we pushed
    npx prisma migrate diff --from-url "$DB_URL" --to-schema-datamodel prisma/schema.prisma --script
    ;;
  generate)
    npx prisma generate
    ;;
  *)
    # Treat the argument as a SQL query
    run_psql -c "$1"
    ;;
esac
