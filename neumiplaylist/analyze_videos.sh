#!/bin/bash
# Video File Analyzer for Neumi Playback
# Analyzes video files to identify potential playback issues
# Requires: ffmpeg

echo "============================================================"
echo "Video File Analyzer - Find Playback Issues"
echo "============================================================"
echo

# Check if ffmpeg is installed
if ! command -v ffmpeg &> /dev/null; then
    echo "ERROR: ffmpeg is not installed"
    echo
    echo "Install with:"
    echo "  brew install ffmpeg"
    exit 1
fi

# Prompt for directory or file
read -p "Enter video file or directory to analyze: " TARGET

if [ ! -e "$TARGET" ]; then
    echo "ERROR: Path does not exist: $TARGET"
    exit 1
fi

# Create output file
OUTPUT="video_analysis_$(date +%Y%m%d_%H%M%S).txt"
echo "Results will be saved to: $OUTPUT"
echo

# Function to analyze single file
analyze_file() {
    local file="$1"
    local filename=$(basename "$file")
    
    echo "Analyzing: $filename" | tee -a "$OUTPUT"
    
    # Get video info
    INFO=$(ffmpeg -i "$file" 2>&1)
    
    # Extract codec
    CODEC=$(echo "$INFO" | grep "Video:" | sed 's/.*Video: //' | awk '{print $1}')
    
    # Extract resolution
    RESOLUTION=$(echo "$INFO" | grep "Video:" | grep -oE '[0-9]{3,4}x[0-9]{3,4}' | head -1)
    
    # Extract bitrate
    BITRATE=$(echo "$INFO" | grep "bitrate:" | grep -oE '[0-9]+ kb/s' | head -1)
    BITRATE_NUM=$(echo "$BITRATE" | grep -oE '[0-9]+')
    
    # Calculate Mbps
    if [ -n "$BITRATE_NUM" ]; then
        MBPS=$(echo "scale=1; $BITRATE_NUM / 1000" | bc)
    else
        MBPS="Unknown"
    fi
    
    # Determine risk level
    RISK="OK"
    REASON=""
    
    if [ "$CODEC" = "hevc" ] && [ -n "$BITRATE_NUM" ] && [ "$BITRATE_NUM" -gt 15000 ]; then
        RISK="HIGH"
        REASON="HEVC + High Bitrate"
    elif [ "$CODEC" = "hevc" ]; then
        RISK="MEDIUM"
        REASON="HEVC codec (CPU intensive)"
    elif [ -n "$BITRATE_NUM" ] && [ "$BITRATE_NUM" -gt 20000 ]; then
        RISK="MEDIUM"
        REASON="High bitrate (>20 Mbps)"
    fi
    
    # Output results
    {
        echo "  Codec: $CODEC"
        echo "  Resolution: $RESOLUTION"
        echo "  Bitrate: $MBPS Mbps"
        echo "  Risk: $RISK ${REASON:+($REASON)}"
        echo "  ---"
    } | tee -a "$OUTPUT"
}

# Process files
if [ -f "$TARGET" ]; then
    # Single file
    analyze_file "$TARGET"
else
    # Directory - find all video files
    echo "Scanning directory for video files..."
    echo
    
    find "$TARGET" -type f \( \
        -iname "*.mp4" -o \
        -iname "*.mkv" -o \
        -iname "*.avi" -o \
        -iname "*.mov" -o \
        -iname "*.m4v" \
    \) | while read -r file; do
        analyze_file "$file"
    done
fi

echo
echo "============================================================"
echo "Analysis complete!"
echo "Full results saved to: $OUTPUT"
echo "============================================================"
echo
echo "Risk levels:"
echo "  OK     - Should play smoothly"
echo "  MEDIUM - May have occasional stuttering"
echo "  HIGH   - Likely to stutter (consider re-encoding)"
echo
echo "Files marked HIGH risk should be re-encoded with:"
echo "  ffmpeg -i input.mkv -c:v libx264 -crf 23 -maxrate 8M -bufsize 16M -c:a copy output.mp4"
echo
