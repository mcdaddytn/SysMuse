@echo off
setlocal
set "DIR=%~dp0"
call "%DIR%managedb.bat" restore "%~1" "%~2"
