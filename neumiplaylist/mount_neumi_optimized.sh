#!/bin/bash
# Optimized NTFS Mount for Neumi SD Card (Mac)
# Mounts with performance-optimized options for video playback

echo "============================================================"
echo "Optimized NTFS Mount for Video Playback"
echo "============================================================"
echo

# Check if NTFS-3G is installed
if ! command -v ntfs-3g &> /dev/null; then
    echo "ERROR: NTFS-3G is not installed"
    echo
    echo "Install options:"
    echo "1. Paragon NTFS for Mac (commercial, easiest)"
    echo "2. NTFS-3G (free):"
    echo "   brew install --cask macfuse"
    echo "   brew install ntfs-3g"
    exit 1
fi

# List available disks
echo "Available disks:"
diskutil list | grep -E "disk[0-9]|NTFS"
echo

# Prompt for disk
read -p "Enter SD card device (e.g., disk4s1 or disk2s1): " DISK

# Validate
if [ ! -e "/dev/$DISK" ]; then
    echo "ERROR: Device /dev/$DISK does not exist"
    exit 1
fi

# Mount point
MOUNT_POINT="/Volumes/Neumi"

# Unmount if already mounted
echo
echo "Unmounting if already mounted..."
diskutil unmount /dev/$DISK 2>/dev/null

# Create mount point
echo "Creating mount point: $MOUNT_POINT"
sudo mkdir -p "$MOUNT_POINT"

# Mount with optimized options
echo
echo "Mounting with performance options..."
echo "Options: noatime, big_writes, async"
echo

sudo $(brew --prefix ntfs-3g)/bin/ntfs-3g /dev/$DISK "$MOUNT_POINT" \
  -o local \
  -o allow_other \
  -o noatime \
  -o nodiratime \
  -o big_writes \
  -o async \
  -o windows_names

if [ $? -eq 0 ]; then
    echo
    echo "============================================================"
    echo "SUCCESS! SD card mounted at: $MOUNT_POINT"
    echo "============================================================"
    echo
    echo "Performance optimizations applied:"
    echo "  ✓ noatime    - No access time updates (faster reads)"
    echo "  ✓ nodiratime - No directory access time updates"
    echo "  ✓ big_writes - Larger write buffers (better throughput)"
    echo "  ✓ async      - Asynchronous I/O (better performance)"
    echo
    echo "This mount will persist until you eject the SD card."
    echo "Re-run this script each time you insert the SD card."
    echo
    echo "To auto-mount with these options every time:"
    echo "1. Open System Settings → Login Items"
    echo "2. Add this script to 'Open at Login'"
    echo
else
    echo
    echo "ERROR: Mount failed"
    echo "Try running with sudo:"
    echo "  sudo ./mount_neumi_optimized.sh"
fi
