#pragma once

#include <juce_core/juce_core.h>
#include <juce_audio_basics/juce_audio_basics.h>
#include <vector>
#include <map>
#include <set>

//==============================================================================
/**
 * Enhanced MIDI utilities for VSTi rendering
 * Provides advanced MIDI file analysis and processing capabilities
 */
class MidiUtilities
{
public:
    struct MidiAnalysis
    {
        double totalDuration = 0.0;
        double firstNoteTime = 0.0;
        double lastNoteTime = 0.0;
        int lowestNote = 127;
        int highestNote = 0;
        int totalNotes = 0;
        int totalEvents = 0;
        double averageTempo = 120.0;
        
        // Track information
        struct TrackInfo
        {
            int trackIndex;
            juce::String trackName;
            int eventCount;
            int noteCount;
            bool hasNotes;
            bool hasControlChanges;
            bool hasProgramChanges;
            bool hasTempoChanges;
            int channelMask = 0; // Bitmask of MIDI channels used
        };
        
        std::vector<TrackInfo> tracks;
        
        // Channel information
        struct ChannelInfo
        {
            int channel;
            int noteCount;
            int programNumber = -1;
            std::set<int> usedNotes;
            bool isDrumChannel = false;
        };
        
        std::map<int, ChannelInfo> channels;
        
        void print() const
        {
            std::cout << "=== MIDI ANALYSIS REPORT ===" << std::endl;
            std::cout << "Duration: " << totalDuration << " seconds" << std::endl;
            std::cout << "First Note: " << firstNoteTime << " seconds" << std::endl;
            std::cout << "Last Note: " << lastNoteTime << " seconds" << std::endl;
            std::cout << "Note Range: " << lowestNote << " - " << highestNote << std::endl;
            std::cout << "Total Notes: " << totalNotes << std::endl;
            std::cout << "Total Events: " << totalEvents << std::endl;
            std::cout << "Average Tempo: " << averageTempo << " BPM" << std::endl;
            std::cout << "Tracks: " << tracks.size() << std::endl;
            
            for (const auto& track : tracks)
            {
                std::cout << "  Track " << track.trackIndex << ": " << track.trackName 
                         << " (" << track.eventCount << " events, " << track.noteCount << " notes)" << std::endl;
                std::cout << "    Notes: " << (track.hasNotes ? "YES" : "NO")
                         << ", CC: " << (track.hasControlChanges ? "YES" : "NO")
                         << ", PC: " << (track.hasProgramChanges ? "YES" : "NO")
                         << ", Tempo: " << (track.hasTempoChanges ? "YES" : "NO") << std::endl;
            }
            
            std::cout << "MIDI Channels Used: " << channels.size() << std::endl;
            for (const auto& [channel, info] : channels)
            {
                std::cout << "  Channel " << channel << ": " << info.noteCount << " notes";
                if (info.programNumber >= 0)
                    std::cout << ", Program " << info.programNumber;
                if (info.isDrumChannel)
                    std::cout << " (DRUMS)";
                std::cout << std::endl;
            }
            std::cout << "===========================" << std::endl;
        }
    };
    
    /**
     * Analyze a MIDI file and return comprehensive information
     */
    static MidiAnalysis analyzeMidiFile(const juce::String& midiFilePath)
    {
        MidiAnalysis analysis;
        
        juce::File midiFile(midiFilePath);
        if (!midiFile.existsAsFile())
        {
            std::cerr << "MIDI file not found: " << midiFilePath << std::endl;
            return analysis;
        }
        
        juce::FileInputStream fileStream(midiFile);
        if (!fileStream.openedOk())
        {
            std::cerr << "Could not open MIDI file: " << midiFilePath << std::endl;
            return analysis;
        }
        
        juce::MidiFile midi;
        if (!midi.readFrom(fileStream))
        {
            std::cerr << "Could not parse MIDI file: " << midiFilePath << std::endl;
            return analysis;
        }
        
        // Basic file info
        int timeFormat = midi.getTimeFormat();
        bool isTicksPerQuarter = (timeFormat > 0);
        
        std::cout << "MIDI File Analysis:" << std::endl;
        std::cout << "  Time Format: " << timeFormat << (isTicksPerQuarter ? " (PPQ)" : " (SMPTE)") << std::endl;
        std::cout << "  Tracks: " << midi.getNumTracks() << std::endl;
        
        // Track-by-track analysis
        double currentTempo = 120.0; // Default tempo
        int tempoEventCount = 0;
        double totalTempo = 0.0;
        
        for (int trackIndex = 0; trackIndex < midi.getNumTracks(); ++trackIndex)
        {
            const auto* track = midi.getTrack(trackIndex);
            MidiAnalysis::TrackInfo trackInfo;
            trackInfo.trackIndex = trackIndex;
            trackInfo.eventCount = track->getNumEvents();
            trackInfo.noteCount = 0;
            trackInfo.hasNotes = false;
            trackInfo.hasControlChanges = false;
            trackInfo.hasProgramChanges = false;
            trackInfo.hasTempoChanges = false;
            
            // Analyze events in this track
            for (int eventIndex = 0; eventIndex < track->getNumEvents(); ++eventIndex)
            {
                const auto& midiEvent = track->getEventPointer(eventIndex);
                const auto& message = midiEvent->message;
                
                // Convert to absolute time
                double timeInSeconds = 0.0;
                if (isTicksPerQuarter)
                {
                    // Simple conversion assuming current tempo
                    double ticksPerSecond = (timeFormat * currentTempo) / 60.0;
                    timeInSeconds = midiEvent->timeStamp / ticksPerSecond;
                }
                else
                {
                    // SMPTE format - direct time conversion
                    timeInSeconds = midiEvent->timeStamp;
                }
                
                analysis.totalEvents++;
                analysis.totalDuration = juce::jmax(analysis.totalDuration, timeInSeconds);
                
                // Analyze message type
                if (message.isNoteOn())
                {
                    trackInfo.hasNotes = true;
                    trackInfo.noteCount++;
                    analysis.totalNotes++;
                    
                    int noteNumber = message.getNoteNumber();
                    int channel = message.getChannel();
                    
                    analysis.lowestNote = juce::jmin(analysis.lowestNote, noteNumber);
                    analysis.highestNote = juce::jmax(analysis.highestNote, noteNumber);
                    
                    if (analysis.firstNoteTime == 0.0 || timeInSeconds < analysis.firstNoteTime)
                        analysis.firstNoteTime = timeInSeconds;
                    if (timeInSeconds > analysis.lastNoteTime)
                        analysis.lastNoteTime = timeInSeconds;
                    
                    trackInfo.channelMask |= (1 << (channel - 1));
                    
                    // Update channel info
                    auto& channelInfo = analysis.channels[channel];
                    channelInfo.channel = channel;
                    channelInfo.noteCount++;
                    channelInfo.usedNotes.insert(noteNumber);
                    channelInfo.isDrumChannel = (channel == 10); // MIDI channel 10 is typically drums
                }
                else if (message.isControllerOfType(7)) // Volume CC
                {
                    trackInfo.hasControlChanges = true;
                }
                else if (message.isProgramChange())
                {
                    trackInfo.hasProgramChanges = true;
                    int channel = message.getChannel();
                    analysis.channels[channel].programNumber = message.getProgramChangeNumber();
                }
                else if (message.isTempoMetaEvent())
                {
                    trackInfo.hasTempoChanges = true;
                    currentTempo = 60000000.0 / message.getTempoSecondsPerQuarterNote();
                    totalTempo += currentTempo;
                    tempoEventCount++;
                }
                else if (message.isTrackNameEvent())
                {
                    trackInfo.trackName = message.getTextFromTextMetaEvent();
                }
            }
            
            analysis.tracks.push_back(trackInfo);
        }
        
        // Calculate average tempo
        if (tempoEventCount > 0)
            analysis.averageTempo = totalTempo / tempoEventCount;
        else
            analysis.averageTempo = currentTempo;
        
        return analysis;
    }
    
    /**
     * Create a simplified MIDI file for testing
     */
    static bool createTestMidiFile(const juce::String& outputPath, 
                                   double durationSeconds = 10.0,
                                   int baseNote = 60, // Middle C
                                   double tempo = 120.0)
    {
        juce::MidiFile midiFile;
        midiFile.setTicksPerQuarterNote(480);
        
        juce::MidiMessageSequence track;
        
        // Calculate timing
        double ticksPerSecond = (480 * tempo) / 60.0;
        int totalTicks = static_cast<int>(durationSeconds * ticksPerSecond);
        
        // Create a simple chord progression
        std::vector<std::vector<int>> chords = {
            {baseNote, baseNote + 4, baseNote + 7},     // C major
            {baseNote + 5, baseNote + 9, baseNote + 12}, // F major
            {baseNote + 7, baseNote + 11, baseNote + 14}, // G major
            {baseNote, baseNote + 4, baseNote + 7}       // C major
        };
        
        double chordDuration = durationSeconds / chords.size();
        
        for (size_t chordIndex = 0; chordIndex < chords.size(); ++chordIndex)
        {
            double startTime = chordIndex * chordDuration;
            double endTime = startTime + chordDuration * 0.8; // 80% duration with gaps
            
            int startTick = static_cast<int>(startTime * ticksPerSecond);
            int endTick = static_cast<int>(endTime * ticksPerSecond);
            
            // Add notes for this chord
            for (int note : chords[chordIndex])
            {
                auto noteOn = juce::MidiMessage::noteOn(1, note, (juce::uint8)100);
                auto noteOff = juce::MidiMessage::noteOff(1, note, (juce::uint8)100);
                
                track.addEvent(noteOn, startTick);
                track.addEvent(noteOff, endTick);
            }
        }
        
        // Add tempo event
        auto tempoEvent = juce::MidiMessage::tempoMetaEvent(static_cast<int>(60000000.0 / tempo));
        track.addEvent(tempoEvent, 0);
        
        // Add track name
        auto trackName = juce::MidiMessage::textMetaEvent(3, "Test Track");
        track.addEvent(trackName, 0);
        
        // Add end of track
        auto endOfTrack = juce::MidiMessage::endOfTrack();
        track.addEvent(endOfTrack, totalTicks);
        
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
            std::cout << "Created test MIDI file: " << outputPath << std::endl;
            std::cout << "  Duration: " << durationSeconds << " seconds" << std::endl;
            std::cout << "  Tempo: " << tempo << " BPM" << std::endl;
            std::cout << "  Base Note: " << baseNote << " (MIDI note number)" << std::endl;
            std::cout << "  Chords: " << chords.size() << std::endl;
        }
        
        return success;
    }
    
    /**
     * Validate MIDI file for VSTi compatibility
     */
    static bool validateMidiForVsti(const juce::String& midiFilePath, juce::String& errorMessage)
    {
        auto analysis = analyzeMidiFile(midiFilePath);
        
        if (analysis.totalEvents == 0)
        {
            errorMessage = "MIDI file contains no events";
            return false;
        }
        
        if (analysis.totalNotes == 0)
        {
            errorMessage = "MIDI file contains no note events";
            return false;
        }
        
        if (analysis.totalDuration <= 0.0)
        {
            errorMessage = "MIDI file has invalid duration";
            return false;
        }
        
        if (analysis.totalDuration > 3600.0) // 1 hour limit
        {
            errorMessage = "MIDI file too long (> 1 hour), consider splitting";
            return false;
        }
        
        // Check for extremely dense MIDI (performance warning)
        double eventsPerSecond = analysis.totalEvents / analysis.totalDuration;
        if (eventsPerSecond > 1000.0)
        {
            errorMessage = "Warning: Very dense MIDI file (" + juce::String(eventsPerSecond, 1) + 
                          " events/sec), may impact performance";
            // Don't fail, just warn
        }
        
        return true;
    }
    
    /**
     * Extract specific channels from MIDI file
     */
    static bool extractMidiChannels(const juce::String& inputPath, 
                                   const juce::String& outputPath,
                                   const std::vector<int>& channels)
    {
        juce::File inputFile(inputPath);
        if (!inputFile.existsAsFile())
        {
            std::cerr << "Input MIDI file not found: " << inputPath << std::endl;
            return false;
        }
        
        juce::FileInputStream fileStream(inputFile);
        if (!fileStream.openedOk())
        {
            std::cerr << "Could not open input MIDI file: " << inputPath << std::endl;
            return false;
        }
        
        juce::MidiFile inputMidi;
        if (!inputMidi.readFrom(fileStream))
        {
            std::cerr << "Could not parse input MIDI file: " << inputPath << std::endl;
            return false;
        }
        
        juce::MidiFile outputMidi;
        outputMidi.setTicksPerQuarterNote(inputMidi.getTimeFormat());
        
        std::set<int> channelSet(channels.begin(), channels.end());
        
        // Process each track
        for (int trackIndex = 0; trackIndex < inputMidi.getNumTracks(); ++trackIndex)
        {
            const auto* inputTrack = inputMidi.getTrack(trackIndex);
            juce::MidiMessageSequence outputTrack;
            
            for (int eventIndex = 0; eventIndex < inputTrack->getNumEvents(); ++eventIndex)
            {
                const auto& midiEvent = inputTrack->getEventPointer(eventIndex);
                const auto& message = midiEvent->message;
                
                // Include non-channel messages (meta events, etc.)
                if (!message.getChannel())
                {
                    outputTrack.addEvent(message, midiEvent->timeStamp);
                }
                // Include messages from selected channels
                else if (channelSet.count(message.getChannel()))
                {
                    outputTrack.addEvent(message, midiEvent->timeStamp);
                }
            }
            
            // Only add track if it has events
            if (outputTrack.getNumEvents() > 0)
            {
                outputMidi.addTrack(outputTrack);
            }
        }
        
        // Write output file
        juce::File outputFile(outputPath);
        outputFile.getParentDirectory().createDirectory();
        
        juce::FileOutputStream outputStream(outputFile);
        if (!outputStream.openedOk())
        {
            std::cerr << "Could not create output MIDI file: " << outputPath << std::endl;
            return false;
        }
        
        bool success = outputMidi.writeTo(outputStream);
        if (success)
        {
            std::cout << "Extracted MIDI channels to: " << outputPath << std::endl;
            std::cout << "  Input tracks: " << inputMidi.getNumTracks() << std::endl;
            std::cout << "  Output tracks: " << outputMidi.getNumTracks() << std::endl;
            std::cout << "  Extracted channels: ";
            for (size_t i = 0; i < channels.size(); ++i)
            {
                std::cout << channels[i];
                if (i < channels.size() - 1) std::cout << ", ";
            }
            std::cout << std::endl;
        }
        
        return success;
    }
    
    /**
     * Transpose MIDI file by semitones
     */
    static bool transposeMidi(const juce::String& inputPath, 
                             const juce::String& outputPath,
                             int semitones)
    {
        if (semitones < -48 || semitones > 48)
        {
            std::cerr << "Transpose amount out of range (-48 to +48): " << semitones << std::endl;
            return false;
        }
        
        juce::File inputFile(inputPath);
        if (!inputFile.existsAsFile())
        {
            std::cerr << "Input MIDI file not found: " << inputPath << std::endl;
            return false;
        }
        
        juce::FileInputStream fileStream(inputFile);
        if (!fileStream.openedOk())
        {
            std::cerr << "Could not open input MIDI file: " << inputPath << std::endl;
            return false;
        }
        
        juce::MidiFile inputMidi;
        if (!inputMidi.readFrom(fileStream))
        {
            std::cerr << "Could not parse input MIDI file: " << inputPath << std::endl;
            return false;
        }
        
        juce::MidiFile outputMidi;
        outputMidi.setTicksPerQuarterNote(inputMidi.getTimeFormat());
        
        // Process each track
        for (int trackIndex = 0; trackIndex < inputMidi.getNumTracks(); ++trackIndex)
        {
            const auto* inputTrack = inputMidi.getTrack(trackIndex);
            juce::MidiMessageSequence outputTrack;
            
            for (int eventIndex = 0; eventIndex < inputTrack->getNumEvents(); ++eventIndex)
            {
                const auto& midiEvent = inputTrack->getEventPointer(eventIndex);
                auto message = midiEvent->message;
                
                // Transpose note events (but not drum channel)
                if ((message.isNoteOn() || message.isNoteOff()) && message.getChannel() != 10)
                {
                    int oldNote = message.getNoteNumber();
                    int newNote = juce::jlimit(0, 127, oldNote + semitones);
                    
                    if (message.isNoteOn())
                        message = juce::MidiMessage::noteOn(message.getChannel(), newNote, message.getVelocity());
                    else
                        message = juce::MidiMessage::noteOff(message.getChannel(), newNote, message.getVelocity());
                }
                
                outputTrack.addEvent(message, midiEvent->timeStamp);
            }
            
            outputMidi.addTrack(outputTrack);
        }
        
        // Write output file
        juce::File outputFile(outputPath);
        outputFile.getParentDirectory().createDirectory();
        
        juce::FileOutputStream outputStream(outputFile);
        if (!outputStream.openedOk())
        {
            std::cerr << "Could not create output MIDI file: " << outputPath << std::endl;
            return false;
        }
        
        bool success = outputMidi.writeTo(outputStream);
        if (success)
        {
            std::cout << "Transposed MIDI file saved to: " << outputPath << std::endl;
            std::cout << "  Transpose amount: " << (semitones >= 0 ? "+" : "") << semitones << " semitones" << std::endl;
        }
        
        return success;
    }
    
    /**
     * Get note name from MIDI note number
     */
    static juce::String getNoteNameFromNumber(int noteNumber)
    {
        if (noteNumber < 0 || noteNumber > 127)
            return "Invalid";
        
        const char* noteNames[] = {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"};
        int octave = (noteNumber / 12) - 1;
        int noteIndex = noteNumber % 12;
        
        return juce::String(noteNames[noteIndex]) + juce::String(octave);
    }
    
    /**
     * Get MIDI note number from note name (e.g., "C4" = 60)
     */
    static int getNoteNumberFromName(const juce::String& noteName)
    {
        if (noteName.length() < 2)
            return -1;
        
        juce::String note = noteName.substring(0, noteName.length() - 1).toUpperCase();
        int octave = noteName.getLastCharacter() - '0';
        
        if (octave < -1 || octave > 9)
            return -1;
        
        int noteValue = -1;
        if (note == "C") noteValue = 0;
        else if (note == "C#" || note == "DB") noteValue = 1;
        else if (note == "D") noteValue = 2;
        else if (note == "D#" || note == "EB") noteValue = 3;
        else if (note == "E") noteValue = 4;
        else if (note == "F") noteValue = 5;
        else if (note == "F#" || note == "GB") noteValue = 6;
        else if (note == "G") noteValue = 7;
        else if (note == "G#" || note == "AB") noteValue = 8;
        else if (note == "A") noteValue = 9;
        else if (note == "A#" || note == "BB") noteValue = 10;
        else if (note == "B") noteValue = 11;
        
        if (noteValue == -1)
            return -1;
        
        return (octave + 1) * 12 + noteValue;
    }
};