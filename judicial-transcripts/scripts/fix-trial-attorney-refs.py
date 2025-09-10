#!/usr/bin/env python3
"""
Fixes TrialAttorney lawFirmId and lawFirmOfficeId references to ensure they
point to valid entities that exist in the metadata.
"""

import json
import sys
import glob
import os

def fix_trial_attorney_refs(filepath):
    """Fix TrialAttorney references in a single file."""
    with open(filepath, 'r') as f:
        data = json.load(f)
    
    # Get counts of available entities
    law_firm_count = len(data.get('LawFirm', []))
    law_firm_office_count = len(data.get('LawFirmOffice', []))
    
    if law_firm_count == 0:
        print(f"  Warning: No law firms in {filepath}")
    
    fixed_count = 0
    for ta in data.get('TrialAttorney', []):
        # Fix lawFirmId - cycle through available firms or set to None
        if ta.get('lawFirmId'):
            if law_firm_count > 0:
                if ta['lawFirmId'] > law_firm_count:
                    old_id = ta['lawFirmId']
                    ta['lawFirmId'] = ((ta['lawFirmId'] - 1) % law_firm_count) + 1
                    fixed_count += 1
            else:
                ta['lawFirmId'] = None
                fixed_count += 1
        
        # Fix lawFirmOfficeId - cycle through available offices or set to None
        if ta.get('lawFirmOfficeId'):
            if law_firm_office_count > 0:
                if ta['lawFirmOfficeId'] > law_firm_office_count:
                    old_id = ta['lawFirmOfficeId']
                    ta['lawFirmOfficeId'] = ((ta['lawFirmOfficeId'] - 1) % law_firm_office_count) + 1
                    fixed_count += 1
            else:
                ta['lawFirmOfficeId'] = None
                fixed_count += 1
    
    # Write back if changes were made
    if fixed_count > 0:
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)
            f.write('\n')
        print(f"  Fixed {fixed_count} references in {os.path.basename(os.path.dirname(filepath))}")
        return 1
    else:
        print(f"  No fixes needed for {os.path.basename(os.path.dirname(filepath))}")
        return 0

def main():
    """Process all trial-metadata.json files."""
    pattern = os.path.join(os.path.dirname(__file__), '../output/multi-trial/*/trial-metadata.json')
    files = glob.glob(pattern)
    
    print(f"Checking {len(files)} trial-metadata.json files for invalid references...\n")
    
    fixed_files = 0
    for filepath in sorted(files):
        if fix_trial_attorney_refs(filepath):
            fixed_files += 1
    
    print(f"\n{'='*60}")
    print(f"Fixed {fixed_files} files with invalid references")
    print(f"{'='*60}")

if __name__ == '__main__':
    main()