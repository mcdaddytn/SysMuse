@echo off
setlocal EnableExtensions

set "SUFFIX=%~1"
if "%SUFFIX%"=="" set "SUFFIX=current"
set "BACKUP_DIR=%~2"
if "%BACKUP_DIR%"=="" set "BACKUP_DIR=.\backups"

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
  "$sql = Join-Path $dir ('{0}_{1}.sql' -f $db,'%SUFFIX%');" ^
  "$gz  = $sql + '.gz';" ^
  "if(!(Test-Path $gz)){ throw ('Not found: {0}' -f $gz) }" ^
  "$in  = [IO.File]::OpenRead($gz);" ^
  "$ofs = [IO.File]::Create($sql);" ^
  "$gzs = New-Object IO.Compression.GzipStream($in,[IO.Compression.CompressionMode]::Decompress);" ^
  "$gzs.CopyTo($ofs);" ^
  "$gzs.Dispose(); $ofs.Dispose(); $in.Dispose();" ^
  "Write-Host 'Decompressed:' $sql"

if errorlevel 1 exit /b %errorlevel%

call "%~dp0managedb.bat" restore "%SUFFIX%" "%BACKUP_DIR%"
set "RC=%ERRORLEVEL%"

del "%BACKUP_DIR%\%PGDATABASE%_%SUFFIX%.sql" 2>nul
exit /b %RC%
