#!/bin/bash
#
# Import system state from external drive backup
#
# Usage: ./scripts/import-from-drive.sh [drive-path]
#
# Default drive: /Volumes/GLSSD2
# Reads from: <drive>/ip-port/ (cache, output, config, db-backup, .env)
#
# Run this from the ip-port project root after cloning the repo.
#

set -e

DRIVE="${1:-/Volumes/GLSSD2}"
SRC="$DRIVE/ip-port"

if [ ! -d "$SRC" ]; then
  echo "ERROR: Backup not found at: $SRC"
  echo "Usage: ./scripts/import-from-drive.sh [drive-path]"
  exit 1
fi

if [ ! -f "$SRC/manifest.json" ]; then
  echo "WARNING: No manifest.json found. Continuing anyway..."
else
  echo "═══════════════════════════════════════════════════════════"
  echo "IMPORT FROM DRIVE"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  echo "Source: $SRC"
  echo ""
  echo "Manifest:"
  cat "$SRC/manifest.json" 2>/dev/null
  echo ""
fi

read -p "Continue with import? This will overwrite local data. (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Import cancelled."
  exit 1
fi
echo ""

# ─────────────────────────────────────────────────────────────
# 1. Cache
# ─────────────────────────────────────────────────────────────
echo "1. Copying cache/ from drive..."
if [ -d "$SRC/cache" ]; then
  mkdir -p cache
  rsync -a --progress "$SRC/cache/" cache/
  echo "   Cache: $(du -sh cache/ | cut -f1)"
else
  echo "   WARNING: No cache/ in backup"
fi

# ─────────────────────────────────────────────────────────────
# 2. Output
# ─────────────────────────────────────────────────────────────
echo ""
echo "2. Copying output/ from drive..."
if [ -d "$SRC/output" ]; then
  mkdir -p output
  rsync -a --progress "$SRC/output/" output/
  echo "   Output: $(du -sh output/ | cut -f1)"
else
  echo "   WARNING: No output/ in backup"
fi

# ─────────────────────────────────────────────────────────────
# 3. Config
# ─────────────────────────────────────────────────────────────
echo ""
echo "3. Copying config/ from drive..."
if [ -d "$SRC/config" ]; then
  rsync -a "$SRC/config/" config/
  echo "   Config: $(du -sh config/ | cut -f1)"
else
  echo "   WARNING: No config/ in backup"
fi

# ─────────────────────────────────────────────────────────────
# 4. Environment file
# ─────────────────────────────────────────────────────────────
echo ""
echo "4. Environment file..."
if [ -f "$SRC/.env" ]; then
  if [ -f ".env" ]; then
    echo "   .env already exists. Backup saved as .env.from-drive"
    cp "$SRC/.env" .env.from-drive
    echo "   Compare and merge manually: diff .env .env.from-drive"
  else
    cp "$SRC/.env" .env
    echo "   .env copied."
  fi
  echo ""
  echo "   IMPORTANT: Review and update .env paths for this machine:"
  echo "   - USPTO_PATENT_GRANT_XML_DIR (path to patent XML exports)"
  echo "   - CPC_SCHEME_XML_DIR (path to CPC scheme data)"
  echo "   - CPC_DEFINITION_XML_DIR (path to CPC definition data)"
  echo "   - ANTHROPIC_API_KEY (may want different key per machine)"
else
  echo "   WARNING: No .env in backup. Create from .env.example"
fi

# ─────────────────────────────────────────────────────────────
# 5. Database
# ─────────────────────────────────────────────────────────────
echo ""
echo "5. Database import..."

BACKUP_FILE=$(ls -t "$SRC/db-backup/"*.sql.gz 2>/dev/null | head -1)

if [ -z "$BACKUP_FILE" ]; then
  echo "   WARNING: No .sql.gz backup found in $SRC/db-backup/"
  echo "   Database not imported."
else
  echo "   Backup file: $BACKUP_FILE"

  # Check for Docker postgres
  POSTGRES_CONTAINER=$(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1)

  if [ -z "$POSTGRES_CONTAINER" ]; then
    echo "   PostgreSQL container not running. Starting..."
    docker-compose up -d postgres
    echo "   Waiting 15s for PostgreSQL..."
    sleep 15
    POSTGRES_CONTAINER=$(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1)
  fi

  if [ -n "$POSTGRES_CONTAINER" ]; then
    echo "   Importing into container: $POSTGRES_CONTAINER"
    gunzip -c "$BACKUP_FILE" | docker exec -i "$POSTGRES_CONTAINER" psql -U ip_admin -d ip_portfolio 2>/dev/null
    echo "   Database imported."

    echo ""
    echo "   Verifying..."
    docker exec "$POSTGRES_CONTAINER" psql -U ip_admin -d ip_portfolio -c "
    SELECT
      (SELECT COUNT(*) FROM super_sectors) as super_sectors,
      (SELECT COUNT(*) FROM sectors) as sectors,
      (SELECT COUNT(*) FROM patent_sub_sector_scores) as sector_scores,
      (SELECT COUNT(*) FROM score_snapshots WHERE is_active = true) as active_snapshots;
    " 2>/dev/null || echo "   (verification query failed — may need prisma migrate deploy)"
  else
    echo "   ERROR: Could not start PostgreSQL container."
    echo "   Import manually: gunzip -c $BACKUP_FILE | docker exec -i ip-port-postgres psql -U ip_admin -d ip_portfolio"
  fi
fi

# ─────────────────────────────────────────────────────────────
# 6. Generate Prisma client
# ─────────────────────────────────────────────────────────────
echo ""
echo "6. Generating Prisma client..."
npx prisma generate 2>/dev/null && echo "   Done." || echo "   Run manually: npx prisma generate"

# ─────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "IMPORT COMPLETE"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Data sizes:"
du -sh cache/ output/ config/ 2>/dev/null
echo ""

# Check USPTO data availability
echo "USPTO data check:"
if [ -d "$DRIVE/data/uspto/export" ]; then
  echo "  Export dir: $DRIVE/data/uspto/export/ ($(ls "$DRIVE/data/uspto/export/" 2>/dev/null | wc -l | tr -d ' ') files)"
else
  echo "  WARNING: No USPTO export dir at $DRIVE/data/uspto/export/"
fi
if [ -d "$DRIVE/data/uspto/cpc" ]; then
  echo "  CPC data:   $DRIVE/data/uspto/cpc/ (present)"
else
  echo "  WARNING: No CPC data at $DRIVE/data/uspto/cpc/"
fi

echo ""
echo "Next steps:"
echo "  1. Review .env — update paths, verify API keys"
echo "  2. npm install && cd frontend && npm install"
echo "  3. npm run dev          (API server on :3001)"
echo "  4. cd frontend && npm run dev  (frontend on :3000)"
echo "  5. Open http://localhost:3000"
