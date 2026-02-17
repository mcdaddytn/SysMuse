#!/bin/bash
#
# Backup system state to external drive for migration
#
# Usage: ./scripts/backup-to-drive.sh [drive-path]
#
# Default drive: /Volumes/GLSSD2
# Creates: <drive>/ip-port/ with cache, output, config, db-backup, .env
#
# Uses rsync for incremental copies — fast after first run.
#

set -e

DRIVE="${1:-/Volumes/GLSSD2}"
DEST="$DRIVE/ip-port"

if [ ! -d "$DRIVE" ]; then
  echo "ERROR: Drive not found: $DRIVE"
  echo "Usage: ./scripts/backup-to-drive.sh [drive-path]"
  exit 1
fi

echo "═══════════════════════════════════════════════════════════"
echo "BACKUP TO DRIVE"
echo "═══════════════════════════════════════════════════════════"
echo "Source:  $(pwd)"
echo "Dest:    $DEST"
echo ""

mkdir -p "$DEST/db-backup"

# ─────────────────────────────────────────────────────────────
# 1. Database dump
# ─────────────────────────────────────────────────────────────
echo "1. Exporting database..."

POSTGRES_CONTAINER=$(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1)
TIMESTAMP=$(date +%Y%m%d)
DB_FILE="$DEST/db-backup/ip_portfolio_backup_${TIMESTAMP}.sql"

if [ -n "$POSTGRES_CONTAINER" ]; then
  echo "   Container: $POSTGRES_CONTAINER"
  docker exec "$POSTGRES_CONTAINER" pg_dump -U ip_admin -d ip_portfolio \
    --no-owner --no-privileges --if-exists --clean \
    > "$DB_FILE" 2>/dev/null

  if [ -s "$DB_FILE" ]; then
    gzip -f "$DB_FILE"
    echo "   Database: $(du -h "${DB_FILE}.gz" | cut -f1)"
  else
    echo "   WARNING: pg_dump produced empty file"
    rm -f "$DB_FILE"
  fi
else
  echo "   WARNING: No PostgreSQL container running. Skipping database export."
  echo "   Start with: docker-compose up -d postgres"
fi

# ─────────────────────────────────────────────────────────────
# 2. Cache (biggest piece — rsync for efficiency)
# ─────────────────────────────────────────────────────────────
echo ""
echo "2. Syncing cache/ ($(du -sh cache/ 2>/dev/null | cut -f1))..."
rsync -a --delete --progress cache/ "$DEST/cache/"
echo "   Done."

# ─────────────────────────────────────────────────────────────
# 3. Output files
# ─────────────────────────────────────────────────────────────
echo ""
echo "3. Syncing output/ ($(du -sh output/ 2>/dev/null | cut -f1))..."
rsync -a --delete --progress output/ "$DEST/output/"
echo "   Done."

# ─────────────────────────────────────────────────────────────
# 4. Config
# ─────────────────────────────────────────────────────────────
echo ""
echo "4. Syncing config/..."
rsync -a --delete config/ "$DEST/config/"
echo "   Done."

# ─────────────────────────────────────────────────────────────
# 5. Environment file
# ─────────────────────────────────────────────────────────────
echo ""
echo "5. Copying .env..."
cp .env "$DEST/.env"
echo "   Done."

# ─────────────────────────────────────────────────────────────
# 6. Manifest
# ─────────────────────────────────────────────────────────────
echo ""
echo "6. Writing manifest..."

cat > "$DEST/manifest.json" << MANIFEST
{
  "backup_date": "$(date -Iseconds)",
  "source_machine": "$(hostname)",
  "version": "3.0",
  "database": {
    "file": "ip_portfolio_backup_${TIMESTAMP}.sql.gz",
    "size": "$(du -h "${DB_FILE}.gz" 2>/dev/null | cut -f1 || echo 'N/A')"
  },
  "cache": {
    "total_size": "$(du -sh "$DEST/cache/" 2>/dev/null | cut -f1)",
    "llm_scores": $(ls cache/llm-scores/*.json 2>/dev/null | wc -l | tr -d ' '),
    "prosecution_scores": $(ls cache/prosecution-scores/*.json 2>/dev/null | wc -l | tr -d ' '),
    "ipr_scores": $(ls cache/ipr-scores/*.json 2>/dev/null | wc -l | tr -d ' '),
    "citation_classifications": $(ls cache/citation-classification/*.json 2>/dev/null | wc -l | tr -d ' '),
    "patent_family_parents": $(ls cache/patent-families/parents/*.json 2>/dev/null | wc -l | tr -d ' ')
  },
  "output_size": "$(du -sh "$DEST/output/" 2>/dev/null | cut -f1)",
  "git": {
    "commit": "$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')",
    "branch": "$(git branch --show-current 2>/dev/null || echo 'unknown')",
    "dirty_files": $(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  },
  "uspto_data": {
    "export_dir": "$(ls "$DRIVE/data/uspto/export/" 2>/dev/null | wc -l | tr -d ' ') files in $DRIVE/data/uspto/export/",
    "bulkdata_present": $([ -d "$DRIVE/data/uspto/bulkdata" ] && echo true || echo false),
    "cpc_present": $([ -d "$DRIVE/data/uspto/cpc" ] && echo true || echo false)
  }
}
MANIFEST

# ─────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "BACKUP COMPLETE"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Backup contents:"
du -sh "$DEST"/* 2>/dev/null | sort -rh
echo ""
echo "Total: $(du -sh "$DEST" | cut -f1)"
echo ""

# Check USPTO data
if [ -d "$DRIVE/data/uspto/export" ]; then
  echo "USPTO export data: $(du -sh "$DRIVE/data/uspto/export" 2>/dev/null | cut -f1) at $DRIVE/data/uspto/export/"
else
  echo "WARNING: No USPTO export data at $DRIVE/data/uspto/export/"
  echo "  Claims extraction will not work without this."
fi

echo ""
echo "To migrate to another machine:"
echo "  1. Move this SSD to the target machine"
echo "  2. Clone the git repo on target"
echo "  3. Run: ./scripts/import-from-drive.sh /Volumes/GLSSD2"
