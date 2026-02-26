#!/bin/bash
#
# Restore IP-Port data from external drive backup
#
# Prerequisites (do these manually before running):
#   1. Git clone the repo and checkout the correct branch
#   2. Install Docker Desktop and start it
#   3. Install Node.js 20+
#   4. Mount the external drive (GLSSD2)
#   5. npm install && cd frontend && npm install && cd ..
#
# Usage: ./scripts/setup-from-drive.sh [drive-path]
#
# Default drive: /Volumes/GLSSD2
# Runs unattended — long-running steps (DB import, cache copy) are automatic.
#
# After this script completes, run manually:
#   1. Review/update .env (especially USPTO paths, API keys)
#   2. npm run dev              (API server on :3001)
#   3. cd frontend && npm run dev  (frontend on :3000)
#

set -e

DRIVE="${1:-/Volumes/GLSSD2}"
SRC="$DRIVE/ip-port"
LOG="setup-from-drive-$(date +%Y%m%d-%H%M%S).log"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  IP-PORT DATA RESTORE FROM DRIVE"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  Drive:    $DRIVE"
echo "  Source:   $SRC"
echo "  Target:   $(pwd)"
echo "  Log:      $LOG"
echo "  Started:  $(date)"
echo ""

# Log everything
exec > >(tee -a "$LOG") 2>&1

# ── Preflight checks ──

if [ ! -d "$SRC" ]; then
  echo "ERROR: Backup not found at $SRC"
  exit 1
fi

if [ ! -f "package.json" ]; then
  echo "ERROR: Run this from the ip-port project root (package.json not found)"
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker not installed. Install Docker Desktop first."
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js not installed. Install Node.js 20+ first."
  exit 1
fi

# Show manifest if available
if [ -f "$SRC/manifest.json" ]; then
  echo "Backup manifest:"
  cat "$SRC/manifest.json"
  echo ""
fi

echo "Preflight checks passed."
echo ""

# ─────────────────────────────────────────────────────────────
# Step 1: Environment file
# ─────────────────────────────────────────────────────────────
echo "═══ Step 1/7: Environment file ═══"

if [ -f "$SRC/.env" ]; then
  if [ -f ".env" ]; then
    echo "  .env already exists — saving drive version as .env.from-drive"
    cp "$SRC/.env" .env.from-drive
  else
    cp "$SRC/.env" .env
    echo "  .env copied from drive."
  fi
else
  echo "  WARNING: No .env on drive. Copy .env.example and fill in API keys."
fi
echo ""

# ─────────────────────────────────────────────────────────────
# Step 2: Start Docker + create schema
# ─────────────────────────────────────────────────────────────
echo "═══ Step 2/7: PostgreSQL + schema ═══"

if docker ps --format '{{.Names}}' | grep -q ip-port-postgres; then
  echo "  PostgreSQL already running."
else
  echo "  Starting PostgreSQL container..."
  docker compose up -d postgres

  for i in $(seq 1 30); do
    if docker exec ip-port-postgres pg_isready -U ip_admin -d ip_portfolio &>/dev/null; then
      echo "  PostgreSQL ready after ${i}s."
      break
    fi
    sleep 1
    if [ "$i" -eq 30 ]; then
      echo "  WARNING: PostgreSQL not ready after 30s. Continuing anyway..."
    fi
  done
fi

# Prisma: generate client then push schema
# IMPORTANT: Use "db push" NOT "migrate" — this project has no migrations table.
echo "  Generating Prisma client..."
npx prisma generate 2>&1 | tail -2

echo "  Pushing schema to database..."
npx prisma db push --accept-data-loss 2>&1 | tail -3

echo "  Schema ready."
echo ""

# ─────────────────────────────────────────────────────────────
# Step 3: Restore database from backup (~2-5 min)
# ─────────────────────────────────────────────────────────────
echo "═══ Step 3/7: Restore database ═══"

BACKUP_FILE=$(ls -t "$SRC/db-backup/"*.sql.gz 2>/dev/null | head -1)

if [ -z "$BACKUP_FILE" ]; then
  echo "  WARNING: No .sql.gz backup found in $SRC/db-backup/"
else
  echo "  Backup file: $(basename "$BACKUP_FILE") ($(du -h "$BACKUP_FILE" | cut -f1))"
  echo "  Importing — takes 2-5 minutes..."
  START_DB=$(date +%s)

  gunzip -c "$BACKUP_FILE" | docker exec -i ip-port-postgres psql -U ip_admin -d ip_portfolio 2>/dev/null

  END_DB=$(date +%s)
  echo "  Import completed in $((END_DB - START_DB))s."

  echo "  Verifying..."
  docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio -c "
  SELECT
    (SELECT COUNT(*) FROM patents) as patents,
    (SELECT COUNT(*) FROM patent_sub_sector_scores) as sector_scores,
    (SELECT COUNT(*) FROM portfolios) as portfolios,
    (SELECT COUNT(*) FROM batch_jobs) as batch_jobs;
  " 2>/dev/null || echo "  (verification query failed — run prisma db push again)"
fi
echo ""

# ─────────────────────────────────────────────────────────────
# Step 4: Restore cache (~10-30 min, longest step)
# ─────────────────────────────────────────────────────────────
echo "═══ Step 4/7: Restore cache (longest step) ═══"

if [ -d "$SRC/cache" ]; then
  echo "  Source: $(du -sh "$SRC/cache/" 2>/dev/null | cut -f1)"
  echo "  Copying — this may take 10-30 minutes depending on drive speed..."
  START_CACHE=$(date +%s)

  mkdir -p cache
  rsync -a "$SRC/cache/" cache/

  END_CACHE=$(date +%s)
  echo "  Cache restored in $((END_CACHE - START_CACHE))s: $(du -sh cache/ | cut -f1)"
else
  echo "  WARNING: No cache/ in backup"
fi
echo ""

# ─────────────────────────────────────────────────────────────
# Step 5: Restore output and config
# ─────────────────────────────────────────────────────────────
echo "═══ Step 5/7: Restore output & config ═══"

if [ -d "$SRC/output" ]; then
  mkdir -p output
  rsync -a "$SRC/output/" output/
  echo "  Output: $(du -sh output/ | cut -f1)"
fi

if [ -d "$SRC/config" ]; then
  rsync -a "$SRC/config/" config/
  echo "  Config: $(du -sh config/ | cut -f1)"
fi
echo ""

# ─────────────────────────────────────────────────────────────
# Step 6: Re-generate Prisma client (after DB restore)
# ─────────────────────────────────────────────────────────────
echo "═══ Step 6/7: Final Prisma generate ═══"
npx prisma generate 2>&1 | tail -2
echo ""

# ─────────────────────────────────────────────────────────────
# Step 7: Verify
# ─────────────────────────────────────────────────────────────
echo "═══ Step 7/7: Verification ═══"
echo ""
echo "  Data sizes:"
du -sh cache/ output/ config/ 2>/dev/null | sed 's/^/    /'
echo ""
echo "  Cache file counts:"
echo "    LLM scores:      $(find cache/llm-scores -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
echo "    Prosecution:     $(find cache/prosecution-scores -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
echo "    IPR:             $(find cache/ipr-scores -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
echo "    Patent families: $(find cache/patent-families/parents -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
echo "    Batch metadata:  $(find cache/batch-jobs -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "  RESTORE COMPLETE — $(date)"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  Next steps:"
echo "    1. Review .env — update USPTO paths + API keys for this machine"
echo "    2. npm run dev                     # API server :3001"
echo "    3. cd frontend && npm run dev      # Frontend :3000"
echo "    4. Open http://localhost:3000"
echo ""
echo "  Full log: $LOG"
echo ""
