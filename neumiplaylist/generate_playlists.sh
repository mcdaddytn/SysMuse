#!/bin/bash
# Neumi Atom Playlist Manager - Generate Playlists (Mac/Linux)
# This script reads your CSV file and creates M3U playlist files

echo "============================================================"
echo "Neumi Atom Playlist Manager - Playlist Generator (Mac/Linux)"
echo "============================================================"
echo

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 is not installed"
    exit 1
fi

# Check if CSV exists
if [ ! -f "video_library.csv" ]; then
    echo "ERROR: video_library.csv not found!"
    echo "Please run scan_videos.sh first."
    exit 1
fi

# Prompt for SD card path
read -p "Enter path to your SD card (e.g., /Volumes/SDCARD): " SD_PATH

# Remove trailing slash if present
SD_PATH="${SD_PATH%/}"

echo
echo "SD card path: $SD_PATH"
echo "CSV file: video_library.csv"
echo "Output folder: Playlists"
echo
echo "This will create M3U playlist files in the Playlists folder."
echo
read -p "Press Enter to continue..."

# Run the Python script
python3 generate_playlists.py video_library.csv "$SD_PATH" --summary

echo
echo "============================================================"
echo "Done! Copy the Playlists folder to your SD card."
echo "============================================================"
echo
echo "The Playlists folder contains your .m3u playlist files."
echo "Copy this entire folder to the root of your SD card."
echo

# Optional: Offer to copy playlists to SD card
read -p "Do you want to copy Playlists folder to SD card now? (y/n): " COPY_NOW
if [ "$COPY_NOW" = "y" ] || [ "$COPY_NOW" = "Y" ]; then
    echo
    echo "Copying Playlists folder to $SD_PATH/Playlists..."
    cp -R Playlists "$SD_PATH/"
    echo
    echo "Copy complete!"
    echo "You can now safely eject your SD card."
fi

echo
