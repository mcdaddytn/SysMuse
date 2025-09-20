\
#!/usr/bin/env bash
# Clean build artifacts and caches for Node + TypeScript
# Usage: bash scripts/clean.sh

set -euo pipefail

# Go to repo root if run from another dir
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Cleaning build outputs and caches..."

# Dist / coverage / tsbuildinfo
rm -rf "dist" || true
rm -rf "coverage" || true
rm -f tsconfig.tsbuildinfo || true
rm -f dist/.tsbuildinfo || true

# Common tool caches
rm -rf "node_modules/.cache" || true
rm -rf "node_modules/.ts-node" || true
rm -rf "node_modules/.prisma" || true

# Jest cache (sometimes under node_modules/.cache/jest)
rm -rf "node_modules/.cache/jest" || true

# Prisma generated client (regenerated on prisma generate)
rm -rf "node_modules/@prisma/client" || true

echo "==> Clean complete."
