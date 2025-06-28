#include "PluginEditorWindow.h"

//==============================================================================
PluginEditorWindow::PluginEditorWindow(juce::AudioPluginInstance* p)
    : DocumentWindow("Plugin Editor - " + (p ? p->getName() : "Unknown"),
                    juce::Desktop::getInstance().getDefaultLookAndFeel()
                                               .findColour(juce::ResizableWindow::backgroundColourId),
                    DocumentWindow::allButtons),
      plugin(p)
{
    if (plugin && plugin->hasEditor())
    {
        editor.reset(plugin->createEditor());
        
        if (editor)
        {
            setContentOwned(editor.release(), true);
            setUsingNativeTitleBar(true);
            setResizable(true, false);
            
            // Center the window and size appropriately
            auto bounds = getContentComponent()->getBounds();
            centreWithSize(bounds.getWidth(), bounds.getHeight());
            
            std::cout << "Plugin editor opened:" << std::endl;
            std::cout << "  Plugin: " << plugin->getName() << std::endl;
            std::cout << "  Editor size: " << bounds.getWidth() << "x" << bounds.getHeight() << std::endl;
            std::cout << "  Use the plugin's interface to load presets or adjust parameters." << std::endl;
            std::cout << "  Close this window when finished to save the current state." << std::endl;
        }
        else
        {
            // Plugin claims to have editor but creation failed
            auto* label = new juce::Label();
            label->setText("Plugin editor creation failed", juce::dontSendNotification);
            label->setJustificationType(juce::Justification::centred);
            setContentOwned(label, true);
            centreWithSize(300, 100);
            
            std::cout << "Warning: Plugin editor creation failed" << std::endl;
        }
    }
    else
    {
        // Plugin has no editor - show message
        auto* label = new juce::Label();
        label->setText("This plugin has no graphical interface.\nUse parameter control instead.", juce::dontSendNotification);
        label->setJustificationType(juce::Justification::centred);
        setContentOwned(label, true);
        centreWithSize(300, 100);
        
        std::cout << "Note: Plugin has no graphical editor interface" << std::endl;
    }
}

PluginEditorWindow::~PluginEditorWindow()
{
    if (editor)
    {
        editor.reset();
    }
    
    std::cout << "Plugin editor window closed" << std::endl;
}

void PluginEditorWindow::closeButtonPressed()
{
    std::cout << "User closed plugin editor window - state will be captured" << std::endl;
    setVisible(false);
}