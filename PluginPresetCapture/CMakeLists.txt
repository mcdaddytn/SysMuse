cmake_minimum_required(VERSION 3.22)

project(PluginPresetCapture VERSION 1.0.0)

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

# Add JUCE as subdirectory
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/JUCE/CMakeLists.txt")
    message(STATUS "Found JUCE at: ${CMAKE_CURRENT_SOURCE_DIR}/JUCE")
    add_subdirectory(JUCE)
else()
    message(FATAL_ERROR "JUCE not found! Please ensure JUCE is linked or copied to the JUCE subdirectory.")
endif()

# Create the GUI application
juce_add_gui_app(PluginPresetCapture
    PRODUCT_NAME "Plugin Preset Capture"
    COMPANY_NAME "AudioTools"
    VERSION "1.0.0"
    DESCRIPTION "Interactive plugin preset capture tool"
    ICON_BIG ""
    ICON_SMALL "")

# Add source files
target_sources(PluginPresetCapture PRIVATE
    Source/Main.cpp
    Source/MainComponent.cpp
    Source/MainComponent.h
    Source/PluginEditorWindow.cpp
    Source/PluginEditorWindow.h)

# Set include directories
target_include_directories(PluginPresetCapture PRIVATE
    Source)

# Link against JUCE modules - including GUI modules
target_link_libraries(PluginPresetCapture PRIVATE
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

# Enable VST3 support and disable others
target_compile_definitions(PluginPresetCapture PRIVATE
    # VST3 support
    JUCE_PLUGINHOST_VST3=1
    
    # Disable other plugin formats for simplicity
    JUCE_PLUGINHOST_VST=0
    JUCE_PLUGINHOST_AU=0
    JUCE_PLUGINHOST_LADSPA=0
    
    # Disable web features we don't need
    JUCE_USE_CURL=0
    JUCE_WEB_BROWSER=0
    
    # GUI app specific
    JUCE_DISPLAY_SPLASH_SCREEN=0
    JUCE_USE_DARK_SPLASH_SCREEN=0
    
    # Windows specific optimizations
    JUCE_WASAPI=1
    JUCE_DIRECTSOUND=1)

# Set target properties
set_target_properties(PluginPresetCapture PROPERTIES
    CXX_STANDARD 17
    CXX_STANDARD_REQUIRED ON)

# Windows-specific linker settings
if(WIN32)
    target_link_libraries(PluginPresetCapture PRIVATE
        winmm
        ole32
        oleaut32
        imm32
        comdlg32
        shlwapi
        rpcrt4
        wininet)
endif()

# Copy executable to project root for easier access
add_custom_command(TARGET PluginPresetCapture POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy $<TARGET_FILE:PluginPresetCapture> ${CMAKE_SOURCE_DIR}/PluginPresetCapture.exe
    COMMENT "Copying executable to project root")

# Print build information
message(STATUS "")
message(STATUS "=== Plugin Preset Capture Build Configuration ===")
message(STATUS "Build type: ${CMAKE_BUILD_TYPE}")
message(STATUS "Compiler: ${CMAKE_CXX_COMPILER}")
message(STATUS "C++ Standard: ${CMAKE_CXX_STANDARD}")
message(STATUS "Target architecture: ${CMAKE_GENERATOR_PLATFORM}")
if(WIN32)
    message(STATUS "Windows SDK: ${CMAKE_VS_WINDOWS_TARGET_PLATFORM_VERSION}")
endif()
message(STATUS "JUCE path: ${CMAKE_CURRENT_SOURCE_DIR}/JUCE")
message(STATUS "================================================")
message(STATUS "")