# Claude Code Project Instructions
## For Claude Assistant

**READ THIS FIRST when this project is opened in Claude Code**

## 🎯 Project Summary

This is a video playlist management system for **Neumi Atom media players**. The system:
- Scans SD cards with movies/TV shows
- Parses complex filenames into clean names
- Creates playlists using NTFS hard links
- Batch re-encodes problematic videos for smooth playback

## 📚 Start by Reading These (In Order)

1. **PROJECT_OVERVIEW.md** - Complete system architecture and context
2. **card_structures/card1_structure.txt** - First SD card layout
3. **card_structures/card2_structure.txt** - Second SD card layout (different structure)
4. **README.md** - User-facing documentation

## 🎓 Key Context

### Two Different SD Card Structures

**Card 1 - Movies with nested directories:**
```
Movies/
├── Flat files: Casablanca.mp4
└── Nested: Scorsese/The Irishman (2019) [1080p]/filename.mp4
```

**Card 2 - TV Series with seasons:**
```
Series/
└── Show Name/
    └── Season X/
        └── Episode files
```

### Critical Files to Understand

**scan_videos.py:**
- Recursively scans directories
- Parses filenames (removes quality tags, codecs, release groups)
- Detects TV episodes vs movies
- Creates CSV with clean names

**generate_playlists.py:**
- Reads CSV with playlist assignments
- Creates hard links (not copies!)
- Numbered files: `01 Clean Name.ext`

**batch_reencode.py:** ← CURRENT FOCUS
- New script for re-encoding problematic videos
- Needs testing on both card structures
- Should handle nested directories
- In-place encoding with backup option

### Hardware Context

**Neumi 1080p:** Forgiving decoder, works with high-bitrate files
**Neumi 4K Lite:** Stricter decoder, stutters on high-bitrate HEVC

**Problem:** Some videos that work on 1080p stutter on 4K Lite
**Solution:** Re-encode to H.264 @ 8 Mbps max

## 🔧 Current Development Goals

1. **Test batch_reencode.py** on both card structures
2. **Add progress indicators** - Long-running batch jobs need ETA
3. **Optimize for interrupted jobs** - Resume capability
4. **Handle edge cases** - Special characters, very long paths
5. **Performance tuning** - Multi-threaded encoding?

## 📋 Your Role as Claude

When user opens this project, you should:

1. ✅ **Read PROJECT_OVERVIEW.md** - Understand full context
2. ✅ **Review directory structures** - See actual file layouts
3. ✅ **Understand the problem** - Why re-encoding is needed
4. ✅ **Ask clarifying questions** - What specific help is needed?

### Good First Questions:

- "I've reviewed the project. Which SD card structure are you testing with?"
- "Do you have sample filenames that are currently problematic?"
- "What's your priority: progress bars, resume capability, or testing?"
- "Have you run batch_reencode.py yet? Any errors?"

## 🎯 Expected User Requests

### Type 1: Testing/Debugging
**User:** "Can you test batch_reencode.py on Card 1 structure?"
**You should:**
- Review card1_structure.txt
- Identify potential edge cases in directory nesting
- Suggest dry-run command
- Ask about sample problematic files

### Type 2: New Features
**User:** "Add progress bar to batch_reencode.py"
**You should:**
- Review current implementation
- Suggest tqdm library
- Show code modifications
- Preserve existing functionality

### Type 3: Optimization
**User:** "Can we make re-encoding faster?"
**You should:**
- Review ffmpeg settings (preset, CRF)
- Suggest multi-threading options
- Consider GPU acceleration
- Balance speed vs quality

### Type 4: Bug Fixes
**User:** "Script fails on files with special characters"
**You should:**
- Ask for specific filename example
- Review string handling in script
- Test edge cases
- Suggest fix with validation

## 🚫 What NOT to Do

- ❌ Don't suggest breaking changes without permission
- ❌ Don't remove existing functionality
- ❌ Don't assume hardware capabilities (GPU encoding may not be available)
- ❌ Don't suggest filesystem changes (must stay NTFS for hard links)
- ❌ Don't optimize prematurely - test first, then optimize

## ✅ What TO Do

- ✅ Read provided directory structures before answering
- ✅ Consider both card layouts in solutions
- ✅ Test for edge cases (special chars, deep nesting, long paths)
- ✅ Preserve backward compatibility
- ✅ Document changes clearly
- ✅ Suggest testing strategies
- ✅ Ask for clarification when uncertain

## 🧪 Testing Considerations

### Edge Cases to Consider:

**Filenames:**
- Special characters: `&`, `'`, `"`, `()`, `[]`
- Unicode characters (non-English titles)
- Very long filenames (>200 chars)
- Spaces, dots, underscores

**Directory Structure:**
- Deeply nested (5+ levels)
- Mixed nesting (some flat, some nested)
- Symlinks (should these be followed?)
- Read-only files
- Files in use (locked)

**File Types:**
- MKV (may have multiple audio/subtitle tracks)
- AVI (older codec support)
- MP4 (most common, should be smooth)
- Various codecs (H.264, HEVC, VP9, etc.)

**Performance:**
- Large files (>10 GB)
- Many small files (>1000)
- Slow SD cards
- Limited disk space

## 📊 Success Metrics

Good solutions should:
- ✅ Work on both card structures without modification
- ✅ Handle edge cases gracefully (don't crash)
- ✅ Preserve originals or backup safely
- ✅ Show clear progress indicators
- ✅ Complete in reasonable time
- ✅ Produce files that play smoothly on Neumi 4K Lite

## 🗣️ Communication Style

**With User:**
- Be clear and concise
- Explain technical decisions in simple terms
- Offer options with pros/cons
- Ask for preferences on tradeoffs

**In Code:**
- Add comments explaining non-obvious logic
- Use descriptive variable names
- Follow existing code style
- Include docstrings

## 🎬 Example Interaction Flow

**User:** "I have batch_reencode.py ready but haven't tested it yet."

**Good Response:**
```
I've reviewed the batch_reencode.py script and both card structures. 

Before running on your full library, I recommend:

1. Test on a small sample first:
   - Pick 2-3 files from Card 1 (nested structure)
   - Pick 2-3 episodes from Card 2 (TV series)
   - Run with --dry-run flag first

2. Try this test command:
   python3 batch_reencode.py /path/to/test/folder --dry-run

This will show what would be processed without actually encoding.

Which card are you starting with? I can suggest specific test files
based on the directory structures you've provided.
```

**Bad Response:**
```
Just run it, it should work.
```

## 🔄 Development Workflow

1. **Understand** - Read context, ask questions
2. **Plan** - Suggest approach, get user buy-in
3. **Implement** - Write code with comments
4. **Test** - Suggest test cases
5. **Iterate** - Refine based on feedback

## 💡 Remember

- User is managing elderly relative's media player
- System must be reliable and foolproof
- Hard links save significant space (256GB cards)
- NTFS required for hard link support
- Mac user (needs NTFS-3G or Paragon)
- Two different card structures need support
- Neumi 4K Lite is pickier than 1080p model

## 🚀 Ready to Help!

When user asks for help, start by:
1. Acknowledging what you've read
2. Asking clarifying questions
3. Suggesting concrete next steps
4. Offering to show code examples

Example opening:
```
I've reviewed the project overview and both SD card directory structures.
I can see Card 1 has nested movie folders while Card 2 has TV series 
organized by season.

What would you like to work on first:
A) Testing batch_reencode.py on your actual cards
B) Adding progress bars and ETA
C) Optimizing for interrupted jobs (resume capability)
D) Something else?

I'm ready to help with any of these!
```

---

**Remember:** This is a working production system. Changes should be careful, tested, and backwards-compatible.

Good luck, Claude! 🎉
