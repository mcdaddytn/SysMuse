#include <iostream>
#include <memory>
#include <vector>

//#include <JuceHeader.h>
#include <juce_core/juce_core.h>
#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_utils/juce_audio_utils.h>
#include <juce_data_structures/juce_data_structures.h>
#include <juce_events/juce_events.h>
#include <juce_graphics/juce_graphics.h>
#include <juce_gui_basics/juce_gui_basics.h>

//==============================================================================
struct PluginConfig
{
    juce::String pluginPath;
    juce::String pluginName;  // Optional: specify which plugin from a multi-plugin file
    juce::String presetPath;
    juce::var parameters;
};

struct ProcessingConfig
{
    juce::String inputFile;
    juce::String outputFile;
    std::vector<PluginConfig> plugins;
    double sampleRate = 44100.0;
    int bufferSize = 512;
};

//==============================================================================
class AudioPluginHost
{
public:
    AudioPluginHost() = default;
    ~AudioPluginHost() = default;

    bool loadConfiguration(const juce::String& configPath)
    {
        juce::File configFile(configPath);
        if (!configFile.existsAsFile())
        {
            std::cerr << "Configuration file not found: " << configPath << std::endl;
            return false;
        }

        auto jsonText = configFile.loadFileAsString();
        auto json = juce::JSON::parse(jsonText);

        if (!json.isObject())
        {
            std::cerr << "Invalid JSON configuration" << std::endl;
            return false;
        }

        return parseConfiguration(json);
    }

    bool processAudioFile()
    {
        // Load input audio file
        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();

        juce::File inputFile(config.inputFile);
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(inputFile));

        if (!reader)
        {
            std::cerr << "Could not read input file: " << config.inputFile << std::endl;
            return false;
        }

        // Setup audio buffer
        auto numChannels = static_cast<int>(reader->numChannels);
        auto numSamples = static_cast<int>(reader->lengthInSamples);

        juce::AudioBuffer<float> audioBuffer(numChannels, numSamples);
        reader->read(&audioBuffer, 0, numSamples, 0, true, true);

        // Initialize plugin chain
        if (!initializePlugins(reader->sampleRate, audioBuffer.getNumChannels()))
        {
            std::cerr << "Failed to initialize plugin chain" << std::endl;
            return false;
        }

        // Process audio through plugin chain
        processAudioBuffer(audioBuffer, reader->sampleRate);

        // Write output file
        return writeAudioFile(audioBuffer, reader->sampleRate, numChannels);
    }

private:
    ProcessingConfig config;
    std::vector<std::unique_ptr<juce::AudioPluginInstance>> pluginChain;
    juce::AudioPluginFormatManager pluginFormatManager;

    bool parseConfiguration(const juce::var& json)
    {
        config.inputFile = json["input_file"].toString();
        config.outputFile = json["output_file"].toString();
        config.sampleRate = json.getProperty("sample_rate", 44100.0);
        config.bufferSize = json.getProperty("buffer_size", 512);

        if (config.inputFile.isEmpty() || config.outputFile.isEmpty())
        {
            std::cerr << "Input and output file paths are required" << std::endl;
            return false;
        }

        auto pluginsArray = json["plugins"];
        if (!pluginsArray.isArray())
        {
            std::cerr << "Plugins array is required" << std::endl;
            return false;
        }

        for (int i = 0; i < pluginsArray.size(); ++i)
        {
            auto pluginJson = pluginsArray[i];
            PluginConfig pluginConfig;

            pluginConfig.pluginPath = pluginJson["path"].toString();
            pluginConfig.pluginName = pluginJson.getProperty("plugin_name", "");
            pluginConfig.presetPath = pluginJson.getProperty("preset", "");
            pluginConfig.parameters = pluginJson.getProperty("parameters", juce::var());

            if (pluginConfig.pluginPath.isEmpty())
            {
                std::cerr << "Plugin path is required for plugin " << i << std::endl;
                return false;
            }

            config.plugins.push_back(std::move(pluginConfig));
        }

        return true;
    }

    bool initializePlugins(double sampleRate, int numChannels)
    {
        pluginFormatManager.addDefaultFormats();

        std::cout << "Found " << pluginFormatManager.getFormats().size() << " plugin formats:" << std::endl;
        for (auto* format : pluginFormatManager.getFormats())
        {
            std::cout << "  - " << format->getName() << std::endl;
        }
        std::cout << std::endl;

        for (const auto& pluginConfig : config.plugins)
        {
            std::cout << "=== Loading Plugin ===" << std::endl;
            std::cout << "Plugin path: " << pluginConfig.pluginPath << std::endl;

            // Load plugin
            juce::File pluginFile(pluginConfig.pluginPath);
            if (!pluginFile.existsAsFile())
            {
                std::cerr << "Plugin file not found: " << pluginConfig.pluginPath << std::endl;
                return false;
            }

            std::cout << "Plugin file exists, size: " << pluginFile.getSize() << " bytes" << std::endl;

            // Find plugin descriptions - Fixed for JUCE 7.x API
            juce::OwnedArray<juce::PluginDescription> descriptions;
            bool pluginFound = false;

            std::cout << "Scanning plugin file for available plugins..." << std::endl;

            for (auto* format : pluginFormatManager.getFormats())
            {
                std::cout << "  Trying format: " << format->getName() << std::endl;
                format->findAllTypesForFile(descriptions, pluginConfig.pluginPath);
                if (descriptions.size() > 0)
                {
                    std::cout << "  Found " << descriptions.size() << " plugin(s) with " << format->getName() << std::endl;
                    pluginFound = true;
                    // Don't break here - let it find all plugins from all formats
                }
            }

            if (!pluginFound || descriptions.size() == 0)
            {
                std::cerr << "No valid plugin found in file: " << pluginConfig.pluginPath << std::endl;
                return false;
            }

            // List all found plugins
            std::cout << "\nFound plugins in file:" << std::endl;
            for (int i = 0; i < descriptions.size(); ++i)
            {
                auto& desc = *descriptions[i];
                std::cout << "  [" << i << "] " << desc.name << " (" << desc.manufacturerName << ")" << std::endl;
                std::cout << "      Category: " << desc.category << std::endl;
                std::cout << "      Plugin Type: " << desc.pluginFormatName << std::endl;
                std::cout << "      Version: " << desc.version << std::endl;
                std::cout << "      Unique ID: " << desc.createIdentifierString() << std::endl;
            }

            // Select which plugin to use
            juce::PluginDescription* selectedDescription = nullptr;

            if (!pluginConfig.pluginName.isEmpty())
            {
                // Look for plugin by name
                std::cout << "\nLooking for plugin named: " << pluginConfig.pluginName << std::endl;
                for (int i = 0; i < descriptions.size(); ++i)
                {
                    auto& desc = *descriptions[i];
                    if (desc.name.containsIgnoreCase(pluginConfig.pluginName))
                    {
                        selectedDescription = &desc;
                        std::cout << "Found matching plugin: " << desc.name << std::endl;
                        break;
                    }
                }

                if (!selectedDescription)
                {
                    std::cerr << "Could not find plugin named '" << pluginConfig.pluginName << "' in the file." << std::endl;
                    std::cerr << "Available plugins are listed above." << std::endl;
                    return false;
                }
            }
            else
            {
                // Use the first plugin
                selectedDescription = descriptions[0];
                std::cout << "\nNo plugin name specified, using first plugin: " << selectedDescription->name << std::endl;
            }

            std::cout << "Selected plugin: " << selectedDescription->name << std::endl;

            juce::String errorMessage;
            auto plugin = pluginFormatManager.createPluginInstance(*selectedDescription, sampleRate, config.bufferSize, errorMessage);

            if (!plugin)
            {
                std::cerr << "Failed to load plugin: " << pluginConfig.pluginPath
                         << "\nError: " << errorMessage << std::endl;
                return false;
            }

            std::cout << "Successfully created plugin instance!" << std::endl;
            std::cout << "Plugin info:" << std::endl;
            std::cout << "  Name: " << plugin->getName() << std::endl;
            std::cout << "  Inputs: " << plugin->getTotalNumInputChannels() << std::endl;
            std::cout << "  Outputs: " << plugin->getTotalNumOutputChannels() << std::endl;
            std::cout << "  Parameters: " << plugin->getParameters().size() << std::endl;

            // Configure plugin
            plugin->prepareToPlay(sampleRate, config.bufferSize);
            plugin->setPlayConfigDetails(numChannels, numChannels, sampleRate, config.bufferSize);

            // Load preset if specified
            if (!pluginConfig.presetPath.isEmpty())
            {
                std::cout << "Loading preset: " << pluginConfig.presetPath << std::endl;
                if (!loadPreset(plugin.get(), pluginConfig.presetPath))
                {
                    std::cerr << "Warning: Could not load preset: " << pluginConfig.presetPath << std::endl;
                }
                else
                {
                    std::cout << "Preset loaded successfully!" << std::endl;
                }
            }

            // Set parameters if specified
            if (pluginConfig.parameters.isObject())
            {
                std::cout << "Setting parameters..." << std::endl;
                setPluginParameters(plugin.get(), pluginConfig.parameters);
            }

            pluginChain.push_back(std::move(plugin));

            std::cout << "Plugin added to chain successfully!" << std::endl;
            std::cout << "=========================" << std::endl << std::endl;
        }

        std::cout << "Total plugins in chain: " << pluginChain.size() << std::endl;
        return true;
    }

    bool loadPreset(juce::AudioPluginInstance* plugin, const juce::String& presetPath)
    {
        juce::File presetFile(presetPath);
        if (!presetFile.existsAsFile())
            return false;

        // Try to load as VST3 preset
        if (presetPath.endsWithIgnoreCase(".vstpreset"))
        {
            juce::MemoryBlock presetData;
            if (presetFile.loadFileAsData(presetData))
            {
                plugin->setStateInformation(presetData.getData(), static_cast<int>(presetData.getSize()));
                return true;
            }
        }

        // Try to load as generic state
        auto presetText = presetFile.loadFileAsString();
        if (presetText.isNotEmpty())
        {
            juce::MemoryOutputStream stream;
            if (juce::Base64::convertFromBase64(stream, presetText))
            {
                plugin->setStateInformation(stream.getData(), static_cast<int>(stream.getDataSize()));
                return true;
            }
        }

        return false;
    }

    void setPluginParameters(juce::AudioPluginInstance* plugin, const juce::var& parameters)
    {
        if (!parameters.isObject())
            return;

        auto* paramObject = parameters.getDynamicObject();
        if (!paramObject)
            return;

        for (auto& prop : paramObject->getProperties())
        {
            auto paramName = prop.name.toString();
            auto paramValue = static_cast<float>(prop.value);

            // Find parameter by name using JUCE 7.x compatible API
            const auto& params = plugin->getParameters();
            for (int i = 0; i < params.size(); ++i)
            {
                if (params[i]->getName(256) == paramName)
                {
                    params[i]->setValue(paramValue);
                    std::cout << "Set parameter '" << paramName << "' to " << paramValue << std::endl;
                    break;
                }
            }
        }
    }

    void processAudioBuffer(juce::AudioBuffer<float>& buffer, double sampleRate)
    {
        auto numSamples = buffer.getNumSamples();
        auto blockSize = config.bufferSize;

        // Process in chunks
        for (int startSample = 0; startSample < numSamples; startSample += blockSize)
        {
            auto samplesToProcess = juce::jmin(blockSize, numSamples - startSample);

            // Create a view of the current block
            juce::AudioBuffer<float> blockBuffer(buffer.getArrayOfWritePointers(),
                                               buffer.getNumChannels(),
                                               startSample,
                                               samplesToProcess);

            // Process through each plugin in the chain
            for (auto& plugin : pluginChain)
            {
                juce::MidiBuffer midiBuffer;
                plugin->processBlock(blockBuffer, midiBuffer);
            }
        }

        std::cout << "Processed " << numSamples << " samples through "
                  << pluginChain.size() << " plugins" << std::endl;
    }

    bool writeAudioFile(const juce::AudioBuffer<float>& buffer, double sampleRate, int numChannels)
    {
        juce::File outputFile(config.outputFile);

        // Create output directory if it doesn't exist
        outputFile.getParentDirectory().createDirectory();

        // Setup audio format
        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();

        std::unique_ptr<juce::AudioFormat> format(formatManager.findFormatForFileExtension(outputFile.getFileExtension()));
        if (!format)
        {
            std::cerr << "Unsupported output format: " << outputFile.getFileExtension() << std::endl;
            return false;
        }

        // Create writer
        std::unique_ptr<juce::FileOutputStream> fileStream(outputFile.createOutputStream());
        if (!fileStream)
        {
            std::cerr << "Could not create output file: " << config.outputFile << std::endl;
            return false;
        }

        std::unique_ptr<juce::AudioFormatWriter> writer(format->createWriterFor(fileStream.get(),
                                                                              sampleRate,
                                                                              static_cast<unsigned int>(numChannels),
                                                                              24, // bit depth
                                                                              {},
                                                                              0));
        if (!writer)
        {
            std::cerr << "Could not create audio writer" << std::endl;
            return false;
        }

        fileStream.release(); // Writer now owns the stream

        // Write audio data
        writer->writeFromAudioSampleBuffer(buffer, 0, buffer.getNumSamples());
        writer->flush();

        std::cout << "Output written to: " << config.outputFile << std::endl;
        return true;
    }
};

//==============================================================================
// Simple function-based approach instead of application class
int main(int argc, char* argv[])
{
    // Initialize JUCE
    juce::initialiseJuce_GUI();

    if (argc < 2)
    {
        std::cout << "Usage: VSTPluginHost <config.json>" << std::endl;
        std::cout << "Example: VSTPluginHost processing_config.json" << std::endl;
        juce::shutdownJuce_GUI();
        return 1;
    }

    AudioPluginHost host;

    if (!host.loadConfiguration(juce::String(argv[1])))
    {
        std::cerr << "Failed to load configuration" << std::endl;
        juce::shutdownJuce_GUI();
        return 1;
    }

    std::cout << "Processing audio file..." << std::endl;

    bool success = host.processAudioFile();

    if (!success)
    {
        std::cerr << "Failed to process audio file" << std::endl;
        juce::shutdownJuce_GUI();
        return 1;
    }
    else
    {
        std::cout << "Processing completed successfully!" << std::endl;
    }

    juce::shutdownJuce_GUI();
    return 0;
}