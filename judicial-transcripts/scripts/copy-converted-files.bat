@echo off
setlocal EnableDelayedExpansion

REM Script to copy converted PDF text files based on conversion-summary.json
REM Usage: copy-converted-files.bat <destination_directory>

REM Check if destination directory argument is provided
if "%~1"=="" (
    echo Error: Please provide a destination directory as an argument
    echo Usage: %~nx0 ^<destination_directory^>
    exit /b 1
)

set "DEST_BASE=%~1"
set "SOURCE_BASE=output\multi-trial"
set /a COPY_COUNT=0
set /a TRIAL_COUNT=0
set /a SKIP_COUNT=0

REM Create destination directory if it doesn't exist
if not exist "%DEST_BASE%" (
    echo Creating destination directory: %DEST_BASE%
    mkdir "%DEST_BASE%"
)

echo =========================================
echo PDF Conversion Copy Utility
echo =========================================
echo Source: %SOURCE_BASE%
echo Destination: %DEST_BASE%
echo.

REM Check if jq is available
where jq >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: jq is not installed or not in PATH
    echo Please install jq from https://stedolan.github.io/jq/download/
    exit /b 1
)

REM Process each trial directory
for /d %%D in ("%SOURCE_BASE%\*") do (
    set "trial_dir=%%D"
    set "trial_name=%%~nxD"
    set "summary_file=!trial_dir!\conversion-summary.json"

    REM Check if conversion-summary.json exists
    if exist "!summary_file!" (
        echo Processing: !trial_name!

        REM Check if conversion was complete
        for /f "usebackq delims=" %%C in (`jq -r ".complete" "!summary_file!" 2^>nul`) do (
            set "is_complete=%%C"
        )

        if "!is_complete!" neq "true" (
            echo   Warning: Conversion not marked as complete
        )

        REM Create destination trial directory if it doesn't exist
        set "dest_trial_dir=%DEST_BASE%\!trial_name!"
        if not exist "!dest_trial_dir!" (
            echo   Creating directory: !dest_trial_dir!
            mkdir "!dest_trial_dir!"
        )

        REM Create temporary file for converted files list
        set "temp_file=!temp!\converted_files_%RANDOM%.tmp"
        jq -r ".filesConverted[]" "!summary_file!" > "!temp_file!" 2>nul

        REM Check if there are any files to copy
        set /a file_count=0
        for /f %%F in ('type "!temp_file!" 2^>nul ^| find /c /v ""') do (
            set /a total_files=%%F
        )

        if !total_files! equ 0 (
            echo   Warning: No files were converted in the last run
            set /a SKIP_COUNT+=1
        ) else (
            REM Copy each converted file
            for /f "usebackq delims=" %%F in ("!temp_file!") do (
                set "filename=%%F"
                set "source_file=!trial_dir!\!filename!"
                set "dest_file=!dest_trial_dir!\!filename!"

                if exist "!source_file!" (
                    echo   Copying: !filename!
                    copy /Y "!source_file!" "!dest_file!" >nul
                    set /a file_count+=1
                    set /a COPY_COUNT+=1
                ) else (
                    echo   Error: Source file not found: !filename!
                )
            )

            echo   Copied !file_count! files to !dest_trial_dir!
        )

        REM Clean up temporary file
        if exist "!temp_file!" del "!temp_file!"

        set /a TRIAL_COUNT+=1
        echo.
    ) else (
        echo Skipping: !trial_name! ^(no conversion-summary.json found^)
        echo.
    )
)

echo =========================================
echo Copy Complete!
echo =========================================
echo Trials processed: %TRIAL_COUNT%
echo Files copied: %COPY_COUNT%
echo Trials skipped ^(no conversions^): %SKIP_COUNT%
echo.
echo Destination: %DEST_BASE%

endlocal