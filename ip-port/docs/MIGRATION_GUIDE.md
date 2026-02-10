# IP Portfolio Migration Guide

This guide covers migrating the IP Portfolio system to a new machine, preserving all data and scoring results.

## Overview

**What needs to be migrated:**
- PostgreSQL database (~185 MB) - Contains all scoring results, sector definitions, templates
- Output files (~180 MB) - Cached candidates, exports, analysis results
- Config files (~650 KB) - Scoring templates, sector configurations
- Environment variables - API keys and settings

**What does NOT need to be migrated (available from git):**
- Source code - Pull from git repository
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

# Make scripts executable
chmod +x scripts/db-export.sh scripts/db-import.sh

# Export database
./scripts/db-export.sh ./db-backup

# This creates: ./db-backup/ip_portfolio_backup_YYYYMMDD_HHMMSS.sql.gz
```

### Step 2: Copy Files to External Drive

Copy these directories/files to your external drive:

```bash
# Create migration bundle directory
EXTERNAL_DRIVE="/Volumes/YourDrive"  # Adjust to your drive path
BUNDLE_DIR="$EXTERNAL_DRIVE/ip-port-migration"
mkdir -p "$BUNDLE_DIR"

# Copy database backup
cp -r db-backup/ "$BUNDLE_DIR/"

# Copy output files (cached data, exports)
cp -r output/ "$BUNDLE_DIR/"

# Copy config files (scoring templates)
cp -r config/ "$BUNDLE_DIR/"

# Copy environment file
cp .env "$BUNDLE_DIR/" 2>/dev/null || echo "No .env file (will need to recreate)"

# Copy scripts
cp -r scripts/ "$BUNDLE_DIR/"
```

**Alternative: Single copy command**
```bash
# Copy everything needed in one command
rsync -av --progress \
  db-backup/ \
  output/ \
  config/ \
  scripts/ \
  .env \
  "$BUNDLE_DIR/"
```

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

# 4. Start PostgreSQL container
docker-compose up -d postgres

# Wait for PostgreSQL to be ready
sleep 10
```

### Step 4: Import Data on Target Machine

```bash
# Mount your external drive and navigate to ip-port

# 1. Copy files from external drive
EXTERNAL_DRIVE="/Volumes/YourDrive"  # Adjust to your drive path
BUNDLE_DIR="$EXTERNAL_DRIVE/ip-port-migration"

# Copy output files
cp -r "$BUNDLE_DIR/output/"* output/

# Copy config files
cp -r "$BUNDLE_DIR/config/"* config/

# Copy environment file
cp "$BUNDLE_DIR/.env" .env

# Copy scripts if not already present
cp -r "$BUNDLE_DIR/scripts/"* scripts/

# 2. Import database
chmod +x scripts/db-import.sh
./scripts/db-import.sh "$BUNDLE_DIR/db-backup/ip_portfolio_backup_*.sql.gz"
```

### Step 5: Verify Migration

```bash
# 1. Start the API server
npm run dev

# 2. In another terminal, verify data
curl http://localhost:3001/api/scoring-templates/llm/super-sector-progress/WIRELESS
curl http://localhost:3001/api/scoring-templates/llm/super-sector-progress/SECURITY

# 3. Check database directly
docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio -c "
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

### Database connection issues
```bash
# Check if PostgreSQL is running
docker ps | grep postgres

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
| Database | ~185 MB | All scoring results, sector data |
| Output files | ~180 MB | Cached candidates, exports |
| Config files | ~650 KB | Scoring templates |
| Node modules | ~500 MB | Reinstalled via npm install |

## Files Checklist

Before migrating, ensure you have:

- [ ] `db-backup/ip_portfolio_backup_*.sql.gz` - Database export
- [ ] `output/` directory - All output files
- [ ] `config/` directory - Scoring templates
- [ ] `.env` file - Environment variables
- [ ] `scripts/db-import.sh` - Import script

After migrating, verify:

- [ ] Docker Desktop running
- [ ] PostgreSQL container running
- [ ] Database imported successfully
- [ ] API server starts without errors
- [ ] Scoring data visible in API responses
