@echo off
REM ===============================
REM Configurable Variables
REM ===============================

REM SET INPUT_PDF=F:\docs\rj\JudicialAccess\Transcripts\VocalLifevAmazonPDF\sample.pdf
REM SET OUTPUT_TXT=F:\docs\rj\JudicialAccess\Transcripts\TextOutput\sample.txt
SET INPUT_PDF=C:\docs\rj\transcripts\Contentguard\Contentguard_ NOVEMBER 18, 2015 PM.pdf
SET OUTPUT_TXT=c:\docs\rj\transcripts\TextOutput\content_guard_3.txt
REM SET OUTPUT_TXT=c:\docs\rj\transcripts\TextOutput\content_guard_1.txt

REM ===============================
REM pdftotext Options (choose ONE)
REM ===============================

REM Option A: Simple text extraction (default)
REM SET PDFTOTEXT_OPTIONS=

REM Option B: Preserve layout (columns and spacing)
REM SET PDFTOTEXT_OPTIONS=-layout

REM Option C: Fixed spacing (2 char width units)
REM SET PDFTOTEXT_OPTIONS=-fixed 2

REM Option D: Table-aware extraction
REM SET PDFTOTEXT_OPTIONS=-table

REM Option E: Raw mode (less formatting cleanup)
REM SET PDFTOTEXT_OPTIONS=-raw

REM Option F: Remove diagonal text (if boxes or watermarks interfere)
REM SET PDFTOTEXT_OPTIONS=-nodiag

REM Combine options as needed:
REM SET PDFTOTEXT_OPTIONS=-layout -nodiag
REM SET PDFTOTEXT_OPTIONS=-layout -fixed 2 -eol dos
SET PDFTOTEXT_OPTIONS=-layout -table -eol mac

REM ===============================
REM Execute pdftotext
REM ===============================

echo Running: pdftotext %PDFTOTEXT_OPTIONS% "%INPUT_PDF%" "%OUTPUT_TXT%"
pdftotext %PDFTOTEXT_OPTIONS% "%INPUT_PDF%" "%OUTPUT_TXT%"

IF %ERRORLEVEL% NEQ 0 (
    echo Error: pdftotext failed with exit code %ERRORLEVEL%
    exit /b %ERRORLEVEL%
) ELSE (
    echo Success: Text written to %OUTPUT_TXT%
)
