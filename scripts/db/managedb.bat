@echo off
setlocal EnableExtensions EnableDelayedExpansion

:: ===== DEBUG =====
if not defined DEBUG set "DEBUG=1"
echo [MGD ] ENTER managedb.bat  CWD="%CD%"

:: ===== ARGS =====
set "op=%~1"
set "SUFFIX=%~2"
set "BACKUP_DIR=%~3"

if "%op%"=="" goto :usage
if /I not "%op%"=="backup" if /I not "%op%"=="restore" goto :usage
if "%SUFFIX%"=="" set "SUFFIX=current"
if "%BACKUP_DIR%"=="" set "BACKUP_DIR=backups"

if "%DEBUG%"=="1" (
  echo [DBG] op="%op%" suffix="%SUFFIX%" backup_dir="%BACKUP_DIR%"
)

:: ===== LOAD .env (from current dir) =====
if exist ".env" (
  if "%DEBUG%"=="1" echo [DBG] Loading .env from "%CD%\.env"
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if not "%%~A"=="" set "%%~A=%%~B"
  )
) else (
  if "%DEBUG%"=="1" echo [DBG] No .env found in "%CD%"
)

:: ===== Parse DATABASE_URL into PG* if present =====
if defined DATABASE_URL (
  set "TMP_ENV=%TEMP%\pg_from_url_%RANDOM%.cmd"
  if "%DEBUG%"=="1" echo [DBG] Parsing DATABASE_URL into PG* via PowerShell → "%TMP_ENV%"
  powershell -NoProfile -Command ^
    "$u=[uri]($env:DATABASE_URL.Trim('`"')); $ui=$u.UserInfo; $user=''; $pass='';" ^
    "if($ui){ $parts=$ui.Split(':',2); $user=[uri]::UnescapeDataString($parts[0]); if($parts.Count -gt 1){$pass=[uri]::UnescapeDataString($parts[1])} }" ^
    "$host=$u.Host; $port=if($u.Port -gt 0){$u.Port}else{5432}; $db=$u.AbsolutePath.TrimStart('/');" ^
    "if(-not $env:PGUSER -and $user){'set PGUSER='+$user}" ^
    "if(-not $env:PGPASSWORD -and $pass){'set PGPASSWORD='+$pass}" ^
    "if(-not $env:PGHOST -and $host){'set PGHOST='+$host}" ^
    "if(-not $env:PGPORT){'set PGPORT='+$port}" ^
    "if(-not $env:PGDATABASE -and $db){'set PGDATABASE='+$db}" > "%TMP_ENV%"
  if exist "%TMP_ENV%" (
    if "%DEBUG%"=="1" echo [DBG] Applying parsed vars from "%TMP_ENV%"
    call "%TMP_ENV%"
    del "%TMP_ENV%" >nul 2>&1
  ) else (
    if "%DEBUG%"=="1" echo [DBG] URL parse produced no updates
  )
) else (
  if "%DEBUG%"=="1" echo [DBG] DATABASE_URL not set
)

:: ===== Show vars (mask password) =====
if "%DEBUG%"=="1" (
  echo [DBG] PGHOST="%PGHOST%"
  echo [DBG] PGPORT="%PGPORT%"
  echo [DBG] PGUSER="%PGUSER%"
  echo [DBG] PGPASSWORD="********"
  echo [DBG] PGDATABASE="%PGDATABASE%"
)

for %%V in (PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE) do (
  if not defined %%V (
    echo [ERR] Missing %%V (and DATABASE_URL didn't provide it). >&2
    echo       Try: scripts\dotenv-from-url.bat "postgresql://user:pass@host:5432/db?schema=public" >&2
    exit /b 1
  )
)

:: ===== Prepare output path =====
if not exist "%BACKUP_DIR%" (
  if "%DEBUG%"=="1" echo [DBG] Creating backup dir "%BACKUP_DIR%"
  mkdir "%BACKUP_DIR%" || ( echo [ERR] Failed to create "%BACKUP_DIR%" & exit /b 1 )
)
set "OUTFILE=%BACKUP_DIR%\%PGDATABASE%_%SUFFIX%.sql"
if "%DEBUG%"=="1" echo [DBG] OUTFILE="%OUTFILE%"

:: ===== Docker detection =====
set "docker_exec="
where docker >nul 2>&1
if errorlevel 1 (
  if "%DEBUG%"=="1" echo [DBG] docker not found on PATH
) else (
  if "%DEBUG%"=="1" echo [DBG] docker found; checking engine
  docker info >nul 2>&1
  if errorlevel 1 (
    if "%DEBUG%"=="1" echo [DBG] docker engine not running / not accessible
  ) else (
    if "%DEBUG%"=="1" echo [DBG] docker engine running; scanning containers
    for /f "usebackq tokens=1,2,* delims=;" %%A in (`docker ps --format "{{.ID}};{{.Image}};{{.Ports}}"`) do (
      set "CID=%%A"
      set "IMG=%%B"
      set "PORTS=%%C"
      if "%DEBUG%"=="1" echo [DBG] container id=!CID! image=!IMG! ports=!PORTS!
      echo(!IMG!| findstr /i /c:"postgres" >nul 2>&1
      if not errorlevel 1 (
        echo(!PORTS!| findstr /c:":%PGPORT%->" >nul 2>&1
        if not errorlevel 1 (
          set "docker_exec=docker exec -i !CID!"
          if "%DEBUG%"=="1" echo [DBG] Selected container by port match: !CID!
          goto :docker_done
        ) else if not defined docker_exec (
          set "docker_exec=docker exec -i !CID!"
          if "%DEBUG%"=="1" echo [DBG] Selected container fallback: !CID!
        )
      )
    )
  )
)
:docker_done
if defined docker_exec (
  if "%DEBUG%"=="1" echo [DBG] docker_exec="%docker_exec%"
) else (
  if "%DEBUG%"=="1" echo [DBG] No postgres container selected; will use local binaries
)

:: ===== RUN =====
if /I "%op%"=="backup" goto :do_backup
goto :do_restore

:do_backup
echo Backing up %PGDATABASE% ^> "%OUTFILE%"
if defined docker_exec (
  if "%DEBUG%"=="1" echo [DBG] Running pg_dump inside container
  call %docker_exec% sh -lc "PGPASSWORD=\"%PGPASSWORD%\" pg_dump -h \"%PGHOST\" -p \"%PGPORT\" -U \"%PGUSER\" -d \"%PGDATABASE\" --clean --if-exists --no-owner --no-privileges" > "%OUTFILE%"
  set "RC=!ERRORLEVEL!"
) else (
  if "%DEBUG%"=="1" echo [DBG] Running local pg_dump
  set "PGPASSWORD=%PGPASSWORD%"
  pg_dump -h "%PGHOST%" -p "%PGPORT%" -U "%PGUSER%" -d "%PGDATABASE%" --clean --if-exists --no-owner --no-privileges > "%OUTFILE%"
  set "RC=!ERRORLEVEL!"
)
if not "%RC%"=="0" ( echo [ERR] Backup failed (rc=%RC%). & exit /b %RC% )
if "%DEBUG%"=="1" echo [DBG] Backup complete: "%OUTFILE%"
echo Done.
exit /b 0

:do_restore
if not exist "%OUTFILE%" (
  echo [ERR] Restore file not found: "%OUTFILE%" >&2
  exit /b 1
)
echo Restoring %PGDATABASE% ^< "%OUTFILE%"
if defined docker_exec (
  if "%DEBUG%"=="1" echo [DBG] Running psql inside container
  type "%OUTFILE%" | %docker_exec% sh -lc "PGPASSWORD=\"%PGPASSWORD\" psql -h \"%PGHOST\" -p \"%PGPORT\" -U \"%PGUSER\" -d \"%PGDATABASE\" -v ON_ERROR_STOP=1"
  set "RC=!ERRORLEVEL!"
) else (
  if "%DEBUG%"=="1" echo [DBG] Running local psql
  set "PGPASSWORD=%PGPASSWORD%"
  psql -h "%PGHOST%" -p "%PGPORT%" -U "%PGUSER%" -d "%PGDATABASE%" -v ON_ERROR_STOP=1 -f "%OUTFILE%"
  set "RC=!ERRORLEVEL!"
)
if not "%RC%"=="0" ( echo [ERR] Restore failed (rc=%RC%). & exit /b %RC% )
if "%DEBUG%"=="1" echo [DBG] Restore complete
echo Done.
exit /b 0

:usage
echo Usage: %~nx0 ^<backup^|restore^> [suffix=current] [backup_dir=.\backups]>&2
exit /b 2
