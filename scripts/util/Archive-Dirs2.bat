@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM Usage:
REM   Archive-Dirs-Robocopy.bat "C:\lists\dirs.txt" "E:\Archive"

if "%~1"=="" (
  echo ERROR: Missing arg 1: list file
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

if not exist "%LISTFILE%" (
  echo ERROR: List file not found: "%LISTFILE%"
  exit /b 3
)

if not exist "%DESTROOT%" mkdir "%DESTROOT%"

REM Timestamp (locale-dependent, but good enough for folder naming)
for /f "tokens=1-3 delims=/: " %%a in ("%date%") do set "D=%%a-%%b-%%c"
for /f "tokens=1-3 delims=:. " %%a in ("%time%") do set "T=%%a%%b%%c"
set "LOGDIR=%DESTROOT%\_archive_logs_%D%_%T%"
mkdir "%LOGDIR%" >nul 2>&1

set /a OK=0
set /a BAD=0

echo DestRoot: "%DESTROOT%"
echo ListFile: "%LISTFILE%"
echo LogDir:   "%LOGDIR%"
echo ------------------------------------------------------------

for /f "usebackq delims=" %%L in ("%LISTFILE%") do (
  set "LINE=%%L"
  call :Trim LINE
  if "!LINE!"=="" goto :continue
  if "!LINE:~0,1!"=="#" goto :continue

  set "SRC=!LINE!"

  if not exist "!SRC!" (
    echo MISSING: "!SRC!"
    set /a BAD+=1
    echo !SRC!^|MISSING>>"%LOGDIR%\summary.txt"
    goto :continue
  )

  call :MakeDest "!SRC!" DEST
  set "DEST=!DEST!"

  if not exist "!DEST!" mkdir "!DEST!" >nul 2>&1

  call :SafeName "!SRC!" SAFE
  set "LOG=%LOGDIR%\robocopy_!SAFE!.log"

  echo.
  echo COPY: "!SRC!"
  echo   -> "!DEST!"
  echo LOG:  "!LOG!"

  REM /E copy subdirs incl empty
  REM /COPY:DAT data/attrs/timestamps
  REM /DCOPY:DAT directory timestamps
  REM /R:1 /W:1 minimal retry/wait
  REM /Z restartable
  REM /NP no progress
  REM /XJ exclude junctions
  robocopy "!SRC!" "!DEST!" /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /Z /NP /XJ /LOG+:"!LOG!"
  set "RC=!ERRORLEVEL!"

  if !RC! GEQ 8 (
    echo FAILED (robocopy exit=!RC!): "!SRC!"
    set /a BAD+=1
    echo !SRC!^|FAILED^|!RC!>>"%LOGDIR%\summary.txt"
  ) else (
    echo OK (robocopy exit=!RC!): "!SRC!"
    set /a OK+=1
    echo !SRC!^|OK^|!RC!>>"%LOGDIR%\summary.txt"
  )

  :continue
)

echo.
echo ==================== SUMMARY ====================
echo OK:     %OK%
echo Issues: %BAD%
echo Summary: "%LOGDIR%\summary.txt"
echo Done.
exit /b 0

:Trim
setlocal EnableDelayedExpansion
set "s=!%~1!"
for /f "tokens=* delims= " %%A in ("!s!") do set "s=%%A"
:trimtail
if "!s!"=="" goto :doneTrim
if "!s:~-1!"==" " set "s=!s:~0,-1!" & goto :trimtail
:doneTrim
endlocal & set "%~1=%s%"
exit /b

:MakeDest
REM Map source -> DESTROOT\<DriveLetter>\<path...> or DESTROOT\UNC\<server>\<share>\<path...>
setlocal EnableDelayedExpansion
set "src=%~1"

set "d="
if "!src:~0,2!"=="\\\\" (
  set "p=!src:~2!"
  set "d=%DESTROOT%\UNC\!p!"
) else (
  set "drive=!src:~0,1!"
  set "rest=!src:~2!"
  if "!rest:~0,1!"=="\" set "rest=!rest:~1!"
  set "d=%DESTROOT%\!drive!\!rest!"
)
endlocal & set "%~2=%d%"
exit /b

:SafeName
REM Make a filename-safe-ish token from a path
setlocal EnableDelayedExpansion
set "s=%~1"
set "s=!s:\=_!"
set "s=!s:/=_!"
set "s=!s::=_!"
set "s=!s: =_!"
endlocal & set "%~2=%s%"
exit /b
