@echo off
setlocal enabledelayedexpansion

:: Check input
if "%~1"=="" (
    echo Usage: %0 https://github.com/user/repo.git
    exit /b 1
)

set "REPO_URL=%~1"

:: Use PowerShell to extract the repo name with dots preserved
for /f "usebackq delims=" %%R in (`powershell -NoProfile -Command "$u='%REPO_URL%'; $n=($u.Split('/')[-1]); if ($n.EndsWith('.git')) { $n = $n.Substring(0, $n.Length - 4) }; Write-Output $n"`) do set "REPO_NAME=%%R"

:: Format timestamp
for /f %%a in ('powershell -NoProfile -Command "Get-Date -Format \"MMddyyyyHHmmss\""') do set "TIMESTAMP=%%a"

:: Clone repo
git clone "%REPO_URL%" "%REPO_NAME%"
if errorlevel 1 exit /b 1

:: Zip contents
powershell -NoProfile -Command "Compress-Archive -Path '%REPO_NAME%\*' -DestinationPath '%REPO_NAME%_%TIMESTAMP%.zip'"

echo Cloned '%REPO_NAME%' and archived as '%REPO_NAME%_%TIMESTAMP%.zip'
