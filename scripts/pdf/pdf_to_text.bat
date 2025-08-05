@echo off
setlocal

REM ====== CONFIGURE PATH TO pdftotext.exe ======
REM set "PDFTOTEXT_PATH=C:\Tools\poppler\bin"
set "PDFTOTEXT_PATH=F:\frame\utilities\xpdf-tools-win-4.05\bin64"

REM ====== ARGUMENT HANDLING ======
REM %1 = input folder, %2 = output folder
set "INPUT_DIR=%~1"
set "OUTPUT_DIR=%~2"

REM Default input folder to current directory if not given
if "%INPUT_DIR%"=="" set "INPUT_DIR=%cd%"

REM Remove quotes if provided
set "INPUT_DIR=%INPUT_DIR:"=%"

REM Default output folder to input folder if not given
if "%OUTPUT_DIR%"=="" set "OUTPUT_DIR=%INPUT_DIR%"
set "OUTPUT_DIR=%OUTPUT_DIR:"=%"

REM ====== VALIDATION ======
if not exist "%INPUT_DIR%" (
    echo ERROR: Input folder does not exist: %INPUT_DIR%
    exit /b 1
)

if not exist "%OUTPUT_DIR%" (
    echo Output folder does not exist, creating: %OUTPUT_DIR%
    mkdir "%OUTPUT_DIR%"
)

REM ====== PROCESS PDF FILES ======
echo Converting PDFs from "%INPUT_DIR%" to "%OUTPUT_DIR%"...
echo.

for %%F in ("%INPUT_DIR%\*.pdf") do (
    echo Processing: %%~nxF
    "%PDFTOTEXT_PATH%\pdftotext.exe" -layout "%%~fF" "%OUTPUT_DIR%\%%~nF.txt"
)

echo.
echo Conversion complete.
REM pause
