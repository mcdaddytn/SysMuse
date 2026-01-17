#!/bin/bash
# Download competitor portfolios sequentially to avoid rate limits
# Usage: ./scripts/download-competitors-sequential.sh

cd /Users/gmcaveney/Documents/dev/SysMuse/ip-port

echo "════════════════════════════════════════════════════════════════"
echo "  SEQUENTIAL COMPETITOR PORTFOLIO DOWNLOAD"
echo "  Started: $(date)"
echo "════════════════════════════════════════════════════════════════"
echo ""

COMPETITORS=("IBM" "Cisco" "Forcepoint" "Palantir" "Darktrace" "Dropbox" "McAfee" "Sophos" "Samsung" "Citrix" "Red Hat" "FireEye" "Huawei")

for comp in "${COMPETITORS[@]}"; do
    echo ""
    echo "────────────────────────────────────────────────────────────────"
    echo "  Downloading: $comp"
    echo "  Time: $(date '+%H:%M:%S')"
    echo "────────────────────────────────────────────────────────────────"

    # Run download and capture result
    npx tsx examples/download-competitor-portfolios.ts --competitor "$comp" 2>&1 | tee "output/competitor-download-${comp// /-}.log"

    # Check if successful
    if grep -q "✓ Downloaded" "output/competitor-download-${comp// /-}.log"; then
        echo "  ✓ $comp complete"
    else
        echo "  ✗ $comp may have failed - check log"
    fi

    # Wait between downloads to avoid rate limits
    echo "  Waiting 30s before next download..."
    sleep 30
done

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  ALL DOWNLOADS COMPLETE"
echo "  Finished: $(date)"
echo "════════════════════════════════════════════════════════════════"

# Show disk usage
echo ""
echo "Disk usage after downloads:"
du -sh output/competitors/
