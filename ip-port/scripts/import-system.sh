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

# 1. Database
echo "1. Importing database..."
if [ -f "prisma/dev.db" ]; then
  BACKUP="prisma/dev.db.backup-$(date +%Y%m%d-%H%M%S)"
  mv prisma/dev.db "$BACKUP"
  echo "   Backed up existing database to: $BACKUP"
fi
cp "$IMPORT_DIR/database.db" prisma/dev.db
echo "   Database imported: $(du -h prisma/dev.db | cut -f1)"

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

# 5. Configuration
echo ""
echo "5. Copying configuration..."
if [ -d "$IMPORT_DIR/config" ]; then
  cp -r "$IMPORT_DIR/config" .
fi

# 6. Verify
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "IMPORT COMPLETE - VERIFICATION"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Database: $(du -h prisma/dev.db | cut -f1)"
echo "LLM scores: $(ls cache/llm-scores/*.json 2>/dev/null | wc -l | tr -d ' ') files"
echo "Prosecution: $(ls cache/prosecution-scores/*.json 2>/dev/null | wc -l | tr -d ' ') files"
echo "IPR: $(ls cache/ipr-scores/*.json 2>/dev/null | wc -l | tr -d ' ') files"
echo "Families: $(ls cache/patent-families/parents/*.json 2>/dev/null | wc -l | tr -d ' ') files"
echo ""

if [ -f "$IMPORT_DIR/env.txt" ]; then
  echo "NOTE: Environment file saved as $IMPORT_DIR/env.txt"
  echo "      Review and copy to .env, updating any machine-specific values:"
  echo "      - API keys"
  echo "      - Database paths"
  echo "      - Port numbers"
  echo ""
fi

echo "Next steps:"
echo "  1. Review and update .env file if needed"
echo "  2. Run: npm install"
echo "  3. Run: npx prisma generate"
echo "  4. Run: npm run dev"
