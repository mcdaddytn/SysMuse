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
    juce::String pluginName;
    juce::String presetPath;
    juce::String parametersBefore;
    juce::String parametersAfter;
    juce::var parameters;

    // VSTi-specific configuration
    bool isInstrument = false;
    juce::String midiFile;
    double instrumentLength = 0.0;
    int programNumber = -1;  // For program change selection
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
		double microsecondsPerQuarter = 500000.0;  // Default tempo
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
					// FIXED: Proper conversion from ticks to seconds
					// timeInSeconds = ticks / ticksPerQuarter * secondsPerQuarter
					double ticksPerQuarter = static_cast<double>(timeFormat);
					double secondsPerQuarter = microsecondsPerQuarter / 1000000.0;
					timeInSeconds = message.getTimeStamp() / ticksPerQuarter * secondsPerQuarter;

					std::cout << "  Event at tick " << message.getTimeStamp()
							  << " -> " << std::fixed << std::setprecision(3) << timeInSeconds << "s" << std::endl;
				}
				else
				{
					// SMPTE format - direct time conversion
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
					std::cout << "  NOTE ON:  Note " << message.getNoteNumber()
							  << " (" << getNoteNameFromNumber(message.getNoteNumber()) << ")"
							  << ", Vel " << (int)message.getVelocity()
							  << ", Ch " << message.getChannel()
							  << " at " << std::fixed << std::setprecision(3) << timeInSeconds << "s" << std::endl;
					totalNoteOnEvents++;
				}
				else if (message.isNoteOff())
				{
					std::cout << "  NOTE OFF: Note " << message.getNoteNumber()
							  << " (" << getNoteNameFromNumber(message.getNoteNumber()) << ")"
							  << ", Vel " << (int)message.getVelocity()
							  << ", Ch " << message.getChannel()
							  << " at " << std::fixed << std::setprecision(3) << timeInSeconds << "s" << std::endl;
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
					// Don't spam with every meta event, just count them
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

	// Helper function - add this to your SimpleMidiSequence class:
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
        // Track note-on events that don't have corresponding note-offs
        std::map<int, double> hangingNotes; // note number -> start time

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

        // Add note-off events for hanging notes
        for (const auto& note : hangingNotes)
        {
            auto noteOffTime = totalLength + 0.1; // Add 100ms after end
            auto noteOffMessage = juce::MidiMessage::noteOff(1, note.first, (juce::uint8)64);
            events.emplace_back(noteOffTime, noteOffMessage);
            totalLength = juce::jmax(totalLength, noteOffTime);
        }

        // Re-sort after adding note-offs
        std::sort(events.begin(), events.end(),
                  [](const MidiEvent& a, const MidiEvent& b) {
                      return a.timeStamp < b.timeStamp;
                  });
    }
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

        // Validate configuration
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

        // Determine final sample rate and bit depth
        double finalSampleRate = (config.sampleRate > 0) ? config.sampleRate : 44100.0;
        int finalBitDepth = (config.bitDepth > 0) ? config.bitDepth : 24;

        std::cout << "Processing settings:" << std::endl;
        std::cout << "  Sample rate: " << finalSampleRate << " Hz" << std::endl;
        std::cout << "  Bit depth: " << finalBitDepth << " bits" << std::endl;
        std::cout << "  Buffer size: " << config.bufferSize << " samples" << std::endl;
        std::cout << "  Instrument channels: " << config.instrumentChannels << std::endl;

        // Initialize plugin chain
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
                break; // Use first instrument's MIDI file
            }
        }

        // Determine render length
        double renderLength = config.renderLength;
        if (renderLength <= 0.0)
        {
            renderLength = midiSequence.totalLength + 2.0; // Add 2 seconds tail
        }

        std::cout << "Render length: " << renderLength << " seconds" << std::endl;

        // Calculate total samples
        auto totalSamples = static_cast<int>(renderLength * finalSampleRate);
        std::cout << "Total samples to render: " << totalSamples << std::endl;

        // Create audio buffer for rendering
        juce::AudioBuffer<float> audioBuffer(config.instrumentChannels, totalSamples);
        audioBuffer.clear();

        // Render instrument and process through effects chain
        renderInstrumentChain(audioBuffer, finalSampleRate, renderLength);

        // Write output file
        return writeAudioFile(audioBuffer, finalSampleRate, config.instrumentChannels, finalBitDepth);
    }

    bool processAudioFile()
    {
        // Original audio file processing code
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

        return writeAudioFile(audioBuffer, finalSampleRate, numChannels, finalBitDepth);
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

		// Track current MIDI event index
		size_t currentMidiEventIndex = 0;
		int totalMidiEventsSent = 0;
		int totalNoteOnsSent = 0;
		int totalNoteOffsSent = 0;
		int blocksWithAudio = 0;

		// Process in chunks
		for (int startSample = 0; startSample < totalSamples; startSample += blockSize)
		{
			auto samplesToProcess = juce::jmin(blockSize, totalSamples - startSample);
			double currentTimeStart = startSample / sampleRate;
			double currentTimeEnd = (startSample + samplesToProcess) / sampleRate;

			// Create MIDI buffer for this block
			juce::MidiBuffer midiBuffer;
			int eventsInThisBuffer = 0;

			// Add MIDI events that occur in this time range
			while (currentMidiEventIndex < midiSequence.events.size())
			{
				const auto& event = midiSequence.events[currentMidiEventIndex];

				if (event.timeStamp >= currentTimeEnd)
					break; // Event is in future blocks

				if (event.timeStamp >= currentTimeStart)
				{
					// Event occurs in this block
					int sampleOffset = static_cast<int>((event.timeStamp - currentTimeStart) * sampleRate);
					sampleOffset = juce::jlimit(0, samplesToProcess - 1, sampleOffset);

					midiBuffer.addEvent(event.message, sampleOffset);
					eventsInThisBuffer++;
					totalMidiEventsSent++;

					// Only log important MIDI events (notes)
					if (event.message.isNoteOn())
					{
						std::cout << "SENT: Note On  - Note " << event.message.getNoteNumber()
								  << " (" << SimpleMidiSequence::getNoteNameFromNumber(event.message.getNoteNumber()) << ")"
								  << ", Vel " << (int)event.message.getVelocity()
								  << " at time " << std::fixed << std::setprecision(3) << event.timeStamp
								  << "s, sample " << (startSample + sampleOffset) << std::endl;
						totalNoteOnsSent++;
					}
					else if (event.message.isNoteOff())
					{
						std::cout << "SENT: Note Off - Note " << event.message.getNoteNumber()
								  << " (" << SimpleMidiSequence::getNoteNameFromNumber(event.message.getNoteNumber()) << ")"
								  << " at time " << std::fixed << std::setprecision(3) << event.timeStamp
								  << "s, sample " << (startSample + sampleOffset) << std::endl;
						totalNoteOffsSent++;
					}
					// Skip logging meta events to reduce spam
				}

				currentMidiEventIndex++;
			}

			// Create a view of the current block
			juce::AudioBuffer<float> blockBuffer(buffer.getArrayOfWritePointers(),
											   buffer.getNumChannels(),
											   startSample,
											   samplesToProcess);

			// Clear the block initially
			blockBuffer.clear();

			// Process through each plugin in the chain
			for (size_t pluginIndex = 0; pluginIndex < pluginChain.size(); ++pluginIndex)
			{
				auto& plugin = pluginChain[pluginIndex];

				if (config.plugins[pluginIndex].isInstrument)
				{
					// For instruments, pass MIDI and let them generate audio
					plugin->processBlock(blockBuffer, midiBuffer);

					// Check if we now have audio after instrument processing
					float postInstrumentLevel = blockBuffer.getRMSLevel(0, 0, samplesToProcess);
					if (postInstrumentLevel > 0.001f)  // Higher threshold to reduce spam
					{
						std::cout << "Audio generated at sample " << startSample
								  << " (time " << std::fixed << std::setprecision(3) << currentTimeStart << "s)"
								  << ", level: " << std::fixed << std::setprecision(3) << postInstrumentLevel;
						if (eventsInThisBuffer > 0)
							std::cout << " [" << eventsInThisBuffer << " MIDI events]";
						std::cout << std::endl;
						blocksWithAudio++;
					}

					// Clear MIDI buffer after instrument processing
					midiBuffer.clear();
				}
				else
				{
					// For audio effects, process the audio (no MIDI)
					juce::MidiBuffer emptyMidi;
					plugin->processBlock(blockBuffer, emptyMidi);
				}
			}

			// Progress indicator (less frequent)
			if (startSample % (blockSize * 200) == 0)  // Every 200 blocks instead of 50
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

		// Check final audio buffer for any content
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

            // Load plugin
            juce::File pluginFile(pluginConfig.pluginPath);
            if (!pluginFile.exists())
            {
                std::cerr << "Plugin path not found: " << pluginConfig.pluginPath << std::endl;
                return false;
            }

            // Find plugin descriptions
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
                        break;  // Use first format that finds plugins
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

            // Select which plugin to use
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
                // If looking for instrument, prefer instrument plugins
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

            // Configure plugin
            plugin->prepareToPlay(sampleRate, config.bufferSize);

            int inputChannels = pluginConfig.isInstrument ? 0 : numChannels;
            int outputChannels = pluginConfig.isInstrument ? config.instrumentChannels : numChannels;
            plugin->setPlayConfigDetails(inputChannels, outputChannels, sampleRate, config.bufferSize);

            // Set program if specified
            if (pluginConfig.programNumber >= 0)
            {
                if (plugin->getNumPrograms() > pluginConfig.programNumber)
                {
                    plugin->setCurrentProgram(pluginConfig.programNumber);
                    std::cout << "Set program to: " << pluginConfig.programNumber << std::endl;
                    std::cout << "Program name: " << plugin->getProgramName(pluginConfig.programNumber) << std::endl;
                }
                else
                {
                    std::cout << "Warning: Program " << pluginConfig.programNumber << " not available (max: " << (plugin->getNumPrograms() - 1) << ")" << std::endl;
                }
            }

            // Load preset if specified
            if (!pluginConfig.presetPath.isEmpty())
            {
                loadPreset(plugin.get(), pluginConfig.presetPath);
            }

            // Set parameters if specified
            if (pluginConfig.parameters.isObject())
            {
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
        std::cout << "Loading preset: " << presetPath << std::endl;

        juce::File presetFile(presetPath);
        if (!presetFile.existsAsFile())
        {
            std::cout << "Preset file does not exist!" << std::endl;
            return false;
        }

        // Try to load as VST3 preset
        if (presetPath.endsWithIgnoreCase(".vstpreset"))
        {
            juce::MemoryBlock presetData;
            if (presetFile.loadFileAsData(presetData))
            {
                try
                {
                    plugin->setStateInformation(presetData.getData(), static_cast<int>(presetData.getSize()));
                    std::cout << "Preset loaded successfully!" << std::endl;
                    return true;
                }
                catch (...)
                {
                    std::cout << "Failed to load preset" << std::endl;
                }
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

        auto& properties = paramObject->getProperties();
        std::cout << "Setting " << properties.size() << " parameters:" << std::endl;

        for (auto& prop : properties)
        {
            auto paramName = prop.name.toString();
            auto requestedValue = static_cast<float>(prop.value);

            std::cout << "  Setting: " << paramName << " = " << requestedValue << std::endl;

            // Find parameter by name
            const auto& params = plugin->getParameters();
            bool paramFound = false;

            for (int i = 0; i < params.size(); ++i)
            {
                auto* param = params[i];
                auto currentName = param->getName(256);

                if (currentName == paramName || currentName.containsIgnoreCase(paramName))
                {
                    param->setValue(requestedValue);
                    std::cout << "    Parameter set: " << currentName << " = " << param->getValue() << std::endl;
                    paramFound = true;
                    break;
                }
            }

            if (!paramFound)
            {
                std::cout << "    Parameter '" << paramName << "' not found" << std::endl;
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

    bool writeAudioFile(const juce::AudioBuffer<float>& buffer, double sampleRate, int numChannels, int bitDepth)
    {
        juce::File outputFile(config.outputFile);

        // Delete existing output file
        if (outputFile.exists())
        {
            outputFile.deleteFile();
        }

        // Create output directory if needed
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

        // Clamp bit depth to supported values
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

        fileStream.release(); // Writer now owns the stream

        // Write audio data
        writer->writeFromAudioSampleBuffer(buffer, 0, buffer.getNumSamples());
        writer->flush();

        std::cout << "Output written to: " << config.outputFile << std::endl;
        std::cout << "  Sample rate: " << sampleRate << " Hz" << std::endl;
        std::cout << "  Bit depth: " << finalBitDepth << " bits" << std::endl;
        std::cout << "  Channels: " << numChannels << std::endl;
        std::cout << "  Samples: " << buffer.getNumSamples() << std::endl;

        return true;
    }
};

//==============================================================================
int main(int argc, char* argv[])
{
    // Initialize JUCE
    juce::initialiseJuce_GUI();

    if (argc < 2)
    {
        std::cout << "VST Plugin Host with VSTi Support" << std::endl;
        std::cout << "Usage: VSTPluginHost <config.json>" << std::endl;
        std::cout << "Example: VSTPluginHost dexed_config.json" << std::endl;
        std::cout << std::endl;
        std::cout << "Supports:" << std::endl;
        std::cout << "  - Virtual Instruments (VSTi) with MIDI input" << std::endl;
        std::cout << "  - Audio Effects processing" << std::endl;
        std::cout << "  - Hybrid chains: VSTi -> Effects" << std::endl;
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

    std::cout << "Processing audio..." << std::endl;

    bool success = host.processAudio();

    if (!success)
    {
        std::cerr << "Failed to process audio" << std::endl;
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