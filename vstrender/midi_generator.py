#!/usr/bin/env python3
"""
Better MIDI file generator with proper timing
Creates a C major scale that should definitely work
"""

def write_variable_length(value):
    """Write variable length quantity (MIDI standard)"""
    if value == 0:
        return bytes([0])
    
    result = []
    while value > 0:
        result.insert(0, value & 0x7F)
        value >>= 7
    
    # Set continuation bit on all but last byte
    for i in range(len(result) - 1):
        result[i] |= 0x80
    
    return bytes(result)

def create_better_midi():
    # Header chunk
    header = b'MThd'
    header += (6).to_bytes(4, 'big')  # Chunk size
    header += (1).to_bytes(2, 'big')  # Format 1 (multi-track)
    header += (1).to_bytes(2, 'big')  # Number of tracks
    header += (480).to_bytes(2, 'big')  # Ticks per quarter note
    
    # Track chunk
    track_data = bytearray()
    
    # Track name event
    track_data.extend(write_variable_length(0))  # Delta time 0
    track_data.extend(b'\xFF\x03')  # Track name meta event
    track_name = b'C Major Scale Test'
    track_data.extend(bytes([len(track_name)]))
    track_data.extend(track_name)
    
    # Tempo event (120 BPM)
    track_data.extend(write_variable_length(0))  # Delta time 0
    track_data.extend(b'\xFF\x51\x03')  # Tempo meta event
    # 120 BPM = 500000 microseconds per quarter note
    tempo = 500000
    track_data.extend(tempo.to_bytes(3, 'big'))
    
    # Time signature 4/4
    track_data.extend(write_variable_length(0))  # Delta time 0
    track_data.extend(b'\xFF\x58\x04\x04\x02\x18\x08')  # 4/4 time signature
    
    # C major scale notes
    notes = [60, 62, 64, 65, 67, 69, 71, 72]  # C4 to C5
    note_duration = 480  # Quarter note in ticks
    note_length = 400    # Note on duration (shorter than quarter for separation)
    
    print("Creating MIDI events:")
    
    current_time = 0
    for i, note in enumerate(notes):
        note_name = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][note % 12]
        octave = (note // 12) - 1
        print(f"  Note {i+1}: {note_name}{octave} (MIDI {note}) at time {current_time} ticks")
        
        # Note on event
        if i == 0:
            delta_time = 0  # First note starts immediately
        else:
            delta_time = note_duration  # Start next note after previous duration
        
        track_data.extend(write_variable_length(delta_time))
        track_data.extend(b'\x90')  # Note on, channel 0
        track_data.extend(bytes([note, 100]))  # Note number, velocity
        
        # Note off event
        track_data.extend(write_variable_length(note_length))
        track_data.extend(b'\x80')  # Note off, channel 0
        track_data.extend(bytes([note, 0]))  # Note number, velocity 0
        
        current_time += note_duration
    
    # End of track
    track_data.extend(write_variable_length(0))  # Delta time 0
    track_data.extend(b'\xFF\x2F\x00')  # End of track meta event
    
    # Complete track chunk
    track_chunk = b'MTrk'
    track_chunk += len(track_data).to_bytes(4, 'big')
    track_chunk += track_data
    
    # Complete MIDI file
    midi_file = header + track_chunk
    
    return midi_file

# Create the file
print("Generating better C major scale MIDI file...")
midi_data = create_better_midi()

filename = 'c_major_scale_fixed.mid'
with open(filename, 'wb') as f:
    f.write(midi_data)

print(f"\nCreated {filename}")
print("Details:")
print("  - C major scale: C4, D4, E4, F4, G4, A4, B4, C5")
print("  - Tempo: 120 BPM")
print("  - Duration: Quarter notes with gaps")
print("  - Format: Standard MIDI File Type 1")
print("  - Channel: 0 (MIDI channel 1)")
print("  - Velocity: 100 (medium-strong)")
print(f"  - File size: {len(midi_data)} bytes")
print("\nThis should definitely produce sound with any MIDI instrument!")