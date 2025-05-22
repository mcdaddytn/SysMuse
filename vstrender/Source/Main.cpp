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

        for (const auto& pluginConfig : config.plugins)
        {
            // Load plugin
            juce::File pluginFile(pluginConfig.pluginPath);
            if (!pluginFile.existsAsFile())
            {
                std::cerr << "Plugin file not found: " << pluginConfig.pluginPath << std::endl;
                return false;
            }

            juce::PluginDescription description;
            for (auto* format : pluginFormatManager.getFormats())
            {
                if (format->findAllTypesForFile(description, pluginConfig.pluginPath))
                    break;
            }

            juce::String errorMessage;
            auto plugin = pluginFormatManager.createPluginInstance(description, sampleRate, config.bufferSize, errorMessage);

            if (!plugin)
            {
                std::cerr << "Failed to load plugin: " << pluginConfig.pluginPath
                         << " Error: " << errorMessage << std::endl;
                return false;
            }

            // Configure plugin
            plugin->prepareToPlay(sampleRate, config.bufferSize);
            plugin->setPlayConfigDetails(numChannels, numChannels, sampleRate, config.bufferSize);

            // Load preset if specified
            if (!pluginConfig.presetPath.isEmpty())
            {
                if (!loadPreset(plugin.get(), pluginConfig.presetPath))
                {
                    std::cerr << "Warning: Could not load preset: " << pluginConfig.presetPath << std::endl;
                }
            }

            // Set parameters if specified
            if (pluginConfig.parameters.isObject())
            {
                setPluginParameters(plugin.get(), pluginConfig.parameters);
            }

            pluginChain.push_back(std::move(plugin));

            std::cout << "Loaded plugin: " << description.name << std::endl;
        }

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

            // Find parameter by name
            for (auto* param : plugin->getParameters())
            {
                if (param->getName(256) == paramName)
                {
                    param->setValue(paramValue);
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
class ConsoleApplication : public juce::JUCEApplicationBase
{
public:
    const juce::String getApplicationName() override { return "VST Plugin Host"; }
    const juce::String getApplicationVersion() override { return "1.0.0"; }

    void initialise(const juce::String& commandLine) override
    {
        auto args = getCommandLineParameterArray();

        if (args.size() < 1)
        {
            std::cout << "Usage: " << getApplicationName() << " <config.json>" << std::endl;
            std::cout << "Example: " << getApplicationName() << " processing_config.json" << std::endl;
            quit();
            return;
        }

        AudioPluginHost host;

        if (!host.loadConfiguration(args[0]))
        {
            std::cerr << "Failed to load configuration" << std::endl;
            setApplicationReturnValue(1);
            quit();
            return;
        }

        std::cout << "Processing audio file..." << std::endl;

        if (!host.processAudioFile())
        {
            std::cerr << "Failed to process audio file" << std::endl;
            setApplicationReturnValue(1);
        }
        else
        {
            std::cout << "Processing completed successfully!" << std::endl;
        }

        quit();
    }

    void shutdown() override {}
};

//==============================================================================
START_JUCE_APPLICATION(ConsoleApplication)