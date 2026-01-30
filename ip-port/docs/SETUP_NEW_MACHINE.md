# Setting Up Patent Portfolio Workstation on a New Machine

## Prerequisites

- **Node.js** v20+ (`brew install node` or use nvm)
- **Docker Desktop** (for PostgreSQL)
- **Git** (to clone the repo)

## Quick Start (With Export Package)

### On Source Machine (Export)

```bash
cd ip-port
./scripts/export-system.sh ./export-package
# Creates export-package/ with all data
```

Transfer `export-package/` folder to new machine (USB, cloud drive, etc.)

### On Target Machine (Import)

```bash
# 1. Clone the repository
git clone <repo-url> ip-port
cd ip-port

# 2. Import the data
./scripts/import-system.sh /path/to/export-package

# 3. Set up environment
cp /path/to/export-package/env.txt .env
# Edit .env - verify API keys are correct:
#   ANTHROPIC_API_KEY=sk-ant-...
#   PATENTSVIEW_API_KEY=...
#   USPTO_ODP_API_KEY=...

# 4. Install dependencies
npm install
cd frontend && npm install && cd ..

# 5. Start PostgreSQL
npm run docker:up
# Wait ~10 seconds for container to initialize

# 6. Set up Prisma
npx prisma generate
npx prisma db push

# 7. Build frontend
cd frontend && npm run build && cd ..

# 8. Start server
npm run api:start

# 9. Open browser
open http://localhost:3001
```

## Fresh Start (No Export)

If starting without an export package:

```bash
# 1. Clone and install
git clone <repo-url> ip-port
cd ip-port
npm install
cd frontend && npm install && cd ..

# 2. Create .env file
cat > .env << 'EOF'
# Required API Keys
ANTHROPIC_API_KEY=sk-ant-your-key-here
PATENTSVIEW_API_KEY=your-key-here
USPTO_ODP_API_KEY=your-key-here

# Database (Docker)
DATABASE_URL=postgresql://ip_admin:ip_admin_password@localhost:5432/ip_portfolio

# LLM Settings
LLM_MODEL=claude-sonnet-4-20250514
LLM_BATCH_SIZE=5
LLM_RATE_LIMIT_MS=2000
EOF

# 3. Start Docker
npm run docker:up

# 4. Set up Prisma
npx prisma generate
npx prisma db push

# 5. Build and run
cd frontend && npm run build && cd ..
npm run api:start
```

## API Keys Required

| Key | Purpose | Where to Get |
|-----|---------|--------------|
| `ANTHROPIC_API_KEY` | LLM analysis | https://console.anthropic.com |
| `PATENTSVIEW_API_KEY` | Patent data | https://patentsview.org/apis |
| `USPTO_ODP_API_KEY` | IPR/Prosecution data | https://data.uspto.gov (requires ID.me) |

## Troubleshooting

### Docker not starting
```bash
# Check Docker is running
docker ps

# Restart containers
npm run docker:down
npm run docker:up
```

### Database connection issues
```bash
# Check PostgreSQL container
docker logs ip-port-postgres-1

# Reset database
npm run docker:down
rm -rf .docker-data/
npm run docker:up
npx prisma db push
```

### Frontend build errors
```bash
# Clear and rebuild
cd frontend
rm -rf node_modules dist
npm install
npm run build
```

### Port 3001 in use
```bash
# Find and kill process
lsof -i :3001
kill -9 <PID>
```

## Directory Structure

```
ip-port/
├── cache/                  # Enrichment data (per-patent JSON)
│   ├── llm-scores/        # LLM analysis results
│   ├── prosecution-scores/ # USPTO prosecution data
│   ├── ipr-scores/        # PTAB IPR data
│   └── patent-families/   # Citation relationships
├── config/                # Sector definitions, etc.
├── frontend/              # Vue.js frontend
├── output/                # Analysis outputs
│   └── streaming-candidates-*.json  # Main patent data
├── src/api/               # Express API server
└── scripts/               # Utility scripts
```

## Verifying Setup

After starting the server, check:

1. **Health endpoint**: http://localhost:3001/api/health
2. **Patents loaded**: Check terminal for "Loaded X patents"
3. **Frontend**: http://localhost:3001 should show the UI
4. **Enrichment status**: Jobs & Enrichment page shows coverage %
