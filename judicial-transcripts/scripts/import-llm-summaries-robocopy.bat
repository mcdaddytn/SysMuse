@echo off
setlocal enabledelayedexpansion

REM Import LLM Summaries Script using Robocopy (more robust for Windows)
REM Usage: import-llm-summaries-robocopy.bat <source_path>
REM Example: import-llm-summaries-robocopy.bat "C:\data\jud-tran\jud-tran"

REM Check if source path is provided
if "%~1"=="" (
    echo Usage: %0 ^<source_path^>
    echo Example: %0 "C:\data\jud-tran\jud-tran"
    exit /b 1
)

set "SOURCE_PATH=%~1"
set "DEST_PATH=output"

REM Verify source path exists
if not exist "%SOURCE_PATH%" (
    echo Error: Source path does not exist: %SOURCE_PATH%
    exit /b 1
)

echo Starting LLM Summaries Import ^(using robocopy^)
echo Source: %SOURCE_PATH%
echo Destination: %DEST_PATH%
echo.

REM 1. Copy attorneyProfiles
if exist "%SOURCE_PATH%\attorneyProfiles" (
    echo Copying attorneyProfiles...
    if not exist "%DEST_PATH%\attorneyProfiles" mkdir "%DEST_PATH%\attorneyProfiles"
    robocopy "%SOURCE_PATH%\attorneyProfiles" "%DEST_PATH%\attorneyProfiles" /E /NJH /NJS /NDL /NC /NS >nul 2>&1
    
    REM Count files
    set /a COUNT=0
    for %%f in ("%DEST_PATH%\attorneyProfiles\*") do set /a COUNT+=1
    echo + Copied !COUNT! attorney profiles
) else (
    echo - No attorneyProfiles directory found in source
)

REM 2. Copy trialSummaries
if exist "%SOURCE_PATH%\trialSummaries" (
    echo Copying trialSummaries...
    if not exist "%DEST_PATH%\trialSummaries" mkdir "%DEST_PATH%\trialSummaries"
    robocopy "%SOURCE_PATH%\trialSummaries" "%DEST_PATH%\trialSummaries" /E /NJH /NJS /NDL /NC /NS >nul 2>&1
    
    REM Count files
    set /a COUNT=0
    for %%f in ("%DEST_PATH%\trialSummaries\*") do set /a COUNT+=1
    echo + Copied !COUNT! trial summaries
) else (
    echo - No trialSummaries directory found in source
)

REM 3. Copy LLMSummary1 directories for matching trials in markersections
if exist "%SOURCE_PATH%\markersections" (
    if exist "%DEST_PATH%\markersections" (
        echo Copying LLMSummary1 directories for matching trials...
        set /a COPIED_COUNT=0
        set /a SKIPPED_COUNT=0
        
        REM Process each directory in destination
        for /d %%D in ("%DEST_PATH%\markersections\*") do (
            REM Get the trial name
            set "DEST_DIR=%%D"
            for %%N in ("%%D") do set "TRIAL_NAME=%%~nxN"
            
            REM Check if source has this trial with LLMSummary1
            set "SOURCE_LLM=%SOURCE_PATH%\markersections\!TRIAL_NAME!\LLMSummary1"
            set "DEST_LLM=!DEST_DIR!\LLMSummary1"
            
            if exist "!SOURCE_LLM!" (
                echo   Copying: !TRIAL_NAME!\LLMSummary1
                
                REM Remove existing LLMSummary1 if present
                if exist "!DEST_LLM!" rmdir /S /Q "!DEST_LLM!" 2>nul
                
                REM Use robocopy to copy the directory
                robocopy "!SOURCE_LLM!" "!DEST_LLM!" /E /NJH /NJS /NDL /NC /NS >nul 2>&1
                if !errorlevel! leq 7 (
                    set /a COPIED_COUNT+=1
                ) else (
                    echo     Warning: Failed to copy !TRIAL_NAME!\LLMSummary1
                )
            ) else (
                set /a SKIPPED_COUNT+=1
            )
        )
        
        echo + Copied LLMSummary1 for !COPIED_COUNT! trials
        if !SKIPPED_COUNT! gtr 0 (
            echo   !SKIPPED_COUNT! trials had no LLMSummary1 in source or not found
        )
    ) else (
        echo - markersections directory not found in destination
    )
) else (
    echo - markersections directory not found in source
)

echo.
echo Import completed successfully!

REM Show summary
echo.
echo Summary:

if exist "%DEST_PATH%\attorneyProfiles" (
    set /a COUNT=0
    for %%f in ("%DEST_PATH%\attorneyProfiles\*") do set /a COUNT+=1
    echo   - Attorney Profiles: !COUNT! files
)

if exist "%DEST_PATH%\trialSummaries" (
    set /a COUNT=0
    for %%f in ("%DEST_PATH%\trialSummaries\*") do set /a COUNT+=1
    echo   - Trial Summaries: !COUNT! files
)

if exist "%DEST_PATH%\markersections" (
    set /a COUNT=0
    for /d %%D in ("%DEST_PATH%\markersections\*") do (
        if exist "%%D\LLMSummary1" set /a COUNT+=1
    )
    echo   - Marker Section LLM Summaries: !COUNT! directories
)

endlocal