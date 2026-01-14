# Quick Start Guide - Neumi Atom Playlist Manager

## 5-Minute Setup

### Windows

1. **Plug in SD card** (e.g., becomes drive E:)

2. **Scan videos:**
   - Double-click: `scan_videos.bat`
   - Enter: `E` (your drive letter)
   - Wait for scan to complete
   - **Mac system files (._*) are automatically filtered out**

3. **Edit playlists:**
   - Open: `video_library.csv` in Excel
   - Find columns: `Playlist1`, `Playlist2`, `Playlist3`, `Documentaries`, `Series1`, `Series2`
   - Enter numbers for playback order:
     - `1` = plays first
     - `2` = plays second
     - `3` = plays third
     - (blank) = not in this playlist
   - Save and close

4. **Generate playlists:**
   - Double-click: `generate_playlists.bat`
   - Enter: `E` (your drive letter)
   - Type: `Y` to copy to SD card
   - Done!

5. **Use on Neumi:**
   - Eject SD card
   - Insert into Neumi Atom
   - Navigate to: Video → Playlists
   - Select playlist and play

---

### Mac

1. **Plug in SD card** (e.g., `/Volumes/SDCARD`)

2. **Make scripts executable (first time only):**
   ```bash
   cd neumi_playlist_system
   chmod +x *.sh
   ```

3. **Scan videos:**
   ```bash
   ./scan_videos.sh
   ```
   - Enter: `/Volumes/SDCARD` (your SD card path)
   - **Mac system files (._*) are automatically filtered out**

4. **Edit playlists:**
   - Open: `video_library.csv` in Excel or Numbers
   - Enter numbers in playlist columns (1, 2, 3...)
   - Save and close

5. **Generate playlists:**
   ```bash
   ./generate_playlists.sh
   ```
   - Enter your SD card path
   - Type: `y` to copy to SD card

6. **Use on Neumi:**
   - Eject SD card
   - Insert into Neumi Atom
   - Navigate to playlists and play

---

## Default Settings

### Default Category Folders
The scanner looks for these folders on your SD card:
- **Movies** - Main movie collection
- **ClassicMovies** - Classic/older films
- **Documentaries** - Documentary content
- **Series** - TV shows and episodes
- **MusicVideo** - Music videos

### Default Playlist Columns
The CSV will have these playlist columns:
- **Playlist1** - General purpose playlist
- **Playlist2** - General purpose playlist
- **Playlist3** - General purpose playlist
- **Documentaries** - For documentary content
- **Series1** - For TV series
- **Series2** - Alternative series playlist

You can customize both by editing the `.bat` or `.sh` files.

---

## CSV Editing Example

### Before (Empty):
```
filename                      Playlist1  Playlist2  Documentaries
Casablanca (1942).mp4                            
The Searchers (1956).mkv                         
Planet Earth S01E01.mp4                          
```

### After (Filled):
```
filename                      Playlist1  Playlist2  Documentaries
Casablanca (1942).mp4         1          2          
The Searchers (1956).mkv      2          1          
Planet Earth S01E01.mp4                            1
```

**Result:**
- **Playlist1:** Casablanca (1st), The Searchers (2nd)
- **Playlist2:** The Searchers (1st), Casablanca (2nd)
- **Documentaries:** Planet Earth S01E01

---

## Common Tasks

### Adding New Movies

1. Copy new movies to SD card folders
2. Run `scan_videos` (creates new CSV)
3. **Important:** Open old CSV and copy playlist numbers to new CSV
4. Add playlist numbers for new movies
5. Run `generate_playlists`
6. Copy Playlists folder to SD card

### Creating a New Playlist

1. Edit batch/shell script to add playlist name
2. Run `scan_videos` (regenerates CSV with new column)
3. Fill in order numbers in new playlist column
4. Run `generate_playlists`

### Changing Playlist Order

1. Open `video_library.csv`
2. Change the numbers in playlist column
3. Run `generate_playlists`
4. Copy updated Playlists folder to SD card

---

## What Gets Filtered Out

The scanner **automatically skips**:
- ✅ Mac resource fork files (starting with `._`)
- ✅ Hidden files (starting with `.`)
- ✅ Windows thumbnail cache (`Thumbs.db`)

Only actual video files appear in your CSV!

---

## Folder Structure

```
Your Computer:
  neumi_playlist_system/
    ├── scan_videos.bat/.sh        ← Run this first
    ├── generate_playlists.bat/.sh ← Run this second
    ├── video_library.csv          ← Edit this in between
    └── Playlists/                 ← Copy this to SD card

SD Card:
  E:\ (or /Volumes/SDCARD)
    ├── Movies/
    │   └── [your movie files]
    ├── ClassicMovies/
    │   └── [your movie files]
    ├── Documentaries/
    │   └── [your docs]
    ├── Series/
    │   └── [your TV shows]
    ├── MusicVideo/
    │   └── [your music videos]
    └── Playlists/                 ← Copied from computer
        ├── Playlist1.m3u
        ├── Playlist2.m3u
        └── etc.
```

---

## Supported Formats

The scanner looks for these video formats:
**MP4, MKV, AVI, MOV, M4V, TS, VOB, M2TS**

---

## Need Help?

See the full **README.md** for:
- Detailed instructions
- Troubleshooting
- Advanced usage
- Examples

---

**That's it! Enjoy your organized playlists! 🎬**
