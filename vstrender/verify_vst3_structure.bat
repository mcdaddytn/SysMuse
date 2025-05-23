@echo off
echo ===========================================
echo VST3 Bundle Structure Verification
echo ===========================================
echo.

set VST3_BUNDLE=C:\Program Files\Steinberg\Cubase 11\VST3\Cubase Plug-in Set.vst3

echo Testing VST3 bundle path:
echo "%VST3_BUNDLE%"
echo.

if exist "%VST3_BUNDLE%" (
    echo [OK] VST3 bundle directory exists
    echo.
    echo Bundle contents:
    dir "%VST3_BUNDLE%" /b
    echo.
    
    if exist "%VST3_BUNDLE%\Contents" (
        echo [OK] Contents directory exists
        echo.
        echo Contents structure:
        dir "%VST3_BUNDLE%\Contents" /b /s
    ) else (
        echo [WARNING] Contents directory not found
    )
    
    echo.
    echo Binary files in bundle:
    dir "%VST3_BUNDLE%" /s *.vst3 /b
    
) else (
    echo [ERROR] VST3 bundle directory not found
    echo.
    echo Searching for Cubase VST3 files:
    for /r "C:\Program Files\Steinberg\" %%f in ("*Cubase*Plug-in*Set*.vst3") do echo Found: %%f
)

echo.
echo ===========================================
echo Use the bundle directory path (not the binary inside)
echo Correct path: %VST3_BUNDLE%
echo ===========================================
pause