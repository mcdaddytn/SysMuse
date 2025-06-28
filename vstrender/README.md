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

# Complete Dexed Setup Guide

This guide walks you through setting up a complete workflow with the Dexed VST3 synthesizer, including SysEx patch loading, MIDI file creation, and professional processing chains.

## Quick Setup

### 1. Build the Complete Framework

Update your CMakeLists.txt with the enhanced version that includes both VSTPluginHost and TestMidi tools:

```bash
cd F:\code\vsthost
cmake -B build -S . -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
```

This will create both:
- `VSTPluginHost.exe` - Main audio processing tool
- `TestMidi.exe` - MIDI file generator and analyzer

### 2. Create Source Files

You'll need to create these additional source files:

**Source/MidiUtilities.h** - Already provided in the artifacts above
**Source/TestMidiGenerator.cpp** - Rename the TestMidiGenerator tool code
**Source/DexedSysExHandler.h** - SysEx patch handling for Dexed

### 3. Verify Dexed Installation

```bash
# Check if Dexed is installed
dir "C:\Program Files\Common Files\VST3\Dexed.vst3"

# If not found, download from: https://asb2m10.github.io/dexed/
```

## Dexed Overview

**Dexed** is a multi-platform, multi-format plugin that accurately models the Yamaha DX7 FM synthesizer. Key features:

- **FM Synthesis** - 6 operators with multiple algorithms
- **DX7 Compatible** - Loads original DX7 patches (.syx files)  
- **Multi-Timbral** - Up to 32 voices
- **Built-in Effects** - Chorus, delay, reverb
- **Open Source** - Free and actively maintained

### Dexed Parameters

Common Dexed parameters you can control:

| Parameter | Range | Description |
|-----------|-------|-------------|
| `Volume` | 0.0-1.0 | Master output volume |
| `Cutoff` | 0.0-1.0 | Filter cutoff frequency |
| `Resonance` | 0.0-1.0 | Filter resonance/Q |
| `Transpose` | -24 to +24 | Transpose in semitones |
| `Tune` | -100 to +100 | Fine tuning in cents |
| `Algorithm` | 1-32 | FM algorithm selection |
| `Feedback` | 0.0-1.0 | Operator feedback amount |

## SysEx Patch Loading

### Understanding DX7 SysEx Files

DX7 patches are stored in SysEx (System Exclusive) files with `.syx` extension:

- **32-Voice Bank** - Contains 32 patches (4104 bytes)
- **Single Voice** - Contains 1 patch (163 bytes)
- **Bulk Dump** - Multiple banks combined

### Enhanced Main.cpp for SysEx Support

Add SysEx support to your Main.cpp by including the DexedSysExHandler and adding these features to the PluginConfig struct:

```cpp
struct PluginConfig
{
    // ... existing fields ...
    
    // SysEx support
    juce::String sysexFile;        // Path to .syx file
    int sysexPatchNumber = -1;     // Which patch from bank (0-31)
    int programNumber = -1;        // Alternative: use program change
};
```

Then in parseConfiguration, add:

```cpp
pluginConfig.sysexFile = pluginJson.getProperty("sysex_file", "");
pluginConfig.sysexPatchNumber = pluginJson.getProperty("sysex_patch_number", -1);
pluginConfig.programNumber = pluginJson.getProperty("program_number", -1);
```

And in initializePlugins, after loading the plugin:

```cpp
// Load SysEx patch if specified
if (!pluginConfig.sysexFile.isEmpty())
{
    std::cout << "Loading SysEx file: " << pluginConfig.sysexFile << std::endl;
    auto sysexBank = DexedSysExHandler::loadSysExFile(pluginConfig.sysexFile);
    sysexBank.print();
    
    if (sysexBank.isValid && pluginConfig.sysexPatchNumber >= 0 && 
        pluginConfig.sysexPatchNumber < static_cast<int>(sysexBank.patches.size()))
    {
        const auto& patch = sysexBank.patches[pluginConfig.sysexPatchNumber];
        std::cout << "Selecting patch: " << patch.name << std::endl;
        DexedSysExHandler::sendPatchToVSTi(plugin.get(), patch);
    }
}

// Alternative: Use program change
if (pluginConfig.programNumber >= 0)
{
    DexedSysExHandler::selectPatchByProgram(plugin.get(), pluginConfig.programNumber);
}
```

## Step-by-Step Workflow

### Step 1: Create Test MIDI File

```bash
# Create a DX7-style chord progression
TestMidi.exe create F:\syscode\SysMuse\vstrender\midi\dexed_test.mid 20 120 60

# Or create a more complex pattern
TestMidi.exe create F:\syscode\SysMuse\vstrender\midi\dx7_melody.mid 30 140 57

# Create an electric piano style pattern
TestMidi.exe create F:\syscode\SysMuse\vstrender\midi\epiano_ballad.mid 45 90 60
```

### Step 2: Find DX7 Patches

Download DX7 patches from these sources:

- **Bobby Blues DX7 Patches** - Free classic sounds
- **DX7 SysEx Archive** - Thousands of vintage patches  
- **Modern DX7 Banks** - Contemporary FM sounds
- **Dexed Website** - Curated patch collections

Save `.syx` files to: `F:\syscode\SysMuse\vstrender\patches\`

### Step 3: Analyze Your SysEx Files

```bash
# This will be added to TestMidi utility
TestMidi.exe sysex-analyze F:\syscode\SysMuse\vstrender\patches\dx7_bank.syx
```

Expected output:
```
=== SysEx Bank Analysis ===
File: dx7_bank.syx
Valid: YES
Patches: 32

Patch List:
  [ 0] BRASS   1
  [ 1] STRINGS 1
  [ 2] E.PIANO 1
  [ 3] FLUTE   1
  ...
```

### Step 4: Test Basic Dexed Rendering

Create `dexed_basic_test.json`:

```json
{
  "output_file": "F:\\syscode\\SysMuse\\vstrender\\dexed_basic_test.wav",
  "sample_rate": 44100,
  "bit_depth": 24,
  "render_length": 20.0,
  "plugins": [
    {
      "path": "C:\\Program Files\\Common Files\\VST3\\Dexed.vst3",
      "plugin_name": "Dexed",
      "is_instrument": true,
      "midi_file": "F:\\syscode\\SysMuse\\vstrender\\midi\\dexed_test.mid",
      "export_parameters_before": "F:\\syscode\\SysMuse\\vstrender\\dexed_params.json"
    }
  ]
}
```

Run the test:
```bash
VSTPluginHost.exe dexed_basic_test.json
```

### Step 5: Load SysEx Patches

Create `dexed_with_patch.json`:

```json
{
  "output_file": "F:\\syscode\\SysMuse\\vstrender\\dexed_epiano.wav",
  "plugins": [
    {
      "path": "C:\\Program Files\\Common Files\\VST3\\Dexed.vst3",
      "is_instrument": true,
      "midi_file": "F:\\syscode\\SysMuse\\vstrender\\midi\\epiano_ballad.mid",
      "sysex_file": "F:\\syscode\\SysMuse\\vstrender\\patches\\dx7_bank.syx",
      "sysex_patch_number": 2,
      "parameters": {
        "Volume": 0.8
      }
    }
  ]
}
```

### Step 6: Add Effects Processing

Create `dexed_full_production.json`:

```json
{
  "output_file": "F:\\syscode\\SysMuse\\vstrender\\dexed_full_production.wav",
  "sample_rate": 48000,
  "bit_depth": 24,
  "plugins": [
    {
      "path": "C:\\Program Files\\Common Files\\VST3\\Dexed.vst3",
      "is_instrument": true,
      "midi_file": "F:\\syscode\\SysMuse\\vstrender\\midi\\dx7_melody.mid",
      "sysex_file": "F:\\syscode\\SysMuse\\vstrender\\patches\\dx7_bank.syx",
      "sysex_patch_number": 5,
      "parameters": {
        "Volume": 0.85,
        "Cutoff": 0.8,
        "Resonance": 0.3
      }
    },
    {
      "path": "C:\\Program Files\\Common Files\\VST3\\Pro-Q 3.vst3",
      "parameters": {
        "High Shelf Gain": 2.0,
        "Low Cut Freq": 80
      }
    },
    {
      "path": "C:\\Program Files\\Common Files\\VST3\\ValhallaRoom.vst3",
      "parameters": {
        "Mix": 0.25,
        "Size": 0.6
      }
    }
  ]
}
```

## Advanced Dexed Techniques

### 1. Multi-Layered Sounds

Render multiple Dexed instances with different patches:

```bash
# Render layer 1 (EP sound)
VSTPluginHost.exe dexed_layer1.json

# Render layer 2 (String pad)  
VSTPluginHost.exe dexed_layer2.json

# Combine in your DAW or audio editor
```

### 2. Bass and Lead Separation

Create specialized configurations:

**dexed_bass.json**:
```json
{
  "plugins": [
    {
      "path": "C:\\Program Files\\Common Files\\VST3\\Dexed.vst3",
      "is_instrument": true,
      "midi_file": "bass_line.mid",
      "sysex_patch_number": 8,
      "parameters": {
        "Transpose": -12,
        "Cutoff": 0.6
      }
    }
  ]
}
```

**dexed_lead.json**:
```json
{
  "plugins": [
    {
      "path": "C:\\Program Files\\Common Files\\VST3\\Dexed.vst3",
      "is_instrument": true,
      "midi_file": "lead_melody.mid",
      "sysex_patch_number": 15,
      "parameters": {
        "Transpose": 12,
        "Resonance": 0.8
      }
    }
  ]
}
```

### 3. Vintage 80s Processing Chain

```json
{
  "plugins": [
    {
      "path": "C:\\Program Files\\Common Files\\VST3\\Dexed.vst3",
      "is_instrument": true,
      "midi_file": "80s_melody.mid",
      "sysex_file": "80s_patches.syx",
      "sysex_patch_number": 10
    },
    {
      "path": "C:\\Program Files\\Common Files\\VST3\\Chorus.vst3",
      "parameters": {
        "Rate": 0.5,
        "Depth": 0.6,
        "Mix": 0.8
      }
    },
    {
      "path": "C:\\Program Files\\Common Files\\VST3\\Delay.vst3",
      "parameters": {
        "Time": 0.125,
        "Feedback": 0.4,
        "Mix": 0.3
      }
    },
    {
      "path": "C:\\Program Files\\Common Files\\VST3\\Reverb.vst3",
      "parameters": {
        "Room": 0.7,
        "Mix": 0.2
      }
    }
  ]
}
```

## Troubleshooting Dexed

### Common Issues

#### 1. Dexed Not Loading
```bash
# Check installation
dir "C:\Program Files\Common Files\VST3\Dexed.vst3"

# If not found, download from official website
# Ensure you have the VST3 version, not VST2
```

#### 2. SysEx Patches Not Loading
- Verify `.syx` file is valid DX7 format
- Check patch number is within range (0-31 for banks)
- Ensure SysEx data is being sent correctly

#### 3. No Audio Output
- Check MIDI file has note events
- Verify Dexed volume parameter
- Try different patches - some may be very quiet
- Check algorithm and operator settings

#### 4. Timing Issues
- DX7 patches may have slow attack times
- Increase render length to capture full decay
- Check MIDI note lengths and overlaps

### Debug Features

Export Dexed parameters to understand what's available:

```json
{
  "plugins": [
    {
      "path": "C:\\Program Files\\Common Files\\VST3\\Dexed.vst3",
      "is_instrument": true,
      "midi_file": "test.mid",
      "export_parameters_before": "dexed_all_parameters.json"
    }
  ]
}
```

Review the exported JSON to see all available parameters:
```json
{
  "plugin_name": "Dexed",
  "total_parameters": 155,
  "parameters": {
    "Volume": {
      "value": 0.8,
      "text": "80%",
      "index": 0
    },
    "Algorithm": {
      "value": 0.06,
      "text": "3",
      "index": 134
    }
  }
}
```

## Performance Tips

### 1. Buffer Size Optimization
- Use larger buffers (2048-4096) for offline rendering
- Dexed can be CPU-intensive with complex patches

### 2. Sample Rate Selection
- 44.1kHz is fine for most DX7 sounds
- 48kHz for professional video work
- Higher rates may not improve FM synthesis quality significantly

### 3. Render Length
- FM patches often have long release times
- Add 2-3 seconds extra to capture full decay
- Use `render_length` parameter to override

### 4. MIDI Preparation
- Ensure proper note-off events
- Avoid very dense MIDI (>1000 events/second)
- Use sustain pedal (CC64) for realistic playing

## Batch Processing Scripts

### Windows Batch Script
```batch
@echo off
echo Rendering Dexed patch variations...

set MIDI_FILE=F:\syscode\SysMuse\vstrender\midi\melody.mid
set SYSEX_FILE=F:\syscode\SysMuse\vstrender\patches\dx7_bank.syx

for /L %%i in (0,1,31) do (
    echo Rendering patch %%i...
    
    echo {^
  "output_file": "F:\\renders\\patch_%%i.wav",^
  "plugins": [^
    {^
      "path": "C:\\Program Files\\Common Files\\VST3\\Dexed.vst3",^
      "is_instrument": true,^
      "midi_file": "%MIDI_FILE%",^
      "sysex_file": "%SYSEX_FILE%",^
      "sysex_patch_number": %%i^
    }^
  ]^
} > temp_config.json
    
    VSTPluginHost.exe temp_config.json
    del temp_config.json
)

echo All patches rendered!
pause
```

### Python Script
```python
import json
import subprocess
import os

def render_all_patches(midi_file, sysex_file, output_dir):
    """Render all 32 patches from a DX7 bank"""
    
    os.makedirs(output_dir, exist_ok=True)
    
    for patch_num in range(32):
        print(f"Rendering patch {patch_num}...")
        
        config = {
            "output_file": f"{output_dir}/patch_{patch_num:02d}.wav",
            "sample_rate": 44100,
            "bit_depth": 24,
            "plugins": [{
                "path": "C:\\Program Files\\Common Files\\VST3\\Dexed.vst3",
                "is_instrument": True,
                "midi_file": midi_file,
                "sysex_file": sysex_file,
                "sysex_patch_number": patch_num,
                "parameters": {
                    "Volume": 0.8
                }
            }]
        }
        
        with open("temp_config.json", "w") as f:
            json.dump(config, f, indent=2)
        
        result = subprocess.run(["VSTPluginHost.exe", "temp_config.json"], 
                              capture_output=True, text=True)
        
        if result.returncode == 0:
            print(f"? Patch {patch_num} rendered successfully")
        else:
            print(f"? Failed to render patch {patch_num}")
            print(f"Error: {result.stderr}")
        
        os.remove("temp_config.json")

# Usage
render_all_patches(
    midi_file="F:/midi/test_melody.mid",
    sysex_file="F:/patches/classic_dx7.syx", 
    output_dir="F:/renders/dx7_patches"
)
```

## Next Steps

1. **Build the enhanced framework** with CMakeLists.txt
2. **Create the additional source files** (MidiUtilities.h, DexedSysExHandler.h)
3. **Download some DX7 patch banks** (.syx files)
4. **Create test MIDI files** using TestMidi utility
5. **Start with basic Dexed rendering** to verify setup
6. **Add SysEx patch loading** for authentic DX7 sounds
7. **Build complete production chains** with effects processing

This gives you a professional Dexed workflow that can handle everything from simple patch testing to complex multi-layered productions!

Would you like me to help you with any specific part of this setup, or shall we start building and testing the basic configuration? 



