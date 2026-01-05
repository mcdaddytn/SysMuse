#!/usr/bin/env python3
"""
Neumi Atom Playlist Manager - Generate Playlists
Reads CSV file and creates M3U playlist files for Neumi Atom.
"""

import csv
import argparse
from pathlib import Path
import shutil

def read_csv_and_generate_playlists(csv_path, base_path, output_dir, clean_existing=True):
    """
    Read CSV file and generate M3U playlists.
    Args:
        csv_path: Path to CSV file
        base_path: Base path for SD card (used to make relative paths)
        output_dir: Directory to output playlist files
        clean_existing: Whether to clean existing playlists first
    """
    # Parse base path
    base_path = Path(base_path)
    output_dir = Path(output_dir)
    # Clean existing playlists if requested
    if clean_existing and output_dir.exists():
        print(f"Cleaning existing playlists in: {output_dir}")
        shutil.rmtree(output_dir)
    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)
    # Read CSV and collect playlist data
    playlists = {}
    # Use utf-8-sig to handle BOM (Byte Order Mark) from Excel
    with open(csv_path, 'r', encoding='utf-8-sig') as csvfile:
        reader = csv.DictReader(csvfile)
        fieldnames = reader.fieldnames
        # DEBUG: Print raw fieldnames
        print(f"\nDEBUG: Raw fieldnames: {fieldnames}")
        print(f"DEBUG: Fieldnames with repr: {[repr(f) for f in fieldnames]}")
        # Find playlist columns (columns that are NOT the base columns)
        base_columns = {'filename', 'file_type', 'category', 'relative_path'}
        playlist_columns = [col for col in fieldnames if col not in base_columns]
        if not playlist_columns:
            print("Error: No playlist columns found in CSV!")
            print("Expected columns beyond: filename, file_type, category, relative_path")
            return
        print(f"\nFound {len(playlist_columns)} playlists:")
        for col in playlist_columns:
            print(f"  - {col}")
            playlists[col] = []
        # Process each video file
        print("\nProcessing videos...")
        row_count = 0
        for row in reader:
            row_count += 1
            relative_path = row['relative_path']
            filename = row['filename']
            # DEBUG: Print first few rows
            if row_count <= 3:
                print(f"\nDEBUG Row {row_count}:")
                print(f"  filename: {repr(filename)}")
                for col in playlist_columns:
                    val = row.get(col, '')
                    print(f"  {col}: {repr(val)} -> stripped: {repr(val.strip())} -> bool: {bool(val.strip())}")
            # Process each playlist
            for col in playlist_columns:
                order_value = row.get(col, '').strip()
                # If order value exists and is not empty
                if order_value:
                    try:
                        # Try to parse as integer for ordering
                        order = int(order_value)
                        playlists[col].append({
                            'order': order,
                            'path': relative_path,
                            'filename': filename
                        })
                    except ValueError:
                        print(f"Warning: Invalid order value '{order_value}' for {filename} in {col}")
    # Generate M3U files
    print("\nGenerating playlist files...")
    for playlist_name, videos in playlists.items():
        if not videos:
            print(f"  Skipping empty playlist: {playlist_name}")
            continue
        # Sort by order
        videos.sort(key=lambda x: x['order'])
        # Create M3U file
        m3u_path = output_dir / f"{playlist_name}.m3u"
        with open(m3u_path, 'w', encoding='utf-8') as m3u:
            # Write M3U header
            m3u.write("#EXTM3U\n")
            m3u.write(f"#PLAYLIST:{playlist_name}\n\n")
            # Write each video entry
            for video in videos:
                # Write title line
                m3u.write(f"#EXTINF:-1,{video['filename']}\n")
                # Write path - use relative path from playlist location
                # Neumi Atom will need to find files relative to playlist location
                m3u.write(f"../{video['path']}\n\n")
        print(f"  Created: {m3u_path.name} ({len(videos)} videos)")
    return playlists
    
def generate_summary_report(playlists, output_path):
    """Generate a summary report of playlists."""
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write("Neumi Atom Playlist Summary\n")
        f.write("=" * 60 + "\n\n")
        
        for playlist_name, videos in playlists.items():
            if videos:
                f.write(f"{playlist_name}: {len(videos)} videos\n")
                f.write("-" * 40 + "\n")
                for i, video in enumerate(videos, 1):
                    f.write(f"  {i}. {video['filename']}\n")
                f.write("\n")
    
    print(f"\nSummary report created: {output_path}")

def main():
    parser = argparse.ArgumentParser(
        description='Generate M3U playlist files from CSV for Neumi Atom'
    )
    parser.add_argument(
        'csv_file',
        help='CSV file created by scan_videos.py'
    )
    parser.add_argument(
        'base_path',
        help='Base path to SD card (e.g., E:\\ or /Volumes/SDCARD)'
    )
    parser.add_argument(
        '-o', '--output-dir',
        default='Playlists',
        help='Output directory for playlist files (default: Playlists)'
    )
    parser.add_argument(
        '--no-clean',
        action='store_true',
        help='Do not clean existing playlists before generating new ones'
    )
    parser.add_argument(
        '--summary',
        action='store_true',
        help='Generate summary report of playlists'
    )
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("Neumi Atom Playlist Manager - Playlist Generator")
    print("=" * 60)
    print(f"\nCSV file: {args.csv_file}")
    print(f"Base path: {args.base_path}")
    print(f"Output directory: {args.output_dir}")
    
    # Generate playlists
    playlists = read_csv_and_generate_playlists(
        args.csv_file,
        args.base_path,
        args.output_dir,
        clean_existing=not args.no_clean
    )
    
    # Generate summary if requested
    if args.summary:
        generate_summary_report(playlists, 'playlist_summary.txt')
    
    print("\n" + "=" * 60)
    print("Playlist generation complete!")
    print("\nNext steps:")
    print(f"1. Copy the '{args.output_dir}' folder to your SD card")
    print("2. On Neumi Atom, navigate to the Playlists folder")
    print("3. Select a .m3u file and start playing")
    print("=" * 60)

if __name__ == '__main__':
    main()
