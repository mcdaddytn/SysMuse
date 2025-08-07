@echo off
setlocal enabledelayedexpansion

:: Get revision or range as argument
if "%~1"=="" (
    echo Usage: %0 <revision> or <rev1..rev2>
    exit /b 1
)
set "REV=%~1"

:: Output directory
set "OUTDIR=diffs"
if exist "%OUTDIR%" rmdir /s /q "%OUTDIR%"
mkdir "%OUTDIR%"

:: Get list of changed files
for /f "delims=" %%F in ('git diff --name-only %REV%') do (
    set "FILENAME=%%F"
    set "SAFEFILE=%%F"
    set "SAFEFILE=!SAFEFILE:/=_!"
    set "SAFEFILE=!SAFEFILE:\=_!"
    set "SAFEFILE=!SAFEFILE:.=_%EXT%!"

    git diff %REV% -- "%%F" > "%OUTDIR%\!SAFEFILE!.diff"
)

echo Success Diffs saved in "%OUTDIR%" directory.
