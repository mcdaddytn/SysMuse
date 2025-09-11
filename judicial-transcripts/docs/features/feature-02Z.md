# Feature 02Z: Alternative Document Section Markers

## Overview
Many transcript files do not contain the standard "P R O C E E D I N G S" or "CERTIFICATION" markers that trigger document section transitions in phase 1 parsing. This feature adds support for configurable alternative markers to properly identify and parse these transcript variations.

## Problem Statement
Analysis of 515 transcript files revealed:
- 465 files (90.3%) contain the standard "P R O C E E D I N G S" marker
- 50 files (9.7%) do NOT contain this marker and use alternative formatting

Without proper section markers, the parser cannot correctly identify when the main proceedings begin or when the certification section starts, leading to incorrect parsing and data extraction.

## Affected Trials
The following trials have files missing the standard "P R O C E E D I N G S" marker:

### Trials with ALL files missing the marker (28 files total):
- **32 Netlist V Samsung** (7 files)
- **72 Taylor V Turner** (2 files)  
- **73 Tq Delta, Llc V. Commscope** (6 files)
- **75 Garrett V Wood County** (2 files)
- **83 Koninklijke** (5 files)
- **86 Ollnova** (4 files)
- **101 Netlist, Inc. V. Samsung** (2 files)

### Trials with SOME files missing the marker:
- **02 Contentguard** (1 of 29 files)
- **06 Simpleair** (2 of 14 files)
- **10 Metaswitch Genband 2016** (1 of 9 files)
- **15 Optis Wireless Technology V. Huawei** (5 of 10 files)
- **19 Alfonso Cioffi Et Al V. Google** (1 of 11 files)
- **22 Core Wireless V. Apple** (2 of 13 files)
- **29 Intellectual Ventures V. T Mobile** (3 of 9 files)
- **34 Personalized Media V Google** (1 of 10 files)
- **44 Beneficial V. Advance** (1 of 6 files)
- **52 Personalized Apple** (1 of 2 files)
- **67 Gonzalez V. New Life** (1 of 5 files)
- **71 Hinson Et Al V. Dorel** (3 of 4 files)

## Solution Design

### Configuration Structure
Add new fields to `TrialStyleConfig` to support alternative section markers:

```typescript
interface TrialStyleConfig {
  // ... existing fields ...
  
  // Alternative markers for document sections
  sectionMarkers?: {
    // Markers that trigger PROCEEDINGS section (checked in order)
    proceedings?: string[];
    
    // Markers that trigger CERTIFICATION section (checked in order)
    certification?: string[];
  };
}
```

### Default Configuration
The default configuration should include both standard and common alternative markers:

```json
{
  "sectionMarkers": {
    "proceedings": [
      "P R O C E E D I N G S",
      "COURT SECURITY OFFICER:",
      "THE COURT:",
      "LAW CLERK:",
      "(Jury out.)",
      "All rise",
      "Be seated, please",
      "TRIAL ON THE MERITS"
    ],
    "certification": [
      "CERTIFICATION",
      "C E R T I F I C A T I O N",
      "I HEREBY CERTIFY",
      "CERTIFY THAT THE FOREGOING",
      "CERTIFICATE"
    ]
  }
}
```

### Implementation Details

1. **Marker Detection Logic**:
   - Check markers in the order specified in configuration
   - Use case-sensitive exact match after stripping line prefix
   - First matching marker triggers the section transition
   - Continue using existing line number tracking for section boundaries

2. **Parser Modifications**:
   - Update `MultiPassContentParser.ts` to use configurable markers
   - Modify the `checkForSectionTransition()` method to iterate through marker arrays
   - Maintain backward compatibility with existing transcripts

3. **Configuration Merging**:
   - Trial-specific `trialstyle.json` can override section markers
   - Markers from source directory config merge with defaults
   - Empty marker arrays in override completely replace defaults

### Example Trial-Specific Override
For trials using unique markers, place in source directory `trialstyle.json`:

```json
{
  "sectionMarkers": {
    "proceedings": [
      "TRIAL ON THE MERITS",
      "THE COURT:"
    ]
  }
}
```

## Testing Requirements

1. **Verify standard markers still work** - Test with trials that have "P R O C E E D I N G S"
2. **Test alternative markers** - Focus on the 7 trials with ALL files missing standard marker
3. **Test marker precedence** - Ensure markers are checked in configured order
4. **Test configuration merging** - Verify trial-specific overrides work correctly
5. **Performance testing** - Ensure multiple marker checks don't significantly impact parsing speed
6. **Verify Line record distribution** - Check that Line records have documentSection properly distributed:
   - SUMMARY section: First few pages (typically 1-5 pages)
   - PROCEEDINGS section: Main body (typically 90-95% of lines, often 100+ pages)
   - CERTIFICATION section: Final pages (typically 1-2 pages)
   - A successful parse should NOT have all Lines in SUMMARY or undefined sections
   - Query to verify: `SELECT documentSection, COUNT(*) FROM "Line" WHERE sessionId = ? GROUP BY documentSection`

## Success Criteria

1. All 50 files without "P R O C E E D I N G S" marker parse correctly
2. No regression in parsing files with standard markers
3. Section transitions occur at appropriate locations
4. Configuration is easily maintainable and extensible
5. Parser performance remains acceptable (< 10% slowdown)

## Migration Notes

- Existing parsed data remains valid
- No database schema changes required
- Only affects phase 1 parsing logic
- Can be deployed without reprocessing existing successful parses

## Future Enhancements

1. Machine learning to detect section boundaries without explicit markers
2. Configurable section types beyond PROCEEDINGS and CERTIFICATION
3. Fuzzy matching for marker variations (e.g., handle typos)
4. Automatic marker detection and suggestion based on file analysis