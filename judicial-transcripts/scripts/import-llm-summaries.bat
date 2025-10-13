@echo off
setlocal enabledelayedexpansion

REM Import LLM Summaries Script
REM Usage: import-llm-summaries.bat <source_path>
REM Example: import-llm-summaries.bat "C:\Users\username\Dropbox\docs\docsxfer\jud-tran"

REM Check if source path is provided
if "%~1"=="" (
    echo Usage: %0 ^<source_path^>
    echo Example: %0 "C:\Users\username\Dropbox\docs\docsxfer\jud-tran"
    exit /b 1
)

set "SOURCE_PATH=%~1"
set "DEST_PATH=output"

REM Verify source path exists
if not exist "%SOURCE_PATH%" (
    echo Error: Source path does not exist: %SOURCE_PATH%
    exit /b 1
)

echo Starting LLM Summaries Import
echo Source: %SOURCE_PATH%
echo Destination: %DEST_PATH%
echo.

REM 1. Copy attorneyProfiles
if exist "%SOURCE_PATH%\attorneyProfiles" (
    echo Copying attorneyProfiles...
    if not exist "%DEST_PATH%\attorneyProfiles" (
        mkdir "%DEST_PATH%\attorneyProfiles"
    )
    xcopy /E /I /Y /Q "%SOURCE_PATH%\attorneyProfiles\*" "%DEST_PATH%\attorneyProfiles\" >nul 2>&1
    
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
    if not exist "%DEST_PATH%\trialSummaries" (
        mkdir "%DEST_PATH%\trialSummaries"
    )
    xcopy /E /I /Y /Q "%SOURCE_PATH%\trialSummaries\*" "%DEST_PATH%\trialSummaries\" >nul 2>&1
    
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
        
        REM Iterate through destination trials
        for /d %%T in ("%DEST_PATH%\markersections\*") do (
            set "TRIAL_NAME=%%~nxT"
            set "SOURCE_TRIAL_DIR=%SOURCE_PATH%\markersections\!TRIAL_NAME!"
            
            REM Check if corresponding source trial exists
            if exist "!SOURCE_TRIAL_DIR!" (
                set "SOURCE_LLM_DIR=!SOURCE_TRIAL_DIR!\LLMSummary1"
                
                REM Check if LLMSummary1 exists in source
                if exist "!SOURCE_LLM_DIR!" (
                    echo   Copying: !TRIAL_NAME!\LLMSummary1
                    REM Remove existing LLMSummary1 if it exists (to overwrite)
                    if exist "%%T\LLMSummary1" (
                        rmdir /S /Q "%%T\LLMSummary1"
                    )
                    xcopy /E /I /Y /Q "!SOURCE_LLM_DIR!" "%%T\LLMSummary1\" >nul 2>&1
                    set /a COPIED_COUNT+=1
                ) else (
                    echo   No LLMSummary1 found for: !TRIAL_NAME!
                )
            ) else (
                echo   Skipping: !TRIAL_NAME! ^(not found in source^)
                set /a SKIPPED_COUNT+=1
            )
        )
        
        echo + Copied LLMSummary1 for !COPIED_COUNT! trials
        if !SKIPPED_COUNT! gtr 0 (
            echo   Skipped !SKIPPED_COUNT! trials ^(not found in source^)
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
    for /f %%i in ('dir /s /b /ad "%DEST_PATH%\markersections\LLMSummary1" 2^>nul ^| find /c "LLMSummary1"') do set COUNT=%%i
    echo   - Marker Section LLM Summaries: !COUNT! directories
)

endlocal