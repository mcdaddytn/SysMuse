#!/bin/bash
# Database Export Script for IP Portfolio Migration
# Usage: ./scripts/db-export.sh [output_dir]

set -e

OUTPUT_DIR="${1:-./db-backup}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="ip_portfolio_backup_${TIMESTAMP}.sql"

echo "=== IP Portfolio Database Export ==="
echo "Output directory: $OUTPUT_DIR"
echo "Backup file: $BACKUP_FILE"
echo ""

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# Export the database using pg_dump
echo "Exporting database..."
docker exec ip-port-postgres pg_dump -U ip_admin -d ip_portfolio \
  --no-owner \
  --no-privileges \
  --if-exists \
  --clean \
  > "$OUTPUT_DIR/$BACKUP_FILE"

# Compress the backup
echo "Compressing backup..."
gzip -f "$OUTPUT_DIR/$BACKUP_FILE"

# Get file size
SIZE=$(du -h "$OUTPUT_DIR/${BACKUP_FILE}.gz" | cut -f1)

echo ""
echo "=== Export Complete ==="
echo "Backup file: $OUTPUT_DIR/${BACKUP_FILE}.gz"
echo "Size: $SIZE"
echo ""
echo "To import on target machine, run:"
echo "  ./scripts/db-import.sh $OUTPUT_DIR/${BACKUP_FILE}.gz"
