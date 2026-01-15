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
set "DEST_PATH=%CD%\output"

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
    REM Check if destination markersections exists, if not offer to create structure
    if not exist "%DEST_PATH%\markersections" (
        echo Warning: Destination markersections directory does not exist.
        echo The markersections directory is normally created when running the parsing phases.
        echo.
        echo Do you want to:
        echo   1. Create the directory structure from source ^(copies all trial directories^)
        echo   2. Skip copying LLMSummary1 directories
        echo.
        set /p CHOICE="Enter choice (1 or 2): "
        
        if "!CHOICE!"=="1" (
            echo Creating markersections directory structure...
            mkdir "%DEST_PATH%\markersections" 2>nul
            
            REM Create matching trial directories
            for /d %%S in ("%SOURCE_PATH%\markersections\*") do (
                for %%N in ("%%S") do set "TRIAL_NAME=%%~nxN"
                echo   Creating trial directory: !TRIAL_NAME!
                mkdir "%DEST_PATH%\markersections\!TRIAL_NAME!" 2>nul
                
                REM Create variant subdirectories if they exist in source
                if exist "%%S\Abridged1" mkdir "%DEST_PATH%\markersections\!TRIAL_NAME!\Abridged1" 2>nul
                if exist "%%S\Abridged2" mkdir "%DEST_PATH%\markersections\!TRIAL_NAME!\Abridged2" 2>nul
                if exist "%%S\FullText" mkdir "%DEST_PATH%\markersections\!TRIAL_NAME!\FullText" 2>nul
            )
            echo Directory structure created.
        ) else (
            echo Skipping LLMSummary1 copy.
            goto :skip_markersections
        )
    )
    
    if exist "%DEST_PATH%\markersections" (
        echo Copying LLMSummary1 directories for matching trials...
        set /a COPIED_COUNT=0
        set /a SKIPPED_COUNT=0
        set /a NOT_FOUND_COUNT=0
        
        REM Iterate through destination trials and use full paths to avoid name issues
        for /d %%D in ("%DEST_PATH%\markersections\*") do (
            REM Get just the directory name
            for %%N in ("%%D") do set "TRIAL_NAME=%%~nxN"
            
            REM Use direct path checking without string concatenation
            set "FOUND=0"
            for /d %%S in ("%SOURCE_PATH%\markersections\*") do (
                for %%M in ("%%S") do (
                    if "%%~nxM"=="!TRIAL_NAME!" (
                        set "FOUND=1"
                        set "SOURCE_TRIAL=%%S"
                    )
                )
            )
            
            if "!FOUND!"=="1" (
                REM Check if LLMSummary1 exists in source trial
                if exist "!SOURCE_TRIAL!\LLMSummary1" (
                    echo   Copying: !TRIAL_NAME!\LLMSummary1
                    REM Remove existing LLMSummary1 if it exists (to overwrite)
                    if exist "%%D\LLMSummary1" (
                        rmdir /S /Q "%%D\LLMSummary1" 2>nul
                    )
                    xcopy /E /I /Y /Q "!SOURCE_TRIAL!\LLMSummary1" "%%D\LLMSummary1\" >nul 2>&1
                    set /a COPIED_COUNT+=1
                ) else (
                    echo   No LLMSummary1 found for: !TRIAL_NAME!
                    set /a NOT_FOUND_COUNT+=1
                )
            ) else (
                echo   Skipping: !TRIAL_NAME! ^(not found in source^)
                set /a SKIPPED_COUNT+=1
            )
        )
        
        echo + Copied LLMSummary1 for !COPIED_COUNT! trials
        if !NOT_FOUND_COUNT! gtr 0 (
            echo   !NOT_FOUND_COUNT! trials had no LLMSummary1 directory in source
        )
        if !SKIPPED_COUNT! gtr 0 (
            echo   !SKIPPED_COUNT! trials not found in source
        )
    ) else (
        echo - markersections directory not found in destination
    )
) else (
    echo - markersections directory not found in source
)

:skip_markersections

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