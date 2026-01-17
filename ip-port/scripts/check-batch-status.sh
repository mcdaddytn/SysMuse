#!/bin/bash
# Check status of citation overlap batch jobs
# Usage: ./scripts/check-batch-status.sh

OUTPUT_DIR="${1:-output}"

echo "=== CITATION OVERLAP STATUS $(date '+%Y-%m-%d %H:%M:%S') ==="
echo ""

total_found=0
total_cites=0
completed=0

for range in "4000-4500" "4500-5000" "5000-5500" "5500-6000" "6000-6500" "6500-7000" "7000-7500" "7500-8000" "8000-8500" "8500-9000" "9000-9500" "9500-10000"; do
    log="$OUTPUT_DIR/citation-overlap-${range}.log"
    if [ -f "$log" ]; then
        progress=$(grep -o "Progress: [0-9]*/500" "$log" 2>/dev/null | tail -1 || echo "starting")
        found=$(grep -o "Found [0-9]* patents" "$log" 2>/dev/null | tail -1 | grep -o "[0-9]*" || echo "0")
        cites=$(grep -o "with [0-9]* competitor" "$log" 2>/dev/null | tail -1 | grep -o "[0-9]*" || echo "0")

        # Check if completed
        if grep -q "Analysis complete" "$log" 2>/dev/null; then
            status="DONE"
            completed=$((completed + 1))
        else
            status="running"
        fi

        echo "  $range: $progress | Found: $found patents, $cites cites [$status]"
        total_found=$((total_found + found))
        total_cites=$((total_cites + cites))
    fi
done

echo ""
echo "TOTALS: $total_found patents with $total_cites competitor citations"
echo "Completed: $completed/12 batches"
echo ""

# Check running processes
running=$(ps aux | grep "citation-overlap-batch" | grep -v grep | wc -l | tr -d ' ')
echo "Active processes: $running"
