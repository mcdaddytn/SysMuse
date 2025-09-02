# Trial Configuration Tracking
**Last Updated**: 2025-09-02

## Overview
This document tracks trial-specific parsing configurations discovered during testing. Each trial may have unique header structures, Q&A patterns, and other parsing requirements.

## Key Configuration Parameters

### pageHeaderLines
Number of lines at the top of each page that constitute the header. Critical for proper page parsing.

**Indicators of Problems:**
- `Page.headerText` is empty or null
- `Page.parsedTrialPage` is empty or differs from `trialPageNumber`
- Exception: `parsedTrialPage` may differ from `trialPageNumber` when:
  - `pageHeaderLines=1` and page numbers reach 100+
  - This causes text corruption but first 99 pages should parse correctly

### File Naming Conventions
- **"Trial" suffix**: Full-day transcript (similar to "AM and PM")
  - Maps to MORNING session type
  - Example: "Hinson Et Al V. Dorel June 13, 2016 Trial.txt"
- **"AM"/"PM" suffixes**: Half-day sessions
- **"PM1" suffix**: Maps to EVENING session type

## Invalid Trials (Excluded from Processing)

These trials have significant issues that prevent proper parsing:

### 50 - Packet Netscout / 50 - Packet
- **Issues**: Duplicate directories, unclear structure
- **Status**: INVALID - Needs investigation

### 68 - Contentguard Holdings, Inc. V. Google
- **Case Number**: 2:14-CV-00061-JRG
- **Issues**: 
  - Most sessions show only 1 page instead of hundreds
  - PM1 session correctly mapped to EVENING but still has 1-page issue
  - Page structure completely broken
- **Status**: INVALID - Major structural issues

### 72 - Taylor V Turner
- **Case Number**: 2:11-CV-00057-JRG
- **Issues**:
  - Malformed PDF conversion with irregular page boundaries
  - Pages 2 and 3 headers on consecutive lines (59-60)
  - Entire transcript stored as single page (9,835 lines)
- **Status**: INVALID - Needs re-conversion from PDF

## Trial-Specific Configurations

### 71 - Hinson Et Al V. Dorel
- **Case Number**: 2:15-CV-00713-JRG
- **pageHeaderLines**: 2 (standard)
- **File Pattern**: "Trial" suffix (full-day transcripts)
- **Sessions**: 4 (all MORNING type)
- **Config Location**: `./config/trial-configs/71-hinson-et-al-v-dorel.json`
- **Notes**: Standard configuration, works correctly

### 72 - Taylor V Turner ⚠️ MALFORMED TRANSCRIPT
- **Case Number**: 2:11-CV-00057-JRG
- **pageHeaderLines**: 1 (should be, but transcript is malformed)
- **File Pattern**: "Trial" suffix (full-day transcripts)
- **Sessions**: 2 (all MORNING type)
- **Config Location**: `./config/trial-configs/72-taylor-v-turner.json`
- **CRITICAL ISSUES**:
  - **Malformed PDF conversion**: Pages have irregular boundaries
  - **Consecutive headers**: Pages 2 and 3 headers appear on lines 59-60 with no content between
  - **Single page storage**: Parser treats entire transcript as one page (9,835 lines)
  - **Header locations**: Line 1 (page 1), 59 (page 2), 60 (page 3), 117 (page 4), 174 (page 5)
- **Header Structure** (when it appears):
  ```
  Case 2:11-cv-00057-JRG Document 278 Filed 11/10/12 Page X of 371 PageID #: XXXXX
  ```
- **Recommendation**: Needs re-conversion from PDF or special handling for malformed structure

### 73 - Tq Delta, Llc V. Commscope
- **Case Number**: 2:21-CV-00310-JRG
- **pageHeaderLines**: TBD
- **Config Location**: TBD
- **Notes**: Not yet analyzed

### 75 - Garrett V Wood County
- **Case Number**: 6:17-CV-00507-JRG
- **pageHeaderLines**: TBD
- **Config Location**: TBD
- **Notes**: Not yet analyzed

### 68 - Contentguard Holdings, Inc. V. Google ⚠️
- **Case Number**: 2:14-CV-00061-JRG
- **pageHeaderLines**: TBD
- **MAJOR ISSUES**: 
  - Most sessions show only 1 page instead of proper page counts
  - PM1 session correctly mapped to EVENING but still has 1-page issue
  - Should be excluded from batch testing until fixed
- **Config Location**: TBD

### 83 - Koninklijke
- **Case Number**: 2:21-CV-00113-JRG
- **pageHeaderLines**: TBD
- **Config Location**: TBD

### 85 - Navico V. Garmin
- **Case Number**: 2:16-CV-0190
- **pageHeaderLines**: TBD
- **Config Location**: TBD

### 86 - Ollnova
- **Case Number**: 2:22-CV-00072-JRG
- **pageHeaderLines**: TBD
- **Config Location**: TBD

### 95 - Lake Cherokee
- **Case Number**: 2:10-CV-216
- **pageHeaderLines**: TBD
- **Config Location**: TBD

### 101 - Netlist, Inc. V. Samsung
- **pageHeaderLines**: TBD
- **Config Location**: TBD

### 103 - Smartflash
- **pageHeaderLines**: TBD
- **Config Location**: TBD

### 106 - Chrimar Systems V. Aerohive
- **pageHeaderLines**: TBD
- **Config Location**: TBD

## Phase 2 Issues Discovered

### Event Duplication in Batch Processing
When running Phase 2 for multiple trials sequentially, events were being assigned to the wrong trial. Investigation revealed:
- Individual trial processing works correctly
- Batch processing has issues with trial isolation
- Debug logging added to Phase2Processor to track trialId flow

### Single Page Transcripts
Some trials (e.g., Taylor V Turner) store entire transcripts as single pages with thousands of lines:
- Page 950: 9,835 lines
- Page 951: 3,130 lines
This is normal for these trials but unusual compared to standard pagination.

## Testing Process

### How to Test pageHeaderLines Configuration
1. Run Phase 1 parsing with trial
2. Check database for header parsing:
   ```sql
   SELECT p.id, p."pageNumber", p."trialPageNumber", 
          p."parsedTrialPage", p."headerText" 
   FROM "Page" p 
   JOIN "Session" s ON p."sessionId" = s.id 
   WHERE s."trialId" = [TRIAL_ID] 
   LIMIT 10;
   ```
3. If headerText is empty, examine raw text file to count header lines
4. Update trialstyle.json with correct pageHeaderLines value
5. Re-run Phase 1 and verify headerText is populated

## Storage Structure
```
config/
├── trial-configs/        # Backup of working trialstyle.json files
│   ├── 71-hinson-et-al-v-dorel.json
│   ├── 72-taylor-v-turner.json
│   └── ...
└── multi-trial-config-mac.json  # Main batch configuration
```

## Next Steps
1. Systematically test each trial to determine pageHeaderLines
2. Document Q&A patterns for each trial
3. Identify any special delimiter patterns
4. Create automated validation for header parsing
5. Migrate configurations back to source PDF folders for future conversions