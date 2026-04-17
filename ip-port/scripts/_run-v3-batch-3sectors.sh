#!/usr/bin/env bash
# Run V3 infringement pipeline for 3 sectors sequentially:
#   1. computing-os-security
#   2. computing-data-protection
#   3. computing-auth-boot
#
# Each sector: create V3 vendor package → build targets → score → generate heatmap → export litigation CSV
# Non-interactive, designed to run unattended.

set -euo pipefail
cd "$(dirname "$0")/.."

LOG="output/v3-batch-3sectors-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

echo "=== V3 Batch Pipeline: 3 Sectors ==="
echo "Started: $(date)"
echo "Log: $LOG"
echo ""

run_sector() {
  local SECTOR="$1"
  local ABBREV="$2"

  echo "========================================"
  echo "=== SECTOR: $SECTOR ==="
  echo "=== Started: $(date) ==="
  echo "========================================"

  # Step 1: Create V3 vendor package
  echo ""
  echo "--- Step 1: Create V3 vendor package ---"
  npx tsx scripts/create-sector-vendor-package.ts "$SECTOR" --score-type=v3 --top=35
  echo ""

  # Step 2: Build infringement targets
  echo "--- Step 2: Build infringement targets ---"
  npx tsx "scripts/_build-${ABBREV}-infringement-targets.ts"
  echo ""

  # Step 3: Run infringement scoring
  local TARGETS_FILE="output/${SECTOR}-infringement-targets.csv"
  if [ ! -f "$TARGETS_FILE" ]; then
    echo "ERROR: Targets file not found: $TARGETS_FILE"
    return 1
  fi
  local PAIR_COUNT
  PAIR_COUNT=$(tail -n +2 "$TARGETS_FILE" | grep -c . || echo 0)
  if [ "$PAIR_COUNT" -eq 0 ]; then
    echo "No new pairs to score for $SECTOR — all cached. Skipping scoring."
  else
    echo "--- Step 3: Score $PAIR_COUNT infringement pairs ---"
    npx tsx scripts/score-infringement.ts --from-targets "$TARGETS_FILE" --max-docs-per-product 1 --concurrency 6
  fi
  echo ""

  # Step 4: Generate heatmap
  echo "--- Step 4: Generate heatmap ---"
  npx tsx "scripts/_generate-${ABBREV}-infringement-summary.ts"
  echo ""

  # Step 5: Export litigation CSV
  echo "--- Step 5: Export litigation CSV ---"
  local VENDOR_DIR
  VENDOR_DIR=$(ls -d output/vendor-exports/${SECTOR}-* 2>/dev/null | sort | tail -1)
  if [ -n "$VENDOR_DIR" ]; then
    # Find focus area ID from the vendor package
    local FA_ID
    FA_ID=$(grep -o 'cmnnifw[a-z0-9]*' "$VENDOR_DIR/README.md" 2>/dev/null | head -1 || echo "")
    if [ -z "$FA_ID" ]; then
      # Try to get it from the database via the sector name
      echo "  Could not find focus area ID in README — skipping litigation export"
    else
      npx tsx scripts/export-litigation-package.ts --id "$FA_ID" || echo "  Warning: litigation export failed"
      # Copy to vendor package dir
      local LIT_CSV
      LIT_CSV=$(ls -t output/litigation-packages/litigation-package-*.csv 2>/dev/null | head -1)
      if [ -n "$LIT_CSV" ]; then
        cp "$LIT_CSV" "$VENDOR_DIR/litigation-package-all-fields-export.csv"
        echo "  Copied litigation CSV to $VENDOR_DIR/"
      fi
    fi
  fi
  echo ""

  echo "=== SECTOR $SECTOR COMPLETE: $(date) ==="
  echo ""
}

# Run all 3 sectors
run_sector "computing-os-security" "cos"
run_sector "computing-data-protection" "cdp"
run_sector "computing-auth-boot" "cab"

echo "========================================"
echo "=== ALL 3 SECTORS COMPLETE ==="
echo "=== Finished: $(date) ==="
echo "========================================"
echo "Log saved: $LOG"
