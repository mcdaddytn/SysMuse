#!/bin/bash
# Neumi Atom Playlist Manager - Scan Videos (Mac/Linux)
# This script scans your SD card and creates a CSV inventory of all video files

echo "============================================================"
echo "Neumi Atom Playlist Manager - Video Scanner (Mac/Linux)"
echo "============================================================"
echo

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 is not installed"
    echo "On Mac: Install from https://www.python.org/ or use 'brew install python3'"
    echo "On Linux: Use 'sudo apt-get install python3' or equivalent"
    exit 1
fi

# Prompt for SD card path
read -p "Enter path to your SD card (e.g., /Volumes/SDCARD or /media/sdcard): " SD_PATH

# Remove trailing slash if present
SD_PATH="${SD_PATH%/}"

# Check if path exists
if [ ! -d "$SD_PATH" ]; then
    echo "ERROR: Path does not exist: $SD_PATH"
    exit 1
fi

echo
echo "Scanning SD card at: $SD_PATH"
echo

# Default categories - edit these if you have different folder names
CATEGORIES="Movies ClassicMovies Documentaries Series MusicVideo"

# Default playlists - edit these to match your desired playlists
PLAYLISTS="Playlist1 Playlist2 Playlist3 Documentaries Series1 Series2"

echo "Categories to scan: $CATEGORIES"
echo "Playlists to create: $PLAYLISTS"
echo
echo "This will skip Mac system files (._*) and hidden files"
echo
read -p "Press Enter to continue (Ctrl+C to cancel)..."

# Run the Python script
python3 scan_videos.py "$SD_PATH" -c $CATEGORIES -p $PLAYLISTS

echo
echo "============================================================"
echo "Done! Check video_library.csv to edit your playlists."
echo "============================================================"
