# IP Portfolio Migration Guide

This guide covers migrating the IP Portfolio system to a new machine, preserving all data and scoring results.

## System Data Inventory

### What lives in the project directory (`ip-port/`)

| Component | Size | Description |
|-----------|------|-------------|
| `cache/` | ~3.3 GB | Downloaded/computed data from APIs and scoring |
| `output/` | ~181 MB | Candidates files, exports, analysis results |
| `config/` | ~652 KB | Scoring templates, sector configs, affiliates |
| `.env` | 4 KB | API keys, DB URL, data paths |
| PostgreSQL DB | ~40 MB compressed | Sectors, templates, sector scores, snapshots |

#### Cache directory breakdown

| Directory | Size | Files | Contents |
|-----------|------|-------|----------|
| `cache/api/patentsview/` | 2.8 GB | 5 dirs | PatentsView API responses (patent details, citations, forward citations) |
| `cache/patent-families/` | 251 MB | ~64k | Parent patent lookups and enrichment details |
| `cache/citation-classification/` | 122 MB | ~29k | Competitor/affiliate classification per patent |
| `cache/llm-scores/` | 68 MB | ~17.5k | Portfolio-level LLM structured analysis (eligibility, validity, etc.) |
| `cache/prosecution-scores/` | 45 MB | ~11.5k | Prosecution quality scores from file-wrapper data |
| `cache/ipr-scores/` | 42 MB | ~10.7k | IPR/PTAB risk scores |
| `cache/api/file-wrapper/` | 2.7 MB | ~689 | USPTO file-wrapper API responses |
| `cache/api/ptab/` | 2.8 MB | ~706 | USPTO PTAB API responses |

All cache data is derived from API calls. It can theoretically be regenerated but would cost significant time and API credits. **Always migrate cache data.**

### What lives on the external SSD (`/Volumes/GLSSD2/`)

| Path | Description |
|------|-------------|
| `data/uspto/export/` | **Active** — Patent grant XML files extracted for our portfolio. Used at runtime for claims text extraction. Populated by external Java bulk-extract tool. |
| `data/uspto/bulkdata/` | **Archive** — Full USPTO bulk data ZIP files by year (2005–present). Source data for the Java extractor. Not needed at runtime. |
| `data/uspto/cpc/` | **Reference** — CPC scheme and definition XML files. Used for sector taxonomy mapping and CPC code descriptions. |
| `ip-port/` | **Backup** — Previous backup of db, config, output (from Feb 10). Needs updating. |

#### USPTO Export Directory (claims data pipeline)

The `data/uspto/export/` directory is actively used by the system to extract patent claims text for LLM scoring with claims. The pipeline:

1. New patents are added to the portfolio
2. Patent IDs are extracted (e.g., via `scripts/export-patents-missing-claims.sh`)
3. A **separate Java program** (not part of this repo) reads the USPTO bulk data ZIPs and extracts the relevant patent XML into `data/uspto/export/`
4. The system reads from `export/` at runtime via `USPTO_PATENT_GRANT_XML_DIR` env var
5. Only patents in the export directory can be scored "with claims"

The Java extractor only needs to run when new patents are added. Once extracted, the bulkdata ZIPs are not needed at runtime.

### What does NOT need to be migrated (comes from git)
- Source code, scripts, docs
- Node modules — `npm install` on target
- Docker images — pulled automatically
- Prisma client — `npx prisma generate` on target

## Migration Process

### Overview

The migration uses a physical SSD to transfer all data:

```
Source Machine                    SSD Drive                      Target Machine
─────────────                    ─────────                      ──────────────
ip-port/cache/     ──rsync──►    ip-port/cache/     ──rsync──►  ip-port/cache/
ip-port/output/    ──rsync──►    ip-port/output/    ──rsync──►  ip-port/output/
ip-port/config/    ──rsync──►    ip-port/config/    ──rsync──►  ip-port/config/
ip-port/.env       ──copy──►     ip-port/.env       ──edit──►   ip-port/.env
PostgreSQL DB      ──pg_dump──►  ip-port/db-backup/ ──import──► PostgreSQL DB
data/uspto/        ──rsync──►    data/uspto/        (already on SSD or copy)
```

### Step 1: Export to SSD (Source Machine)

Run the backup script from the project root:

```bash
./scripts/backup-to-drive.sh /Volumes/GLSSD2
```

This will:
- Dump the PostgreSQL database
- Rsync cache, output, config directories (incremental — only changed files)
- Copy .env
- Write a manifest with counts and git state

Or do it manually:

```bash
DRIVE="/Volumes/GLSSD2"
DEST="$DRIVE/ip-port"

# 1. Database dump
mkdir -p "$DEST/db-backup"
docker exec ip-port-postgres pg_dump -U ip_admin -d ip_portfolio \
  --no-owner --no-privileges --if-exists --clean \
  > "$DEST/db-backup/ip_portfolio_backup_$(date +%Y%m%d).sql"
gzip -f "$DEST/db-backup/ip_portfolio_backup_$(date +%Y%m%d).sql"

# 2. Cache (rsync = only copy changes, much faster after first run)
rsync -av --delete cache/ "$DEST/cache/"

# 3. Output
rsync -av --delete output/ "$DEST/output/"

# 4. Config
rsync -av --delete config/ "$DEST/config/"

# 5. Environment
cp .env "$DEST/.env"
```

### Step 2: Verify SSD Contents

After export, confirm:
```bash
ls -la /Volumes/GLSSD2/ip-port/
# Should have: cache/ config/ db-backup/ output/ .env

ls /Volumes/GLSSD2/data/uspto/
# Should have: bulkdata/ cpc/ export/
```

### Step 3: Set Up Target Machine

```bash
# 1. Prerequisites
#    - Docker Desktop installed and running
#    - Node.js 20+ installed
#    - Git installed

# 2. Clone repo
git clone <your-repo-url> ip-port
cd ip-port

# 3. Install dependencies
npm install
cd frontend && npm install && cd ..

# 4. Start Docker
docker-compose up -d postgres
sleep 15  # Wait for PostgreSQL to be ready
```

### Step 4: Import from SSD (Target Machine)

```bash
DRIVE="/Volumes/GLSSD2"  # Or wherever SSD is mounted
SRC="$DRIVE/ip-port"

# 1. Copy data directories
rsync -av "$SRC/cache/" cache/
rsync -av "$SRC/output/" output/
rsync -av "$SRC/config/" config/

# 2. Copy and edit .env
cp "$SRC/.env" .env
# EDIT .env: Update paths if drive mount point differs
# - USPTO_PATENT_GRANT_XML_DIR
# - CPC_SCHEME_XML_DIR
# - CPC_DEFINITION_XML_DIR
# - ANTHROPIC_API_KEY (may want different key per machine)

# 3. Import database
BACKUP=$(ls -t "$SRC/db-backup/"*.sql.gz | head -1)
echo "Importing: $BACKUP"
gunzip -c "$BACKUP" | docker exec -i ip-port-postgres psql -U ip_admin -d ip_portfolio

# 4. Generate Prisma client
npx prisma generate
```

### Step 5: Verify

```bash
# Check database
docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio -c "
SELECT
  (SELECT COUNT(*) FROM super_sectors) as super_sectors,
  (SELECT COUNT(*) FROM sectors) as sectors,
  (SELECT COUNT(*) FROM patent_sub_sector_scores) as sector_scores,
  (SELECT COUNT(*) FROM score_snapshots WHERE is_active = true) as active_snapshots;
"

# Start API server
npm run dev

# In another terminal, start frontend
cd frontend && npm run dev

# Open http://localhost:3000
```

### Step 6: Ensure USPTO Data Accessible

The system needs access to the USPTO export directory for claims extraction. Options:

**Option A: Keep SSD connected** — If the SSD stays plugged in, just verify .env paths match the mount point.

**Option B: Copy to local drive** — Copy `data/uspto/export/` to the target machine's local disk and update `USPTO_PATENT_GRANT_XML_DIR` in .env.

**Option C: Copy to another external drive** — Copy to any accessible drive and update .env paths.

The `bulkdata/` directory is only needed when running the Java extractor for new patents. The `cpc/` directory is only needed for CPC enrichment operations.

## Environment Variables Reference

```env
# Database (Docker default)
DATABASE_URL="postgresql://ip_admin:ip_dev_password@localhost:5432/ip_portfolio?schema=public"
DB_PASSWORD=ip_dev_password

# API Keys
ANTHROPIC_API_KEY=sk-ant-...       # LLM scoring
PATENTSVIEW_API_KEY=...            # Patent data lookups
USPTO_ODP_API_KEY=...              # USPTO Open Data Portal

# USPTO Data Paths (adjust to match drive mount point)
USPTO_PATENT_GRANT_XML_DIR=/Volumes/GLSSD2/data/uspto/export
CPC_SCHEME_XML_DIR=/Volumes/GLSSD2/data/uspto/cpc/CPCSchemeXML202601
CPC_DEFINITION_XML_DIR=/Volumes/GLSSD2/data/uspto/cpc/FullCPCDefinitionXML202601

# LLM Config
LLM_MODEL=claude-sonnet-4-20250514
LLM_BATCH_SIZE=5
```

## Troubleshooting

### "role does not exist" errors
Always use the correct user flag with docker exec:
```bash
docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio -c "SELECT 1"
```

### Old database data from previous install
```bash
docker-compose down
docker volume rm ip-port-pgdata
docker-compose up -d postgres
sleep 15
# Then re-import
```

### Missing tables after import
```bash
npx prisma migrate deploy
```

### Claims not found for patents
Check that `USPTO_PATENT_GRANT_XML_DIR` in .env points to a valid directory containing extracted patent XML files. If patents are missing, extract them using the Java bulk-extract tool from the `bulkdata/` ZIPs.
