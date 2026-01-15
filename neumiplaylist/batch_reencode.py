#!/usr/bin/env python3
"""
Batch Video Re-encoder for Neumi Atom Playback
Re-encodes video files in-place with optimized settings for smooth playback.
Supports nested directory structures and preserves originals as backups.
"""

import os
import subprocess
import json
from pathlib import Path
import argparse
import sys
from datetime import datetime

def load_config():
    """Load configuration from config.json"""
    config_path = Path(__file__).parent / 'config.json'
    with open(config_path, 'r') as f:
        return json.load(f)

def get_video_info(file_path):
    """
    Get video information using ffprobe.
    Returns dict with codec, bitrate, resolution.
    """
    try:
        cmd = [
            'ffprobe',
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            str(file_path)
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode != 0:
            return None
        
        data = json.loads(result.stdout)
        
        # Find video stream
        video_stream = None
        for stream in data.get('streams', []):
            if stream.get('codec_type') == 'video':
                video_stream = stream
                break
        
        if not video_stream:
            return None
        
        # Extract info
        info = {
            'codec': video_stream.get('codec_name', 'unknown'),
            'width': video_stream.get('width', 0),
            'height': video_stream.get('height', 0),
            'bitrate': int(data.get('format', {}).get('bit_rate', 0)) // 1000,  # in kbps
            'duration': float(data.get('format', {}).get('duration', 0))
        }
        
        return info
        
    except Exception as e:
        print(f"Error getting video info: {e}")
        return None

def should_reencode(file_path, config, force=False):
    """
    Determine if file should be re-encoded based on codec and bitrate.
    
    Returns: (should_encode: bool, reason: str)
    """
    if force:
        return True, "Force flag set"
    
    info = get_video_info(file_path)
    
    if not info:
        return False, "Could not read video info"
    
    codec = info['codec']
    bitrate = info['bitrate']
    
    # Check if already optimized (H.264 with reasonable bitrate)
    if codec == 'h264' and bitrate < 10000:  # <10 Mbps
        return False, f"Already optimized (H.264 @ {bitrate//1000} Mbps)"
    
    # HEVC with high bitrate - needs re-encode
    if codec in ['hevc', 'h265'] and bitrate > 12000:
        return True, f"High bitrate HEVC ({bitrate//1000} Mbps)"
    
    # HEVC in general - may benefit from H.264
    if codec in ['hevc', 'h265']:
        return True, f"HEVC codec (better as H.264 for Neumi)"
    
    # H.264 but very high bitrate
    if codec == 'h264' and bitrate > 20000:
        return True, f"High bitrate H.264 ({bitrate//1000} Mbps)"
    
    # Other codecs
    if codec not in ['h264', 'hevc', 'h265']:
        return True, f"Unsupported codec ({codec})"
    
    return False, f"Acceptable quality (H.264 @ {bitrate//1000} Mbps)"

def reencode_file(input_path, output_path, preset='medium', crf=23, maxrate='8M', dry_run=False):
    """
    Re-encode video file with optimized settings.
    
    Args:
        input_path: Source video file
        output_path: Destination file
        preset: ffmpeg preset (ultrafast, fast, medium, slow)
        crf: Quality (18-28, lower=better, 23=default)
        maxrate: Maximum bitrate
        dry_run: If True, only print command without executing
    
    Returns:
        (success: bool, message: str)
    """
    cmd = [
        'ffmpeg',
        '-i', str(input_path),
        '-c:v', 'libx264',
        '-preset', preset,
        '-crf', str(crf),
        '-maxrate', maxrate,
        '-bufsize', '16M',
        '-c:a', 'copy',
        '-c:s', 'copy',  # Copy subtitles if present
        '-movflags', '+faststart',  # Optimize for streaming
        '-y',  # Overwrite output
        str(output_path)
    ]
    
    if dry_run:
        print(f"  Would run: {' '.join(cmd)}")
        return True, "Dry run"
    
    try:
        print(f"  Encoding: {input_path.name}")
        print(f"  Settings: {preset} preset, CRF {crf}, maxrate {maxrate}")
        
        # Run ffmpeg with progress output
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True
        )
        
        # Print progress
        for line in process.stdout:
            if 'time=' in line:
                # Extract and print time progress
                print(f"  Progress: {line.strip()}", end='\r')
        
        process.wait()
        print()  # New line after progress
        
        if process.returncode == 0:
            return True, "Success"
        else:
            return False, f"ffmpeg failed with code {process.returncode}"
            
    except Exception as e:
        return False, f"Error: {str(e)}"

def process_directory(base_path, config, args):
    """
    Process all video files in directory tree.
    
    Args:
        base_path: Root directory to scan
        config: Configuration dict
        args: Command line arguments
    
    Returns:
        stats: Dictionary with processing statistics
    """
    stats = {
        'total': 0,
        'reencoded': 0,
        'skipped': 0,
        'failed': 0,
        'saved_space': 0
    }
    
    supported_formats = set(config['supported_formats'])
    
    # Build file list
    print(f"\nScanning: {base_path}")
    print("=" * 80)
    
    video_files = []
    for root, dirs, files in os.walk(base_path):
        for filename in files:
            file_ext = Path(filename).suffix.lower()
            if file_ext in supported_formats:
                full_path = Path(root) / filename
                video_files.append(full_path)
    
    stats['total'] = len(video_files)
    print(f"Found {stats['total']} video files")
    print()
    
    # Process each file
    for idx, file_path in enumerate(video_files, 1):
        print(f"\n[{idx}/{stats['total']}] Processing: {file_path.relative_to(base_path)}")
        print("-" * 80)
        
        # Check if should re-encode
        should_encode, reason = should_reencode(file_path, config, args.force)
        print(f"  Decision: {reason}")
        
        if not should_encode:
            print("  → Skipping (already optimized)")
            stats['skipped'] += 1
            continue
        
        # Get original size
        original_size = file_path.stat().st_size
        
        # Prepare output path
        if args.suffix:
            # Add suffix before extension
            output_path = file_path.with_stem(f"{file_path.stem}{args.suffix}")
        else:
            # In-place: use temp file then replace
            output_path = file_path.with_suffix(f".tmp{file_path.suffix}")
        
        # Backup original if requested
        backup_path = None
        if args.backup and not args.suffix:
            backup_path = file_path.with_stem(f"{file_path.stem}.original")
            if backup_path.exists() and not args.force:
                print(f"  ⚠ Backup already exists: {backup_path.name}")
                print("  → Skipping (use --force to overwrite)")
                stats['skipped'] += 1
                continue
        
        # Re-encode
        success, message = reencode_file(
            file_path,
            output_path,
            preset=args.preset,
            crf=args.crf,
            maxrate=args.maxrate,
            dry_run=args.dry_run
        )
        
        if not success:
            print(f"  ✗ Failed: {message}")
            stats['failed'] += 1
            if output_path.exists():
                output_path.unlink()
            continue
        
        if args.dry_run:
            print(f"  ✓ {message}")
            stats['reencoded'] += 1
            continue
        
        # Check output file
        if not output_path.exists():
            print("  ✗ Output file not created")
            stats['failed'] += 1
            continue
        
        new_size = output_path.stat().st_size
        size_diff = original_size - new_size
        size_pct = (size_diff / original_size) * 100 if original_size > 0 else 0
        
        print(f"  Original: {original_size / 1024 / 1024:.1f} MB")
        print(f"  New:      {new_size / 1024 / 1024:.1f} MB")
        print(f"  Saved:    {abs(size_diff) / 1024 / 1024:.1f} MB ({size_pct:+.1f}%)")
        
        # Replace original or keep both
        if args.suffix:
            print(f"  ✓ Created: {output_path.name}")
        else:
            # Backup original if requested
            if args.backup:
                file_path.rename(backup_path)
                print(f"  → Backed up to: {backup_path.name}")
            else:
                file_path.unlink()
                print(f"  → Deleted original")
            
            # Rename temp to original name
            output_path.rename(file_path)
            print(f"  ✓ Replaced: {file_path.name}")
        
        stats['reencoded'] += 1
        stats['saved_space'] += size_diff
    
    return stats

def print_summary(stats, duration):
    """Print summary statistics"""
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Total files:      {stats['total']}")
    print(f"Re-encoded:       {stats['reencoded']}")
    print(f"Skipped:          {stats['skipped']}")
    print(f"Failed:           {stats['failed']}")
    print(f"Space saved:      {stats['saved_space'] / 1024 / 1024 / 1024:.2f} GB")
    print(f"Time elapsed:     {duration:.1f} seconds ({duration/60:.1f} minutes)")
    print("=" * 80)

def main():
    parser = argparse.ArgumentParser(
        description='Batch re-encode videos for Neumi Atom playback',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Dry run - see what would be processed
  python batch_reencode.py /Volumes/Neumi --dry-run
  
  # Re-encode in place, keep backups
  python batch_reencode.py /Volumes/Neumi --backup
  
  # Re-encode and delete originals (save space)
  python batch_reencode.py /Volumes/Neumi
  
  # Create new files with suffix (keep originals)
  python batch_reencode.py /Volumes/Neumi --suffix "_optimized"
  
  # Fast encode (lower quality, faster)
  python batch_reencode.py /Volumes/Neumi --preset fast --crf 25
  
  # High quality encode (slower)
  python batch_reencode.py /Volumes/Neumi --preset slow --crf 21
        """
    )
    
    parser.add_argument(
        'directory',
        help='Directory to process (will scan recursively)'
    )
    
    parser.add_argument(
        '--preset',
        choices=['ultrafast', 'fast', 'medium', 'slow'],
        default='medium',
        help='Encoding speed (faster = lower quality, default: medium)'
    )
    
    parser.add_argument(
        '--crf',
        type=int,
        default=23,
        help='Quality (18-28, lower=better, default: 23)'
    )
    
    parser.add_argument(
        '--maxrate',
        default='8M',
        help='Maximum bitrate (default: 8M for Neumi compatibility)'
    )
    
    parser.add_argument(
        '--backup',
        action='store_true',
        help='Keep original files as .original backup'
    )
    
    parser.add_argument(
        '--suffix',
        help='Add suffix to new files instead of replacing (e.g., "_optimized")'
    )
    
    parser.add_argument(
        '--force',
        action='store_true',
        help='Re-encode all files, even if already optimized'
    )
    
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be done without actually encoding'
    )
    
    args = parser.parse_args()
    
    # Check dependencies
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("ERROR: ffmpeg is not installed or not in PATH")
        print("Install with: brew install ffmpeg (Mac) or apt-get install ffmpeg (Linux)")
        sys.exit(1)
    
    try:
        subprocess.run(['ffprobe', '-version'], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("ERROR: ffprobe is not installed")
        print("Install ffmpeg (includes ffprobe)")
        sys.exit(1)
    
    # Validate directory
    base_path = Path(args.directory)
    if not base_path.exists():
        print(f"ERROR: Directory does not exist: {base_path}")
        sys.exit(1)
    
    # Load config
    config = load_config()
    
    # Print settings
    print("=" * 80)
    print("BATCH VIDEO RE-ENCODER FOR NEUMI ATOM")
    print("=" * 80)
    print(f"Directory:        {base_path}")
    print(f"Preset:           {args.preset}")
    print(f"Quality (CRF):    {args.crf}")
    print(f"Max Bitrate:      {args.maxrate}")
    print(f"Backup originals: {args.backup}")
    print(f"Suffix:           {args.suffix or 'N/A (in-place)'}")
    print(f"Force re-encode:  {args.force}")
    print(f"Dry run:          {args.dry_run}")
    print("=" * 80)
    
    if not args.dry_run:
        print("\n⚠️  WARNING: This will re-encode video files.")
        if not args.backup and not args.suffix:
            print("⚠️  Original files will be DELETED (no backup).")
        response = input("\nContinue? (yes/no): ")
        if response.lower() not in ['yes', 'y']:
            print("Cancelled.")
            sys.exit(0)
    
    # Process files
    start_time = datetime.now()
    stats = process_directory(base_path, config, args)
    duration = (datetime.now() - start_time).total_seconds()
    
    # Print summary
    print_summary(stats, duration)

if __name__ == '__main__':
    main()
