#!/bin/bash
# SD Card Speed Test for Mac
# Tests actual read/write performance of your SD card

echo "============================================================"
echo "SD Card Speed Test - Neumi NTFS Card"
echo "============================================================"
echo

# Prompt for SD card path
read -p "Enter path to your SD card (e.g., /Volumes/Neumi): " SD_PATH

# Remove trailing slash
SD_PATH="${SD_PATH%/}"

# Check if path exists
if [ ! -d "$SD_PATH" ]; then
    echo "ERROR: Path does not exist: $SD_PATH"
    exit 1
fi

# Check available space
AVAILABLE=$(df -h "$SD_PATH" | awk 'NR==2 {print $4}')
echo "Available space on SD card: $AVAILABLE"
echo

# Test file location
TEST_FILE="$SD_PATH/speedtest_temp.dat"

echo "Creating 500MB test file..."
echo "This will take a moment..."
echo

# Create test file (500MB)
dd if=/dev/zero of="$TEST_FILE" bs=1m count=500 2>&1 | grep -E "bytes|copied"

echo
echo "Testing READ speed..."
echo "============================================================"

# Clear disk cache
sudo purge 2>/dev/null

# Test read speed
READ_RESULT=$(dd if="$TEST_FILE" of=/dev/null bs=1m 2>&1)
READ_TIME=$(echo "$READ_RESULT" | grep "copied" | awk '{print $(NF-1)}')
READ_SPEED=$(echo "$READ_RESULT" | grep "copied" | awk '{print $NF}' | tr -d '()')

echo "$READ_RESULT" | grep -E "bytes|copied"
echo
echo "READ SPEED: $READ_SPEED"
echo

# Cleanup
rm "$TEST_FILE"

echo "============================================================"
echo "Results Summary:"
echo "============================================================"
echo "READ SPEED: $READ_SPEED"
echo
echo "Expected for your Lexar U3 card: >30 MB/s"
echo
echo "Interpretation:"
echo "  >50 MB/s  - Excellent, card is fine"
echo "  30-50 MB/s - Good, card is OK"
echo "  <30 MB/s  - Problem with card or NTFS mount"
echo
echo "If speed is <30 MB/s, try optimized mount options."
echo "============================================================"
