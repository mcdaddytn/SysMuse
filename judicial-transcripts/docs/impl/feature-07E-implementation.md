# Feature 07E Implementation Guide: Marker Section Hierarchy and Ordering

## Overview
This guide documents the implementation of marker section output generation with proper hierarchical ordering, including lessons learned about opening and closing statement detection.

## Date: 2025-09-13

## Key Issues Addressed

### 1. Marker Section File Output Generation
**Problem**: Individual witness testimony and examination sections weren't being output to files.

**Root Cause**: Sections created by `WitnessMarkerDiscovery` were missing the `source` field, defaulting to `MANUAL`, which wasn't included in the filter for `generateAutoSummaries`.

**Solution**:
- Added `MarkerSource.PHASE3_DISCOVERY` to all MarkerSection creations in `WitnessMarkerDiscovery.ts`
- This ensures all programmatically generated sections are properly marked and included in output generation

### 2. Chronological Ordering Within Hierarchy Levels
**Problem**: Sections were being output in incorrect order (e.g., JURY_DELIBERATION before CLOSING_STATEMENTS).

**Root Cause**:
- Sections weren't sorted chronologically when fetched for output
- Opening/closing statement periods were using unsorted arrays

**Solution**:
```typescript
// In generateAutoSummaries:
orderBy: [
  { parentSectionId: 'asc' },  // Group by parent first
  { startEventId: 'asc' }       // Then chronologically within each group
]

// In findOpeningStatements and findClosingStatements:
openingStatements.sort((a, b) => (a.startEventId || 0) - (b.startEventId || 0));
closingStatements.sort((a, b) => (a.startEventId || 0) - (b.startEventId || 0));
```

### 3. Default Handling for Missing Sections
**Problem**: System needed reasonable defaults when opening/closing statements couldn't be identified.

**Solution**: Added default CLOSING_STATEMENTS_PERIOD creation:
```typescript
// Default: Create a period from after witness testimony to end of trial
const defaultStartEvent = testimonyPeriod?.endEventId ? testimonyPeriod.endEventId + 1 :
                          (lastEvent ? lastEvent.id - 100 : 1);
```

## Key Findings

### Statement Order Variations
In trial "01 Genband", we discovered:
- **Opening Statements**: Follow standard order (Plaintiff → Defense)
  - Plaintiff: Event 851
  - Defense: Events 855-857

- **Closing Statements**: Reversed order (Defense → Plaintiff)
  - Defense: Events 5662-5664 (MR_VERHOEVEN)
  - Plaintiff: Event 5672 (MR_DACUS)

This highlights that **we cannot assume a fixed order** for statements. The system must:
1. Detect statements based on speaker roles and content patterns
2. Sort them chronologically after detection
3. Create periods based on actual chronological bounds

### File Output Structure
Successfully generates ~68-71 files per trial including:
- Individual examination files (Direct, Cross, Redirect, Recross)
- Individual witness testimony files (complete testimony per witness)
- Group sections (Plaintiff/Defense witnesses)
- Trial structure sections (Sessions, Opening/Closing statements, etc.)

Output directory structure:
```
output/markersections/
├── 01 Genband/
│   ├── 01 Genband_WitExam_Direct_BRENDON_MILLS.txt
│   ├── 01 Genband_WitTest_BRENDON_MILLS.txt
│   ├── 01 Genband_Closing_Statements.txt
│   └── ...
└── 04 Intellectual Ventures/
    └── ...
```

## Configuration Requirements

### Trial Style Configuration
Located in `config/trialstyle.json`:
```json
{
  "saveMarkerSectionsToFile": true,
  "markerSectionOutputDir": "./output/markersections",
  "markerSummaryMode": "SUMMARYABRIDGED2",
  "markerAppendMode": "space",
  "markerCleanMode": "REMOVEEXTRASPACE"
}
```

## Areas for Improvement

### 1. Statement Detection Accuracy
Current issues:
- Relying on word count thresholds that may miss shorter statements
- Need better pattern matching for statement beginnings
- Should identify key phrases like "on behalf of [client]" for opening statements

### 2. Attorney Role Assignment
- Need to verify attorney roles are correctly assigned early in processing
- Consider using multiple signals (firm names, client mentions, context)

### 3. Period Between Witness Testimony and Closing
- Currently no dedicated section for proceedings between witness testimony end and closing statements begin
- May contain important procedural matters, jury instructions, etc.

### 4. Validation and Manual Override
- Need mechanism for manual marker corrections
- Should validate detected boundaries against expected patterns
- Consider confidence scoring for automated detection

## Next Steps

1. **Improve Statement Detection** (Feature 07F)
   - Implement pattern-based detection for opening/closing statements
   - Add contextual clues (e.g., "on behalf of", "members of the jury")
   - Reduce reliance on word count alone

2. **Add Intermediate Sections**
   - Create sections for jury instructions
   - Handle rebuttal arguments
   - Capture procedural matters between major phases

3. **Manual Override System**
   - Allow manual markers to override automatic detection
   - Implement confidence-based precedence
   - Provide UI/CLI for marker adjustment

## Testing Checklist

- [x] Verify all witness sections generate files
- [x] Confirm chronological ordering within hierarchy levels
- [x] Test with trials having non-standard statement order
- [x] Validate default period creation when statements not found
- [ ] Test with trials having rebuttal arguments
- [ ] Verify handling of trials with missing phases

## Related Files

- `src/phase3/StandardTrialHierarchyBuilder.ts` - Main hierarchy builder
- `src/phase3/WitnessMarkerDiscovery.ts` - Witness section detection
- `src/services/TranscriptRenderer.ts` - Section rendering and file output
- `src/phase3/LongStatementsAccumulator.ts` - Statement detection logic