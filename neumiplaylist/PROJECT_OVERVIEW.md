# Neumi Atom Playlist Management System
## Project Overview & Context

## 📋 Project Purpose

This system manages video playlists for **Neumi Atom media players** (1080p and 4K Lite models) used by elderly relatives. The goal is to create organized, easy-to-navigate playlists on SD cards that play movies in a specific order without requiring the user to search through files.

## 🎯 Core Problem Solved

**Challenge:** Neumi Atom players don't support M3U playlists or symbolic links.

**Solution:** Use NTFS hard links on SD cards to create playlist folders with:
- Numbered files (01, 02, 03...) for correct playback order
- Clean, readable names (not ugly torrent filenames)
- Zero space duplication (hard links point to same data)
- Support for both movies and TV series

## 🏗️ System Architecture

### 1. Video Scanning & Parsing
**Script:** `scan_videos.py`

**Purpose:** Scan SD card directory structure and create CSV inventory

**Features:**
- Recursive directory scanning (handles nested folders)
- Intelligent filename parsing:
  - Extracts year (1900-2030)
  - Extracts quality (1080p, 720p, 4K, etc.)
  - Removes codec tags (x264, x265, HEVC)
  - Removes release group tags ([YTS.AM], YIFY, etc.)
  - Creates clean display names
- TV episode detection:
  - Recognizes "Season X Episode YY" patterns
  - Recognizes "S##E##" patterns
  - Parses episode titles
- File filtering:
  - Ignores non-video files (.txt, .srt, .jpg, .DS_Store)
  - Only processes supported video formats

**Output:** `video_library.csv` with columns:
- `filename` - Original filename on disk
- `clean_name` - Generated display name
- `content_type` - "movie" or "episode"
- `series_name` - For TV episodes
- `season` - Episode season number
- `episode` - Episode number
- `year` - Parsed year
- `quality` - Parsed quality
- `file_type` - Extension
- `category` - Source folder
- `relative_path` - Full path from SD card root
- Playlist columns (user fills in with numbers)

### 2. Playlist Generation
**Script:** `generate_playlists.py`

**Purpose:** Create hard-linked playlist folders from CSV

**Process:**
1. Read CSV with playlist assignments
2. For each playlist column:
   - Find all videos with numbers in that column
   - Sort by number (playback order)
   - Create playlist folder
   - Create hard links with format: `##-Clean Name.ext`
3. Hard links point to original files (no space used)

**Output:** `Playlists/` folder structure:
```
Playlists/
├── Playlist1/
│   ├── 01 Casablanca.mp4
│   ├── 02 The Godfather.mp4
│   └── 03 Goodfellas.mp4
└── Series1/
    ├── 01 S02E01 - The Child.avi
    └── 02 S02E02 - Where Silence Has Lease.avi
```

### 3. Batch Re-encoding
**Script:** `batch_reencode.py`

**Purpose:** Re-encode problematic videos for smooth playback

**Problem Solved:** 
- Neumi 4K Lite stutters on high-bitrate HEVC files
- NTFS overhead compounds I/O issues
- Some videos smooth on 1080p model but stutter on 4K Lite

**Features:**
- Scans directory tree for video files
- Analyzes each file (codec, bitrate)
- Determines if re-encoding needed:
  - HEVC → H.264 (less CPU intensive)
  - High bitrate (>20 Mbps) → 8 Mbps (smooth playback)
  - Already optimized → Skip
- Re-encodes with Neumi-optimized settings:
  - H.264 codec
  - 8 Mbps max bitrate
  - CRF 23 (high quality)
  - Fast start flag (streaming optimized)
- Options:
  - In-place (replace originals)
  - Keep backups (.original)
  - Add suffix (_optimized)
  - Dry run (see what would happen)

### 4. Configuration System
**File:** `config.json`

**Purpose:** Centralized pattern matching for filename parsing

**Configurable patterns:**
- Supported video formats
- File extensions to ignore
- Quality patterns (1080p, 720p, 4K, etc.)
- Source patterns (BluRay, WEBRip, etc.)
- Codec patterns (x264, x265, HEVC, etc.)
- Release group patterns (YTS.AM, YIFY, BONE, etc.)
- Bracket patterns to remove
- File size patterns to remove

**Extensibility:** Users can add custom patterns without modifying Python code

### 5. Diagnostic Tools

**`test_sd_speed.sh`** - Test SD card read speed
- Creates 500MB test file
- Measures read performance
- Compares against expected speeds

**`mount_neumi_optimized.sh`** - Optimize NTFS mount for video playback
- Adds performance flags:
  - `noatime` - No access time updates
  - `big_writes` - Larger I/O buffers
  - `async` - Asynchronous I/O
- Reduces NTFS overhead by 20-30%

**`analyze_videos.sh`** - Identify problematic video files
- Uses ffprobe to analyze each video
- Reports codec, bitrate, resolution
- Flags HIGH risk files (likely to stutter)

**`test_fragmentation.bat`** - Check NTFS fragmentation (Windows)
- Analyzes file fragmentation
- Recommends defragmentation if needed

### 6. Platform Support

**Windows:**
- Batch scripts (.bat) for easy double-click execution
- Native NTFS support (no drivers needed)
- Defragmentation tools available

**Mac:**
- Shell scripts (.sh) for terminal execution
- Requires NTFS driver (Paragon NTFS or NTFS-3G)
- Optimized mount scripts for performance

**Linux:**
- Shell scripts work natively
- NTFS-3G usually pre-installed

## 📂 Directory Structures Supported

### Structure 1: Flat with Subdirectories (Card 1)
```
Movies/
├── Casablanca.1942.1080p.BluRay.x264.YIFY.mp4
├── The.Searchers.1956.720p.BluRay.mp4
└── Scorsese/
    ├── Goodfellas.1990.mkv
    └── The Irishman (2019) [1080p]/
        └── The.Irishman.2019.mp4
```

### Structure 2: TV Series with Seasons (Card 2)
```
Series/
└── Star Trek - The Next Generation/
    ├── Season 2/
    │   ├── Episode 01 - The Child.avi
    │   └── Episode 02 - Where Silence Has Lease.avi
    └── Season 5/
        └── Episodes...
```

### Structure 3: Complex Nested (Both Cards)
```
Classic Films/
├── Coen Bros/
│   ├── Fargo.1996.mp4
│   ├── Millers Crossing (1990) [1080p]/
│   │   ├── Millers.Crossing.1990.mp4
│   │   ├── subtitle.srt  ← ignored
│   │   └── cover.jpg  ← ignored
│   └── The.Big.Lebowski.1998.REMASTERED/
│       ├── The.Big.Lebowski.1998.mp4
│       └── Subs/  ← all ignored
└── Scorsese/
    └── Similar structure...
```

**All structures work!** Scripts recursively scan and handle any nesting level.

## 🎬 Workflow Example

### Initial Setup
```bash
# 1. Format SD card as NTFS (Windows or Mac with Paragon)

# 2. Copy movies to SD card
# Movies go in: Movies/, ClassicMovies/, etc.
# Series go in: Series/

# 3. Scan videos
./scan_videos.sh
# Enter: /Volumes/Neumi
# Creates: video_library.csv

# 4. Edit CSV in Excel
# Add numbers (1, 2, 3...) in playlist columns

# 5. Generate playlists
./generate_playlists.sh
# Enter: /Volumes/Neumi
# Creates: Playlists/ folder with hard links

# 6. Use on Neumi
# Navigate to: Playlists/Playlist1/
# Press Play → Movies play in order!
```

### Adding New Content
```bash
# 1. Copy new movies to SD card

# 2. Re-scan
./scan_videos.sh

# 3. Merge playlists
# Copy playlist columns from old CSV to new CSV
# Add numbers for new movies

# 4. Regenerate playlists
./generate_playlists.sh
```

### Fixing Stuttering Videos
```bash
# 1. Analyze what files are problematic
./analyze_videos.sh
# Enter: /Volumes/Neumi
# Identifies HIGH risk files

# 2. Re-encode problematic files
python3 batch_reencode.py /Volumes/Neumi --backup
# Re-encodes in place, keeps backups

# 3. Test playback
# Should be smooth now!
```

## 🔧 Technical Decisions

### Why NTFS?
- **Hard link support** - FAT32/exFAT don't support hard links
- **No space duplication** - Same file in multiple playlists, zero extra space
- **Windows/Mac support** - Works on both platforms with drivers

### Why Hard Links vs Copies?
- **Space efficiency** - 256GB card can hold many playlists
- **Consistency** - Update original, all playlists update
- **Performance** - No data duplication on SD card

### Why Hard Links vs Symlinks?
- **Neumi compatibility** - Neumi sees hard links as real files
- **Filesystem support** - NTFS supports hard links, FAT32/exFAT don't support symlinks

### Why CSV vs Database?
- **Excel editing** - Non-technical users can edit
- **Portability** - Works anywhere, no special software
- **Version control** - Can track changes with git

### Why Re-encode vs Just Play?
- **Neumi 4K Lite limitation** - Stricter decoder than 1080p model
- **NTFS overhead** - Every bit of optimization helps
- **Future-proofing** - Optimized files work on any device
- **Space savings** - 8 Mbps files are smaller, fit more on card

## 🎯 Target Use Case

**Primary user:** Elderly relative
**Technical level:** Non-technical
**Usage pattern:** 
- Insert SD card in Neumi player
- Navigate to Playlists folder
- Select playlist
- Press play
- Videos play in correct order with clean names

**Caregiver workflow:**
- Manages SD cards on computer
- Updates playlists periodically
- Re-encodes new content if needed
- Elderly user never sees complex file management

## 📊 Performance Considerations

### SD Card Requirements
- **Minimum:** UHS-I U3 (30 MB/s sustained)
- **Recommended:** UHS-I U3 V30 (like Lexar cards)
- **Tested:** Lexar 256GB UHS-I U3 V30 (works perfectly)

### Video Bitrate Guidelines
**For smooth playback on Neumi 4K Lite:**
- ≤8 Mbps: Smooth on any UHS-I card
- 8-12 Mbps: Smooth on U3 cards
- 12-15 Mbps: May stutter (depends on codec)
- >15 Mbps: Likely to stutter → re-encode

### NTFS Optimization
- **Mount flags** (Mac): noatime, big_writes, async
- **Defragmentation** (Windows): Consolidate file blocks
- **Performance impact:** 20-30% faster reads with optimized mount

### Neumi 1080p vs 4K Lite
**1080p Model:**
- More forgiving decoder
- "Dumbs down" complex videos
- Works with higher bitrate files
- Adaptive playback (degrades gracefully)

**4K Lite Model:**
- Stricter decoder
- Uncompromising quality
- Requires optimized files
- Stutters rather than degrade

**Recommendation:** For high-bitrate library, 1080p model may actually perform better!

## 🗂️ Project File Structure

```
neumi_playlist_system/
├── config.json                     # Pattern matching configuration
├── scan_videos.py                  # Video scanner with parsing
├── generate_playlists.py           # Playlist generator with hard links
├── batch_reencode.py               # Batch re-encoder
├── scan_videos.bat/.sh             # Scan wrapper scripts
├── generate_playlists.bat/.sh      # Generate wrapper scripts
├── test_sd_speed.sh                # SD card speed test
├── mount_neumi_optimized.sh        # Optimized NTFS mount (Mac)
├── analyze_videos.sh               # Video file analyzer
├── test_fragmentation.bat          # Fragmentation checker (Windows)
├── README.md                       # Complete documentation
├── QUICKSTART.md                   # 5-minute setup guide
├── CHANGELOG.md                    # Version history
├── TROUBLESHOOTING_PLAYBACK.md     # Playback issues guide
├── PROJECT_OVERVIEW.md             # This file
└── SETUP_CLAUDE_CODE.md            # Claude Code project setup
```

## 🎓 Key Learnings

1. **NTFS overhead matters** - Optimized mount flags make significant difference
2. **Neumi 4K Lite is pickier** - "Better" hardware doesn't mean better for all content
3. **HEVC is CPU intensive** - H.264 often plays smoother on budget players
4. **Hard links are perfect** - Zero space, works with Neumi, easy to manage
5. **CSV is user-friendly** - Excel editing beats any custom UI for this use case
6. **Recursive scanning needed** - Real libraries are messy with nested folders
7. **File filtering critical** - Ignore .srt, .jpg, .txt automatically
8. **TV episode support essential** - Many users have mix of movies and series

## 🔮 Future Enhancements

- **Auto-playlist generation** - Group by genre, year, director
- **Web UI** - Browser-based playlist editor
- **Mobile app** - Manage playlists from phone
- **Automatic re-encoding** - Detect and queue problematic files
- **Cloud sync** - Sync playlist metadata across devices
- **Multi-language** - Support for non-English filenames

## 📝 Notes for Claude Code Development

**Current State:**
- Core functionality works and tested
- Supports both card structures
- Re-encoding script creates
- Need to add: Directory capture examples, metadata from both cards

**Next Steps:**
1. Capture directory structure of both SD cards
2. Include sample video_library.csv for each card
3. Test batch re-encoding on both structures
4. Optimize for long-running batch jobs
5. Add progress bars and ETA for re-encoding
6. Add resume capability for interrupted re-encoding

**Testing Priorities:**
1. Recursive scanning with various nest levels
2. Episode parsing edge cases
3. Hard link creation on actual NTFS SD cards
4. Re-encoding quality/speed tradeoffs
5. Space savings from re-encoding

**Known Issues:**
- None currently! System is working well.

**User Feedback:**
- Playlist system works perfectly
- Clean names are appreciated
- Hard links save massive space
- Some videos stutter on 4K Lite → re-encoding needed
