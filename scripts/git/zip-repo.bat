@echo off
setlocal enabledelayedexpansion

REM Usage:
REM   zip-repo.bat
REM   zip-repo.bat <ref>
REM   zip-repo.bat <ref> --include-untracked

REM Ensure git repo
git rev-parse --is-inside-work-tree >nul 2>&1 || (
  echo Not a git repository.
  exit /b 1
)

REM Inputs
set "REF=%~1"
if "%REF%"=="" set "REF=HEAD"
set "FLAG=%~2"

REM Repo name and timestamp
for %%I in (.) do set "REPO_NAME=%%~nxI"
for /f %%a in ('powershell -NoProfile -Command "Get-Date -Format \"MMddyyyyHHmmss\""') do set "TS=%%a"

REM Output path
if not exist "backups" mkdir "backups"
set "ZIP=backups\%REPO_NAME%_%TS%.zip"

echo Creating clean archive from %REF% ...
git archive -o "%ZIP%" "%REF%" || (
  echo git archive failed.
  exit /b 1
)

REM Append untracked-but-not-ignored files if requested
if /i not "%FLAG%"=="--include-untracked" goto done
echo Appending untracked files (not ignored) ...
powershell -NoProfile -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$raw = git ls-files --others --exclude-standard -z;" ^
  "$files = ($raw -split [char]0) | Where-Object { $_ -ne '' };" ^
  "if ($files.Count -gt 0) { Compress-Archive -Update -DestinationPath '%ZIP%' -Path $files } else { Write-Host 'None found.' }" ^
  || ( echo Failed appending untracked files. & exit /b 1 )

:done
echo Created %ZIP%
