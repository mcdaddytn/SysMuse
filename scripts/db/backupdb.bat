@echo on
setlocal EnableExtensions
set "DEBUG=1"

rem Where am I being run from?
echo [WRAP] CWD: "%CD%"

rem Where is this wrapper located?
set "WRAP_DIR=%~dp0"
echo [WRAP] wrapper dir: "%WRAP_DIR%"

rem Resolve managedb.bat alongside the wrapper
set "MANAGEDB=%WRAP_DIR%managedb.bat"
echo [WRAP] managedb path: "%MANAGEDB%"

if not exist "%MANAGEDB%" (
  echo [ERR ] managedb.bat NOT FOUND at "%MANAGEDB%"
  exit /b 1
)

rem Show the args we're passing
echo [WRAP] calling managedb: OP=backup SUFFIX="%~1" BACKUP_DIR="%~2"

call "%MANAGEDB%" backup "%~1" "%~2"
echo [WRAP] managedb exited with ERRORLEVEL=%ERRORLEVEL%
exit /b %ERRORLEVEL%
