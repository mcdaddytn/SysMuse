@echo off
setlocal EnableExtensions

set "SUFFIX=%~1"
if "%SUFFIX%"=="" set "SUFFIX=current"
set "BACKUP_DIR=%~2"
if "%BACKUP_DIR%"=="" set "BACKUP_DIR=.\backups"

rem Run normal backup
call "%~dp0managedb.bat" backup "%SUFFIX%" "%BACKUP_DIR%"
if errorlevel 1 exit /b %errorlevel%

rem Compress the expected output to .gz using PowerShell (no external gzip needed)
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
  "if(-not $db){ throw 'Cannot resolve PGDATABASE from .env or env:DATABASE_URL' }" ^
  "$dir = Resolve-Path '%BACKUP_DIR%';" ^
  "$out = Join-Path $dir ('{0}_{1}.sql' -f $db,'%SUFFIX%');" ^
  "if(!(Test-Path $out)){ throw ('Expected dump not found: {0}' -f $out) }" ^
  "$gz  = $out + '.gz';" ^
  "$in  = [IO.File]::OpenRead($out);" ^
  "$ofs = [IO.File]::Create($gz);" ^
  "$gzs = New-Object IO.Compression.GzipStream($ofs,[IO.Compression.CompressionLevel]::Optimal);" ^
  "$in.CopyTo($gzs);" ^
  "$gzs.Dispose(); $ofs.Dispose(); $in.Dispose();" ^
  "Remove-Item $out -Force;" ^
  "Write-Host 'Compressed:' $gz"

endlocal
