#!/bin/bash
# Database Import Script for IP Portfolio Migration
# Usage: ./scripts/db-import.sh <backup_file.sql.gz>

set -e

if [ -z "$1" ]; then
  echo "Usage: ./scripts/db-import.sh <backup_file.sql.gz>"
  echo "Example: ./scripts/db-import.sh ./db-backup/ip_portfolio_backup_20260209.sql.gz"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "=== IP Portfolio Database Import ==="
echo "Backup file: $BACKUP_FILE"
echo ""

# Check if Docker container is running
if ! docker ps | grep -q ip-port-postgres; then
  echo "Starting PostgreSQL container..."
  docker-compose up -d postgres
  echo "Waiting for PostgreSQL to be ready..."
  sleep 5
fi

# Check if database exists, create if not
echo "Checking database..."
docker exec ip-port-postgres psql -U ip_admin -tc "SELECT 1 FROM pg_database WHERE datname = 'ip_portfolio'" | grep -q 1 || \
  docker exec ip-port-postgres createdb -U ip_admin ip_portfolio

# Import the backup
echo "Importing database (this may take a few minutes)..."
if [[ "$BACKUP_FILE" == *.gz ]]; then
  gunzip -c "$BACKUP_FILE" | docker exec -i ip-port-postgres psql -U ip_admin -d ip_portfolio
else
  docker exec -i ip-port-postgres psql -U ip_admin -d ip_portfolio < "$BACKUP_FILE"
fi

# Verify import
echo ""
echo "Verifying import..."
docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio -c "
SELECT
  (SELECT COUNT(*) FROM patent_sub_sector_scores) as scores,
  (SELECT COUNT(*) FROM sectors) as sectors,
  (SELECT COUNT(*) FROM sub_sectors) as sub_sectors,
  (SELECT COUNT(*) FROM super_sectors) as super_sectors;
"

echo ""
echo "=== Import Complete ==="
echo "Run 'npm run dev' to start the API server"
