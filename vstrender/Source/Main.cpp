#include <memory>
#include <vector>
#include <map>
#include <iomanip>
#include <cstdlib>
#include <csignal>

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
// Debug and safety utilities
//==============================================================================

void safeLog(const char* message) {
    try {
        std::cout << "[DEBUG] " << message << std::endl;
        std::cout.flush();
    } catch (...) {
        std::cerr << "[DEBUG] " << message << std::endl;
    }
}

// Forward declaration
class AudioPluginHost;
static AudioPluginHost* g_hostInstance = nullptr;

void crashHandler(int sig) {
    std::cout << "\n[CRASH HANDLER] Caught signal " << sig << std::endl;
    std::cout << "[CRASH HANDLER] Attempting emergency exit..." << std::endl;
    std::exit(0);
}

//==============================================================================
// Parameter enumeration and management utilities
//==============================================================================

struct ParameterInfo
{
    int index;
    juce::String name;
    juce::String label;
    juce::String text;
    float value;
    float defaultValue;
    int numSteps;
    bool isDiscrete;
    bool isBoolean;
    bool isMetaParameter;
    juce::String category;

    void print() const
    {
        std::cout << "  [" << std::setw(3) << index << "] "
                  << std::setw(35) << std::left << name.toStdString()
                  << " = " << std::setw(8) << std::fixed << std::setprecision(4) << value;

        if (!text.isEmpty() && text != juce::String(value))
        {
            std::cout << " (\"" << text << "\")";
        }

        if (isDiscrete && numSteps > 0)
        {
            std::cout << " [discrete: " << numSteps << " steps]";
        }

        if (isBoolean)
        {
            std::cout << " [boolean]";
        }

        if (!label.isEmpty())
        {
            std::cout << " {" << label << "}";
        }

        std::cout << std::endl;
    }
};

class PluginParameterManager
{
public:
    static std::vector<ParameterInfo> enumerateParameters(juce::AudioPluginInstance* plugin)
    {
        std::vector<ParameterInfo> parameters;

        if (!plugin)
            return parameters;

        const auto& params = plugin->getParameters();

        std::cout << "\n=== PARAMETER ENUMERATION ===" << std::endl;
        std::cout << "Plugin: " << plugin->getName() << std::endl;
        std::cout << "Total parameters: " << params.size() << std::endl;
        std::cout << "Programs available: " << plugin->getNumPrograms() << std::endl;

        if (plugin->getNumPrograms() > 0)
        {
            std::cout << "Current program: " << plugin->getCurrentProgram()
                      << " (\"" << plugin->getProgramName(plugin->getCurrentProgram()) << "\")" << std::endl;
        }

        std::cout << "\nParameter List:" << std::endl;
        std::cout << "Index Name                               Value    Text/Label" << std::endl;
        std::cout << "----- ---------------------------------- -------- -----------" << std::endl;

        for (int i = 0; i < params.size(); ++i)
        {
            auto* param = params[i];
            ParameterInfo info;

            info.index = i;
            info.name = param->getName(256);
            info.label = param->getLabel();
            info.value = param->getValue();
            info.defaultValue = param->getDefaultValue();
            info.text = param->getText(param->getValue(), 256);
            info.numSteps = param->getNumSteps();
            info.isDiscrete = (info.numSteps > 0 && info.numSteps < 1000);
            info.isBoolean = param->isBoolean();
            info.isMetaParameter = param->isMetaParameter();
			info.category = "Unknown";
            // Convert category enum to string
            /*
            auto category = param->getCategory();
            switch (category)
            {
                case juce::AudioProcessorParameter::genericParameter:
                    info.category = "Generic";
                    break;
                case juce::AudioProcessorParameter::inputGain:
                    info.category = "Input Gain";
                    break;
                case juce::AudioProcessorParameter::outputGain:
                    info.category = "Output Gain";
                    break;
                case juce::AudioProcessorParameter::inputMeter:
                    info.category = "Input Meter";
                    break;
                case juce::AudioProcessorParameter::outputMeter:
                    info.category = "Output Meter";
                    break;
                case juce::AudioProcessorParameter::compressorLimiterGateExpander:
                    info.category = "Compressor/Limiter/Gate/Expander";
                    break;
                case juce::AudioProcessorParameter::colour:
                    info.category = "Colour";
                    break;
                case juce::AudioProcessorParameter::otherParameter:
                    info.category = "Other";
                    break;
                default:
                    info.category = "Unknown";
                    break;
            }
            */

            info.print();
            parameters.push_back(info);
        }

        // Look for common program/preset parameters
        std::cout << "\n=== PRESET/PROGRAM PARAMETERS ===" << std::endl;
        findPresetParameters(parameters);

        std::cout << "===========================" << std::endl;

        return parameters;
    }

    static void findPresetParameters(const std::vector<ParameterInfo>& parameters)
    {
        std::vector<std::string> presetKeywords = {
            "program", "preset", "patch", "bank", "sound", "voice",
            "Program", "Preset", "Patch", "Bank", "Sound", "Voice",
            // Pianoteq-specific keywords
            "instrument", "piano", "model", "type", "variant", "style"
        };

        std::cout << "Looking for preset/program-related parameters:" << std::endl;

        bool foundAny = false;
        for (const auto& param : parameters)
        {
            for (const auto& keyword : presetKeywords)
            {
                if (param.name.contains(juce::String(keyword)))
                {
                    std::cout << "  *** PRESET PARAM: [" << param.index << "] "
                              << param.name << " = " << param.value
                              << " (\"" << param.text << "\")";

                    if (param.isDiscrete)
                    {
                        std::cout << " [" << param.numSteps << " options]";
                    }
                    std::cout << std::endl;
                    foundAny = true;
                    break;
                }
            }
        }

        // Look for discrete parameters that might be instrument selectors
        std::cout << "\nDiscrete parameters that might control instruments/sounds:" << std::endl;
        for (const auto& param : parameters)
        {
            if (param.isDiscrete && param.numSteps > 1 && param.numSteps < 100 &&
                !param.name.startsWith("MIDI CC"))
            {
                // Skip obvious non-instrument parameters
                juce::String lowerName = param.name.toLowerCase();
                if (!lowerName.contains("volume") && !lowerName.contains("gain") &&
                    !lowerName.contains("mix") && !lowerName.contains("level") &&
                    !lowerName.contains("delay") && !lowerName.contains("reverb") &&
                    !lowerName.contains("bypass"))
                {
                    std::cout << "  [" << param.index << "] " << param.name
                              << " = " << param.value << " (\"" << param.text << "\") "
                              << "[" << param.numSteps << " options]" << std::endl;
                    foundAny = true;
                }
            }
        }

        if (!foundAny)
        {
            std::cout << "  No obvious preset/program parameters found." << std::endl;
            std::cout << "  Try looking for parameters with discrete values or specific names." << std::endl;
            std::cout << "  For Pianoteq, the instrument selection might be handled via .fxp presets" << std::endl;
            std::cout << "  or through the plugin's internal preset system rather than parameters." << std::endl;
        }
    }

    static bool exportParametersToJson(juce::AudioPluginInstance* plugin, const juce::String& filePath)
    {
        if (!plugin)
            return false;

        auto parameters = enumerateParameters(plugin);

        juce::var jsonRoot = juce::var(new juce::DynamicObject());
        auto* rootObject = jsonRoot.getDynamicObject();

        rootObject->setProperty("plugin_name", plugin->getName());
        rootObject->setProperty("plugin_description", plugin->getPluginDescription().descriptiveName);
        rootObject->setProperty("total_parameters", static_cast<int>(parameters.size()));
        rootObject->setProperty("num_programs", plugin->getNumPrograms());

        if (plugin->getNumPrograms() > 0)
        {
            rootObject->setProperty("current_program", plugin->getCurrentProgram());
            rootObject->setProperty("current_program_name", plugin->getProgramName(plugin->getCurrentProgram()));

            // Export all program names
            juce::var programsArray = juce::var(juce::Array<juce::var>());
            for (int i = 0; i < plugin->getNumPrograms(); ++i)
            {
                juce::var program = juce::var(new juce::DynamicObject());
                program.getDynamicObject()->setProperty("index", i);
                program.getDynamicObject()->setProperty("name", plugin->getProgramName(i));
                programsArray.append(program);
            }
            rootObject->setProperty("programs", programsArray);
        }

        // Export parameters
        juce::var parametersArray = juce::var(juce::Array<juce::var>());
        for (const auto& param : parameters)
        {
            juce::var paramObj = juce::var(new juce::DynamicObject());
            auto* paramDynObj = paramObj.getDynamicObject();

            paramDynObj->setProperty("index", param.index);
            paramDynObj->setProperty("name", param.name);
            paramDynObj->setProperty("value", param.value);
            paramDynObj->setProperty("text", param.text);
            paramDynObj->setProperty("default_value", param.defaultValue);
            paramDynObj->setProperty("label", param.label);
            paramDynObj->setProperty("num_steps", param.numSteps);
            paramDynObj->setProperty("is_discrete", param.isDiscrete);
            paramDynObj->setProperty("is_boolean", param.isBoolean);
            paramDynObj->setProperty("is_meta_parameter", param.isMetaParameter);
            paramDynObj->setProperty("category", param.category);

            parametersArray.append(paramObj);
        }
        rootObject->setProperty("parameters", parametersArray);

        // Write to file
        juce::File outputFile(filePath);
        outputFile.getParentDirectory().createDirectory();

        juce::FileOutputStream fileStream(outputFile);
        if (!fileStream.openedOk())
        {
            std::cerr << "Could not create parameter export file: " << filePath << std::endl;
            return false;
        }

        juce::JSON::writeToStream(fileStream, jsonRoot, true);

        std::cout << "Parameters exported to: " << filePath << std::endl;
        return true;
    }

    static void monitorProgramChanges(juce::AudioPluginInstance* plugin)
    {
        if (plugin->getNumPrograms() > 0)
        {
            std::cout << "\n=== PROGRAM INFORMATION ===" << std::endl;
            std::cout << "Available programs: " << plugin->getNumPrograms() << std::endl;
            std::cout << "Current program: " << plugin->getCurrentProgram()
                      << " (\"" << plugin->getProgramName(plugin->getCurrentProgram()) << "\")" << std::endl;

            std::cout << "\nAll available programs:" << std::endl;
            for (int i = 0; i < std::min(20, plugin->getNumPrograms()); ++i)
            {
                std::cout << "  [" << std::setw(3) << i << "] " << plugin->getProgramName(i) << std::endl;
            }

            if (plugin->getNumPrograms() > 20)
            {
                std::cout << "  ... and " << (plugin->getNumPrograms() - 20) << " more programs" << std::endl;
            }
            std::cout << "=========================" << std::endl;
        }
    }
};

//==============================================================================
// Configuration structures
//==============================================================================

struct PluginConfig
{
    juce::String pluginPath;
    juce::String pluginName;
    juce::String presetPath;
    juce::String parametersBefore;
    juce::String parametersAfter;
    juce::var parameters;

    // VSTi-specific configuration
    bool isInstrument = false;
    juce::String midiFile;
    double instrumentLength = 0.0;
    int programNumber = -1;

    // SYSEX patch support:
    juce::String sysexFile;
    int sysexPatchNumber = -1;

    // State saving/loading support
    juce::String saveStateTo;        // Save current state to this file
    juce::String loadStateFrom;      // Load state from this file
    bool saveDefaultState = false;   // Save the default state before any changes
};

struct ProcessingConfig
{
    juce::String inputFile;
    juce::String outputFile;
    std::vector<PluginConfig> plugins;
    double sampleRate = 0.0;
    int bitDepth = 0;
    int bufferSize = 2048;

    // VSTi-specific settings
    bool hasInstrument = false;
    double renderLength = 0.0;
    int instrumentChannels = 2;
};

//==============================================================================
// Simple MIDI sequence for VSTi processing
//==============================================================================

class SimpleMidiSequence
{
public:
    struct MidiEvent
    {
        double timeStamp;
        juce::MidiMessage message;

        MidiEvent(double time, const juce::MidiMessage& msg)
            : timeStamp(time), message(msg) {}
    };

    std::vector<MidiEvent> events;
    double totalLength = 0.0;
    bool logNoteDetails = false;

	bool loadFromFile(const juce::String& midiFilePath)
	{
		juce::File midiFile(midiFilePath);
		if (!midiFile.existsAsFile())
		{
			std::cerr << "MIDI file not found: " << midiFilePath << std::endl;
			return false;
		}

		std::cout << "=== DETAILED MIDI FILE ANALYSIS ===" << std::endl;
		std::cout << "File: " << midiFilePath << std::endl;
		std::cout << "Size: " << midiFile.getSize() << " bytes" << std::endl;

		juce::FileInputStream fileStream(midiFile);
		if (!fileStream.openedOk())
		{
			std::cerr << "Could not open MIDI file: " << midiFilePath << std::endl;
			return false;
		}

		juce::MidiFile midi;
		if (!midi.readFrom(fileStream))
		{
			std::cerr << "Could not parse MIDI file: " << midiFilePath << std::endl;
			return false;
		}

		std::cout << "MIDI file loaded successfully:" << std::endl;
		std::cout << "  Tracks: " << midi.getNumTracks() << std::endl;
		std::cout << "  Time format: " << midi.getTimeFormat() << std::endl;

		events.clear();
		totalLength = 0.0;

		// Default tempo: 120 BPM = 500,000 microseconds per quarter note
		double microsecondsPerQuarter = 500000.0;
		int timeFormat = midi.getTimeFormat();
		bool isTicksPerQuarter = (timeFormat > 0);

		int totalNoteOnEvents = 0;
		int totalNoteOffEvents = 0;
		int totalOtherEvents = 0;

		std::cout << "\n=== PROCESSING TRACKS ===" << std::endl;

		for (int trackIndex = 0; trackIndex < midi.getNumTracks(); ++trackIndex)
		{
			const auto* track = midi.getTrack(trackIndex);
			std::cout << "\nTrack " << trackIndex << ": " << track->getNumEvents() << " events" << std::endl;

			for (int eventIndex = 0; eventIndex < track->getNumEvents(); ++eventIndex)
			{
				const auto* midiEventHolder = track->getEventPointer(eventIndex);
				const juce::MidiMessage& message = midiEventHolder->message;

				double timeInSeconds = 0.0;

				if (isTicksPerQuarter)
				{
					double ticksPerQuarter = static_cast<double>(timeFormat);
					double secondsPerQuarter = microsecondsPerQuarter / 1000000.0;
					timeInSeconds = message.getTimeStamp() / ticksPerQuarter * secondsPerQuarter;

					if (logNoteDetails) {
						std::cout << "  Event at tick " << message.getTimeStamp()
								  << " -> " << std::fixed << std::setprecision(3) << timeInSeconds << "s" << std::endl;
					}
				}
				else
				{
					timeInSeconds = message.getTimeStamp();
				}

				// Update tempo if tempo change event
				if (message.isTempoMetaEvent())
				{
					microsecondsPerQuarter = message.getTempoSecondsPerQuarterNote() * 1000000.0;
					double bpm = 60000000.0 / microsecondsPerQuarter;
					std::cout << "  TEMPO CHANGE: " << std::fixed << std::setprecision(1) << bpm << " BPM"
							  << " (" << microsecondsPerQuarter << " us/quarter) at " << timeInSeconds << "s" << std::endl;
					totalOtherEvents++;
				}
				else if (message.isNoteOn())
				{
					if (logNoteDetails) {
						std::cout << "  NOTE ON:  Note " << message.getNoteNumber()
								  << " (" << getNoteNameFromNumber(message.getNoteNumber()) << ")"
								  << ", Vel " << (int)message.getVelocity()
								  << ", Ch " << message.getChannel()
								  << " at " << std::fixed << std::setprecision(3) << timeInSeconds << "s" << std::endl;
					}
					totalNoteOnEvents++;
				}
				else if (message.isNoteOff())
				{
					if (logNoteDetails) {
						std::cout << "  NOTE OFF: Note " << message.getNoteNumber()
								  << " (" << getNoteNameFromNumber(message.getNoteNumber()) << ")"
								  << ", Vel " << (int)message.getVelocity()
								  << ", Ch " << message.getChannel()
								  << " at " << std::fixed << std::setprecision(3) << timeInSeconds << "s" << std::endl;
						}
					totalNoteOffEvents++;
				}
				else if (message.isTrackNameEvent())
				{
					std::cout << "  TRACK NAME: " << message.getTextFromTextMetaEvent() << std::endl;
					totalOtherEvents++;
				}
				else if (message.isEndOfTrackMetaEvent())
				{
					std::cout << "  END OF TRACK at " << timeInSeconds << "s" << std::endl;
					totalOtherEvents++;
				}
				else
				{
					totalOtherEvents++;
				}

				events.emplace_back(timeInSeconds, message);
				totalLength = juce::jmax(totalLength, timeInSeconds);
			}
		}

		// Sort events by time
		std::sort(events.begin(), events.end(),
				  [](const MidiEvent& a, const MidiEvent& b) {
					  return a.timeStamp < b.timeStamp;
				  });

		std::cout << "\n=== SUMMARY ===" << std::endl;
		std::cout << "Note On events: " << totalNoteOnEvents << std::endl;
		std::cout << "Note Off events: " << totalNoteOffEvents << std::endl;
		std::cout << "Other events: " << totalOtherEvents << std::endl;
		std::cout << "Total events loaded: " << events.size() << std::endl;
		std::cout << "Total duration: " << std::fixed << std::setprecision(3) << totalLength << " seconds" << std::endl;

		if (totalNoteOnEvents == 0)
		{
			std::cout << "*** ERROR: No Note On events found! ***" << std::endl;
			return false;
		}

		if (totalNoteOnEvents != totalNoteOffEvents)
		{
			std::cout << "*** WARNING: Mismatched Note On/Off events! ***" << std::endl;
		}

		// Find first and last note times
		double firstNoteTime = -1;
		double lastNoteTime = -1;

		for (const auto& event : events)
		{
			if (event.message.isNoteOn())
			{
				if (firstNoteTime < 0)
					firstNoteTime = event.timeStamp;
				lastNoteTime = event.timeStamp;
			}
		}

		std::cout << "First note at: " << std::fixed << std::setprecision(3) << firstNoteTime << "s" << std::endl;
		std::cout << "Last note at: " << std::fixed << std::setprecision(3) << lastNoteTime << "s" << std::endl;
		std::cout << "Actual note span: " << std::fixed << std::setprecision(3) << (lastNoteTime - firstNoteTime) << "s" << std::endl;

		// Add note-off events for any hanging notes
		addNoteOffEvents();

		std::cout << "Events after cleanup: " << events.size() << std::endl;
		std::cout << "=== END ANALYSIS ===" << std::endl;

		return true;
	}

	static juce::String getNoteNameFromNumber(int noteNumber)
	{
		if (noteNumber < 0 || noteNumber > 127)
			return "Invalid";

		const char* noteNames[] = {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"};
		int octave = (noteNumber / 12) - 1;
		int noteIndex = noteNumber % 12;

		return juce::String(noteNames[noteIndex]) + juce::String(octave);
	}

private:
    void addNoteOffEvents()
    {
        std::map<int, double> hangingNotes;

        for (const auto& event : events)
        {
            if (event.message.isNoteOn())
            {
                hangingNotes[event.message.getNoteNumber()] = event.timeStamp;
            }
            else if (event.message.isNoteOff())
            {
                hangingNotes.erase(event.message.getNoteNumber());
            }
        }

        for (const auto& note : hangingNotes)
        {
            auto noteOffTime = totalLength + 0.1;
            auto noteOffMessage = juce::MidiMessage::noteOff(1, note.first, (juce::uint8)64);
            events.emplace_back(noteOffTime, noteOffMessage);
            totalLength = juce::jmax(totalLength, noteOffTime);
        }

        std::sort(events.begin(), events.end(),
                  [](const MidiEvent& a, const MidiEvent& b) {
                      return a.timeStamp < b.timeStamp;
                  });
    }
};

//==============================================================================
// Audio Plugin Host
//==============================================================================

class AudioPluginHost
{
public:
    AudioPluginHost()
    {
        g_hostInstance = this;
        std::cout << "[HOST] Constructor called" << std::endl;
    }

    // Skip destructor to avoid segfault
    // ~AudioPluginHost() { }

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

    bool processAudio()
    {
        if (config.hasInstrument)
        {
            return processWithInstrument();
        }
        else
        {
            return processAudioFile();
        }
    }

    void cleanup()
    {
        safeLog("Emergency cleanup - minimal operations only");
        pluginChain.clear();
    }

private:
    ProcessingConfig config;
    std::vector<std::unique_ptr<juce::AudioPluginInstance>> pluginChain;
    juce::AudioPluginFormatManager pluginFormatManager;
    SimpleMidiSequence midiSequence;

    bool parseConfiguration(const juce::var& json)
    {
        config.inputFile = json.getProperty("input_file", "");
        config.outputFile = json["output_file"].toString();
        config.sampleRate = json.getProperty("sample_rate", 44100.0);
        config.bitDepth = json.getProperty("bit_depth", 24);
        config.bufferSize = json.getProperty("buffer_size", 2048);
        config.renderLength = json.getProperty("render_length", 0.0);
        config.instrumentChannels = json.getProperty("instrument_channels", 2);

        if (config.outputFile.isEmpty())
        {
            std::cerr << "Output file path is required" << std::endl;
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
            pluginConfig.parametersBefore = pluginJson.getProperty("export_parameters_before", "");
            pluginConfig.parametersAfter = pluginJson.getProperty("export_parameters_after", "");
            pluginConfig.parameters = pluginJson.getProperty("parameters", juce::var());

            // VSTi-specific settings
            pluginConfig.isInstrument = pluginJson.getProperty("is_instrument", false);
            pluginConfig.midiFile = pluginJson.getProperty("midi_file", "");
            pluginConfig.instrumentLength = pluginJson.getProperty("instrument_length", 0.0);
            pluginConfig.programNumber = pluginJson.getProperty("program_number", -1);
            pluginConfig.sysexFile = pluginJson.getProperty("sysex_file", "");
            pluginConfig.sysexPatchNumber = pluginJson.getProperty("sysex_patch_number", -1);
            pluginConfig.saveStateTo = pluginJson.getProperty("save_state_to", "");
            pluginConfig.loadStateFrom = pluginJson.getProperty("load_state_from", "");
            pluginConfig.saveDefaultState = pluginJson.getProperty("save_default_state", false);

            if (pluginConfig.pluginPath.isEmpty())
            {
                std::cerr << "Plugin path is required for plugin " << i << std::endl;
                return false;
            }

            if (pluginConfig.isInstrument)
            {
                config.hasInstrument = true;
                if (pluginConfig.midiFile.isEmpty())
                {
                    std::cerr << "MIDI file is required for instrument plugin " << i << std::endl;
                    return false;
                }
            }

            config.plugins.push_back(std::move(pluginConfig));
        }

        if (!config.hasInstrument && config.inputFile.isEmpty())
        {
            std::cerr << "Either input_file or an instrument plugin is required" << std::endl;
            return false;
        }

        return true;
    }

    bool processWithInstrument()
    {
        std::cout << "=== Processing with Virtual Instrument ===" << std::endl;

        double finalSampleRate = (config.sampleRate > 0) ? config.sampleRate : 44100.0;
        int finalBitDepth = (config.bitDepth > 0) ? config.bitDepth : 24;

        std::cout << "Processing settings:" << std::endl;
        std::cout << "  Sample rate: " << finalSampleRate << " Hz" << std::endl;
        std::cout << "  Bit depth: " << finalBitDepth << " bits" << std::endl;
        std::cout << "  Buffer size: " << config.bufferSize << " samples" << std::endl;
        std::cout << "  Instrument channels: " << config.instrumentChannels << std::endl;

        if (!initializePlugins(finalSampleRate, config.instrumentChannels))
        {
            std::cerr << "Failed to initialize plugin chain" << std::endl;
            return false;
        }

        // Load MIDI sequence from the first instrument
        for (const auto& pluginConfig : config.plugins)
        {
            if (pluginConfig.isInstrument && !pluginConfig.midiFile.isEmpty())
            {
                std::cout << "Loading MIDI sequence: " << pluginConfig.midiFile << std::endl;
                if (!midiSequence.loadFromFile(pluginConfig.midiFile))
                {
                    std::cerr << "Failed to load MIDI sequence" << std::endl;
                    return false;
                }
                break;
            }
        }

        double renderLength = config.renderLength;
        if (renderLength <= 0.0)
        {
            renderLength = midiSequence.totalLength + 2.0;
        }

        std::cout << "Render length: " << renderLength << " seconds" << std::endl;

        auto totalSamples = static_cast<int>(renderLength * finalSampleRate);
        std::cout << "Total samples to render: " << totalSamples << std::endl;

        juce::AudioBuffer<float> audioBuffer(config.instrumentChannels, totalSamples);
        audioBuffer.clear();

        renderInstrumentChain(audioBuffer, finalSampleRate, renderLength);

        bool rc = writeAudioFile(audioBuffer, finalSampleRate, config.instrumentChannels, finalBitDepth);
        std::cout << "Audio processing completed!" << std::endl;
        return rc;
    }

    bool processAudioFile()
    {
        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();

        juce::File inputFile(config.inputFile);
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(inputFile));

        if (!reader)
        {
            std::cerr << "Could not read input file: " << config.inputFile << std::endl;
            return false;
        }

        auto numChannels = static_cast<int>(reader->numChannels);
        auto numSamples = static_cast<int>(reader->lengthInSamples);

        double finalSampleRate = (config.sampleRate > 0) ? config.sampleRate : reader->sampleRate;
        int finalBitDepth = (config.bitDepth > 0) ? config.bitDepth : static_cast<int>(reader->bitsPerSample);

        std::cout << "Input file info:" << std::endl;
        std::cout << "  Sample rate: " << reader->sampleRate << " Hz" << std::endl;
        std::cout << "  Bit depth: " << reader->bitsPerSample << " bits" << std::endl;
        std::cout << "  Channels: " << numChannels << std::endl;
        std::cout << "  Samples: " << numSamples << std::endl;

        juce::AudioBuffer<float> audioBuffer(numChannels, numSamples);
        reader->read(&audioBuffer, 0, numSamples, 0, true, true);

        if (!initializePlugins(finalSampleRate, audioBuffer.getNumChannels()))
        {
            std::cerr << "Failed to initialize plugin chain" << std::endl;
            return false;
        }

        processAudioBuffer(audioBuffer, finalSampleRate);

        bool rc = writeAudioFile(audioBuffer, finalSampleRate, numChannels, finalBitDepth);
        std::cout << "Audio file processing completed!" << std::endl;
        return rc;
    }

    void renderInstrumentChain(juce::AudioBuffer<float>& buffer, double sampleRate, double renderLength)
    {
        auto totalSamples = buffer.getNumSamples();
        auto blockSize = config.bufferSize;
        auto numChannels = buffer.getNumChannels();

        std::cout << "\n=== RENDER DEBUG INFO ===" << std::endl;
        std::cout << "Rendering instrument chain..." << std::endl;
        std::cout << "  Total samples: " << totalSamples << std::endl;
        std::cout << "  Block size: " << blockSize << std::endl;
        std::cout << "  Channels: " << numChannels << std::endl;
        std::cout << "  Sample rate: " << sampleRate << " Hz" << std::endl;
        std::cout << "  Render length: " << renderLength << " seconds" << std::endl;
        std::cout << "  Total MIDI events: " << midiSequence.events.size() << std::endl;

        size_t currentMidiEventIndex = 0;
        int totalMidiEventsSent = 0;
        int totalNoteOnsSent = 0;
        int totalNoteOffsSent = 0;
        int blocksWithAudio = 0;

        for (int startSample = 0; startSample < totalSamples; startSample += blockSize)
        {
            auto samplesToProcess = juce::jmin(blockSize, totalSamples - startSample);
            double currentTimeStart = startSample / sampleRate;
            double currentTimeEnd = (startSample + samplesToProcess) / sampleRate;

            juce::MidiBuffer midiBuffer;
            int eventsInThisBuffer = 0;

            while (currentMidiEventIndex < midiSequence.events.size())
            {
                const auto& event = midiSequence.events[currentMidiEventIndex];

                if (event.timeStamp >= currentTimeEnd)
                    break;

                if (event.timeStamp >= currentTimeStart)
                {
                    int sampleOffset = static_cast<int>((event.timeStamp - currentTimeStart) * sampleRate);
                    sampleOffset = juce::jlimit(0, samplesToProcess - 1, sampleOffset);

                    midiBuffer.addEvent(event.message, sampleOffset);
                    eventsInThisBuffer++;
                    totalMidiEventsSent++;

                    if (event.message.isNoteOn())
                    {
                        totalNoteOnsSent++;
                    }
                    else if (event.message.isNoteOff())
                    {
                        totalNoteOffsSent++;
                    }
                }

                currentMidiEventIndex++;
            }

            juce::AudioBuffer<float> blockBuffer(buffer.getArrayOfWritePointers(),
                                               buffer.getNumChannels(),
                                               startSample,
                                               samplesToProcess);

            blockBuffer.clear();

            for (size_t pluginIndex = 0; pluginIndex < pluginChain.size(); ++pluginIndex)
            {
                auto& plugin = pluginChain[pluginIndex];

                if (config.plugins[pluginIndex].isInstrument)
                {
                    plugin->processBlock(blockBuffer, midiBuffer);

                    float postInstrumentLevel = blockBuffer.getRMSLevel(0, 0, samplesToProcess);
                    if (postInstrumentLevel > 0.001f)
                    {
                        blocksWithAudio++;
                    }

                    midiBuffer.clear();
                }
                else
                {
                    juce::MidiBuffer emptyMidi;
                    plugin->processBlock(blockBuffer, emptyMidi);
                }
            }

            if (startSample % (blockSize * 200) == 0)
            {
                double progress = (double)startSample / totalSamples * 100.0;
                std::cout << "Progress: " << std::fixed << std::setprecision(1) << progress << "%" << std::endl;
            }
        }

        std::cout << "\n=== RENDER SUMMARY ===" << std::endl;
        std::cout << "Total MIDI events processed: " << totalMidiEventsSent << std::endl;
        std::cout << "Note On events sent: " << totalNoteOnsSent << std::endl;
        std::cout << "Note Off events sent: " << totalNoteOffsSent << std::endl;
        std::cout << "Blocks with audio content: " << blocksWithAudio << std::endl;
        std::cout << "Plugins in chain: " << pluginChain.size() << std::endl;

        float totalRMS = 0.0f;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            float channelRMS = buffer.getRMSLevel(ch, 0, buffer.getNumSamples());
            totalRMS += channelRMS;
            std::cout << "Channel " << ch << " RMS level: " << std::fixed << std::setprecision(4) << channelRMS << std::endl;
        }

        if (totalRMS > 0.0001f)
        {
            std::cout << "*** SUCCESS: Audio content detected in final buffer! ***" << std::endl;
        }
        else
        {
            std::cout << "*** PROBLEM: No audio content in final buffer! ***" << std::endl;
        }

        std::cout << "=== END RENDER ===" << std::endl;
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

        for (size_t configIndex = 0; configIndex < config.plugins.size(); ++configIndex)
        {
            const auto& pluginConfig = config.plugins[configIndex];

            std::cout << "=== Loading Plugin " << (configIndex + 1) << " ===" << std::endl;
            std::cout << "Plugin path: " << pluginConfig.pluginPath << std::endl;
            std::cout << "Is instrument: " << (pluginConfig.isInstrument ? "YES" : "NO") << std::endl;

            juce::File pluginFile(pluginConfig.pluginPath);
            if (!pluginFile.exists())
            {
                std::cerr << "Plugin path not found: " << pluginConfig.pluginPath << std::endl;
                return false;
            }

            juce::OwnedArray<juce::PluginDescription> descriptions;
            bool pluginFound = false;

            std::cout << "Scanning plugin file for available plugins..." << std::endl;

            for (auto* format : pluginFormatManager.getFormats())
            {
                descriptions.clear();

                try
                {
                    format->findAllTypesForFile(descriptions, pluginConfig.pluginPath);

                    if (descriptions.size() > 0)
                    {
                        pluginFound = true;
                        std::cout << "  Found " << descriptions.size() << " plugins with " << format->getName() << std::endl;
                        for (int i = 0; i < descriptions.size(); ++i)
                        {
                            auto& desc = *descriptions[i];
                            std::cout << "    [" << i << "] " << desc.name << " (" << desc.manufacturerName << ")" << std::endl;
                            std::cout << "        Is Instrument: " << (desc.isInstrument ? "YES" : "NO") << std::endl;
                        }
                        break;
                    }
                }
                catch (...)
                {
                    // Continue with next format
                }
            }

            if (!pluginFound || descriptions.size() == 0)
            {
                std::cerr << "No valid plugin found in file: " << pluginConfig.pluginPath << std::endl;
                return false;
            }

            juce::PluginDescription* selectedDescription = nullptr;

            if (!pluginConfig.pluginName.isEmpty())
            {
                for (int i = 0; i < descriptions.size(); ++i)
                {
                    auto& desc = *descriptions[i];
                    if (desc.name.containsIgnoreCase(pluginConfig.pluginName))
                    {
                        selectedDescription = &desc;
                        break;
                    }
                }
            }
            else
            {
                if (pluginConfig.isInstrument)
                {
                    for (int i = 0; i < descriptions.size(); ++i)
                    {
                        auto& desc = *descriptions[i];
                        if (desc.isInstrument)
                        {
                            selectedDescription = &desc;
                            break;
                        }
                    }
                }

                if (!selectedDescription)
                {
                    selectedDescription = descriptions[0];
                }
            }

            if (!selectedDescription)
            {
                std::cerr << "Could not select appropriate plugin" << std::endl;
                return false;
            }

            std::cout << "Selected plugin: " << selectedDescription->name << std::endl;

            juce::String errorMessage;
            auto plugin = pluginFormatManager.createPluginInstance(*selectedDescription, sampleRate, config.bufferSize, errorMessage);

            if (!plugin)
            {
                std::cerr << "Failed to load plugin: " << errorMessage << std::endl;
                return false;
            }

            std::cout << "Successfully created plugin instance!" << std::endl;
            std::cout << "  Accepts MIDI: " << (plugin->acceptsMidi() ? "YES" : "NO") << std::endl;

            plugin->prepareToPlay(sampleRate, config.bufferSize);

            int inputChannels = pluginConfig.isInstrument ? 0 : numChannels;
            int outputChannels = pluginConfig.isInstrument ? config.instrumentChannels : numChannels;
            plugin->setPlayConfigDetails(inputChannels, outputChannels, sampleRate, config.bufferSize);

            // *** ENUMERATE PARAMETERS BEFORE ANY CHANGES ***
            std::cout << "\n=== INITIAL PLUGIN STATE ===" << std::endl;
            auto initialParameters = PluginParameterManager::enumerateParameters(plugin.get());

            // Save default state if requested
            if (pluginConfig.saveDefaultState || !pluginConfig.saveStateTo.isEmpty())
            {
                juce::String defaultStatePath = pluginConfig.saveStateTo.isEmpty() ?
                    ("/tmp/" + plugin->getName().replace(" ", "_") + "_default_state.bin") :
                    pluginConfig.saveStateTo + "_default";

                savePluginState(plugin.get(), defaultStatePath);
            }

            // Export parameters if requested (before changes)
            if (!pluginConfig.parametersBefore.isEmpty())
            {
                PluginParameterManager::exportParametersToJson(plugin.get(), pluginConfig.parametersBefore);
            }

            // Show program information
            PluginParameterManager::monitorProgramChanges(plugin.get());

            // Load state from file if specified (this is our new primary method)
            if (!pluginConfig.loadStateFrom.isEmpty())
            {
                std::cout << "\n=== LOADING STATE FROM FILE ===" << std::endl;
                juce::File stateFile(pluginConfig.loadStateFrom);
                if (stateFile.existsAsFile())
                {
                    juce::MemoryBlock stateData;
                    if (stateFile.loadFileAsData(stateData))
                    {
                        std::cout << "Loading state from: " << pluginConfig.loadStateFrom << std::endl;
                        std::cout << "State file size: " << stateData.getSize() << " bytes" << std::endl;

                        try
                        {
                            plugin->setStateInformation(stateData.getData(), static_cast<int>(stateData.getSize()));
                            std::cout << "State loaded successfully from binary file!" << std::endl;

                            // Re-enumerate parameters after state change
                            std::cout << "\n--- Parameters after state loading ---" << std::endl;
                            PluginParameterManager::enumerateParameters(plugin.get());
                        }
                        catch (...)
                        {
                            std::cout << "Failed to load state from file" << std::endl;
                        }
                    }
                    else
                    {
                        std::cout << "Could not read state file data" << std::endl;
                    }
                }
                else
                {
                    std::cout << "State file does not exist: " << pluginConfig.loadStateFrom << std::endl;
                }
                std::cout << "===============================" << std::endl;
            }

            // Set program if specified
            if (pluginConfig.programNumber >= 0)
            {
                if (plugin->getNumPrograms() > pluginConfig.programNumber)
                {
                    int oldProgram = plugin->getCurrentProgram();
                    plugin->setCurrentProgram(pluginConfig.programNumber);

                    std::cout << "\n=== PROGRAM CHANGE ===" << std::endl;
                    std::cout << "Changed from program " << oldProgram
                              << " (\"" << plugin->getProgramName(oldProgram) << "\")" << std::endl;
                    std::cout << "             to program " << pluginConfig.programNumber
                              << " (\"" << plugin->getProgramName(pluginConfig.programNumber) << "\")" << std::endl;
                    std::cout << "====================" << std::endl;

                    // Save state after program change if requested
                    if (!pluginConfig.saveStateTo.isEmpty())
                    {
                        juce::String programStatePath = pluginConfig.saveStateTo + "_program_" + juce::String(pluginConfig.programNumber);
                        savePluginState(plugin.get(), programStatePath);
                    }
                }
                else
                {
                    std::cout << "Warning: Program " << pluginConfig.programNumber
                              << " not available (max: " << (plugin->getNumPrograms() - 1) << ")" << std::endl;
                }
            }

            // Handle SysEx if specified
            if (!pluginConfig.sysexFile.isEmpty())
            {
                std::cout << "Loading SysEx file: " << pluginConfig.sysexFile << std::endl;
                if (loadSysExPatch(plugin.get(), pluginConfig.sysexFile, pluginConfig.sysexPatchNumber))
                {
                    std::cout << "SysEx patch loaded successfully" << std::endl;

                    // Save state after SysEx loading if requested
                    if (!pluginConfig.saveStateTo.isEmpty())
                    {
                        juce::String sysexStatePath = pluginConfig.saveStateTo + "_sysex_" + juce::String(pluginConfig.sysexPatchNumber);
                        savePluginState(plugin.get(), sysexStatePath);
                    }
                }
                else
                {
                    std::cout << "Warning: Could not load SysEx patch" << std::endl;
                }
            }

            // Load preset if specified (fallback method)
            if (!pluginConfig.presetPath.isEmpty())
            {
                bool presetLoaded = loadPreset(plugin.get(), pluginConfig.presetPath);
                if (presetLoaded)
                {
                    std::cout << "Preset loaded - checking parameter changes..." << std::endl;
                    PluginParameterManager::enumerateParameters(plugin.get());

                    // Save state after preset loading if requested
                    if (!pluginConfig.saveStateTo.isEmpty())
                    {
                        juce::String presetStatePath = pluginConfig.saveStateTo + "_preset";
                        savePluginState(plugin.get(), presetStatePath);
                    }
                }
            }

            // Set individual parameters if specified
            if (pluginConfig.parameters.isObject())
            {
                std::cout << "\n=== APPLYING INDIVIDUAL PARAMETERS ===" << std::endl;
                setPluginParameters(plugin.get(), pluginConfig.parameters);
                std::cout << "=====================================" << std::endl;

                // Save state after parameter changes if requested
                if (!pluginConfig.saveStateTo.isEmpty())
                {
                    juce::String paramStatePath = pluginConfig.saveStateTo + "_after_params";
                    savePluginState(plugin.get(), paramStatePath);
                }
            }

            // *** SHOW FINAL STATE ***
            std::cout << "\n=== FINAL PLUGIN STATE ===" << std::endl;
            PluginParameterManager::monitorProgramChanges(plugin.get());

            // Export parameters if requested (after changes)
            if (!pluginConfig.parametersAfter.isEmpty())
            {
                PluginParameterManager::exportParametersToJson(plugin.get(), pluginConfig.parametersAfter);
            }

            // Save final state if requested
            if (!pluginConfig.saveStateTo.isEmpty())
            {
                savePluginState(plugin.get(), pluginConfig.saveStateTo + "_final");
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
        std::cout << "\n=== COMPREHENSIVE PRESET LOADING ===" << std::endl;
        std::cout << "Loading preset: " << presetPath << std::endl;

        juce::File presetFile(presetPath);
        if (!presetFile.existsAsFile())
        {
            std::cout << "Preset file does not exist!" << std::endl;
            return false;
        }

        juce::MemoryBlock presetData;
        if (!presetFile.loadFileAsData(presetData))
        {
            std::cout << "Could not load preset file data!" << std::endl;
            return false;
        }

        std::cout << "Preset file size: " << presetData.getSize() << " bytes" << std::endl;

        // Save current state before attempting to load preset
        juce::MemoryBlock currentState;
        plugin->getStateInformation(currentState);
        std::cout << "Current plugin state size: " << currentState.getSize() << " bytes" << std::endl;

        // Try multiple loading strategies
        bool success = false;

        // Strategy 1: Direct setStateInformation (for .vstpreset and raw state)
        if (!success)
        {
            std::cout << "\nStrategy 1: Direct state loading..." << std::endl;
            try
            {
                plugin->setStateInformation(presetData.getData(), static_cast<int>(presetData.getSize()));
                std::cout << "Direct state loading successful!" << std::endl;
                success = true;
            }
            catch (...)
            {
                std::cout << "Direct state loading failed" << std::endl;
            }
        }

        // Strategy 2: Try as XML (some presets are XML-based)
        if (!success)
        {
            std::cout << "\nStrategy 2: XML parsing..." << std::endl;
            juce::String presetText = presetData.toString();
            if (presetText.startsWith("<?xml") || presetText.contains("<preset"))
            {
                std::cout << "Detected XML format" << std::endl;
                auto xmlDoc = juce::XmlDocument::parse(presetText);
                if (xmlDoc != nullptr)
                {
                    std::cout << "XML parsed successfully" << std::endl;
                    // Try to extract state data from XML
                    auto stateElement = xmlDoc->getChildByName("state");
                    if (stateElement != nullptr)
                    {
                        juce::String stateData = stateElement->getAllSubText();
                        if (stateData.isNotEmpty())
                        {
                            juce::MemoryBlock stateBlock;
                            if (stateBlock.fromBase64Encoding(stateData))
                            {
                                try
                                {
                                    plugin->setStateInformation(stateBlock.getData(), static_cast<int>(stateBlock.getSize()));
                                    std::cout << "XML state loading successful!" << std::endl;
                                    success = true;
                                }
                                catch (...)
                                {
                                    std::cout << "XML state loading failed" << std::endl;
                                }
                            }
                        }
                    }
                }
            }
            else
            {
                std::cout << "Not XML format" << std::endl;
            }
        }

        // Strategy 3: Skip FXP parsing for now - it's clearly not working
        // Focus on what JUCE supports natively

        // Strategy 4: Try loading via JUCE's AudioProcessor methods
        if (!success)
        {
            std::cout << "\nStrategy 4: JUCE AudioProcessor methods..." << std::endl;

            // Some plugins support setCurrentProgram even without visible programs
            if (plugin->getNumPrograms() > 0)
            {
                std::cout << "Plugin has " << plugin->getNumPrograms() << " programs" << std::endl;
                for (int i = 0; i < plugin->getNumPrograms(); ++i)
                {
                    std::cout << "  Program " << i << ": " << plugin->getProgramName(i) << std::endl;
                }
            }

            // Try to set state via MemoryInputStream
            juce::MemoryInputStream memStream(presetData, false);
            try
            {
                plugin->setStateInformation(presetData.getData(), static_cast<int>(presetData.getSize()));
                success = true;
                std::cout << "MemoryInputStream method successful!" << std::endl;
            }
            catch (...)
            {
                std::cout << "MemoryInputStream method failed" << std::endl;
            }
        }

        if (success)
        {
            std::cout << "\n*** PRESET LOADED SUCCESSFULLY ***" << std::endl;

            // Verify state changed
            juce::MemoryBlock newState;
            plugin->getStateInformation(newState);
            std::cout << "New plugin state size: " << newState.getSize() << " bytes" << std::endl;

            if (newState.getSize() != currentState.getSize() ||
                memcmp(newState.getData(), currentState.getData(), newState.getSize()) != 0)
            {
                std::cout << "Plugin state has changed - preset likely loaded correctly" << std::endl;
            }
            else
            {
                std::cout << "WARNING: Plugin state appears unchanged" << std::endl;
            }
        }
        else
        {
            std::cout << "\n*** ALL PRESET LOADING STRATEGIES FAILED ***" << std::endl;
            std::cout << "This may be a plugin-specific format not supported by JUCE" << std::endl;
        }

        std::cout << "=====================================" << std::endl;
        return success;
    }

    // Add state saving utilities
    bool savePluginState(juce::AudioPluginInstance* plugin, const juce::String& outputPath)
    {
        std::cout << "\n=== SAVING PLUGIN STATE ===" << std::endl;

        juce::MemoryBlock stateData;
        plugin->getStateInformation(stateData);

        std::cout << "Plugin state size: " << stateData.getSize() << " bytes" << std::endl;

        if (stateData.getSize() == 0)
        {
            std::cout << "No state data available to save" << std::endl;
            return false;
        }

        // Save raw binary state
        juce::File outputFile(outputPath);
        outputFile.getParentDirectory().createDirectory();

        if (outputFile.replaceWithData(stateData.getData(), stateData.getSize()))
        {
            std::cout << "State saved to: " << outputPath << std::endl;

            // Also save as base64 for analysis
            juce::String base64State = stateData.toBase64Encoding();
            juce::File base64File(outputPath + ".base64");
            base64File.replaceWithText(base64State);
            std::cout << "Base64 state saved to: " << outputPath + ".base64" << std::endl;

            // Save hex dump for analysis
            juce::String hexDump = createHexDump(stateData);
            juce::File hexFile(outputPath + ".hex");
            hexFile.replaceWithText(hexDump);
            std::cout << "Hex dump saved to: " << outputPath + ".hex" << std::endl;

            return true;
        }
        else
        {
            std::cout << "Failed to save state file" << std::endl;
            return false;
        }
    }

    juce::String createHexDump(const juce::MemoryBlock& data)
    {
        juce::String result;
        const uint8_t* bytes = static_cast<const uint8_t*>(data.getData());
        size_t size = data.getSize();

        result << "Plugin State Hex Dump (" << size << " bytes):\n";
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

        // Add header analysis
        if (size >= 4)
        {
            result << "\nHeader Analysis:\n";
            result << "First 4 bytes: ";
            for (int i = 0; i < 4; ++i)
            {
                result << juce::String::formatted("%02X ", bytes[i]);
            }
            result << " (";
            for (int i = 0; i < 4; ++i)
            {
                char c = static_cast<char>(bytes[i]);
                result << (c >= 32 && c <= 126 ? c : '.');
            }
            result << ")\n";

            // Check for common format signatures
            if (bytes[0] == 'C' && bytes[1] == 'c' && bytes[2] == 'n' && bytes[3] == 'K')
            {
                result << "Detected: FXP/FXB format signature\n";
            }
            else if (bytes[0] == 0x00 && bytes[1] == 0x00 && bytes[2] == 0x00 && bytes[3] == 0x01)
            {
                result << "Detected: Possible VST3 preset format\n";
            }
            else if (bytes[0] == '<' || (bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF))
            {
                result << "Detected: XML/Text format\n";
            }
        }

        return result;
    }

    void setPluginParameters(juce::AudioPluginInstance* plugin, const juce::var& parameters)
    {
        if (!parameters.isObject())
            return;

        auto* paramObject = parameters.getDynamicObject();
        if (!paramObject)
            return;

        auto& properties = paramObject->getProperties();
        std::cout << "Attempting to set " << properties.size() << " parameters:" << std::endl;

        const auto& pluginParams = plugin->getParameters();

        for (auto& prop : properties)
        {
            auto paramName = prop.name.toString();
            auto requestedValue = static_cast<float>(prop.value);

            std::cout << "  Setting: " << paramName << " = " << requestedValue << std::endl;

            bool paramFound = false;

            for (int i = 0; i < pluginParams.size(); ++i)
            {
                auto* param = pluginParams[i];
                auto currentName = param->getName(256);

                if (currentName == paramName || currentName.containsIgnoreCase(paramName))
                {
                    float oldValue = param->getValue();
                    param->setValue(requestedValue);
                    float newValue = param->getValue();

                    std::cout << "    ✓ Parameter found: " << currentName << std::endl;
                    std::cout << "      Index: " << i << std::endl;
                    std::cout << "      Old value: " << oldValue << " (\"" << param->getText(oldValue, 256) << "\")" << std::endl;
                    std::cout << "      New value: " << newValue << " (\"" << param->getText(newValue, 256) << "\")" << std::endl;

                    // Special handling for program parameters
                    if (currentName.containsIgnoreCase("program") && plugin->getNumPrograms() > 0)
                    {
                        int oldProgram = static_cast<int>(oldValue * (plugin->getNumPrograms() - 1));
                        int newProgram = static_cast<int>(newValue * (plugin->getNumPrograms() - 1));

                        std::cout << "      OLD PROGRAM: [" << oldProgram << "] \"" << plugin->getProgramName(oldProgram) << "\"" << std::endl;
                        std::cout << "      NEW PROGRAM: [" << newProgram << "] \"" << plugin->getProgramName(newProgram) << "\"" << std::endl;
                    }

                    paramFound = true;
                    break;
                }
            }

            if (!paramFound)
            {
                std::cout << "    ✗ Parameter '" << paramName << "' not found" << std::endl;
                std::cout << "      Suggestions:" << std::endl;

                for (int i = 0; i < pluginParams.size(); ++i)
                {
                    auto* param = pluginParams[i];
                    auto currentName = param->getName(256);

                    if (currentName.toLowerCase().contains(paramName.toLowerCase()) ||
                        paramName.toLowerCase().contains(currentName.toLowerCase()))
                    {
                        std::cout << "        - \"" << currentName << "\" (index " << i << ")" << std::endl;
                    }
                }
            }
        }
    }

    void processAudioBuffer(juce::AudioBuffer<float>& buffer, double sampleRate)
    {
        auto numSamples = buffer.getNumSamples();
        auto blockSize = config.bufferSize;

        for (int startSample = 0; startSample < numSamples; startSample += blockSize)
        {
            auto samplesToProcess = juce::jmin(blockSize, numSamples - startSample);

            juce::AudioBuffer<float> blockBuffer(buffer.getArrayOfWritePointers(),
                                               buffer.getNumChannels(),
                                               startSample,
                                               samplesToProcess);

            for (auto& plugin : pluginChain)
            {
                juce::MidiBuffer midiBuffer;
                plugin->processBlock(blockBuffer, midiBuffer);
            }
        }

        std::cout << "Processed " << numSamples << " samples through "
                  << pluginChain.size() << " plugins" << std::endl;
    }

    bool writeAudioFile(const juce::AudioBuffer<float>& buffer, double sampleRate, int numChannels, int bitDepth)
    {
        std::cout << "Writing output file: " << config.outputFile << std::endl;
        juce::File outputFile(config.outputFile);

        if (outputFile.exists())
        {
            outputFile.deleteFile();
        }

        outputFile.getParentDirectory().createDirectory();

        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();

        std::unique_ptr<juce::AudioFormat> format(formatManager.findFormatForFileExtension(outputFile.getFileExtension()));
        if (!format)
        {
            std::cerr << "Unsupported output format: " << outputFile.getFileExtension() << std::endl;
            return false;
        }

        std::unique_ptr<juce::FileOutputStream> fileStream(outputFile.createOutputStream());
        if (!fileStream)
        {
            std::cerr << "Could not create output file: " << config.outputFile << std::endl;
            return false;
        }

        int finalBitDepth = bitDepth;
        if (finalBitDepth != 16 && finalBitDepth != 24 && finalBitDepth != 32)
        {
            finalBitDepth = 24;
        }

        std::unique_ptr<juce::AudioFormatWriter> writer(format->createWriterFor(fileStream.get(),
                                                                              sampleRate,
                                                                              static_cast<unsigned int>(numChannels),
                                                                              finalBitDepth,
                                                                              {},
                                                                              0));
        if (!writer)
        {
            std::cerr << "Could not create audio writer" << std::endl;
            return false;
        }

        fileStream.release();

        writer->writeFromAudioSampleBuffer(buffer, 0, buffer.getNumSamples());
        writer->flush();

        std::cout << "Output written to: " << config.outputFile << std::endl;
        std::cout << "  Sample rate: " << sampleRate << " Hz" << std::endl;
        std::cout << "  Bit depth: " << finalBitDepth << " bits" << std::endl;
        std::cout << "  Channels: " << numChannels << std::endl;
        std::cout << "  Samples: " << buffer.getNumSamples() << std::endl;

        return true;
    }

    bool loadSysExPatch(juce::AudioPluginInstance* plugin, const juce::String& sysexPath, int patchNumber)
    {
        juce::File sysexFile(sysexPath);
        if (!sysexFile.existsAsFile())
        {
            std::cerr << "SysEx file not found: " << sysexPath << std::endl;
            return false;
        }

        std::cout << "SysEx file: " << sysexPath << " (" << sysexFile.getSize() << " bytes)" << std::endl;

        juce::MemoryBlock fileData;
        if (!sysexFile.loadFileAsData(fileData))
        {
            std::cerr << "Could not load SysEx file data" << std::endl;
            return false;
        }

        const uint8_t* data = static_cast<const uint8_t*>(fileData.getData());
        size_t dataSize = fileData.getSize();

        auto patches = parseDX7Bank(data, dataSize);
        if (patches.empty())
        {
            std::cout << "No valid patches found in SysEx file" << std::endl;
            return false;
        }

        std::cout << "Found " << patches.size() << " patches in SysEx bank" << std::endl;

        int targetPatch = (patchNumber >= 0) ? patchNumber : 0;
        if (targetPatch >= static_cast<int>(patches.size()))
        {
            std::cout << "Warning: Patch " << targetPatch << " not available, using patch 0" << std::endl;
            targetPatch = 0;
        }

        const auto& patch = patches[targetPatch];
        std::cout << "Loading patch " << targetPatch << ": " << patch.name << std::endl;

        return sendSysExToPlugin(plugin, patch.data);
    }

    struct SysExPatch
    {
        juce::String name;
        std::vector<uint8_t> data;
    };

    std::vector<SysExPatch> parseDX7Bank(const uint8_t* data, size_t dataSize)
    {
        std::vector<SysExPatch> patches;

        if (dataSize >= 4104 && data[0] == 0xF0 && data[1] == 0x43 &&
            data[3] == 0x09 && data[4] == 0x20 && data[5] == 0x00)
        {
            std::cout << "Detected DX7 32-voice bank format" << std::endl;

            for (int voice = 0; voice < 32; ++voice)
            {
                size_t voiceOffset = 6 + (voice * 128);

                if (voiceOffset + 128 > dataSize)
                    break;

                SysExPatch patch;
                patch.data.assign(data + voiceOffset, data + voiceOffset + 128);

                patch.name = "";
                for (int i = 118; i < 128; ++i)
                {
                    char c = static_cast<char>(patch.data[i]);
                    if (c >= 32 && c <= 126)
                        patch.name += c;
                    else
                        patch.name += " ";
                }
                patch.name = patch.name.trim();

                if (patch.name.isEmpty())
                    patch.name = "Patch " + juce::String(voice + 1);

                patches.push_back(patch);
            }
        }
        else if (dataSize >= 140 && data[0] == 0xF0 && data[1] == 0x43 &&
                 data[4] == 0x01 && data[5] == 0x1B)
        {
            std::cout << "Detected DX7 single voice format" << std::endl;

            SysExPatch patch;
            patch.data.assign(data + 6, data + 6 + 128);
            patch.name = "Single Voice";
            patches.push_back(patch);
        }
        else
        {
            std::cout << "Unknown SysEx format (size: " << dataSize << " bytes)" << std::endl;
        }

        return patches;
    }

    bool sendSysExToPlugin(juce::AudioPluginInstance* plugin, const std::vector<uint8_t>& patchData)
    {
        if (!plugin || patchData.empty())
            return false;

        std::cout << "Sending SysEx patch to plugin (" << patchData.size() << " bytes)" << std::endl;

        try
        {
            std::vector<uint8_t> sysexMessage;
            sysexMessage.push_back(0xF0);
            sysexMessage.push_back(0x43);
            sysexMessage.push_back(0x00);
            sysexMessage.push_back(0x00);
            sysexMessage.push_back(0x01);
            sysexMessage.push_back(0x1B);

            size_t dataSize = std::min(static_cast<size_t>(128), patchData.size());
            for (size_t i = 0; i < dataSize; ++i)
            {
                sysexMessage.push_back(patchData[i]);
            }

            while (sysexMessage.size() < 134)
            {
                sysexMessage.push_back(0x00);
            }

            uint8_t checksum = 0;
            for (size_t i = 6; i < sysexMessage.size(); ++i)
            {
                checksum += sysexMessage[i];
            }
            checksum = (~checksum + 1) & 0x7F;
            sysexMessage.push_back(checksum);
            sysexMessage.push_back(0xF7);

            juce::MidiMessage midiSysEx(sysexMessage.data(), static_cast<int>(sysexMessage.size()));
            juce::MidiBuffer midiBuffer;
            midiBuffer.addEvent(midiSysEx, 0);

            juce::AudioBuffer<float> audioBuffer(2, 512);
            audioBuffer.clear();

            plugin->processBlock(audioBuffer, midiBuffer);
            juce::Thread::sleep(100);

            std::cout << "SysEx sent successfully" << std::endl;
            return true;
        }
        catch (...)
        {
            std::cout << "Error sending SysEx to plugin" << std::endl;
            return false;
        }
    }
};

//==============================================================================
// Main function
//==============================================================================

int main(int argc, char* argv[])
{
    // Install crash handler
    signal(SIGSEGV, crashHandler);
    signal(SIGABRT, crashHandler);

    std::cout << "[MAIN] Starting VST Plugin Host with parameter discovery..." << std::endl;

    // Initialize JUCE
    juce::initialiseJuce_GUI();

    if (argc < 2)
    {
        std::cout << "VST Plugin Host with VSTi Support & Parameter Discovery" << std::endl;
        std::cout << "Usage: VSTPluginHost <config.json>" << std::endl;
        std::cout << "Example: VSTPluginHost dexed_config.json" << std::endl;
        std::cout << std::endl;
        std::cout << "Features:" << std::endl;
        std::cout << "  - Virtual Instruments (VSTi) with MIDI input" << std::endl;
        std::cout << "  - Audio Effects processing" << std::endl;
        std::cout << "  - Parameter enumeration and discovery" << std::endl;
        std::cout << "  - Program/preset management" << std::endl;
        std::cout << "  - SysEx support for DX7-compatible instruments" << std::endl;
        std::cout << "  - JSON parameter export" << std::endl;
        std::exit(0);
    }

    int returnCode = 0;

    // Create host instance
    AudioPluginHost* host = new AudioPluginHost();

    try {
        if (!host->loadConfiguration(juce::String(argv[1])))
        {
            std::cerr << "[MAIN] Failed to load configuration" << std::endl;
            returnCode = 1;
        }
        else
        {
            std::cout << "[MAIN] Processing audio..." << std::endl;
            bool success = host->processAudio();

            if (!success)
            {
                std::cerr << "[MAIN] Failed to process audio" << std::endl;
                returnCode = 1;
            }
            else
            {
                std::cout << "[MAIN] Processing completed successfully!" << std::endl;
            }
        }
    } catch (...) {
        std::cout << "[MAIN] Exception caught during processing" << std::endl;
        returnCode = 1;
    }

    std::cout << "[MAIN] Exiting to avoid cleanup segfault..." << std::endl;
    std::exit(returnCode);
}