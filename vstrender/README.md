# VST Plugin Host - Command Line Audio Processor

A command-line utility built with JUCE that processes audio files through a configurable chain of VST3 plugins.

## Features

- **Command-line interface** - Process audio files without GUI
- **JSON configuration** - Easy setup of plugin chains and parameters
- **VST3 plugin support** - Load and chain multiple VST3 plugins
- **Preset loading** - Support for .vstpreset files and base64-encoded state
- **Parameter control** - Set plugin parameters via JSON configuration
- **WAV file processing** - Input and output in WAV format (extensible to other formats)
- **Batch processing ready** - Perfect for automated workflows

## Building the Project

### Prerequisites

1. **JUCE Framework** - Download from [https://juce.com/](https://juce.com/)
2. **CMake 3.22+**
3. **C++17 compatible compiler**
4. **VST3 SDK** (included with JUCE)

### Build Steps

1. Clone or download this project
2. Download JUCE and place it in a `JUCE` subdirectory of your project
3. Create your source directory structure:
   ```
   VSTPluginHost/
   +-- CMakeLists.txt
   +-- JUCE/
   +-- Source/
       +-- Main.cpp
   ```

4. Build with CMake:
   ```bash
   mkdir build
   cd build
   cmake ..
   make  # or cmake --build . on Windows
   ```

### Alternative Build with Projucer

1. Open Projucer (comes with JUCE)
2. Create a new "Console Application" project
3. Add the Main.cpp source file
4. Enable these modules in Projucer:
   - juce_core
   - juce_audio_basics
   - juce_audio_devices
   - juce_audio_formats
   - juce_audio_processors
   - juce_audio_utils
   - juce_data_structures
   - juce_events
5. Set preprocessor definitions:
   - `JUCE_PLUGINHOST_VST3=1`
   - `JUCE_PLUGINHOST_AU=0` (set to 1 on macOS if you want AU support)
6. Generate and build the project

## Usage

```bash
./VSTPluginHost processing_config.json
```

## Configuration File Format

The JSON configuration file defines the audio processing pipeline:

### Basic Structure

```json
{
  "input_file": "path/to/input.wav",
  "output_file": "path/to/output.wav",
  "sample_rate": 44100,
  "buffer_size": 512,
  "plugins": [...]
}
```

### Configuration Options

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `input_file` | string | Yes | Path to input WAV file |
| `output_file` | string | Yes | Path for output WAV file |
| `sample_rate` | number | No | Sample rate (default: 44100) |
| `buffer_size` | number | No | Processing buffer size (default: 512) |
| `plugins` | array | Yes | Array of plugin configurations |

### Plugin Configuration

Each plugin in the `plugins` array can have:

```json
{
  "path": "/path/to/plugin.vst3",
  "preset": "/path/to/preset.vstpreset",
  "parameters": {
    "Parameter Name": value,
    "Another Parameter": value
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes | Full path to VST3 plugin file |
| `preset` | string | No | Path to .vstpreset file or base64 state |
| `parameters` | object | No | Key-value pairs of parameter names and values |

## Example Configurations

### Simple EQ Processing

```json
{
  "input_file": "input.wav",
  "output_file": "eq_processed.wav",
  "plugins": [
    {
      "path": "/usr/lib/vst3/FabFilter Pro-Q 3.vst3",
      "parameters": {
        "Low Shelf Gain": 2.0,
        "High Shelf Gain": 1.5
      }
    }
  ]
}
```

### Multi-Effect Chain

```json
{
  "input_file": "vocals.wav",
  "output_file": "vocals_processed.wav",
  "plugins": [
    {
      "path": "/Library/Audio/Plug-Ins/VST3/DeEsser.vst3",
      "parameters": {
        "Threshold": -15.0,
        "Frequency": 7000
      }
    },
    {
      "path": "/Library/Audio/Plug-Ins/VST3/Compressor.vst3",
      "preset": "VocalComp.vstpreset",
      "parameters": {
        "Makeup Gain": 3.0
      }
    },
    {
      "path": "/Library/Audio/Plug-Ins/VST3/Reverb.vst3",
      "parameters": {
        "Room Size": 0.4,
        "Wet Level": 0.15
      }
    }
  ]
}
```

## Finding Plugin Parameters

To find the exact parameter names for your plugins:

1. **Use a DAW** - Load the plugin in your DAW and note parameter names
2. **Plugin documentation** - Check the plugin's manual
3. **JUCE AudioPluginHost** - Use JUCE's example AudioPluginHost to inspect parameters
4. **Trial and error** - The application will show warnings for unknown parameters

## Preset Files

The application supports two preset formats:

1. **VST3 Presets** - Standard .vstpreset files
2. **Base64 State** - Encoded plugin state in text files

### Creating Base64 Presets

You can create base64 presets by:
1. Loading a plugin in a DAW
2. Configuring it as desired
3. Using the DAW's plugin state export (if available)
4. Or using JUCE's AudioPluginHost to save state

## Error Handling

The application provides detailed error messages for:

- Missing or invalid configuration files
- Plugin loading failures
- Audio file read/write errors
- Invalid parameter names
- Missing preset files

## Supported Audio Formats

While designed for WAV files, the application supports any format that JUCE can handle:

- WAV
- AIFF
- FLAC
- OGG Vorbis (with appropriate JUCE modules)

## Performance Considerations

- **Buffer Size** - Smaller buffers = lower latency but more CPU overhead
- **Plugin Count** - Each plugin adds processing overhead
- **File Size** - Large files are processed in chunks for memory efficiency
- **Plugin Quality** - Some plugins are more CPU-intensive than others

## Troubleshooting

### Common Issues

1. **Plugin not found**
   - Verify the plugin path is correct
   - Ensure the plugin is properly installed
   - Check file permissions

2. **Parameters not working**
   - Verify parameter names match exactly (case-sensitive)
   - Check parameter value ranges in plugin documentation

3. **Audio quality issues**
   - Ensure sample rates match between file and configuration
   - Check plugin bypass states
   - Verify input file integrity

4. **Build issues**
   - Ensure JUCE path is correct in CMakeLists.txt
   - Verify all required JUCE modules are available
   - Check compiler C++17 support

### Debug Mode

For debugging, you can add verbose output by modifying the source code to include more detailed logging.

## Integration Examples

### Batch Processing Script (Bash)

```bash
#!/bin/bash
for file in *.wav; do
    # Update config file with current input/output
    sed "s|INPUT_FILE|$file|g; s|OUTPUT_FILE|processed_$file|g" template_config.json > temp_config.json
    ./VSTPluginHost temp_config.json
done
```

### Python Integration

```python
import json
import subprocess
import os

def process_audio(input_file, output_file, plugin_chain):
    config = {
        "input_file": input_file,
        "output_file": output_file,
        "plugins": plugin_chain
    }
    
    with open("temp_config.json", "w") as f:
        json.dump(config, f, indent=2)
    
    result = subprocess.run(["./VSTPluginHost", "temp_config.json"], 
                          capture_output=True, text=True)
    
    os.remove("temp_config.json")
    return result.returncode == 0
```

## License

This project uses the JUCE framework. Please ensure compliance with JUCE's licensing terms for your use case.

## Contributing

This is a foundational implementation that can be extended with:

- More audio format support
- MIDI file processing
- Real-time parameter automation
- Plugin scanning and validation
- GUI configuration tool
- Advanced error recovery

# Build Troubleshooting Guide

## Step-by-Step Build Process

Follow these exact steps to fix your build:

### 1. Clean Your Build Directory

```cmd
cd /d F:\code\vsthost
rd /s /q build
```

### 2. Verify JUCE Link

Check that JUCE is properly linked:

```cmd
cd /d F:\code\vsthost
dir JUCE
```

You should see:
```
CMakeLists.txt
modules
examples
extras
```

If not, recreate the junction:

```cmd
# Run as Administrator
mklink /J JUCE F:\frame\JUCE-7.0.12
```

### 3. Replace CMakeLists.txt

Replace your current `CMakeLists.txt` with the complete version I provided above. The key changes:

- ? Removed `find_package(PkgConfig REQUIRED)` 
- ? Added proper Windows-specific settings
- ? Added all necessary JUCE modules
- ? Added Windows system libraries
- ? Set console subsystem properly

### 4. Generate Build Files (Clean)

```cmd
cd /d F:\code\vsthost
cmake -B build -S . -G "Visual Studio 17 2022" -A x64
```

### 5. Build the Project

```cmd
cmake --build build --config Release
```

## Expected Output

When CMake configures successfully, you should see:

```
-- The CXX compiler identification is MSVC 19.42.34433.0
-- Detecting CXX compiler ABI info
-- Detecting CXX compiler ABI info - done
-- Check for working CXX compiler: [path] - skipped
-- Detecting CXX compile features
-- Detecting CXX compile features - done
-- Found JUCE at: F:/code/vsthost/JUCE

=== VST Plugin Host Build Configuration ===
Build type: 
Compiler: [compiler path]
C++ Standard: 17
Target architecture: x64
Windows SDK: [version]
JUCE path: F:/code/vsthost/JUCE
==========================================

-- Configuring done (X.Xs)
-- Generating done (X.Xs)
-- Build files have been written to: F:/code/vsthost/build
```

## Common Issues and Solutions

### Issue 1: "JUCE not found!"

**Error:** `CMake Error: JUCE not found! Please ensure JUCE is linked or copied to the JUCE subdirectory.`

**Solution:**
```cmd
# Check if junction exists
dir JUCE

# If not, recreate (run as Administrator)
mklink /J JUCE F:\frame\JUCE-7.0.12

# Verify JUCE CMakeLists.txt exists
dir JUCE\CMakeLists.txt
```

### Issue 2: PkgConfig Error (Fixed)

**Error:** `Could NOT find PkgConfig (missing: PKG_CONFIG_EXECUTABLE)`

**Solution:** This is fixed in the new CMakeLists.txt by removing the PkgConfig dependency.

### Issue 3: Visual Studio Generator Issues

**Error:** `CMake Error: Visual Studio 17 2022 could not find any instance...`

**Solutions:**
- Check your Visual Studio version:
  ```cmd
  # For VS 2022
  cmake -B build -S . -G "Visual Studio 17 2022" -A x64
  
  # For VS 2019
  cmake -B build -S . -G "Visual Studio 16 2019" -A x64
  ```

### Issue 4: Windows SDK Issues

**Error:** Related to Windows SDK not found

**Solution:** Install Windows 10/11 SDK through Visual Studio Installer, or specify version:

Add to CMakeLists.txt:
```cmake
set(CMAKE_SYSTEM_VERSION "10.0.22000.0")  # or your SDK version
```

### Issue 5: Architecture Mismatch

**Error:** Architecture-related build errors

**Solution:** Ensure consistent 64-bit build:
```cmd
cmake -B build -S . -G "Visual Studio 17 2022" -A x64
```

## Quick Test Commands

After successful build, test with these commands:

```cmd
# Check if executable exists
dir build\Release\VSTPluginHost.exe

# Test the executable
build\Release\VSTPluginHost.exe

# Should show usage message:
# Usage: VST Plugin Host <config.json>
# Example: VST Plugin Host processing_config.json
```

## Alternative: Use the Complete Batch Script

Create `quick_build.bat`:

```batch
@echo off
echo VST Plugin Host - Quick Build Script
echo ====================================

cd /d F:\code\vsthost

echo Step 1: Cleaning build directory...
if exist "build" rd /s /q build

echo Step 2: Checking JUCE...
if not exist "JUCE\CMakeLists.txt" (
    echo ERROR: JUCE not found!
    echo Please run as Administrator:
    echo mklink /J JUCE F:\frame\JUCE-7.0.12
    pause
    exit /b 1
)

echo Step 3: Configuring with CMake...
cmake -B build -S . -G "Visual Studio 17 2022" -A x64
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: CMake configuration failed!
    pause
    exit /b 1
)

echo Step 4: Building...
cmake --build build --config Release
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Build failed!
    pause
    exit /b 1
)

echo.
echo SUCCESS! Build completed.
echo Executable: build\Release\VSTPluginHost.exe
echo Also copied to: VSTPluginHost.exe
echo.
build\Release\VSTPluginHost.exe
pause
```

## Next Steps After Successful Build

1. **Test the executable:**
   ```cmd
   build\Release\VSTPluginHost.exe
   ```

2. **Create a test configuration:**
   - Find a VST3 plugin on your system
   - Create a simple WAV file or find a test file
   - Create a JSON config file pointing to these

3. **Run a test:**
   ```cmd
   build\Release\VSTPluginHost.exe configs\test_config.json
   ```

The new CMakeLists.txt should resolve your build issues completely!
