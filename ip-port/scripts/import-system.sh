#!/bin/bash
#
# Import system state from export package
#
# Usage: ./scripts/import-system.sh <export-directory>
#

set -e

IMPORT_DIR="${1:?Usage: import-system.sh <export-directory>}"

if [ ! -f "$IMPORT_DIR/manifest.json" ]; then
  echo "Error: Not a valid export directory (missing manifest.json)"
  exit 1
fi

echo "═══════════════════════════════════════════════════════════"
echo "SYSTEM IMPORT"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Importing from: $IMPORT_DIR"
echo ""
echo "Manifest:"
cat "$IMPORT_DIR/manifest.json" | jq .
echo ""

read -p "Continue with import? This will overwrite existing data. (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Import cancelled."
  exit 1
fi

echo ""

# 1. Database (PostgreSQL via Docker)
echo "1. Importing database..."

POSTGRES_CONTAINER=$(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1)

if [ -f "$IMPORT_DIR/database.sql" ]; then
  if [ -n "$POSTGRES_CONTAINER" ]; then
    echo "   Using Docker container: $POSTGRES_CONTAINER"
    echo "   NOTE: This will add to existing data. For clean import, reset DB first."
    docker exec -i "$POSTGRES_CONTAINER" psql -U ip_admin ip_portfolio < "$IMPORT_DIR/database.sql" 2>/dev/null
    if [ $? -eq 0 ]; then
      echo "   Database imported successfully"
    else
      echo "   WARNING: psql import via Docker had issues. Check database manually."
    fi
  else
    if [ -f ".env" ]; then
      export $(grep -E "^DATABASE_URL=" .env | xargs)
    fi

    if [ -z "$DATABASE_URL" ]; then
      echo "   WARNING: DATABASE_URL not set and no Docker container found."
      echo "   Run manually: psql \$DATABASE_URL < $IMPORT_DIR/database.sql"
    else
      echo "   Importing database from SQL dump..."
      echo "   NOTE: This will add to existing data. For clean import, reset DB first."
      psql "$DATABASE_URL" < "$IMPORT_DIR/database.sql" 2>/dev/null
      if [ $? -eq 0 ]; then
        echo "   Database imported successfully"
      else
        echo "   WARNING: psql import had issues. Check database manually."
      fi
    fi
  fi
else
  echo "   No database.sql found in export. Skipping."
fi

# 2. Cache directories
echo ""
echo "2. Extracting cache directories..."
mkdir -p cache

if [ -f "$IMPORT_DIR/cache-llm-scores.tar.gz" ]; then
  echo "   LLM scores..."
  rm -rf cache/llm-scores
  tar -xzf "$IMPORT_DIR/cache-llm-scores.tar.gz" -C cache
fi

if [ -f "$IMPORT_DIR/cache-prosecution-scores.tar.gz" ]; then
  echo "   Prosecution scores..."
  rm -rf cache/prosecution-scores
  tar -xzf "$IMPORT_DIR/cache-prosecution-scores.tar.gz" -C cache
fi

if [ -f "$IMPORT_DIR/cache-ipr-scores.tar.gz" ]; then
  echo "   IPR scores..."
  rm -rf cache/ipr-scores
  tar -xzf "$IMPORT_DIR/cache-ipr-scores.tar.gz" -C cache
fi

if [ -f "$IMPORT_DIR/cache-patent-families.tar.gz" ]; then
  echo "   Patent families..."
  rm -rf cache/patent-families
  tar -xzf "$IMPORT_DIR/cache-patent-families.tar.gz" -C cache
fi

if [ -f "$IMPORT_DIR/cache-api.tar.gz" ]; then
  echo "   API cache..."
  rm -rf cache/api
  tar -xzf "$IMPORT_DIR/cache-api.tar.gz" -C cache
fi

# 3. Output files
echo ""
echo "3. Extracting output files..."
if [ -f "$IMPORT_DIR/output.tar.gz" ]; then
  rm -rf output
  tar -xzf "$IMPORT_DIR/output.tar.gz"
fi

# 4. LLM analysis results
echo ""
echo "4. Extracting LLM analysis results..."
if [ -f "$IMPORT_DIR/llm-analysis-v3.tar.gz" ]; then
  rm -rf output/llm-analysis-v3
  mkdir -p output
  tar -xzf "$IMPORT_DIR/llm-analysis-v3.tar.gz" -C output
fi

# 5. Job queue state
echo ""
echo "5. Importing job queue state..."
if [ -f "$IMPORT_DIR/batch-jobs.json" ]; then
  mkdir -p logs
  cp "$IMPORT_DIR/batch-jobs.json" logs/
  echo "   batch-jobs.json copied to logs/"
else
  echo "   (no batch-jobs.json in export)"
fi

# 6. Configuration
echo ""
echo "6. Copying configuration..."
if [ -d "$IMPORT_DIR/config" ]; then
  cp -r "$IMPORT_DIR/config" .
fi

# 7. Verify
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "IMPORT COMPLETE - VERIFICATION"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Cache counts:"
echo "  LLM scores:    $(ls cache/llm-scores/*.json 2>/dev/null | wc -l | tr -d ' ') files"
echo "  Prosecution:   $(ls cache/prosecution-scores/*.json 2>/dev/null | wc -l | tr -d ' ') files"
echo "  IPR:           $(ls cache/ipr-scores/*.json 2>/dev/null | wc -l | tr -d ' ') files"
echo "  Families:      $(ls cache/patent-families/parents/*.json 2>/dev/null | wc -l | tr -d ' ') files"
echo ""

if [ -f "$IMPORT_DIR/env.txt" ]; then
  echo "NOTE: Environment file saved as $IMPORT_DIR/env.txt"
  echo "      Review and copy to .env, updating any machine-specific values:"
  echo "      - API keys (ANTHROPIC_API_KEY, PATENTSVIEW_API_KEY, USPTO_ODP_API_KEY)"
  echo "      - Database URL (if using different container/host)"
  echo ""
fi

echo "Next steps:"
echo "  1. Review and update .env file:"
echo "     cp $IMPORT_DIR/env.txt .env"
echo "     # Edit .env and verify/update API keys"
echo ""
echo "  2. Install dependencies:"
echo "     npm install"
echo "     cd frontend && npm install && cd .."
echo ""
echo "  3. Start Docker (PostgreSQL):"
echo "     npm run docker:up"
echo ""
echo "  4. Generate Prisma client:"
echo "     npx prisma generate"
echo ""
echo "  5. Build frontend:"
echo "     cd frontend && npm run build && cd .."
echo ""
echo "  6. Start API server:"
echo "     npm run api:start"
echo ""
echo "  7. Open browser:"
echo "     http://localhost:3001"
