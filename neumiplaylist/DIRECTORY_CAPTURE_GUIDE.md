# Quick Reference: Capturing Directory Structures

## 🎯 What You Need to Capture

For each SD card, capture:
1. Full directory tree with filenames
2. List of all video files
3. Sample of video metadata (5-10 files)
4. Current video_library.csv (if exists)

## 📋 Copy-Paste Commands

### For Mac Users

#### Card 1 - Complete Directory Tree

```bash
# Install tree if needed
brew install tree

# Capture full structure (recommended)
tree -h /Volumes/Neumi > card1_structure.txt

# If too large, limit depth
tree -L 4 -h /Volumes/Neumi > card1_structure.txt

# Just show video files
tree -P '*.mp4|*.mkv|*.avi|*.mov' --prune /Volumes/Neumi > card1_videos.txt
```

#### Card 1 - Video Files Only

```bash
# List all video files with paths
find /Volumes/Neumi -type f \( \
  -iname "*.mp4" -o \
  -iname "*.mkv" -o \
  -iname "*.avi" -o \
  -iname "*.mov" -o \
  -iname "*.m4v" -o \
  -iname "*.ts" \
) > card1_videos.txt

# With file sizes
find /Volumes/Neumi -type f \( \
  -iname "*.mp4" -o \
  -iname "*.mkv" -o \
  -iname "*.avi" \
) -exec ls -lh {} \; > card1_videos_detailed.txt
```

#### Card 1 - Sample Video Metadata

```bash
# Pick first 10 video files and get metadata
find /Volumes/Neumi -type f \( \
  -iname "*.mp4" -o \
  -iname "*.mkv" -o \
  -iname "*.avi" \
) -print0 | head -z -n 10 | while IFS= read -r -d '' file; do
  echo "=== $file ===" >> card1_metadata.txt
  ffprobe -v quiet -print_format json -show_format -show_streams "$file" >> card1_metadata.txt 2>&1
  echo "" >> card1_metadata.txt
done
```

#### Card 2 - Repeat for Second Card

```bash
# Replace /Volumes/Neumi with your Card 2 path
tree -h /Volumes/NeumiSD2 > card2_structure.txt
# ... repeat commands above with card2 output files
```

### For Windows Users

#### Card 1 - Complete Directory Tree

```cmd
REM Capture full structure
tree E:\ /F /A > card1_structure.txt

REM Just folders (no files) for overview
tree E:\ /A > card1_folders.txt
```

#### Card 1 - Video Files Only

```cmd
REM List all video files
dir E:\*.mp4 /S /B > card1_videos.txt
dir E:\*.mkv /S /B >> card1_videos.txt
dir E:\*.avi /S /B >> card1_videos.txt

REM Or use PowerShell (one command for all)
powershell -Command "Get-ChildItem E:\ -Recurse -Include *.mp4,*.mkv,*.avi,*.mov | Select-Object FullName, Length | Export-Csv card1_videos.csv -NoTypeInformation"
```

#### Card 1 - Sample Video Metadata (PowerShell)

```powershell
# Get metadata for first 10 videos
Get-ChildItem E:\ -Recurse -Include *.mp4,*.mkv,*.avi | 
  Select-Object -First 10 | 
  ForEach-Object {
    Write-Output "=== $($_.FullName) ===" | Out-File -Append card1_metadata.txt
    ffprobe -v quiet -print_format json -show_format -show_streams $_.FullName | Out-File -Append card1_metadata.txt
    Write-Output "" | Out-File -Append card1_metadata.txt
  }
```

## 📁 Expected Output Files

After running these commands, you should have:

```
neumi-playlist-project/
├── card_structures/
│   ├── card1_structure.txt        ← Full directory tree
│   ├── card1_videos.txt           ← Just video files
│   ├── card1_metadata.txt         ← Sample video metadata
│   ├── card2_structure.txt        ← Card 2 directory tree
│   ├── card2_videos.txt           ← Card 2 video files
│   └── card2_metadata.txt         ← Card 2 video metadata
└── metadata/
    ├── card1_video_library.csv    ← If you already ran scan_videos.py
    └── card2_video_library.csv    ← If you already ran scan_videos.py
```

## ⚡ Quick One-Liner (Choose Your Platform)

### Mac - All-in-One Capture

```bash
# Set your SD card path
CARD="/Volumes/Neumi"

# Capture everything
tree -h "$CARD" > card_structure.txt && \
find "$CARD" -type f \( -iname "*.mp4" -o -iname "*.mkv" -o -iname "*.avi" \) > card_videos.txt && \
echo "Done! Check card_structure.txt and card_videos.txt"
```

### Windows - All-in-One Capture (PowerShell)

```powershell
# Set your SD card drive
$Card = "E:\"

# Capture everything
tree $Card /F /A | Out-File card_structure.txt
Get-ChildItem $Card -Recurse -Include *.mp4,*.mkv,*.avi | 
  Select-Object FullName, Length | 
  Export-Csv card_videos.csv -NoTypeInformation
Write-Output "Done! Check card_structure.txt and card_videos.csv"
```

## 🎯 Minimal Capture (If Time Constrained)

If you just want the essentials:

### Mac

```bash
# Just get video file list
find /Volumes/Neumi -name "*.mp4" -o -name "*.mkv" -o -name "*.avi" > videos.txt

# Show directory structure (folders only, 3 levels deep)
tree -L 3 -d /Volumes/Neumi > structure.txt
```

### Windows

```cmd
REM Just get video file list
dir E:\*.mp4 /S /B > videos.txt
dir E:\*.mkv /S /B >> videos.txt

REM Show directory structure (folders only)
tree E:\ > structure.txt
```

## 📝 What to Include in Claude Code Project

**At minimum:**
- `card1_structure.txt` - Shows directory organization
- `card1_videos.txt` - Shows actual video files

**Recommended:**
- `card1_metadata.txt` - Sample video details (codec, bitrate)
- `card1_video_library.csv` - Parsed output from scan_videos.py

**Optional:**
- `card1_videos_detailed.txt` - File sizes and dates

## 🔍 Verify Your Captures

```bash
# Mac - Check line counts
wc -l card1_structure.txt    # Should be 100s to 1000s of lines
wc -l card1_videos.txt        # Should match number of video files

# Windows
powershell -Command "Get-Content card1_structure.txt | Measure-Object -Line"
```

## ⚠️ Common Issues

### Issue: "tree: command not found" (Mac)
**Solution:** `brew install tree`

### Issue: "ffprobe: command not found"
**Solution:** `brew install ffmpeg` (Mac) or download from ffmpeg.org (Windows)

### Issue: Output file too large (>10 MB)
**Solution:** Limit depth with `tree -L 3` or capture just video files

### Issue: Special characters in filenames
**Mac:** Tree handles automatically
**Windows:** Use PowerShell instead of cmd for better Unicode support

## 💾 Copy Files to Project

After capturing:

```bash
# Mac
mkdir -p ~/neumi-playlist-project/card_structures
cp card1_*.txt ~/neumi-playlist-project/card_structures/
cp card2_*.txt ~/neumi-playlist-project/card_structures/

# Windows
mkdir C:\neumi-playlist-project\card_structures
copy card1_*.txt C:\neumi-playlist-project\card_structures\
copy card2_*.txt C:\neumi-playlist-project\card_structures\
```

## ✅ Verification Checklist

Before uploading to Claude Code:

- [ ] card1_structure.txt exists and has content
- [ ] card1_videos.txt shows video file paths
- [ ] card2_structure.txt exists and has content  
- [ ] card2_videos.txt shows video file paths
- [ ] Files are readable (not binary/corrupted)
- [ ] Both card structures are different enough to test

## 🚀 Ready for Claude Code

Once you have these files:

1. Create project folder: `neumi-playlist-project/`
2. Add subdirectories: `card_structures/`, `scripts/`, `docs/`
3. Copy all captures to `card_structures/`
4. Copy all scripts to `scripts/`
5. Copy all documentation to `docs/`
6. Upload to Claude Code or open in Claude Desktop

**You're ready to collaborate with Claude on optimizing the system!** 🎉
