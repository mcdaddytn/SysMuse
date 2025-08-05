@echo off
setlocal enabledelayedexpansion

:: Check arguments
if "%~2"=="" (
    echo Usage: %0 https://github.com/user/repo.git Project1
    exit /b 1
)

set "REPO_URL=%~1"
set "SUBDIR=%~2"

:: Extract base repo name
for /f "usebackq delims=" %%R in (`powershell -NoProfile -Command "$u='%REPO_URL%'; $n=($u.Split('/')[-1]); if ($n.EndsWith('.git')) { $n = $n.Substring(0, $n.Length - 4) }; Write-Output $n"`) do set "REPO_NAME=%%R"

:: Extract subdir name only
for %%S in (%SUBDIR%) do set "SUBDIR_NAME=%%~nxS"

:: Timestamp
for /f %%a in ('powershell -NoProfile -Command "Get-Date -Format \"MMddyyyyHHmmss\""') do set "TIMESTAMP=%%a"

set "WORK_DIR=%REPO_NAME%_temp"
mkdir "%WORK_DIR%"
cd "%WORK_DIR%"

:: Init sparse repo
git init
git remote add origin %REPO_URL%
git config core.sparseCheckout true

:: Write sparse-checkout file
> .git\info\sparse-checkout echo %SUBDIR%/*

:: Pull only the subdir (main branch)
git pull origin main

:: Zip the folder
powershell -NoProfile -Command "Compress-Archive -Path '%SUBDIR%\*' -DestinationPath '..\%SUBDIR_NAME%_%TIMESTAMP%.zip'"

echo Archived %SUBDIR% to %SUBDIR_NAME%_%TIMESTAMP%.zip

:: Cleanup
cd ..
rmdir /s /q "%WORK_DIR%"
