@echo off
setlocal enabledelayedexpansion

:: Check argument
if "%~1"=="" (
    echo Usage: %0 https://github.com/user/repo.git
    exit /b 1
)

:: Extract repo URL and name
set "REPO_URL=%~1"
for %%A in ("%REPO_URL%") do (
    set "REPO_NAME=%%~nA"
)

:: Format datetime as MMDDYYYYHHMMSS
for /f %%a in ('powershell -NoProfile -Command "Get-Date -Format \"MMddyyyyHHmmss\""') do set "TIMESTAMP=%%a"

:: Clone the repo
git clone %REPO_URL% %REPO_NAME%
if errorlevel 1 exit /b 1

:: Zip the contents
powershell -Command "Compress-Archive -Path '%REPO_NAME%\*' -DestinationPath '%REPO_NAME%_%TIMESTAMP%.zip'"

echo Cloned '%REPO_NAME%' and archived as '%REPO_NAME%_%TIMESTAMP%.zip'
