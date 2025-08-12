@echo on
setlocal EnableExtensions
set "DEBUG=1"

echo [WRAP] CWD: "%CD%"
set "WRAP_DIR=%~dp0"
echo [WRAP] wrapper dir: "%WRAP_DIR%"

set "MANAGEDB=%WRAP_DIR%managedb.bat"
echo [WRAP] managedb path: "%MANAGEDB%"

if not exist "%MANAGEDB%" (
  echo [ERR ] managedb.bat NOT FOUND at "%MANAGEDB%"
  exit /b 1
)

echo [WRAP] calling managedb: OP=restore SUFFIX="%~1" BACKUP_DIR="%~2"
call "%MANAGEDB%" restore "%~1" "%~2"
echo [WRAP] managedb exited with ERRORLEVEL=%ERRORLEVEL%
exit /b %ERRORLEVEL%
