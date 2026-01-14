@echo off
REM SD Card Fragmentation Check for Windows
REM Checks if files are fragmented on NTFS SD card

echo ============================================================
echo SD Card Fragmentation Check
echo ============================================================
echo.

set /p DRIVE_LETTER="Enter your SD card drive letter (e.g., E): "
set DRIVE_LETTER=%DRIVE_LETTER::=%
set DRIVE=%DRIVE_LETTER%:

echo.
echo Checking fragmentation on %DRIVE%...
echo This may take a few minutes...
echo.

REM Analyze fragmentation
defrag %DRIVE% /A /V

echo.
echo ============================================================
echo Results:
echo ============================================================
echo.
echo Check the fragmentation percentage above.
echo.
echo If fragmentation is greater than 10 percent:
echo   Run: defrag %DRIVE% /O
echo   This will optimize and defragment the SD card.
echo.
echo If fragmentation is less than 10 percent:
echo   Fragmentation is not the issue.
echo   Try optimized NTFS mount on Mac instead.
echo ============================================================
echo.
pause
