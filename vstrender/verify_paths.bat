@echo off
echo ===========================================
echo Path Verification Script
echo ===========================================
echo.

set PLUGIN_PATH=C:\Program Files\Steinberg\Cubase 11\VST3\Cubase Plug-in Set.vst3
set PRESET_PATH=C:\Users\gmac\Documents\VST3 Presets\Steinberg Media Technologies\MultibandCompressor\GM - SC Rhy Gtr.vstpreset

echo Testing plugin path:
echo %PLUGIN_PATH%
if exist "%PLUGIN_PATH%" (
    echo ✓ PLUGIN FILE EXISTS
    dir "%PLUGIN_PATH%"
) else (
    echo ✗ PLUGIN FILE NOT FOUND
    echo.
    echo Searching for Cubase plugin files in common locations...
    dir "C:\Program Files\Steinberg\" /s | findstr -i "Cubase Plug-in Set.vst3"
    dir "C:\Program Files\Common Files\VST3\" /s | findstr -i cubase
)
echo.

echo Testing preset path:
echo %PRESET_PATH%
if exist "%PRESET_PATH%" (
    echo ✓ PRESET FILE EXISTS
    dir "%PRESET_PATH%"
) else (
    echo ✗ PRESET FILE NOT FOUND
    echo.
    echo Searching for preset file...
    dir "C:\Users\gmac\Documents\VST3 Presets\" /s | findstr -i "GM - SC Rhy Gtr"
)
echo.

echo ===========================================
echo Copy the exact paths shown above into JSON
echo Remember to use double backslashes \\\\ in JSON
echo ===========================================
pause