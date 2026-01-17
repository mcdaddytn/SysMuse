@echo off
REM Check status of citation overlap batch jobs
REM Usage: scripts\check-batch-status.bat

setlocal enabledelayedexpansion

echo === CITATION OVERLAP STATUS %date% %time% ===
echo.

set total_found=0
set completed=0

for %%r in ("4000-4500" "4500-5000" "5000-5500" "5500-6000" "6000-6500" "6500-7000" "7000-7500" "7500-8000" "8000-8500" "8500-9000" "9000-9500" "9500-10000") do (
    set "log=output\citation-overlap-%%~r.log"
    if exist "!log!" (
        for /f "tokens=*" %%a in ('findstr /r "Progress:" "!log!" 2^>nul') do set "progress=%%a"
        for /f "tokens=*" %%a in ('findstr /r "Found.*patents" "!log!" 2^>nul') do set "found=%%a"
        echo   %%~r: !progress! ^| !found!
    )
)

echo.
echo Check running processes manually with: tasklist ^| findstr node
