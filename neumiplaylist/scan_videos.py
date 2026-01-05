#!/usr/bin/env python3
"""
Neumi Atom Playlist Manager - Scan Videos
Creates initial CSV inventory of all video files in specified directories.
"""

import os
import csv
from pathlib import Path
import argparse

# Supported video formats for Neumi Atom 4K Lite
SUPPORTED_FORMATS = {'.mp4', '.mkv', '.avi', '.mov', '.m4v', '.ts', '.vob', '.m2ts'}

def is_system_file(filename):
    """
    Check if file is a system/hidden file that should be ignored.
    
    Args:
        filename: Name of the file
        
    Returns:
        True if file should be ignored, False otherwise
    """
    # Filter out Mac system files
    if filename.startswith('._'):
        return True
    
    # Filter out other hidden files
    if filename.startswith('.'):
        return True
    
    # Filter out Windows thumbnail cache
    if filename.lower() == 'thumbs.db':
        return True
        
    return False

def scan_directory(base_path, category_dirs):
    """
    Scan specified directories for video files.
    
    Args:
        base_path: Root path (e.g., SD card mount point)
        category_dirs: List of category directory names to scan
        
    Returns:
        List of dictionaries with file information
    """
    video_files = []
    
    for category in category_dirs:
        category_path = Path(base_path) / category
        
        if not category_path.exists():
            print(f"Warning: Directory not found: {category_path}")
            continue
            
        print(f"\nScanning: {category_path}")
        
        # Walk through directory and subdirectories
        for root, dirs, files in os.walk(category_path):
            for filename in files:
                # Skip system and hidden files
                if is_system_file(filename):
                    continue
                
                # Check if file has supported extension
                file_ext = Path(filename).suffix.lower()
                if file_ext in SUPPORTED_FORMATS:
                    full_path = Path(root) / filename
                    relative_path = full_path.relative_to(base_path)
                    
                    video_files.append({
                        'filename': filename,
                        'file_type': file_ext[1:],  # Remove the dot
                        'category': category,
                        'relative_path': str(relative_path),
                        'full_path': str(full_path)
                    })
                    
        print(f"  Found {len([f for f in video_files if f['category'] == category])} videos")
    
    return video_files

def create_csv(video_files, output_path, playlist_names):
    """
    Create CSV file with video inventory and playlist columns.
    
    Args:
        video_files: List of video file dictionaries
        output_path: Path to output CSV file
        playlist_names: List of playlist names to create columns for
    """
    # Sort files by category, then filename
    video_files.sort(key=lambda x: (x['category'], x['filename']))
    
    # Define CSV columns
    fieldnames = [
        'filename',
        'file_type',
        'category',
        'relative_path'
    ]
    
    # Add playlist columns (no "playlist_" prefix)
    for playlist in playlist_names:
        fieldnames.append(playlist)
    
    # Write CSV
    with open(output_path, 'w', newline='', encoding='utf-8') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        
        for video in video_files:
            # Create row with base info
            row = {
                'filename': video['filename'],
                'file_type': video['file_type'],
                'category': video['category'],
                'relative_path': video['relative_path']
            }
            
            # Initialize playlist columns as empty
            for playlist in playlist_names:
                row[playlist] = ''
            
            writer.writerow(row)
    
    print(f"\nCSV created: {output_path}")
    print(f"Total videos: {len(video_files)}")

def main():
    parser = argparse.ArgumentParser(
        description='Scan video directories and create CSV inventory for Neumi Atom playlist management'
    )
    parser.add_argument(
        'base_path',
        help='Base path to SD card (e.g., E:\\ or /Volumes/SDCARD)'
    )
    parser.add_argument(
        '-c', '--categories',
        nargs='+',
        default=['Movies', 'ClassicMovies', 'Documentaries', 'Series', 'MusicVideo'],
        help='Category directories to scan (default: Movies ClassicMovies Documentaries Series MusicVideo)'
    )
    parser.add_argument(
        '-p', '--playlists',
        nargs='+',
        default=['Playlist1', 'Playlist2', 'Playlist3', 'Documentaries', 'Series1', 'Series2'],
        help='Playlist names to create columns for (default: Playlist1 Playlist2 Playlist3 Documentaries Series1 Series2)'
    )
    parser.add_argument(
        '-o', '--output',
        default='video_library.csv',
        help='Output CSV filename (default: video_library.csv)'
    )
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("Neumi Atom Playlist Manager - Video Scanner")
    print("=" * 60)
    print(f"\nBase path: {args.base_path}")
    print(f"Categories to scan: {', '.join(args.categories)}")
    print(f"Playlist columns: {', '.join(args.playlists)}")
    
    # Scan directories
    video_files = scan_directory(args.base_path, args.categories)
    
    if not video_files:
        print("\nNo video files found!")
        return
    
    # Create CSV
    create_csv(video_files, args.output, args.playlists)
    
    print("\n" + "=" * 60)
    print("Next steps:")
    print("1. Open video_library.csv in Excel or a text editor")
    print("2. For each playlist column, enter a number (1, 2, 3...) for playback order")
    print("3. Leave blank to exclude a video from that playlist")
    print("4. Run: python generate_playlists.py (or use batch/shell script)")
    print("=" * 60)

if __name__ == '__main__':
    main()
