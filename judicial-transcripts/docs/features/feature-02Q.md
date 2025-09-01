# Feature 02Q: Multi-Trial Configuration Management

## Overview
Streamline multi-trial configuration by centralizing the main configuration file and distributing trial-specific settings to individual trial directories. This enables flexible trial selection and per-trial customization while maintaining a single entry point for batch processing.

## Objectives
1. Eliminate individual trial configuration files in favor of a single multi-trial configuration
2. Enable trial-specific settings via `trialstyle.json` files in source PDF directories
3. Support flexible trial selection (include/exclude/all modes)
4. Provide user-editable configuration in destination txt directories before parsing
5. Simplify batch processing of multiple trials with different settings

## Configuration Architecture

### Main Configuration (`multi-trial-config-mac.json`)
- Central configuration file for all trials
- Contains:
  - Input/output directories
  - Default trial settings (baseline `trialstyle.json`)
  - Trial selection mode and lists
  - Phase-specific parameters

### Trial Selection
```json
{
  "trialSelectionMode": "INCLUDE|EXCLUDE|ALL",
  "includedTrials": ["42 Vocalife Amazon", "43 Apple Samsung"],
  "excludedTrials": ["44 Test Case"]
}
```
- `ALL` (default): Process all subdirectories in inputDir
- `INCLUDE`: Process only trials in includedTrials list
- `EXCLUDE`: Process all trials except those in excludedTrials list

### Trial Style Configuration (`trialstyle.json`)

#### Location Hierarchy
1. **Source PDF directory** (`/path/to/pdfs/42 Vocalife Amazon/trialstyle.json`)
   - Optional, contains trial-specific overrides only
   - Minimal configuration with differences from default

2. **Destination TXT directory** (`/path/to/txt/42 Vocalife Amazon/trialstyle.json`)
   - Generated during PDF conversion
   - Merges default settings with PDF directory overrides
   - User-editable before phase1 parsing
   - Active configuration for all processing phases

#### Configuration Merging
```
Default trialstyle.json (from main config)
  + PDF directory trialstyle.json overrides (if exists)
  = Generated trialstyle.json in TXT directory
```

## File Processing Flow

### 1. PDF Conversion Phase
```
Input: PDF files in source directory
Process:
  1. Check for trialstyle.json in PDF directory
  2. Merge with default configuration
  3. Generate trialstyle.json in TXT directory
  4. Convert PDFs to text files (always overwrites existing)
  5. Auto-detect file ordering based on naming patterns
  6. Update orderedFiles/unidentifiedFiles in generated trialstyle.json
  7. Set fileSortingMode=MANUAL after ordering established
Output: TXT files + trialstyle.json in destination directory
```

**Note on Conversion Behavior:**
- PDF to text conversion always overwrites existing TXT files
- No timestamp checking or skip logic currently implemented
- Deletion of TXT directories only needed for housekeeping (e.g., when source PDFs are renamed or removed)
- The generated orderedFiles collection dictates what files are parsed, regardless of other TXT files present
- Future enhancement: `--force` flag for explicit overwrite control

### 2. User Review (Optional)
- User can edit trialstyle.json in TXT directory
- Adjust file ordering in orderedFiles
- Exclude files via unidentifiedFiles
- Modify parsing parameters

### 3. Phase1/Phase2/Phase3 Processing
```
Input: TXT files + trialstyle.json in destination directory
Process:
  1. Read trialstyle.json from TXT directory
  2. Apply configuration for parsing
  3. Process files in specified order
Output: Database records
```

## Trial Style Parameters

### Minimal Override Example (PDF directory)
```json
{
  "summaryCenterDelimiter": "CLERK",
  "datePattern": "ALTERNATIVE_FORMAT"
}
```

### Generated Complete Example (TXT directory)
```json
{
  "fileSortingMode": "MANUAL",
  "summaryCenterDelimiter": "CLERK",
  "datePattern": "ALTERNATIVE_FORMAT",
  "orderedFiles": [
    "001_jury_selection.txt",
    "002_opening_statements.txt",
    "003_witness_testimony.txt"
  ],
  "unidentifiedFiles": [
    "index.txt",
    "notes.txt"
  ],
  "parserMode": "multi-pass",
  "speakerPatterns": {
    "attorney": "^(MR\\.|MS\\.|MX\\.)\\s+[A-Z]+:",
    "witness": "^THE WITNESS:",
    "court": "^THE COURT:"
  }
}
```

## Implementation Requirements

### 1. Configuration Changes
- Refactor multi-trial-config-mac.json to remove per-trial settings
- Add trial selection mechanism
- Move trial-specific settings to PDF directories

### 2. Conversion Process Updates
- Implement trialstyle.json detection in PDF directories
- Add configuration merging logic
- Generate complete trialstyle.json in TXT directories
- Auto-detect and order files based on naming patterns

### 3. Parser Updates
- Read trialstyle.json from TXT directory (not main config)
- Apply trial-specific settings during parsing

### 4. Force Reconversion Option
- Add flag to force PDF reconversion even if TXT files exist
- Clean destination directories before reconversion

## Benefits
1. **Simplified Management**: Single configuration file for all trials
2. **Flexible Selection**: Easy inclusion/exclusion of trials
3. **Per-Trial Customization**: Override defaults where needed
4. **User Control**: Edit generated configuration before processing
5. **Batch Processing**: Run all phases on multiple trials efficiently
6. **Version Control**: Track trial-specific settings with source files

## Migration Path
1. Create minimal trialstyle.json files in PDF directories based on current configs
2. Update multi-trial-config-mac.json to new structure
3. Delete existing TXT directories or use force reconversion
4. Run conversion to generate new trialstyle.json files
5. Archive old individual configuration files to tempconfig

## Success Criteria
- All trials can be processed from single configuration
- Trial-specific settings properly inherited and merged
- File ordering automatically detected and user-adjustable
- All phases (convert, phase1, phase2, phase3) work with new structure
- Individual trial configs successfully deprecated