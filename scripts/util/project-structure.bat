@echo off
setlocal enabledelayedexpansion

:: Output file
set "OUTFILE=project-structure.md"
del "%OUTFILE%" >nul 2>&1

:: Title (optional)
echo ``` >> "%OUTFILE%"
echo Project Structure >> "%OUTFILE%"
echo. >> "%OUTFILE%"

:: Run tree command and filter output
for /f "delims=" %%A in ('tree /F /A') do (
    set "line=%%A"

    :: Replace | with ¦, +--- with +--, and \--- with +--
    set "line=!line:|=¦!"
    set "line=!line:+---=+--!"
    set "line=!line:\---=+--!"

    :: Indent using spaces instead of tabs
    set "line=!line:    =    !"

    echo !line! >> "%OUTFILE%"
)

echo ``` >> "%OUTFILE%"

echo Project structure written to %OUTFILE%
