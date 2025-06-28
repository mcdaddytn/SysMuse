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
        std::cout << "=== Plugin Preset Capture Tool Started ===" << std::endl;
        std::cout << "Raw command line: [" << commandLine << "]" << std::endl;

        // Parse command line arguments more carefully
        juce::StringArray args;

        if (commandLine.isNotEmpty())
        {
            // Try different parsing methods

            // Method 1: JUCE's built-in parsing
            args = juce::StringArray::fromTokens(commandLine, true);
            std::cout << "Method 1 - JUCE tokens (" << args.size() << " args):" << std::endl;
            for (int i = 0; i < args.size(); ++i)
            {
                std::cout << "  [" << i << "] = [" << args[i] << "]" << std::endl;
            }

            // Method 2: If Method 1 gives us empty or wrong results, try manual parsing
            if (args.size() == 0 || (args.size() == 1 && args[0].trim().isEmpty()))
            {
                std::cout << "Method 1 failed, trying Method 2 - manual parsing" << std::endl;

                // Remove surrounding quotes if present
                juce::String cleaned = commandLine.trim();
                if (cleaned.startsWith("\"") && cleaned.endsWithIgnoreCase("\""))
                {
                    cleaned = cleaned.substring(1, cleaned.length() - 1);
                }

                args.clear();
                args.add(cleaned);

                std::cout << "Method 2 result: [" << cleaned << "]" << std::endl;
            }

            // Method 3: If we still don't have a good result, try splitting on quotes
            if (args.size() == 0 || args[0].trim().isEmpty())
            {
                std::cout << "Method 2 failed, trying Method 3 - quote splitting" << std::endl;

                args = juce::StringArray::fromTokens(commandLine, "\"", "");
                args.removeEmptyStrings();
                args.trim();

                std::cout << "Method 3 - Quote split (" << args.size() << " args):" << std::endl;
                for (int i = 0; i < args.size(); ++i)
                {
                    std::cout << "  [" << i << "] = [" << args[i] << "]" << std::endl;
                }
            }
        }

        // Validate we have at least one argument
        if (args.size() < 1 || args[0].trim().isEmpty())
        {
            showUsageAndExit();
            return;
        }

        juce::String pluginPath = args[0].trim();

        // Additional path cleaning
        std::cout << "Final plugin path: [" << pluginPath << "]" << std::endl;

        // Test if the file exists before proceeding
        juce::File testFile(pluginPath);
        std::cout << "File exists check: " << (testFile.exists() ? "YES" : "NO") << std::endl;
        if (testFile.exists())
        {
            std::cout << "File size: " << testFile.getSize() << " bytes" << std::endl;
            std::cout << "Full path: " << testFile.getFullPathName() << std::endl;
        }

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