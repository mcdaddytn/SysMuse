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
            print(f"✓ Patch {patch_num} rendered successfully")
        else:
            print(f"✗ Failed to render patch {patch_num}")
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