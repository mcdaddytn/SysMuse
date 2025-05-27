#include "MainComponent.h"

//==============================================================================
MainComponent::MainComponent(const juce::String& path)
    : pluginPath(path)
{
    // Initialize format manager
    formatManager.addDefaultFormats();
    
    // Setup UI components
    addAndMakeVisible(titleLabel);
    titleLabel.setText("Plugin Preset Capture Tool", juce::dontSendNotification);
    titleLabel.setFont(juce::Font(20.0f, juce::Font::bold));
    titleLabel.setJustificationType(juce::Justification::centred);
    
    addAndMakeVisible(statusLabel);
    statusLabel.setText("Initializing...", juce::dontSendNotification);
    statusLabel.setJustificationType(juce::Justification::centred);
    
    addAndMakeVisible(openEditorButton);
    openEditorButton.setButtonText("Open Plugin Editor");
    openEditorButton.setEnabled(false);
    openEditorButton.onClick = [this]()
    {
        if (plugin && !editorOpen)
        {
            editorWindow = std::make_unique<PluginEditorWindow>(plugin.get());
            editorWindow->setVisible(true);
            editorOpen = true;
            openEditorButton.setEnabled(false);
            showStatus("Plugin editor opened. Close the editor window when done.", juce::Colours::blue);
        }
    };
    
    addAndMakeVisible(saveStateButton);
    saveStateButton.setButtonText("Save Current State");
    saveStateButton.setEnabled(false);
    saveStateButton.onClick = [this]()
    {
        if (plugin)
        {
            savePluginState();
        }
    };
    
    addAndMakeVisible(exitButton);
    exitButton.setButtonText("Exit (Auto-Save State)");
    exitButton.onClick = [this]()
    {
        if (plugin)
        {
            savePluginState();
        }
        juce::JUCEApplication::getInstance()->systemRequestedQuit();
    };
    
    // Set initial size
    setSize(500, 300);
    
    // Load the plugin
    if (loadPlugin(pluginPath))
    {
        showStatus("Plugin loaded successfully! Click 'Open Plugin Editor' to begin.", juce::Colours::green);
        openEditorButton.setEnabled(true);
        saveStateButton.setEnabled(true);
    }
    else
    {
        showStatus("Failed to load plugin: " + pluginPath, juce::Colours::red);
    }
    
    // Start timer to monitor editor window
    startTimer(500); // Check every 500ms
}

MainComponent::~MainComponent()
{
    stopTimer();
    editorWindow.reset();
    plugin.reset();
}

//==============================================================================
void MainComponent::paint(juce::Graphics& g)
{
    g.fillAll(getLookAndFeel().findColour(juce::ResizableWindow::backgroundColourId));
    
    g.setColour(juce::Colours::grey);
    g.drawRect(getLocalBounds(), 1);
}

void MainComponent::resized()
{
    auto area = getLocalBounds().reduced(20);
    
    titleLabel.setBounds(area.removeFromTop(40));
    area.removeFromTop(10);
    
    statusLabel.setBounds(area.removeFromTop(60));
    area.removeFromTop(20);
    
    auto buttonHeight = 40;
    auto buttonArea = area.removeFromTop(buttonHeight);
    openEditorButton.setBounds(buttonArea);
    
    area.removeFromTop(10);
    buttonArea = area.removeFromTop(buttonHeight);
    saveStateButton.setBounds(buttonArea);
    
    area.removeFromTop(20);
    buttonArea = area.removeFromTop(buttonHeight);
    exitButton.setBounds(buttonArea);
}

//==============================================================================
void MainComponent::timerCallback()
{
    // Check if editor window was closed
    if (editorOpen && (!editorWindow || !editorWindow->isVisible()))
    {
        editorOpen = false;
        editorWindow.reset();
        openEditorButton.setEnabled(true);
        
        showStatus("Editor closed. State has been modified. You can save it or open the editor again.", juce::Colours::orange);
    }
}

bool MainComponent::loadPlugin(const juce::String& path)
{
    showStatus("Loading plugin...", juce::Colours::blue);
    
    juce::File pluginFile(path);
    if (!pluginFile.exists())
    {
        showStatus("Plugin file not found: " + path, juce::Colours::red);
        return false;
    }
    
    // Find plugin descriptions
    juce::OwnedArray<juce::PluginDescription> descriptions;
    bool found = false;
    
    for (auto* format : formatManager.getFormats())
    {
        descriptions.clear();
        
        try
        {
            format->findAllTypesForFile(descriptions, path);
            if (descriptions.size() > 0)
            {
                found = true;
                break;
            }
        }
        catch (...)
        {
            continue;
        }
    }
    
    if (!found || descriptions.size() == 0)
    {
        showStatus("No valid plugin found in file", juce::Colours::red);
        return false;
    }
    
    // Use first available plugin
    auto* desc = descriptions[0];
    
    juce::String errorMessage;
    plugin = formatManager.createPluginInstance(*desc, 44100.0, 512, errorMessage);
    
    if (!plugin)
    {
        showStatus("Failed to create plugin: " + errorMessage, juce::Colours::red);
        return false;
    }
    
    // Configure plugin
    plugin->prepareToPlay(44100.0, 512);
    plugin->setPlayConfigDetails(desc->isInstrument ? 0 : 2, 2, 44100.0, 512);
    
    // Save initial state
    plugin->getStateInformation(initialState);
    
    std::cout << "Plugin loaded successfully:" << std::endl;
    std::cout << "  Name: " << plugin->getName() << std::endl;
    std::cout << "  Manufacturer: " << desc->manufacturerName << std::endl;
    std::cout << "  Is Instrument: " << (desc->isInstrument ? "Yes" : "No") << std::endl;
    std::cout << "  Has Editor: " << (plugin->hasEditor() ? "Yes" : "No") << std::endl;
    std::cout << "  Parameters: " << plugin->getParameters().size() << std::endl;
    std::cout << "  Programs: " << plugin->getNumPrograms() << std::endl;
    std::cout << "  Initial state size: " << initialState.getSize() << " bytes" << std::endl;
    
    pluginLoaded = true;
    return true;
}

void MainComponent::savePluginState()
{
    if (!plugin)
        return;
        
    showStatus("Saving plugin state...", juce::Colours::blue);
    
    juce::MemoryBlock currentState;
    plugin->getStateInformation(currentState);
    
    // Generate filename based on plugin name and timestamp
    auto pluginName = plugin->getName().replace(" ", "_").retainCharacters("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_");
    auto timestamp = juce::Time::getCurrentTime().formatted("%Y%m%d_%H%M%S");
    auto filename = pluginName + "_" + timestamp;
    
    // Save to multiple locations for convenience
    juce::Array<juce::File> saveLocations;
    
    // Current directory
    saveLocations.add(juce::File::getCurrentWorkingDirectory().getChildFile(filename + ".bin"));
    
    // Desktop (if available)
    auto desktop = juce::File::getSpecialLocation(juce::File::userDesktopDirectory);
    if (desktop.exists())
    {
        saveLocations.add(desktop.getChildFile(filename + ".bin"));
    }
    
    // Temp directory
    saveLocations.add(juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile(filename + ".bin"));
    
    int savedCount = 0;
    juce::String savedPaths;
    
    for (auto& file : saveLocations)
    {
        if (file.replaceWithData(currentState.getData(), currentState.getSize()))
        {
            savedCount++;
            savedPaths += "  " + file.getFullPathName() + "\n";
            
            // Also save hex dump for analysis
            auto hexDump = createHexDump(currentState);
            auto hexFile = file.withFileExtension(".hex");
            hexFile.replaceWithText(hexDump);
            
            // Save base64 for easy transfer
            auto base64 = currentState.toBase64Encoding();
            auto base64File = file.withFileExtension(".base64");
            base64File.replaceWithText(base64);
        }
    }
    
    if (savedCount > 0)
    {
        showStatus("State saved successfully to " + juce::String(savedCount) + " location(s)", juce::Colours::green);
        
        std::cout << "\n=== PLUGIN STATE SAVED ===" << std::endl;
        std::cout << "Plugin: " << plugin->getName() << std::endl;
        std::cout << "State size: " << currentState.getSize() << " bytes" << std::endl;
        std::cout << "Saved to:" << std::endl;
        std::cout << savedPaths << std::endl;
        
        // Compare with initial state
        if (currentState.getSize() != initialState.getSize() || 
            memcmp(currentState.getData(), initialState.getData(), currentState.getSize()) != 0)
        {
            std::cout << "State has changed from initial load - preset/parameter changes detected!" << std::endl;
        }
        else
        {
            std::cout << "State is identical to initial load - no changes detected." << std::endl;
        }
        std::cout << "==========================" << std::endl;
    }
    else
    {
        showStatus("Failed to save state to any location", juce::Colours::red);
    }
}

juce::String MainComponent::createHexDump(const juce::MemoryBlock& data)
{
    juce::String result;
    const uint8_t* bytes = static_cast<const uint8_t*>(data.getData());
    size_t size = data.getSize();
    
    result << "Plugin State Hex Dump\n";
    result << "Plugin: " << (plugin ? plugin->getName() : "Unknown") << "\n";
    result << "Size: " << size << " bytes\n";
    result << "Timestamp: " << juce::Time::getCurrentTime().toString(true, true) << "\n\n";
    
    result << "Offset   00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F  ASCII\n";
    result << "------   -----------------------------------------------  ----------------\n";
    
    for (size_t i = 0; i < size; i += 16)
    {
        result << juce::String::formatted("%06X:  ", (unsigned int)i);
        
        // Hex bytes
        for (size_t j = 0; j < 16; ++j)
        {
            if (i + j < size)
            {
                result << juce::String::formatted("%02X ", bytes[i + j]);
            }
            else
            {
                result << "   ";
            }
        }
        
        result << " ";
        
        // ASCII representation
        for (size_t j = 0; j < 16 && i + j < size; ++j)
        {
            uint8_t byte = bytes[i + j];
            if (byte >= 32 && byte <= 126)
            {
                result << static_cast<char>(byte);
            }
            else
            {
                result << ".";
            }
        }
        
        result << "\n";
    }
    
    return result;
}

void MainComponent::showStatus(const juce::String& message, juce::Colour colour)
{
    statusLabel.setText(message, juce::dontSendNotification);
    statusLabel.setColour(juce::Label::textColourId, colour);
    std::cout << "[STATUS] " << message << std::endl;
}