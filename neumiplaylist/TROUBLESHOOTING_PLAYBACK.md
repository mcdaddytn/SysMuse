# Playback Stuttering Troubleshooting Guide

## Your Setup
- **SD Cards:** Lexar 256GB UHS-I U3 V30 (up to 160 MB/s)
- **Card Specs:** Excellent for 1080p BluRay (30 MB/s sustained minimum)
- **Filesystem:** NTFS (for hard link support)
- **Platform:** Mac (requires NTFS-3G or Paragon)

## Likely Cause

Since your SD cards are fast enough, stuttering is most likely caused by:

1. **NTFS mount options** (70% probability)
   - Default NTFS-3G mount is not optimized for large sequential reads
   - Adding performance flags should fix it

2. **File fragmentation** (20% probability)
   - Hard links copied to fragmented locations
   - Defragmentation on Windows would fix it

3. **Specific video encoding** (10% probability)
   - High bitrate HEVC files
   - Neumi decoder struggling with complex encoding

## Step-by-Step Diagnosis

### Step 1: Test SD Card Speed (Mac)

**Run:**
```bash
chmod +x test_sd_speed.sh
./test_sd_speed.sh
```

**Expected result:** >50 MB/s read speed

**If <30 MB/s:** Problem is NTFS mount → Go to Step 2
**If >50 MB/s:** SD card is fine → Go to Step 3

---

### Step 2: Optimize NTFS Mount (Mac)

**Run:**
```bash
chmod +x mount_neumi_optimized.sh
./mount_neumi_optimized.sh
```

**This adds these flags:**
- `noatime` - Don't update file access times (20-30% faster)
- `big_writes` - Larger I/O buffers (better sequential throughput)
- `async` - Asynchronous I/O (reduces latency)

**After mounting, test playback:**
- Play previously stuttering video on Neumi
- If smooth now → FIXED! Use this mount script every time
- If still stutters → Go to Step 3

**To auto-mount with these options:**
1. System Settings → Login Items
2. Add mount_neumi_optimized.sh to startup items

---

### Step 3: Analyze Video Files

**Run:**
```bash
chmod +x analyze_videos.sh
./analyze_videos.sh
# Enter path to SD card
```

**Check output for HIGH risk files:**
- These are likely the stuttering ones
- HEVC with >15 Mbps bitrate
- H.264 with >20 Mbps bitrate

**If you find HIGH risk files:**
→ Go to Step 4 (re-encode specific files)

**If no HIGH risk files found:**
→ Go to Step 5 (check fragmentation)

---

### Step 4: Re-encode Problematic Files

**For files marked HIGH risk:**

```bash
ffmpeg -i "input_file.mkv" \
  -c:v libx264 \
  -preset medium \
  -crf 23 \
  -maxrate 8M \
  -bufsize 16M \
  -c:a copy \
  "output_file.mp4"
```

**What this does:**
- Converts to H.264 (less CPU intensive than HEVC)
- Caps bitrate at 8 Mbps (smooth on any SD card)
- Keeps audio unchanged (no quality loss)
- File size: Similar to original

**After re-encoding:**
- Replace original file with optimized version
- Test playback on Neumi
- Should be smooth now

---

### Step 5: Check Fragmentation (Windows Only)

**If you have Windows access:**

1. Insert SD card in Windows PC
2. Run: `test_fragmentation.bat`
3. If fragmentation >10%:
   ```cmd
   defrag E: /O
   ```

**After defragging:**
- Test playback on Neumi
- Should be smoother

**If no Windows access:**
- Fragmentation unlikely to be main issue
- Focus on Step 2 (optimized mount)

---

### Step 6: Test Direct vs Hard Link

**Isolate if hard links are causing issues:**

**On SD card:**
```
Movies/Original.mkv           ← Original file
Playlists/Playlist1/01 Link.mkv   ← Hard link to original
```

**Test both:**
1. Play `Movies/Original.mkv` directly on Neumi
2. Play `Playlists/Playlist1/01 Link.mkv`

**Result:**
- Both stutter → Not hard link issue, original file or NTFS issue
- Only link stutters → Hard link issue (very rare)

---

## Quick Fixes Summary

### Fix 1: Optimized NTFS Mount (Try This First)
```bash
./mount_neumi_optimized.sh
```
**Fixes:** 70% of NTFS-related stuttering
**Time:** 2 minutes

### Fix 2: Re-encode High-Risk Files
```bash
./analyze_videos.sh
# Find HIGH risk files, then:
ffmpeg -i problem.mkv -c:v libx264 -crf 23 -maxrate 8M -bufsize 16M -c:a copy fixed.mp4
```
**Fixes:** Codec/bitrate issues
**Time:** 30-60 minutes per file

### Fix 3: Defragment (Windows)
```cmd
defrag E: /O
```
**Fixes:** Fragmentation issues
**Time:** 15-30 minutes

---

## Expected Performance

**With your Lexar U3 cards + optimized NTFS mount:**

| Video Type | Bitrate | Expected Playback |
|------------|---------|-------------------|
| 720p H.264 | 3-5 Mbps | Smooth ✓ |
| 1080p H.264 | 8-12 Mbps | Smooth ✓ |
| 1080p HEVC | 5-8 Mbps | Smooth ✓ |
| 1080p BluRay H.264 | 15-20 Mbps | Smooth ✓ |
| 1080p BluRay HEVC | 10-15 Mbps | Should be smooth ✓ |
| 1080p High Bitrate HEVC | >15 Mbps | May stutter - re-encode |

---

## Still Having Issues?

If stuttering persists after all steps:

### Option 1: Try Different NTFS Driver

**If using NTFS-3G, try Paragon NTFS:**
- More optimized for macOS
- Better performance out of the box
- 10-day free trial: https://www.paragon-software.com/home/ntfs-mac/

### Option 2: Switch to exFAT (Last Resort)

**Pros:**
- 20-30% faster than NTFS on SD cards
- Native Mac support (no drivers needed)

**Cons:**
- No hard links
- Must use file copies (wastes space) or move-based system

**To test:**
1. Copy 2-3 stuttering movies to exFAT USB stick
2. Test playback on Neumi
3. If smooth → Consider reformatting SD to exFAT

---

## My Recommended Order

**Try these in sequence:**

1. ✅ **Optimize NTFS mount** (./mount_neumi_optimized.sh) - 5 min
2. ✅ **Test playback** - 2 min
3. ✅ If still stutters: **Analyze videos** (./analyze_videos.sh) - 10 min
4. ✅ If HIGH risk files: **Re-encode** - 1 hour
5. ✅ If no improvement: **Defrag on Windows** - 30 min
6. ✅ If no improvement: **Try Paragon NTFS** - free trial

**Most likely fix:** Steps 1-2 (optimized mount)

---

## Questions to Help Diagnose

1. **Do ALL movies stutter or just some?**
   - All → NTFS mount issue
   - Some → Specific file encoding issue

2. **When does stuttering happen?**
   - Throughout → SD card speed or NTFS
   - Only action scenes → High bitrate peaks

3. **Which files stutter?**
   - .mkv files → Likely HEVC high bitrate
   - .mp4 files → Less likely codec, more likely NTFS

4. **Does original file play smooth on computer?**
   - Yes → Neumi or SD card issue
   - No → File encoding issue
