# IP Portfolio Migration Guide

This guide covers migrating the IP Portfolio system to a new machine, preserving all data and scoring results.

## Overview

**What needs to be migrated:**
- PostgreSQL database (~40 MB compressed) - Contains all scoring results, sector definitions, templates
- Output files (~760 MB) - Cached candidates, exports, analysis results
- Config files (~19 MB) - Scoring templates, sector configurations
- Environment variables - API keys and settings

**What does NOT need to be migrated (available from git):**
- Source code - Pull from git repository
- Scripts - Part of source code, pull from git
- Node modules - Reinstall with `npm install`
- Docker images - Pull automatically

## Prerequisites on Target Machine

1. **Docker Desktop** installed and running
2. **Node.js 18+** installed
3. **Git** installed
4. Access to the git repository

## Step-by-Step Migration

### Step 1: Export Database on Source Machine

```bash
cd /path/to/ip-port

# Make export script executable
chmod +x scripts/db-export.sh

# Export database to external drive (or local db-backup/)
./scripts/db-export.sh /Volumes/YourDrive/ip-port/db-backup

# This creates: ip_portfolio_backup_YYYYMMDD_HHMMSS.sql.gz
```

### Step 2: Copy Files to External Drive

Copy these directories/files to your external drive:

```bash
# Set your external drive path
EXTERNAL_DRIVE="/Volumes/YourDrive"  # Adjust to your drive path
BUNDLE_DIR="$EXTERNAL_DRIVE/ip-port"
mkdir -p "$BUNDLE_DIR/db-backup"

# Copy database backup (if not already exported there)
cp db-backup/*.sql.gz "$BUNDLE_DIR/db-backup/"

# Copy output files (cached data, exports)
cp -r output "$BUNDLE_DIR/"

# Copy config files (scoring templates)
cp -r config "$BUNDLE_DIR/"

# Copy environment file
cp .env "$BUNDLE_DIR/" 2>/dev/null || echo "No .env file (will need to recreate)"
```

**Note:** Scripts are NOT copied - they are part of the source code and come from git.

### Step 3: Set Up Target Machine

On the new laptop:

```bash
# 1. Clone the repository
git clone <your-repo-url> ip-port
cd ip-port

# 2. Install dependencies
npm install

# 3. Start Docker Desktop (if not running)
open -a Docker  # macOS

# 4. If this machine had a previous installation, remove old database volume
docker-compose down
docker volume rm ip-port-pgdata 2>/dev/null

# 5. Start PostgreSQL container (creates fresh database with correct user)
docker-compose up -d postgres

# Wait for PostgreSQL to be ready
sleep 15

# 6. Verify database is ready (should return "1")
docker exec -u postgres ip-port-postgres psql -U ip_admin -d ip_portfolio -c "SELECT 1"
```

### Step 4: Import Data on Target Machine

```bash
# Mount your external drive and navigate to ip-port project directory

# 1. Set paths
EXTERNAL_DRIVE="/Volumes/YourDrive"  # Adjust to your drive path
BUNDLE_DIR="$EXTERNAL_DRIVE/ip-port"

# 2. Copy output files
cp -r "$BUNDLE_DIR/output/"* output/

# 3. Copy config files
cp -r "$BUNDLE_DIR/config/"* config/

# 4. Copy environment file
cp "$BUNDLE_DIR/.env" .env

# 5. Import database (find your backup file name)
BACKUP_FILE=$(ls "$BUNDLE_DIR/db-backup/"*.sql.gz | head -1)
echo "Importing: $BACKUP_FILE"

# 5a. Decompress the backup
gunzip -k "$BACKUP_FILE"
SQL_FILE="${BACKUP_FILE%.gz}"

# 5b. Copy SQL file into the container
docker cp "$SQL_FILE" ip-port-postgres:/tmp/backup.sql

# 5c. Fix permissions (file is copied as root, postgres user needs to read it)
docker exec ip-port-postgres chmod 644 /tmp/backup.sql

# 5d. Run the import inside the container
# NOTE: Must use "-u postgres" to run as postgres OS user
docker exec -u postgres ip-port-postgres psql -U ip_admin -d ip_portfolio -f /tmp/backup.sql

# 5e. Clean up
docker exec ip-port-postgres rm /tmp/backup.sql
```

### Step 5: Verify Migration

```bash
# 1. Verify database import (check record counts)
docker exec -u postgres ip-port-postgres psql -U ip_admin -d ip_portfolio -c "
SELECT
  (SELECT COUNT(*) FROM patent_sub_sector_scores) as scores,
  (SELECT COUNT(*) FROM sectors) as sectors,
  (SELECT COUNT(*) FROM sub_sectors) as sub_sectors,
  (SELECT COUNT(*) FROM super_sectors) as super_sectors;
"

# 2. Check scoring data by super-sector
docker exec -u postgres ip-port-postgres psql -U ip_admin -d ip_portfolio -c "
SELECT
  sup.name,
  COUNT(*) as total_scores,
  SUM(CASE WHEN psss.with_claims THEN 1 ELSE 0 END) as with_claims
FROM patent_sub_sector_scores psss
JOIN sub_sectors ss ON psss.sub_sector_id = ss.id
JOIN sectors s ON ss.sector_id = s.id
JOIN super_sectors sup ON s.super_sector_id = sup.id
GROUP BY sup.name
ORDER BY sup.name;
"

# 3. Start the API server (from project root)
npm run dev    # or: npm run api:dev

# 4. In another terminal, verify API responses
curl http://localhost:3001/api/scoring-templates/llm/super-sector-progress/WIRELESS
curl http://localhost:3001/api/scoring-templates/llm/super-sector-progress/SECURITY
```

## Environment Variables

Make sure your `.env` file contains:

```env
# Database (Docker handles this, but useful for reference)
DATABASE_URL="postgresql://ip_admin:ip_admin_password@localhost:5432/ip_portfolio"

# API Keys
ANTHROPIC_API_KEY=your_anthropic_key_here

# USPTO data directory (adjust for new machine if different)
USPTO_PATENT_GRANT_XML_DIR=/path/to/uspto/xml/files
```

## Troubleshooting

### "role does not exist" errors

When running psql commands, you may see errors like:
- `FATAL: role "root" does not exist`
- `FATAL: role "postgres" does not exist`

**Solution:** Always use `-u postgres` flag with docker exec:
```bash
# WRONG - will fail
docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio -c "SELECT 1"

# CORRECT - run as postgres OS user
docker exec -u postgres ip-port-postgres psql -U ip_admin -d ip_portfolio -c "SELECT 1"
```

### "ip_admin does not exist" or old database data

If the target machine had a previous installation, the Docker volume may contain old data:
```bash
# Stop container and remove old volume
docker-compose down
docker volume rm ip-port-pgdata

# Start fresh
docker-compose up -d postgres
sleep 15
```

### Database connection issues
```bash
# Check if PostgreSQL is running
docker ps | grep postgres

# Check container logs for errors
docker logs ip-port-postgres --tail 50

# Restart if needed
docker-compose down
docker-compose up -d postgres
```

### Missing tables after import
```bash
# Run Prisma migrations
npx prisma migrate deploy
```

### Port already in use
```bash
# Check what's using port 3001
lsof -i :3001

# Or change port in package.json scripts
```

## Data Sizes (Reference)

| Component | Size | Notes |
|-----------|------|-------|
| Database | ~40 MB (compressed) | All scoring results, sector data |
| Output files | ~760 MB | Cached candidates, exports, analysis results |
| Config files | ~19 MB | Scoring templates, sector configs |
| Node modules | ~500 MB | Reinstalled via npm install (not migrated) |
| **Total bundle** | **~820 MB** | What you copy to external drive |

## Files Checklist

Before migrating, ensure you have on external drive:

- [ ] `db-backup/ip_portfolio_backup_*.sql.gz` - Database export
- [ ] `output/` directory - All output files
- [ ] `config/` directory - Scoring templates
- [ ] `.env` file - Environment variables

After migrating, verify:

- [ ] Docker Desktop running
- [ ] PostgreSQL container running (`docker ps | grep postgres`)
- [ ] Database imported successfully (check record counts)
- [ ] API server starts without errors (`npm run dev`)
- [ ] Scoring data visible in API responses
