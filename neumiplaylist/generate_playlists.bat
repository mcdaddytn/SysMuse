@echo off
REM Neumi Atom Playlist Manager - Generate Playlists (Windows)
REM This script reads your CSV file and creates M3U playlist files

echo ============================================================
echo Neumi Atom Playlist Manager - Playlist Generator (Windows)
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

REM Check if CSV exists
if not exist video_library.csv (
    echo ERROR: video_library.csv not found!
    echo Please run scan_videos.bat first.
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
echo SD card path: %SD_PATH%
echo CSV file: video_library.csv
echo Output folder: Playlists
echo.
echo This will create M3U playlist files in the Playlists folder.
echo.
pause

REM Run the Python script
python generate_playlists.py video_library.csv "%SD_PATH%" --summary

echo.
echo ============================================================
echo Done! Copy the Playlists folder to your SD card.
echo ============================================================
echo.
echo The Playlists folder contains your .m3u playlist files.
echo Copy this entire folder to the root of your SD card.
echo.
pause

REM Optional: Offer to copy playlists to SD card
set /p COPY_NOW="Do you want to copy Playlists folder to SD card now? (Y/N): "
if /i "%COPY_NOW%"=="Y" (
    echo.
    echo Copying Playlists folder to %SD_PATH%Playlists...
    xcopy /E /I /Y Playlists "%SD_PATH%Playlists"
    echo.
    echo Copy complete!
    echo You can now safely eject your SD card.
)

echo.
pause
