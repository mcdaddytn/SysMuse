cmake_minimum_required(VERSION 3.22)

project(PluginPresetCaptureProject VERSION 1.0.0)

# Set C++ standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Windows-specific settings
if(WIN32)
    if(CMAKE_SIZEOF_VOID_P EQUAL 8)
        set(CMAKE_GENERATOR_PLATFORM x64)
    endif()
    add_compile_definitions(_CRT_SECURE_NO_WARNINGS)
endif()

# Add JUCE - single location check
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/JUCE/CMakeLists.txt")
    message(STATUS "Found JUCE at: ${CMAKE_CURRENT_SOURCE_DIR}/JUCE")
    add_subdirectory(JUCE)
else()
    message(FATAL_ERROR 
        "JUCE not found at ${CMAKE_CURRENT_SOURCE_DIR}/JUCE\n"
        "Please create the JUCE link:\n"
        "  mklink /J JUCE F:\\frame\\JUCE-7.0.12\n"
        "Then ensure JUCE/CMakeLists.txt exists."
    )
endif()

# Create the GUI application with a unique name
juce_add_gui_app(PresetCaptureTool
    PRODUCT_NAME "Plugin Preset Capture"
    COMPANY_NAME "AudioTools"
    VERSION "1.0.0"
    DESCRIPTION "Interactive plugin preset capture tool")

# Add source files
target_sources(PresetCaptureTool PRIVATE
    Source/Main.cpp
    Source/MainComponent.cpp
    Source/MainComponent.h
    Source/PluginEditorWindow.cpp
    Source/PluginEditorWindow.h
    Source/ProjectInfo.h)

# Set include directories
target_include_directories(PresetCaptureTool PRIVATE Source)

# Link against JUCE modules
target_link_libraries(PresetCaptureTool PRIVATE
    juce::juce_core
    juce::juce_audio_basics
    juce::juce_audio_devices
    juce::juce_audio_formats
    juce::juce_audio_processors
    juce::juce_audio_utils
    juce::juce_data_structures
    juce::juce_events
    juce::juce_graphics
    juce::juce_gui_basics
    juce::juce_gui_extra)

# Plugin format support
target_compile_definitions(PresetCaptureTool PRIVATE
    JUCE_PLUGINHOST_VST3=1
    JUCE_PLUGINHOST_VST=0
    JUCE_PLUGINHOST_AU=0
    JUCE_PLUGINHOST_LADSPA=0
    JUCE_USE_CURL=0
    JUCE_WEB_BROWSER=0
    JUCE_DISPLAY_SPLASH_SCREEN=0
    JUCE_USE_DARK_SPLASH_SCREEN=0)

# Windows-specific libraries
if(WIN32)
    target_link_libraries(PresetCaptureTool PRIVATE
        winmm ole32 oleaut32 imm32 comdlg32 shlwapi rpcrt4 wininet)
endif()

# Set target properties
set_target_properties(PresetCaptureTool PROPERTIES
    CXX_STANDARD 17
    CXX_STANDARD_REQUIRED ON
    OUTPUT_NAME "PluginPresetCapture")

# Copy executable to project root
add_custom_command(TARGET PresetCaptureTool POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy 
    $<TARGET_FILE:PresetCaptureTool> 
    ${CMAKE_SOURCE_DIR}/PluginPresetCapture.exe
    COMMENT "Copying executable to project root")

message(STATUS "Build configured successfully for Plugin Preset Capture tool")