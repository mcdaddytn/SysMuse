@echo off
echo === Cleaning and Building Plugin Preset Capture ===
echo.

cd /d F:\syscode\SysMuse\PluginPresetCapture

echo Step 1: Cleaning previous build...
if exist "build" (
    echo Removing build directory...
    rd /s /q build
)

if exist "CMakeCache.txt" (
    echo Removing CMake cache...
    del CMakeCache.txt
)

if exist "PluginPresetCapture.exe" (
    echo Removing old executable...
    del PluginPresetCapture.exe
)

echo Step 2: Verifying JUCE link...
if not exist "JUCE\CMakeLists.txt" (
    echo JUCE not found! Creating link...
    mklink /J JUCE F:\frame\JUCE-7.0.12
    if %ERRORLEVEL% NEQ 0 (
        echo Failed to create JUCE link. Please run as Administrator.
        pause
        exit /b 1
    )
)

echo JUCE found

echo.
echo Step 3: Fresh CMake configuration...
cmake -B build -S . -G "Visual Studio 17 2022" -A x64

if %ERRORLEVEL% NEQ 0 (
    echo CMake configuration failed!
    pause
    exit /b 1
)

echo.
echo Step 4: Building...
cmake --build build --config Release

if %ERRORLEVEL% NEQ 0 (
    echo Build failed!
    pause
    exit /b 1
)

echo.
echo Build completed successfully!
echo Executable: PluginPresetCapture.exe
pause