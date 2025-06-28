#include <iostream>
#include <iomanip>
#include <juce_core/juce_core.h>
#include <juce_audio_basics/juce_audio_basics.h>
#include "MidiUtilities.h"

//==============================================================================
/**
 * Standalone utility to create test MIDI files for VSTi testing
 */
class TestMidiGenerator
{
public:
    static void printUsage()
    {
        std::cout << "Test MIDI File Generator for VSTi Testing" << std::endl;
        std::cout << "=========================================" << std::endl;
        std::cout << std::endl;
        std::cout << "Usage:" << std::endl;
        std::cout << "  TestMidi <command> [options]" << std::endl;
        std::cout << std::endl;
        std::cout << "Commands:" << std::endl;
        std::cout << "  create <output.mid> [duration] [tempo] [base_note]" << std::endl;
        std::cout << "    Create a test MIDI file with chord progression" << std::endl;
        std::cout << "    duration: Length in seconds (default: 10)" << std::endl;
        std::cout << "    tempo: BPM (default: 120)" << std::endl;
        std::cout << "    base_note: MIDI note number (default: 60 = C4)" << std::endl;
        std::cout << std::endl;
        std::cout << "  analyze <input.mid>" << std::endl;
        std::cout << "    Analyze MIDI file and show detailed information" << std::endl;
        std::cout << std::endl;
        std::cout << "  validate <input.mid>" << std::endl;
        std::cout << "    Check if MIDI file is suitable for VSTi rendering" << std::endl;
        std::cout << std::endl;
        std::cout << "  extract <input.mid> <output.mid> <channels...>" << std::endl;
        std::cout << "    Extract specific MIDI channels to new file" << std::endl;
        std::cout << "    channels: Space-separated list (e.g., 1 2 10)" << std::endl;
        std::cout << std::endl;
        std::cout << "  transpose <input.mid> <output.mid> <semitones>" << std::endl;
        std::cout << "    Transpose MIDI file by semitones (-48 to +48)" << std::endl;
        std::cout << std::endl;
        std::cout << "  drums <output.mid> [duration] [tempo]" << std::endl;
        std::cout << "    Create a test drum pattern on channel 10" << std::endl;
        std::cout << std::endl;
        std::cout << "  scale <output.mid> <scale_type> [root_note] [duration]" << std::endl;
        std::cout << "    Create a scale pattern (major, minor, chromatic)" << std::endl;
        std::cout << std::endl;
        std::cout << "Examples:" << std::endl;
        std::cout << "  TestMidi create test_chord.mid 30 140 57" << std::endl;
        std::cout << "  TestMidi analyze my_song.mid" << std::endl;
        std::cout << "  TestMidi extract full_song.mid bass_only.mid 2" << std::endl;
        std::cout << "  TestMidi transpose melody.mid melody_up.mid 12" << std::endl;
        std::cout << "  TestMidi drums drum_test.mid 16" << std::endl;
        std::cout << "  TestMidi scale c_major.mid major 60 20" << std::endl;
    }

    static bool createDrumPattern(const juce::String& outputPath,
                                 double durationSeconds = 16.0,
                                 double tempo = 120.0)
    {
        juce::MidiFile midiFile;
        midiFile.setTicksPerQuarterNote(480);

        juce::MidiMessageSequence track;

        double ticksPerSecond = (480 * tempo) / 60.0;
        double ticksPerBeat = ticksPerSecond * (60.0 / tempo);
        int totalTicks = static_cast<int>(durationSeconds * ticksPerSecond);

        // Drum mapping (General MIDI)
        int kick = 36;      // Bass drum 1
        int snare = 38;     // Acoustic snare
        int hihat = 42;     // Closed hi-hat
        int openhat = 46;   // Open hi-hat
        int crash = 49;     // Crash cymbal 1

        // Create a 4/4 rock pattern
        double patternLength = 4.0 * (60.0 / tempo); // 4 beats in seconds
        int patternTicks = static_cast<int>(patternLength * ticksPerSecond);

        for (int tick = 0; tick < totalTicks; tick += patternTicks)
        {
            // Kick on beats 1 and 3
            track.addEvent(juce::MidiMessage::noteOn(10, kick, (juce::uint8)100), tick);
            track.addEvent(juce::MidiMessage::noteOff(10, kick, (juce::uint8)100), tick + 120);

            track.addEvent(juce::MidiMessage::noteOn(10, kick, (juce::uint8)90), tick + patternTicks/2);
            track.addEvent(juce::MidiMessage::noteOff(10, kick, (juce::uint8)90), tick + patternTicks/2 + 120);

            // Snare on beats 2 and 4
            track.addEvent(juce::MidiMessage::noteOn(10, snare, (juce::uint8)110), tick + patternTicks/4);
            track.addEvent(juce::MidiMessage::noteOff(10, snare, (juce::uint8)110), tick + patternTicks/4 + 120);

            track.addEvent(juce::MidiMessage::noteOn(10, snare, (juce::uint8)105), tick + 3*patternTicks/4);
            track.addEvent(juce::MidiMessage::noteOff(10, snare, (juce::uint8)105), tick + 3*patternTicks/4 + 120);

            // Hi-hat on every eighth note
            for (int i = 0; i < 8; ++i)
            {
                int hihatTick = tick + i * patternTicks/8;
                int velocity = (i % 2 == 0) ? 80 : 60; // Accent on downbeats

                if (i == 7) // Open hi-hat on last eighth
                {
                    track.addEvent(juce::MidiMessage::noteOn(10, openhat, (juce::uint8)70), hihatTick);
                    track.addEvent(juce::MidiMessage::noteOff(10, openhat, (juce::uint8)70), hihatTick + 240);
                }
                else
                {
                    track.addEvent(juce::MidiMessage::noteOn(10, hihat, (juce::uint8)velocity), hihatTick);
                    track.addEvent(juce::MidiMessage::noteOff(10, hihat, (juce::uint8)velocity), hihatTick + 60);
                }
            }
        }

        // Add crash at the beginning
        track.addEvent(juce::MidiMessage::noteOn(10, crash, (juce::uint8)120), 0);
        track.addEvent(juce::MidiMessage::noteOff(10, crash, (juce::uint8)120), 960);

        // Add tempo and track info
        track.addEvent(juce::MidiMessage::tempoMetaEvent(static_cast<int>(60000000.0 / tempo)), 0);
        track.addEvent(juce::MidiMessage::textMetaEvent(3, "Drum Track"), 0);
        track.addEvent(juce::MidiMessage::endOfTrack(), totalTicks);

        midiFile.addTrack(track);

        // Write file
        juce::File outputFile(outputPath);
        outputFile.getParentDirectory().createDirectory();

        juce::FileOutputStream fileStream(outputFile);
        if (!fileStream.openedOk())
        {
            std::cerr << "Could not create MIDI file: " << outputPath << std::endl;
            return false;
        }

        bool success = midiFile.writeTo(fileStream);
        if (success)
        {
            std::cout << "Created drum MIDI file: " << outputPath << std::endl;
            std::cout << "  Duration: " << durationSeconds << " seconds" << std::endl;
            std::cout << "  Tempo: " << tempo << " BPM" << std::endl;
            std::cout << "  Pattern: 4/4 Rock beat on channel 10" << std::endl;
            std::cout << "  Instruments: Kick, Snare, Hi-hat, Crash" << std::endl;
        }

        return success;
    }

    static bool createScale(const juce::String& outputPath,
                           const juce::String& scaleType,
                           int rootNote = 60,
                           double durationSeconds = 10.0,
                           double tempo = 120.0)
    {
        std::vector<int> intervals;

        juce::String lowerScaleType = scaleType.toLowerCase();

        if (lowerScaleType == "major")
        {
            intervals = {0, 2, 4, 5, 7, 9, 11, 12}; // Major scale
        }
        else if (lowerScaleType == "minor")
        {
            intervals = {0, 2, 3, 5, 7, 8, 10, 12}; // Natural minor scale
        }
        else if (lowerScaleType == "chromatic")
        {
            intervals = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12}; // Chromatic scale
        }
        else if (lowerScaleType == "pentatonic")
        {
            intervals = {0, 2, 4, 7, 9, 12}; // Major pentatonic
        }
        else if (lowerScaleType == "blues")
        {
            intervals = {0, 3, 5, 6, 7, 10, 12}; // Blues scale
        }
        else
        {
            std::cerr << "Unknown scale type: " << scaleType << std::endl;
            std::cerr << "Supported scales: major, minor, chromatic, pentatonic, blues" << std::endl;
            return false;
        }

        juce::MidiFile midiFile;
        midiFile.setTicksPerQuarterNote(480);

        juce::MidiMessageSequence track;

        double ticksPerSecond = (480 * tempo) / 60.0;
        double noteLength = durationSeconds / intervals.size();
        int ticksPerNote = static_cast<int>(noteLength * ticksPerSecond);

        // Play scale ascending then descending
        std::vector<int> fullPattern = intervals;

        // Add descending (reverse without repeating the top note)
        for (int i = static_cast<int>(intervals.size()) - 2; i >= 0; --i)
        {
            fullPattern.push_back(intervals[i]);
        }

        // Adjust note length for full pattern
        noteLength = durationSeconds / fullPattern.size();
        ticksPerNote = static_cast<int>(noteLength * ticksPerSecond);

        for (size_t i = 0; i < fullPattern.size(); ++i)
        {
            int noteNumber = rootNote + fullPattern[i];
            int startTick = static_cast<int>(i * ticksPerNote);
            int endTick = startTick + ticksPerNote - 48; // Small gap between notes

            track.addEvent(juce::MidiMessage::noteOn(1, noteNumber, (juce::uint8)80), startTick);
            track.addEvent(juce::MidiMessage::noteOff(1, noteNumber, (juce::uint8)80), endTick);
        }

        // Add meta events
        track.addEvent(juce::MidiMessage::tempoMetaEvent(static_cast<int>(60000000.0 / tempo)), 0);
        track.addEvent(juce::MidiMessage::textMetaEvent(3, scaleType + " Scale"), 0);
        track.addEvent(juce::MidiMessage::endOfTrack(), static_cast<int>(durationSeconds * ticksPerSecond));

        midiFile.addTrack(track);

        // Write file
        juce::File outputFile(outputPath);
        outputFile.getParentDirectory().createDirectory();

        juce::FileOutputStream fileStream(outputFile);
        if (!fileStream.openedOk())
        {
            std::cerr << "Could not create MIDI file: " << outputPath << std::endl;
            return false;
        }

        bool success = midiFile.writeTo(fileStream);
        if (success)
        {
            std::cout << "Created scale MIDI file: " << outputPath << std::endl;
            std::cout << "  Scale: " << scaleType << std::endl;
            std::cout << "  Root note: " << rootNote << " (" << MidiUtilities::getNoteNameFromNumber(rootNote) << ")" << std::endl;
            std::cout << "  Duration: " << durationSeconds << " seconds" << std::endl;
            std::cout << "  Tempo: " << tempo << " BPM" << std::endl;
            std::cout << "  Pattern: Ascending then descending" << std::endl;
        }

        return success;
    }
};

//==============================================================================
int main(int argc, char* argv[])
{
    juce::initialiseJuce_GUI();

    if (argc < 2)
    {
        TestMidiGenerator::printUsage();
        juce::shutdownJuce_GUI();
        return 1;
    }

    juce::String command = argv[1];
    command = command.toLowerCase();

    bool success = false;

    if (command == "create" && argc >= 3)
    {
        juce::String outputPath = argv[2];
        double duration = (argc >= 4) ? juce::String(argv[3]).getDoubleValue() : 10.0;
        double tempo = (argc >= 5) ? juce::String(argv[4]).getDoubleValue() : 120.0;
        int baseNote = (argc >= 6) ? juce::String(argv[5]).getIntValue() : 60;

        success = MidiUtilities::createTestMidiFile(outputPath, duration, baseNote, tempo);
    }
    else if (command == "analyze" && argc >= 3)
    {
        juce::String inputPath = argv[2];
        auto analysis = MidiUtilities::analyzeMidiFile(inputPath);
        analysis.print();
        success = (analysis.totalEvents > 0);
    }
    else if (command == "validate" && argc >= 3)
    {
        juce::String inputPath = argv[2];
        juce::String errorMessage;
        success = MidiUtilities::validateMidiForVsti(inputPath, errorMessage);

        if (success)
        {
            std::cout << "MIDI file is valid for VSTi rendering" << std::endl;
        }
        else
        {
            std::cout << "MIDI file validation failed: " << errorMessage << std::endl;
        }
    }
    else if (command == "extract" && argc >= 5)
    {
        juce::String inputPath = argv[2];
        juce::String outputPath = argv[3];

        std::vector<int> channels;
        for (int i = 4; i < argc; ++i)
        {
            int channel = juce::String(argv[i]).getIntValue();
            if (channel >= 1 && channel <= 16)
            {
                channels.push_back(channel);
            }
            else
            {
                std::cerr << "Invalid MIDI channel: " << channel << " (must be 1-16)" << std::endl;
            }
        }

        if (!channels.empty())
        {
            success = MidiUtilities::extractMidiChannels(inputPath, outputPath, channels);
        }
    }
    else if (command == "transpose" && argc >= 5)
    {
        juce::String inputPath = argv[2];
        juce::String outputPath = argv[3];
        int semitones = juce::String(argv[4]).getIntValue();

        success = MidiUtilities::transposeMidi(inputPath, outputPath, semitones);
    }
    else if (command == "drums" && argc >= 3)
    {
        juce::String outputPath = argv[2];
        double duration = (argc >= 4) ? juce::String(argv[3]).getDoubleValue() : 16.0;
        double tempo = (argc >= 5) ? juce::String(argv[4]).getDoubleValue() : 120.0;

        success = TestMidiGenerator::createDrumPattern(outputPath, duration, tempo);
    }
    else if (command == "scale" && argc >= 4)
    {
        juce::String outputPath = argv[2];
        juce::String scaleType = argv[3];
        int rootNote = (argc >= 5) ? juce::String(argv[4]).getIntValue() : 60;
        double duration = (argc >= 6) ? juce::String(argv[5]).getDoubleValue() : 10.0;

        success = TestMidiGenerator::createScale(outputPath, scaleType, rootNote, duration);
    }
    else
    {
        std::cout << "Invalid command or insufficient arguments." << std::endl;
        std::cout << std::endl;
        TestMidiGenerator::printUsage();
    }

    juce::shutdownJuce_GUI();
    return success ? 0 : 1;
}