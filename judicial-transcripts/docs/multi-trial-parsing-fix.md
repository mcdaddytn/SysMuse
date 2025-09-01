# Multi-Trial Parsing Fix Documentation

## Problem Identified

The `src/cli/parse.ts` file has a critical issue when processing multiple trials specified in `includedTrials`:

1. **Incorrect Matching Logic**: Currently uses `dir.includes(trial)` which causes partial matches
   - Example: "01 Genband" matches when looking for "1 G" or just "1"
   - Should use EXACT matching: `trialsToProcess.includes(dir)`

2. **Single Trial Processing**: Only processes the FIRST matching directory then returns
   - Uses `find()` instead of `filter()` to get matching directories
   - Processes one trial and exits, ignoring remaining trials in the list

## Current Problematic Code (around line 165-187)

```typescript
// Find matching subdirectory
const matchingDir = subdirs.find(dir => 
  trialsToProcess.some((trial: string) => dir.includes(trial))
);

if (matchingDir) {
  actualInputDir = path.join(searchDir, matchingDir);
  // ... process single trial
} else {
  logger.warn(`No matching trial directory found`);
  return;
}
```

## Required Fix

### Step 1: Use Exact Matching
Replace the partial match with exact match:
```typescript
const matchingDirs = subdirs.filter(dir => 
  trialsToProcess.includes(dir)  // EXACT match
);
```

### Step 2: Process ALL Matching Trials
Wrap the entire trial processing logic in a loop:
```typescript
for (const matchingDir of matchingDirs) {
  actualInputDir = path.join(searchDir, matchingDir);
  logger.info(`Processing trial directory: ${matchingDir}`);
  
  // Load trialstyle.json for THIS trial
  trialStyleConfig = null; // Reset for each trial
  const subDirTrialStylePath = path.join(actualInputDir, 'trialstyle.json');
  if (fs.existsSync(subDirTrialStylePath)) {
    trialStyleConfig = JSON.parse(fs.readFileSync(subDirTrialStylePath, 'utf-8'));
  }
  
  // ALL THE TRIAL PROCESSING CODE NEEDS TO BE INSIDE THIS LOOP:
  // - File ordering/sorting
  // - Case number extraction  
  // - Trial creation/update
  // - Session processing
  // - Multi-pass parsing
}
```

## Directory Structure Validation

Checked all 63 trial directories - names are consistent between:
- Source: `/Users/gmac/GrassLabel Dropbox/Grass Label Home/docs/transcripts/pdf`
- Output: `./output/multi-trial`

Directory names are exact matches and suitable for exact string matching.

## Test Configuration

The `config/multi-trial-config-mac.json` has been configured with:
```json
"includedTrials": [
  "42 Vocalife Amazon",
  "01 Genband",
  "50 Packet Netscout",
  "14 Optis Wireless Technology V. Apple Inc",
  "02 Contentguard"
]
```

These directory names exist exactly as specified in both PDF and output directories.

## Implementation Approach

The fix requires restructuring the code flow:

1. **Current Structure**:
   - Find one matching directory
   - Process that directory
   - Exit

2. **Required Structure**:
   - Find ALL matching directories (exact match)
   - FOR EACH matching directory:
     - Load its trialstyle.json
     - Process all files in that directory
     - Create/update trial and sessions
   - Exit after ALL trials processed

## Key Considerations

1. **Variable Scope**: Many variables need to be declared inside the loop:
   - `trialStyleConfig` - must be reset for each trial
   - `files` array - specific to each trial
   - `caseNumber`, `trialName`, `shortName` - extracted per trial
   - `trial` object - created/found per trial

2. **Database Operations**: Each trial should:
   - Create or find its own Trial record
   - Create its own Session records
   - Not interfere with other trials' data

3. **Success Criteria**:
   - All 5 trials in `includedTrials` should be processed in one run
   - Each trial should have its correct number of sessions
   - No duplicate trials or sessions
   - Proper delimiter detection for each trial

## Testing Results So Far

- ✅ PDF Conversion: Successfully converted all 5 trials
- ✅ File Convention Detection: Correctly identified DATEAMPM, DATEMORNAFT, DOCID
- ✅ Delimiter Detection: Successfully detecting ")(" 
- ❌ Multi-trial Processing: Only processes first matching trial (Genband)
- ❌ Exact Matching: Uses partial string matching instead of exact

## Next Steps

1. Roll back the incomplete changes to parse.ts
2. Implement the fix with proper structure:
   - Change to exact matching
   - Add for loop around entire processing block
   - Ensure proper variable scoping
3. Test with all 5 trials
4. Verify each trial has correct session count:
   - 01 Genband: 8 sessions
   - 02 Contentguard: 29 sessions
   - 14 Optis: 9 sessions
   - 42 Vocalife: 12 sessions
   - 50 Packet Netscout: 6 sessions