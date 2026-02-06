@echo off
setlocal EnableExtensions

REM Usage:
REM   Archive-Dirs.bat "C:\lists\dirs.txt" "E:\Archive"
REM Example:
REM   Archive-Dirs.bat "C:\lists\dirs.txt" "E:\Archive"

if "%~1"=="" (
  echo ERROR: Missing arg 1: path to newline-delimited list file
  echo Usage: %~nx0 "C:\lists\dirs.txt" "E:\Archive"
  exit /b 2
)
if "%~2"=="" (
  echo ERROR: Missing arg 2: destination root
  echo Usage: %~nx0 "C:\lists\dirs.txt" "E:\Archive"
  exit /b 2
)

set "LISTFILE=%~1"
set "DESTROOT=%~2"

set "PSSCRIPT=%~dp0Archive-Dirs.ps1"
if not exist "%PSSCRIPT%" (
  REM If the .ps1 isn't in the same folder as the .bat, hardcode it here:
  REM set "PSSCRIPT=C:\scripts\Archive-Dirs.ps1"
  echo ERROR: PowerShell script not found next to this .bat:
  echo   %PSSCRIPT%
  exit /b 3
)

echo Running archive copy...
echo   ListFile: "%LISTFILE%"
echo   DestRoot: "%DESTROOT%"
echo   Script:   "%PSSCRIPT%"
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PSSCRIPT%" -ListFile "%LISTFILE%" -DestRoot "%DESTROOT%"
set "ERR=%ERRORLEVEL%"

echo.
echo Finished. ExitCode=%ERR%
exit /b %ERR%
