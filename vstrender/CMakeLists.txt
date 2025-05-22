cmake_minimum_required(VERSION 3.22)

project(VSTPluginHost VERSION 1.0.0)

# Set C++ standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find JUCE
find_package(PkgConfig REQUIRED)

# Add JUCE as subdirectory (assumes JUCE is in a subdirectory called JUCE)
# You can clone JUCE from: https://github.com/juce-framework/JUCE
add_subdirectory(JUCE)

# Create the executable
juce_add_console_app(VSTPluginHost
    PRODUCT_NAME "VST Plugin Host"
    COMPANY_NAME "AudioTools"
    VERSION "1.0.0")

# Add source files
target_sources(VSTPluginHost PRIVATE
    Source/Main.cpp)

# Link against JUCE modules
target_link_libraries(VSTPluginHost PRIVATE
    juce::juce_core
    juce::juce_audio_basics
    juce::juce_audio_devices
    juce::juce_audio_formats
    juce::juce_audio_processors
    juce::juce_audio_utils
    juce::juce_data_structures
    juce::juce_events
    juce::juce_graphics
    juce::juce_gui_basics)

# Enable VST3 support
target_compile_definitions(VSTPluginHost PRIVATE
    JUCE_PLUGINHOST_VST3=1
    JUCE_PLUGINHOST_AU=0
    JUCE_PLUGINHOST_LADSPA=0
    JUCE_USE_CURL=0
    JUCE_WEB_BROWSER=0)

# Set target properties
set_target_properties(VSTPluginHost PROPERTIES
    CXX_STANDARD 17
    CXX_STANDARD_REQUIRED ON)

# Platform-specific settings
if(APPLE)
    target_compile_definitions(VSTPluginHost PRIVATE
        JUCE_PLUGINHOST_AU=1)
endif()

# Copy to build directory for easy access
if(WIN32)
    set(EXECUTABLE_OUTPUT_PATH ${CMAKE_BINARY_DIR})
endif()