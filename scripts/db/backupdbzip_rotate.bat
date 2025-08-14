@echo off
setlocal EnableExtensions

set "RET=%~1"
if "%RET%"=="" set "RET=7"
set "BACKUP_DIR=%~2"
if "%BACKUP_DIR%"=="" set "BACKUP_DIR=.\backups"

for /f %%A in ('powershell -NoProfile -Command "(Get-Date).ToString('yyyyMMdd_HHmmss')"') do set "STAMP=%%A"
call "%~dp0backupdbzip.bat" "%STAMP%" "%BACKUP_DIR%"
if errorlevel 1 exit /b %errorlevel%

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$envPath = Join-Path (Get-Location) '.env';" ^
  "$db=$env:PGDATABASE;" ^
  "if(-not $db -and (Test-Path $envPath)){" ^
  "  $t=Get-Content -Raw $envPath;" ^
  "  $m=[regex]::Match($t,'DATABASE_URL\s*=\s*\"([^\"']+)\"');" ^
  "  if($m.Success){ $u=[uri]$m.Groups[1].Value; $db=$u.AbsolutePath.TrimStart('/') }" ^
  "}" ^
  "if(-not $db -and $env:DATABASE_URL){ $u=[uri]$env:DATABASE_URL.Trim('\"'); $db=$u.AbsolutePath.TrimStart('/') }" ^
  "if(-not $db){ throw 'Cannot resolve PGDATABASE' }" ^
  "$dir = Resolve-Path '%BACKUP_DIR%';" ^
  "$cut = (Get-Date).AddDays(-[int]%RET%);" ^
  "Get-ChildItem $dir -Filter ($db + '_*.sql.gz') | Where-Object { $_.LastWriteTime -lt $cut } | Remove-Item -Force -ErrorAction SilentlyContinue"

endlocal
