\
#!/usr/bin/env bash
# Clean build artifacts and caches for Node + TypeScript
# Usage: bash scripts/clean.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "[clean] Cleaning build outputs and caches..."

rm -rf "dist" || true
rm -rf "coverage" || true
rm -f tsconfig.tsbuildinfo || true
rm -f dist/.tsbuildinfo || true

rm -rf "node_modules/.cache" || true
rm -rf "node_modules/.ts-node" || true
rm -rf "node_modules/.prisma" || true
rm -rf "node_modules/@prisma/client" || true

echo "[clean] Done."
