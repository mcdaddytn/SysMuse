#!/bin/bash
#
# Export entire system state for migration to another machine
#
# Usage: ./scripts/export-system.sh [export-directory]
#

set -e

EXPORT_DIR="${1:-./export-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$EXPORT_DIR"

echo "═══════════════════════════════════════════════════════════"
echo "SYSTEM EXPORT"
echo "═══════════════════════════════════════════════════════════"
echo "Exporting to: $EXPORT_DIR"
echo ""

# 1. Database export (PostgreSQL via Docker)
echo "1. Exporting database..."

# Check if Docker postgres container is running
POSTGRES_CONTAINER=$(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1)

if [ -n "$POSTGRES_CONTAINER" ]; then
  echo "   Using Docker container: $POSTGRES_CONTAINER"
  docker exec "$POSTGRES_CONTAINER" pg_dump -U ip_admin ip_portfolio > "$EXPORT_DIR/database.sql" 2>/dev/null
  if [ $? -eq 0 ] && [ -s "$EXPORT_DIR/database.sql" ]; then
    echo "   Database exported: $(du -h "$EXPORT_DIR/database.sql" | cut -f1)"
  else
    echo "   WARNING: pg_dump via Docker failed."
  fi
else
  # Fallback to local pg_dump if no Docker container
  if [ -f ".env" ]; then
    export $(grep -E "^DATABASE_URL=" .env | xargs)
  fi

  if [ -z "$DATABASE_URL" ]; then
    echo "   WARNING: DATABASE_URL not set and no Docker container found."
    echo "   Skipping database export."
  else
    pg_dump "$DATABASE_URL" > "$EXPORT_DIR/database.sql" 2>/dev/null
    if [ $? -eq 0 ]; then
      echo "   Database exported: $(du -h "$EXPORT_DIR/database.sql" | cut -f1)"
    else
      echo "   WARNING: pg_dump failed. Database may not be accessible."
    fi
  fi
fi

# 2. Cache directories (compress for transfer)
echo ""
echo "2. Compressing cache directories..."
echo "   LLM scores..."
tar -czf "$EXPORT_DIR/cache-llm-scores.tar.gz" -C cache llm-scores 2>/dev/null || echo "   (no llm-scores)"
echo "   Prosecution scores..."
tar -czf "$EXPORT_DIR/cache-prosecution-scores.tar.gz" -C cache prosecution-scores 2>/dev/null || echo "   (no prosecution-scores)"
echo "   IPR scores..."
tar -czf "$EXPORT_DIR/cache-ipr-scores.tar.gz" -C cache ipr-scores 2>/dev/null || echo "   (no ipr-scores)"
echo "   Patent families..."
tar -czf "$EXPORT_DIR/cache-patent-families.tar.gz" -C cache patent-families 2>/dev/null || echo "   (no patent-families)"
echo "   API cache..."
tar -czf "$EXPORT_DIR/cache-api.tar.gz" -C cache api 2>/dev/null || echo "   (no api cache)"

# 3. Output files
echo ""
echo "3. Compressing output files..."
tar -czf "$EXPORT_DIR/output.tar.gz" output 2>/dev/null || echo "   (no output)"

# 4. LLM analysis results
echo ""
echo "4. Compressing LLM analysis results..."
if [ -d "output/llm-analysis-v3" ]; then
  tar -czf "$EXPORT_DIR/llm-analysis-v3.tar.gz" -C output llm-analysis-v3
fi

# 5. Configuration
echo ""
echo "5. Copying configuration..."
cp -r config "$EXPORT_DIR/" 2>/dev/null || mkdir -p "$EXPORT_DIR/config"
if [ -f ".env" ]; then
  cp .env "$EXPORT_DIR/env.txt"  # Rename to avoid auto-loading on import
  echo "   NOTE: .env copied as env.txt - review and rename on target machine"
fi

# 6. Create manifest
echo ""
echo "6. Creating manifest..."
DB_SIZE="unknown"
if [ -f "$EXPORT_DIR/database.sql" ]; then
  DB_SIZE=$(du -h "$EXPORT_DIR/database.sql" | cut -f1)
fi

cat > "$EXPORT_DIR/manifest.json" << EOF
{
  "export_date": "$(date -Iseconds)",
  "source_machine": "$(hostname)",
  "export_version": "1.0",
  "database_type": "postgresql",
  "database_export_size": "$DB_SIZE",
  "cache_counts": {
    "llm_scores": $(ls cache/llm-scores/*.json 2>/dev/null | wc -l | tr -d ' '),
    "prosecution_scores": $(ls cache/prosecution-scores/*.json 2>/dev/null | wc -l | tr -d ' '),
    "ipr_scores": $(ls cache/ipr-scores/*.json 2>/dev/null | wc -l | tr -d ' '),
    "patent_families": $(ls cache/patent-families/parents/*.json 2>/dev/null | wc -l | tr -d ' ')
  },
  "git_info": {
    "commit": "$(git rev-parse HEAD 2>/dev/null || echo 'unknown')",
    "branch": "$(git branch --show-current 2>/dev/null || echo 'unknown')",
    "status": "$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ') uncommitted changes"
  }
}
EOF

# 7. Summary
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "EXPORT COMPLETE"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Contents:"
ls -lh "$EXPORT_DIR"
echo ""
echo "Total size: $(du -sh "$EXPORT_DIR" | cut -f1)"
echo ""
echo "Manifest:"
cat "$EXPORT_DIR/manifest.json" | jq .
echo ""
echo "To import on target machine:"
echo "  1. Copy $EXPORT_DIR to target machine"
echo "  2. Run: ./scripts/import-system.sh <export-dir>"
