@echo off
REM Neumi Atom Playlist Manager - Scan Videos (Windows)
REM This script scans your SD card and creates a CSV inventory of all video files

echo ============================================================
echo Neumi Atom Playlist Manager - Video Scanner (Windows)
echo ============================================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python from https://www.python.org/
    pause
    exit /b 1
)

REM Prompt for SD card drive letter
set /p DRIVE_LETTER="Enter your SD card drive letter (e.g., E): "

REM Remove colon if user included it
set DRIVE_LETTER=%DRIVE_LETTER::=%

REM Build full path
set SD_PATH=%DRIVE_LETTER%:\

echo.
echo Scanning SD card at: %SD_PATH%
echo.

REM Default categories - edit these if you have different folder names
set CATEGORIES=Movies ClassicMovies Documentaries Series MusicVideo

REM Default playlists - edit these to match your desired playlists
set PLAYLISTS=Playlist1 Playlist2 Playlist3 Documentaries Series1 Series2

echo Categories to scan: %CATEGORIES%
echo Playlists to create: %PLAYLISTS%
echo.
echo This will skip Mac system files (._*) and hidden files
echo.
echo Press Ctrl+C to cancel, or
pause

REM Run the Python script
python scan_videos.py "%SD_PATH%" -c %CATEGORIES% -p %PLAYLISTS%

echo.
echo ============================================================
echo Done! Check video_library.csv to edit your playlists.
echo ============================================================
pause
