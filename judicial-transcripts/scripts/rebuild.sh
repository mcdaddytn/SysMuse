\
#!/usr/bin/env bash
# Clean and rebuild TypeScript to dist, regenerate Prisma types
# Usage: bash scripts/rebuild.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

bash "$SCRIPT_DIR/clean.sh"

echo "==> Regenerating Prisma client (if schema present)..."
if [ -f "prisma/schema.prisma" ]; then
  npx prisma generate
else
  echo "    (No prisma/schema.prisma found; skipping prisma generate)"
fi

echo "==> TypeScript build..."
npx tsc -b || npx tsc

echo "==> Rebuild complete. Output in ./dist"
