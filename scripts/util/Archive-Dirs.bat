@echo off
setlocal EnableExtensions

REM Archive-Dirs.bat
REM Wrapper for Archive-Dirs.ps1
REM
REM Usage:
REM   Archive-Dirs.bat "C:\lists\dirs.txt" "E:\Archive" [--no-device] [--overwrite]
REM
REM Options:
REM   --no-device   Flatten mapping (no drive/UNC prefix). Example: I:\GLP -> DestRoot\GLP
REM   --overwrite   Allow overwriting / updating existing files (disables SkipExisting)
REM
REM Notes:
REM   - By default, the script includes device prefixes (drive/UNC) AND skips existing files (resume-friendly).
REM   - Put this .bat next to Archive-Dirs.ps1 (same folder), or edit PSSCRIPT below.

if "%~1"=="" (
  echo ERROR: Missing arg 1: path to newline-delimited list file
  echo Usage: %~nx0 "C:\lists\dirs.txt" "E:\Archive" [--no-device] [--overwrite]
  exit /b 2
)
if "%~2"=="" (
  echo ERROR: Missing arg 2: destination root
  echo Usage: %~nx0 "C:\lists\dirs.txt" "E:\Archive" [--no-device] [--overwrite]
  exit /b 2
)

set "LISTFILE=%~1"
set "DESTROOT=%~2"

set "PSSCRIPT=%~dp0Archive-Dirs.ps1"
if not exist "%PSSCRIPT%" (
  echo ERROR: PowerShell script not found next to this .bat:
  echo   %PSSCRIPT%
  echo Edit PSSCRIPT in the .bat to point to the correct location.
  exit /b 3
)

REM Defaults
set "INCLUDE_DEVICE=$true"
set "SKIP_EXISTING=$true"

REM Parse optional flags
:parse
shift
if "%~1"=="" goto run

if /I "%~1"=="--no-device" (
  set "INCLUDE_DEVICE=$false"
  goto parse
)

if /I "%~1"=="--overwrite" (
  set "SKIP_EXISTING=$false"
  goto parse
)

echo WARNING: Unknown option "%~1" (ignored)
goto parse

:run
echo Running archive copy...
echo   ListFile: "%LISTFILE%"
echo   DestRoot: "%DESTROOT%"
echo   IncludeDevice: %INCLUDE_DEVICE%
echo   SkipExisting:  %SKIP_EXISTING%
echo   Script:   "%PSSCRIPT%"
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PSSCRIPT%" -ListFile "%LISTFILE%" -DestRoot "%DESTROOT%" -IncludeDevice:%INCLUDE_DEVICE% -SkipExisting:%SKIP_EXISTING%
set "ERR=%ERRORLEVEL%"

echo.
echo Finished. ExitCode=%ERR%
exit /b %ERR%
