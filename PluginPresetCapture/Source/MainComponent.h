#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>
#include <juce_gui_extra/juce_gui_extra.h>

#include "PluginEditorWindow.h"

//==============================================================================
class MainComponent : public juce::Component,
                     private juce::Timer
{
public:
    MainComponent(const juce::String& pluginPath);
    ~MainComponent() override;

    //==============================================================================
    void paint(juce::Graphics&) override;
    void resized() override;

private:
    //==============================================================================
    void timerCallback() override;
    bool loadPlugin(const juce::String& pluginPath);
    void savePluginState();
    juce::String createHexDump(const juce::MemoryBlock& data);
    void showStatus(const juce::String& message, juce::Colour colour = juce::Colours::black);

    //==============================================================================
    juce::AudioPluginFormatManager formatManager;
    std::unique_ptr<juce::AudioPluginInstance> plugin;
    std::unique_ptr<PluginEditorWindow> editorWindow;
    
    // UI Components
    juce::Label titleLabel;
    juce::Label statusLabel;
    juce::TextButton openEditorButton;
    juce::TextButton saveStateButton;
    juce::TextButton exitButton;
    
    // Status tracking
    juce::String pluginPath;
    bool pluginLoaded = false;
    bool editorOpen = false;
    juce::MemoryBlock initialState;
    
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MainComponent)
};