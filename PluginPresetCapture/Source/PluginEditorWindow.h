#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>

//==============================================================================
class PluginEditorWindow : public juce::DocumentWindow
{
public:
    PluginEditorWindow(juce::AudioPluginInstance* plugin);
    ~PluginEditorWindow() override;

    void closeButtonPressed() override;

private:
    juce::AudioPluginInstance* plugin;
    std::unique_ptr<juce::AudioProcessorEditor> editor;
    
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PluginEditorWindow)
};