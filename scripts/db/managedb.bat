@echo off
setlocal EnableExtensions
set "OP=%~1"
set "SUFFIX=%~2"
set "BACKUP_DIR=%~3"
if "%OP%"=="" (
  echo Usage: %~nx0 ^<backup^|restore^> [suffix=current] [backup_dir=.\backups]
  exit /b 2
)
set "HERE=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%managedb.ps1" -Op "%OP%" -Suffix "%SUFFIX%" -BackupDir "%BACKUP_DIR%"
exit /b %ERRORLEVEL%
