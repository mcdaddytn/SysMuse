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
