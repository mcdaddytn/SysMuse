@echo off
setlocal EnableDelayedExpansion

set "EXAMPLE_FILE=.env.example"
set "CONFIG_FILE=env-config.json"
set "OUTPUT_FILE=.env"

:: Check files exist
if not exist "%EXAMPLE_FILE%" (
    echo Missing .env.example
    exit /b 1
)
if not exist "%CONFIG_FILE%" (
    echo Missing env-config.json
    exit /b 1
)

:: Read JSON entries
for /f "tokens=1,* delims=:" %%A in ('powershell -NoProfile -Command ^
  "Get-Content %CONFIG_FILE% | ConvertFrom-Json | Get-Member -MemberType NoteProperty | Select -ExpandProperty Name"') do (
    set "KEY=%%A"
    set "REPLACE_KEY=!KEY:*.=!"
    set "ENV_VAR=!KEY:~0,-1!"
    
    :: Get default value
    for /f "delims=" %%V in ('powershell -NoProfile -Command ^
      "(Get-Content %CONFIG_FILE% | ConvertFrom-Json).'%%A'"') do (
        set "DEFAULT=%%V"
    )

    set /p "INPUT=Enter value for !KEY! [!DEFAULT!]: "
    if "!INPUT!"=="" set "INPUT=!DEFAULT!"
    set "VALUE_!KEY!=!INPUT!"
)

:: Build output
> "%OUTPUT_FILE%" (
    for /f "usebackq delims=" %%L in ("%EXAMPLE_FILE%") do (
        set "LINE=%%L"
        set "OUTLINE=%%L"
        for /f "delims=" %%K in ('powershell -NoProfile -Command ^
          "Get-Content %CONFIG_FILE% | ConvertFrom-Json | Get-Member -MemberType NoteProperty | Select -ExpandProperty Name"') do (
            set "KEY=%%K"
            set "LITERAL=!KEY:*.=!"
            set "ENV_VAR=!KEY:~0,-1!"
            echo !LINE! | findstr /i "^!ENV_VAR!=" >nul
            if !errorlevel! == 0 (
                call set "OUTLINE=%%OUTLINE:!LITERAL!=!VALUE_%%K!%%"
            )
        )
        echo !OUTLINE!
    )
)

echo Success .env file generated from template.
