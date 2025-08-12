@echo off
setlocal
set "DIR=%~dp0"
call "%DIR%managedb.bat" backup "%~1" "%~2"
