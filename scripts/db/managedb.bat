@echo off
setlocal EnableExtensions EnableDelayedExpansion
rem Usage: managedb.bat <backup|restore> [suffix=current] [backup_dir=.\backups]

set "op=%~1"
if "%op%"=="" goto :usage
if /I not "%op%"=="backup" if /I not "%op%"=="restore" goto :usage

set "SUFFIX=%~2"
if "%SUFFIX%"=="" set "SUFFIX=current"
set "BACKUP_DIR=%~3"
if "%BACKUP_DIR%"=="" set "BACKUP_DIR=backups"

rem --- Load .env (simple KEY=VALUE), ignore comments/blank lines ---
if exist ".env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if not "%%~A"=="" set "%%~A=%%~B"
  )
)

rem --- Parse DATABASE_URL if present (fill missing PG*), via PowerShell (safe) ---
if defined DATABASE_URL (
  for /f "usebackq tokens=* delims=" %%J in (`powershell -NoProfile -Command ^
    "$u=[uri]($env:DATABASE_URL.Trim('`"')); $ui=$u.UserInfo; $user,$pass=$ui.Split(':',2); "^
    "if(-not $user){$user=''}; if(-not $pass){$pass=''}; $host=$u.Host; $port=if($u.Port -gt 0){$u.Port}else{5432}; $db=$u.AbsolutePath.TrimStart('/'); "^
    "if(-not $env:PGUSER -and $user){$env:PGUSER=[uri]::UnescapeDataString($user)}; "^
    "if(-not $env:PGPASSWORD -and $pass){$env:PGPASSWORD=[uri]::UnescapeDataString($pass)}; "^
    "if(-not $env:PGHOST -and $host){$env:PGHOST=$host}; if(-not $env:PGPORT){$env:PGPORT=$port}; if(-not $env:PGDATABASE -and $db){$env:PGDATABASE=$db}; "^
    "'OK'"`) do set "PARSE_OK=%%J"
)

for %%V in (PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE) do (
  if not defined %%V (
    echo Missing %%V (and DATABASE_URL didn't provide it).>&2
    echo You can generate them with: scripts\dotenv-from-url.bat "postgresql://user:pass@host:5432/db?schema=public">&2
    exit /b 1
  )
)

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
set "OUTFILE=%BACKUP_DIR%\%PGDATABASE%_%SUFFIX%.sql"

rem --- Docker autodetect: engine up? pick a postgres-ish container; prefer one publishing :PGPORT->
set "docker_exec="
where docker >nul 2>nul
if not errorlevel 1 (
  docker info >nul 2>nul
  if not errorlevel 1 (
    for /f "delims=" %%L in ('docker ps --format "{{.ID}};{{.Image}};{{.Names}};{{.Ports}}"') do (
      for /f "tokens=1-4 delims=;" %%A in ("%%L") do (
        set "CID=%%A"
        set "IMG=%%B"
        set "NAME=%%C"
        set "PORTS=%%D"
        rem keep it simple: image/name must contain "postgres"
        echo(!IMG!| findstr /i /c:"postgres" >nul 2>nul
        if not errorlevel 1 (
          rem prefer a container that publishes :PGPORT->
          echo(!PORTS!| findstr /c:":%PGPORT%->" >nul 2>nul
          if not errorlevel 1 (
            set "docker_exec=docker exec -i !CID!"
            goto :got_docker
          ) else if not defined docker_exec (
            set "docker_exec=docker exec -i !CID!"
          )
        )
      )
    )
  )
)
:got_docker

if /I "%op%"=="backup" (
  echo Backing up %PGDATABASE% ^> "%OUTFILE%"
  if defined docker_exec (
    call %docker_exec% sh -lc "PGPASSWORD=\"%PGPASSWORD%\" pg_dump -h \"%PGHOST\" -p \"%PGPORT\" -U \"%PGUSER\" -d \"%PGDATABASE\" --clean --if-exists --no-owner --no-privileges" > "%OUTFILE%"
  ) else (
    set "PGPASSWORD=%PGPASSWORD%"
    pg_dump -h "%PGHOST%" -p "%PGPORT%" -U "%PGUSER%" -d "%PGDATABASE%" --clean --if-exists --no-privileges --no-owner > "%OUTFILE%"
  )
  if errorlevel 1 ( echo Backup failed.& exit /b 1 )
  echo Done.
  exit /b 0
)

rem restore
if not exist "%OUTFILE%" (
  echo Restore file not found: "%OUTFILE%" >&2
  exit /b 1
)
echo Restoring %PGDATABASE% ^< "%OUTFILE%"
if defined docker_exec (
  type "%OUTFILE%" | %docker_exec% sh -lc "PGPASSWORD=\"%PGPASSWORD\" psql -h \"%PGHOST\" -p \"%PGPORT\" -U \"%PGUSER\" -d \"%PGDATABASE\" -v ON_ERROR_STOP=1"
) else (
  set "PGPASSWORD=%PGPASSWORD%"
  psql -h "%PGHOST%" -p "%PGPORT%" -U "%PGUSER%" -d "%PGDATABASE%" -v ON_ERROR_STOP=1 -f "%OUTFILE%"
)
if errorlevel 1 ( echo Restore failed.& exit /b 1 )
echo Done.
exit /b 0

:usage
echo Usage: %~nx0 ^<backup^|restore^> [suffix=current] [backup_dir=.\backups]>&2
exit /b 2
