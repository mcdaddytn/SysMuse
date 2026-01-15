# Setting Up Claude Code Project
## Neumi Atom Playlist Management System

## 📦 Project Setup Instructions

### Step 1: Create Project Folder

```bash
mkdir neumi-playlist-project
cd neumi-playlist-project
```

### Step 2: Copy All Scripts

Copy all these files into the project folder:

**Core Scripts:**
- `config.json`
- `scan_videos.py`
- `generate_playlists.py`
- `batch_reencode.py`

**Wrapper Scripts:**
- `scan_videos.bat` (Windows)
- `scan_videos.sh` (Mac/Linux)
- `generate_playlists.bat` (Windows)
- `generate_playlists.sh` (Mac/Linux)

**Diagnostic Scripts:**
- `test_sd_speed.sh`
- `mount_neumi_optimized.sh`
- `analyze_videos.sh`
- `test_fragmentation.bat`

**Documentation:**
- `README.md`
- `QUICKSTART.md`
- `CHANGELOG.md`
- `TROUBLESHOOTING_PLAYBACK.md`
- `PROJECT_OVERVIEW.md`
- `SETUP_CLAUDE_CODE.md` (this file)

### Step 3: Capture SD Card Directory Structures

You need to capture the directory tree for both SD cards so Claude can understand the structure.

#### For Mac/Linux:

**Method 1: Using `tree` command (recommended)**

```bash
# Install tree if not available
brew install tree  # Mac
# or
sudo apt-get install tree  # Linux

# Capture directory structure (shows all files)
tree /Volumes/NeumiSD1 > card1_structure.txt

# Capture with size information
tree -h /Volumes/NeumiSD1 > card1_structure_sizes.txt

# For large directories, limit depth
tree -L 4 /Volumes/NeumiSD1 > card1_structure_limited.txt
```

**Method 2: Using `find` command (always available)**

```bash
# All files with relative paths
find /Volumes/NeumiSD1 -type f > card1_files.txt

# All files with details (size, permissions, date)
find /Volumes/NeumiSD1 -type f -ls > card1_files_detailed.txt

# Only video files
find /Volumes/NeumiSD1 -type f \( \
  -iname "*.mp4" -o \
  -iname "*.mkv" -o \
  -iname "*.avi" -o \
  -iname "*.mov" \
) > card1_videos.txt
```

**Method 3: Using `ls` recursively**

```bash
# Simple recursive listing
ls -R /Volumes/NeumiSD1 > card1_listing.txt

# With details
ls -lhR /Volumes/NeumiSD1 > card1_listing_detailed.txt
```

#### For Windows:

**Method 1: Using `tree` command (built-in)**

```cmd
REM Capture directory structure
tree E:\ /F > card1_structure.txt

REM With ASCII characters (better for text files)
tree E:\ /F /A > card1_structure.txt
```

**Method 2: Using `dir` command**

```cmd
REM Recursive directory listing
dir E:\ /S > card1_listing.txt

REM With bare format (paths only)
dir E:\ /S /B > card1_files.txt
```

**Method 3: Using PowerShell (more detailed)**

```powershell
# Get all files with details
Get-ChildItem -Path E:\ -Recurse | 
  Select-Object FullName, Length, Extension, LastWriteTime | 
  Export-Csv -Path card1_details.csv -NoTypeInformation

# Or as text
Get-ChildItem -Path E:\ -Recurse | 
  Format-Table FullName, Length, Extension -AutoSize | 
  Out-File card1_structure.txt -Width 300
```

### Step 4: Capture Sample Video Metadata

Pick 5-10 representative video files and capture their metadata:

```bash
# Mac/Linux
for file in "/Volumes/NeumiSD1/Movies"/*.{mp4,mkv,avi}; do
  echo "=== $file ===" >> video_metadata.txt
  ffprobe -v quiet -print_format json -show_format -show_streams "$file" >> video_metadata.txt
  echo "" >> video_metadata.txt
done
```

```cmd
REM Windows (PowerShell)
Get-ChildItem E:\Movies\*.mp4 | Select-Object -First 10 | ForEach-Object {
  Write-Output "=== $($_.Name) ===" | Out-File -Append video_metadata.txt
  ffprobe -v quiet -print_format json -show_format -show_streams $_.FullName | Out-File -Append video_metadata.txt
}
```

### Step 5: Export Current CSV Files

If you already have video_library.csv files:

```bash
# Copy current CSVs
cp video_library.csv card1_video_library.csv
cp video_library2.csv card2_video_library.csv
```

### Step 6: Create Project Documentation Structure

Your final project structure should look like:

```
neumi-playlist-project/
├── scripts/
│   ├── config.json
│   ├── scan_videos.py
│   ├── generate_playlists.py
│   ├── batch_reencode.py
│   ├── scan_videos.bat/.sh
│   ├── generate_playlists.bat/.sh
│   ├── test_sd_speed.sh
│   ├── mount_neumi_optimized.sh
│   ├── analyze_videos.sh
│   └── test_fragmentation.bat
├── docs/
│   ├── README.md
│   ├── QUICKSTART.md
│   ├── CHANGELOG.md
│   ├── TROUBLESHOOTING_PLAYBACK.md
│   ├── PROJECT_OVERVIEW.md
│   └── SETUP_CLAUDE_CODE.md
├── card_structures/
│   ├── card1_structure.txt
│   ├── card1_files.txt
│   ├── card2_structure.txt
│   └── card2_files.txt
├── metadata/
│   ├── card1_video_library.csv
│   ├── card2_video_library.csv
│   └── video_metadata.txt
└── .claude_project
```

### Step 7: Create .claude_project File

Create a file named `.claude_project` in the root:

```json
{
  "name": "Neumi Playlist Management",
  "description": "Video playlist management system for Neumi Atom media players using NTFS hard links",
  "context_files": [
    "docs/PROJECT_OVERVIEW.md",
    "card_structures/card1_structure.txt",
    "card_structures/card2_structure.txt",
    "metadata/card1_video_library.csv"
  ]
}
```

## 📋 Recommended Directory Capture Commands

### For Card 1 (Movies with nested directors/folders):

```bash
# Mac
tree -L 5 -h /Volumes/NeumiSD1 > card1_structure.txt

# Windows
tree E:\ /F /A > card1_structure.txt
```

### For Card 2 (TV Series with seasons):

```bash
# Mac
tree -L 5 -h /Volumes/NeumiSD2 > card2_structure.txt

# Windows
tree F:\ /F /A > card2_structure.txt
```

### If trees are too large (>10,000 files):

**Option 1: Limit depth**
```bash
tree -L 3 /Volumes/NeumiSD1 > card1_structure_limited.txt
```

**Option 2: Sample by category**
```bash
# Just Movies directory
tree /Volumes/NeumiSD1/Movies > card1_movies_structure.txt

# Just Series directory
tree /Volumes/NeumiSD1/Series > card1_series_structure.txt
```

**Option 3: Video files only**
```bash
find /Volumes/NeumiSD1 -type f \( \
  -iname "*.mp4" -o \
  -iname "*.mkv" -o \
  -iname "*.avi" \
) > card1_videos.txt
```

## 🎯 Essential Files for Claude Code

At minimum, include these for effective Claude Code assistance:

### Critical Files:
1. ✅ **PROJECT_OVERVIEW.md** - Full system context
2. ✅ **card1_structure.txt** - Directory tree of card 1
3. ✅ **card2_structure.txt** - Directory tree of card 2
4. ✅ **config.json** - Pattern matching configuration
5. ✅ **All .py scripts** - Core functionality

### Highly Recommended:
6. ✅ **card1_video_library.csv** - Sample parsed output for card 1
7. ✅ **video_metadata.txt** - Sample ffprobe output
8. ✅ **README.md** - User documentation

### Optional but Helpful:
9. ⭕ **TROUBLESHOOTING_PLAYBACK.md** - Performance context
10. ⭕ **CHANGELOG.md** - Version history

## 🚀 Opening in Claude Code

### Step 1: Initialize Project

```bash
cd neumi-playlist-project
git init  # Optional but recommended
```

### Step 2: Open in Claude Code

**Option A: From Terminal**
```bash
code .  # If using VS Code with Claude
```

**Option B: From Claude.ai**
- Go to Claude.ai
- Create new project
- Upload all files from project folder

**Option C: From Claude Desktop**
- Open Claude Desktop app
- File → Open Project
- Select `neumi-playlist-project` folder

### Step 3: First Prompt to Claude

```
I have a video playlist management system for Neumi Atom media players. 
Please review PROJECT_OVERVIEW.md to understand the system architecture.

Then review the directory structures in card_structures/ to understand 
the two different SD card layouts I'm working with.

I need help with:
1. Testing the batch re-encoding script on both card structures
2. Ensuring it handles nested directories correctly
3. Optimizing for long-running batch jobs

Please start by reading PROJECT_OVERVIEW.md and asking any clarifying questions.
```

## 📝 Tips for Claude Code Collaboration

### Good Practices:

1. **Provide context files** - Claude reads them automatically
2. **Use descriptive filenames** - `card1_structure.txt` not `output.txt`
3. **Include examples** - Sample CSV, sample file listings
4. **Document edge cases** - Unusual directory structures
5. **Share error messages** - Full stack traces when debugging

### What to Include in Prompts:

- Specific card structure you're working with
- Sample filenames that are problematic
- Expected vs actual behavior
- Any error messages (full text)

### What Claude Can Help With:

- ✅ Modify scripts for new patterns
- ✅ Debug parsing issues
- ✅ Optimize performance
- ✅ Add new features
- ✅ Test edge cases
- ✅ Generate documentation
- ✅ Create new diagnostic tools

### What Claude Needs from You:

- 📁 Directory structures
- 📄 Sample filenames
- 🔍 Error messages
- 🎯 Desired behavior
- 📊 Performance metrics

## 🧪 Testing Checklist

Before uploading to Claude Code, verify you have:

- [ ] All Python scripts
- [ ] All shell/batch scripts
- [ ] config.json
- [ ] Directory structure captures for both cards
- [ ] At least one sample video_library.csv
- [ ] PROJECT_OVERVIEW.md
- [ ] README.md
- [ ] Sample filenames from both cards

## 🎓 Example Session

**You:**
```
I have two SD cards with different structures:
- Card 1: Movies in flat + nested folders (see card1_structure.txt)
- Card 2: TV series organized by season (see card2_structure.txt)

I want to test batch_reencode.py on both structures. Can you review 
the script and confirm it will handle both correctly?

Also, I'd like to add progress bars and ETA for long encodes.
```

**Claude:**
```
[Reads PROJECT_OVERVIEW.md and card structures]

I've reviewed both directory structures. The batch_reencode.py script 
uses os.walk() which will handle both structures correctly.

For Card 1 (nested movies):
- Will find movies in subdirectories like Classic Films/Scorsese/
- Will process nested folders like "The Irishman (2019) [1080p]/"

For Card 2 (TV series):
- Will find episodes in Series/Show Name/Season X/
- Will process all episodes in each season

For progress bars and ETA, I recommend using tqdm library. Let me show 
you how to integrate it...
```

## 🔄 Next Steps After Setup

1. Open project in Claude Code
2. Run initial diagnostics:
   ```bash
   python3 batch_reencode.py /path/to/card --dry-run
   ```
3. Review output with Claude
4. Iterate on improvements
5. Test on small sample first
6. Run full batch encode

## 📞 Getting Help

If you run into issues:

1. Share the specific command you ran
2. Include full error message
3. Attach relevant file structure
4. Describe expected vs actual behavior

Example good help request:
```
I ran: python3 batch_reencode.py /Volumes/Neumi --dry-run

Got error: FileNotFoundError: config.json

My directory structure is:
neumi-playlist-project/
├── batch_reencode.py
└── [no config.json]

What am I missing?
```

## ✅ Verification Steps

Before considering setup complete:

```bash
# 1. Verify all scripts are executable
chmod +x *.sh

# 2. Verify config.json is valid JSON
python3 -m json.tool config.json

# 3. Test scan on small directory
python3 scan_videos.py /small/test/dir -o test.csv

# 4. Verify batch reencode can parse files
python3 batch_reencode.py /small/test/dir --dry-run

# 5. Confirm ffmpeg installed
ffmpeg -version
ffprobe -version
```

All set! Your project is ready for Claude Code development. 🎉
