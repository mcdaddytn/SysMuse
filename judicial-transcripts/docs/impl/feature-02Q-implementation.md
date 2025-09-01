# Feature 02Q Implementation Guide

## Overview
This guide documents the implementation approach for multi-trial configuration management, including current behavior and potential future enhancements.

## Current Conversion Behavior

### Always Overwrite Approach
The system currently implements a simple "always overwrite" strategy for PDF to text conversion:

1. **No Existence Checking**: Converter doesn't check if TXT files already exist
2. **No Timestamp Comparison**: No comparison of PDF vs TXT modification times
3. **Unconditional Conversion**: Every PDF found will be converted and written
4. **Simple and Predictable**: Ensures consistent state after each conversion run

### Rationale for Current Approach
- **Simplicity**: Avoids complex timestamp and configuration change detection
- **Consistency**: Guarantees all TXT files reflect current PDF content and settings
- **Configuration Changes**: Ensures trialstyle.json updates are always applied
- **User Control**: orderedFiles collection determines what gets parsed, not file existence

## Implementation Steps

### Phase 1: Configuration Restructuring
1. Extract trial-specific settings from multi-trial-config-mac.json
2. Create minimal trialstyle.json files in PDF source directories
3. Update multi-trial-config-mac.json with trial selection mechanism
4. Archive old individual configuration files to tempconfig/

### Phase 2: Conversion Process Updates
1. Modify PdfToTextConverter to detect trialstyle.json in PDF directories
2. Implement configuration merging (default + PDF overrides)
3. Generate complete trialstyle.json in TXT directories
4. Ensure file ordering detection updates orderedFiles collection

### Phase 3: Parser Updates
1. Update parse.ts to read trialstyle.json from TXT directory
2. Remove trial-specific logic from main configuration loading
3. Ensure all phases use TXT directory configuration

### Phase 4: Trial Selection Implementation
1. Add trialSelectionMode parsing (INCLUDE/EXCLUDE/ALL)
2. Implement directory filtering based on selection lists
3. Update logging to show which trials are being processed

## Configuration Migration

### From (Current Structure):
```json
{
  "trials": {
    "42 Vocalife Amazon": {
      "fileConvention": "custom",
      "expectedPatterns": {...},
      "enableGenericFallback": false
    }
  }
}
```

### To (New Structure):

**multi-trial-config-mac.json:**
```json
{
  "trialSelectionMode": "INCLUDE",
  "includedTrials": ["42 Vocalife Amazon"],
  "defaultTrialStyle": {
    "fileSortingMode": "AUTO",
    "parserMode": "multi-pass"
  }
}
```

**PDF directory trialstyle.json (minimal overrides):**
```json
{
  "fileConvention": "custom",
  "enableGenericFallback": false
}
```

**TXT directory trialstyle.json (generated complete):**
```json
{
  "fileConvention": "custom",
  "fileSortingMode": "MANUAL",
  "parserMode": "multi-pass",
  "enableGenericFallback": false,
  "orderedFiles": [...],
  "unidentifiedFiles": [...]
}
```

## Future Enhancement: Smart Conversion with --force Flag

### Proposed Enhancement (Not Currently Implemented)
A future version could implement intelligent conversion checking:

#### Detection Logic
1. Check if TXT file exists and is newer than source PDF
2. Compare trialstyle.json configurations for material changes
3. Skip conversion if files are current AND configuration unchanged
4. Provide `--force` flag to override detection and force reconversion

#### Complexity Considerations
- **Configuration Comparison**: Need to identify which settings affect conversion
- **Merge Detection**: Must detect if PDF directory config changed
- **State Tracking**: May need to store conversion metadata
- **User Experience**: Balance automation with predictability

#### Implementation Sketch
```typescript
interface ConversionDecision {
  shouldConvert: boolean;
  reason: 'not_exists' | 'outdated' | 'config_changed' | 'forced';
}

function shouldConvertFile(
  pdfPath: string, 
  txtPath: string, 
  forceFlag: boolean
): ConversionDecision {
  if (forceFlag) return { shouldConvert: true, reason: 'forced' };
  if (!fs.existsSync(txtPath)) return { shouldConvert: true, reason: 'not_exists' };
  
  const pdfStats = fs.statSync(pdfPath);
  const txtStats = fs.statSync(txtPath);
  if (pdfStats.mtime > txtStats.mtime) {
    return { shouldConvert: true, reason: 'outdated' };
  }
  
  // Complex: Check if configuration affecting conversion changed
  if (hasConfigurationChanged()) {
    return { shouldConvert: true, reason: 'config_changed' };
  }
  
  return { shouldConvert: false, reason: null };
}
```

### Why Not Implemented Now
1. **Configuration Change Detection**: Complex to determine which config changes require reconversion
2. **Merge Complexity**: trialstyle.json is generated from multiple sources
3. **Minimal Benefit**: Conversion is relatively fast for typical trial sizes
4. **User Clarity**: Always overwriting is more predictable behavior

## Testing Approach

### Test Scenarios
1. **Clean Conversion**: No existing TXT files
2. **Overwrite Conversion**: Existing TXT files get replaced
3. **Trial Selection**: Various INCLUDE/EXCLUDE combinations
4. **Configuration Merging**: Default + PDF override = correct TXT config
5. **File Ordering**: Correct orderedFiles generation

### Validation Steps
1. Verify TXT files always reflect current PDF content
2. Confirm trialstyle.json properly merged in TXT directory
3. Ensure orderedFiles collection accurate for parsing
4. Test all phases work with new configuration structure

## Notes
- The "always overwrite" approach ensures consistency and simplicity
- Users needing clean directories should manually delete before conversion
- The orderedFiles collection provides the authoritative list for parsing
- Future `--force` flag would be additive, not change default behavior