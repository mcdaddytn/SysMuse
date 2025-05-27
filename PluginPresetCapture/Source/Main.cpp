#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>
#include <juce_gui_extra/juce_gui_extra.h>

#include "MainComponent.h"
#include "ProjectInfo.h"

//==============================================================================
class PluginPresetCaptureApplication : public juce::JUCEApplication
{
public:
    //==============================================================================
    PluginPresetCaptureApplication() {}

    const juce::String getApplicationName() override       { return ProjectInfo::projectName; }
    const juce::String getApplicationVersion() override    { return ProjectInfo::versionString; }
    bool moreThanOneInstanceAllowed() override             { return true; }

    //==============================================================================
    void initialise(const juce::String& commandLine) override
    {
        // Parse command line arguments
        juce::StringArray args = juce::StringArray::fromTokens(commandLine, true);

        if (args.size() < 1)
        {
            showUsageAndExit();
            return;
        }

        juce::String pluginPath = args[0];

        // Create main window
        mainWindow.reset(new MainWindow(getApplicationName(), pluginPath));
    }

    void shutdown() override
    {
        mainWindow = nullptr;
    }

    //==============================================================================
    void systemRequestedQuit() override
    {
        quit();
    }

    void anotherInstanceStarted(const juce::String& commandLine) override
    {
        // Handle multiple instances if needed
    }

    //==============================================================================
    class MainWindow : public juce::DocumentWindow
    {
    public:
        MainWindow(juce::String name, const juce::String& pluginPath)
            : DocumentWindow(name,
                           juce::Desktop::getInstance().getDefaultLookAndFeel()
                                                      .findColour(juce::ResizableWindow::backgroundColourId),
                           DocumentWindow::allButtons)
        {
            setUsingNativeTitleBar(true);
            setContentOwned(new MainComponent(pluginPath), true);

#if JUCE_IOS || JUCE_ANDROID
            setFullScreen(true);
#else
            setResizable(true, true);
            centreWithSize(getWidth(), getHeight());
#endif

            setVisible(true);
        }

        void closeButtonPressed() override
        {
            JUCEApplication::getInstance()->systemRequestedQuit();
        }

    private:
        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MainWindow)
    };

private:
    std::unique_ptr<MainWindow> mainWindow;

    void showUsageAndExit()
    {
        std::cout << "Plugin Preset Capture Tool" << std::endl;
        std::cout << "Usage: PluginPresetCapture <plugin_path>" << std::endl;
        std::cout << std::endl;
        std::cout << "Examples:" << std::endl;
        std::cout << "  PluginPresetCapture \"/Library/Audio/Plug-Ins/VST3/Pianoteq 7.vst3\"" << std::endl;
        std::cout << "  PluginPresetCapture \"C:\\Program Files\\Common Files\\VST3\\Dexed.vst3\"" << std::endl;
        std::cout << std::endl;
        std::cout << "The plugin's GUI will open, allowing you to:" << std::endl;
        std::cout << "  - Load presets using the plugin's interface" << std::endl;
        std::cout << "  - Adjust parameters as needed" << std::endl;
        std::cout << "  - Close the window to automatically save the state" << std::endl;

        quit();
    }
};

//==============================================================================
START_JUCE_APPLICATION(PluginPresetCaptureApplication)