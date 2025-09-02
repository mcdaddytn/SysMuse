# Feature 02U: Trial-Specific Configuration Management

## Overview
Implement comprehensive trial-specific configuration support to handle the diverse formatting requirements across different judicial transcripts. Each trial may have unique page header structures, Q&A patterns, delimiters, and other parsing requirements.

## Problem Statement
Current issues discovered during testing:
1. **Variable pageHeaderLines**: Trials have different header structures (1-5 lines)
2. **Malformed transcripts**: Some trials have irregular page boundaries from PDF conversion
3. **Phase 2 batch processing**: Events being assigned to wrong trials in batch mode
4. **Custom delimiters**: Many trials need specific delimiter patterns
5. **File naming variations**: Different conventions for session types

## Requirements

### 1. Configuration Storage and Management
- [x] Create `./config/trial-configs/` directory for storing trial-specific configurations
- [x] Copy all existing trialstyle.json files from output directories
- [x] Implement naming convention: `{numeric-prefix}-{trial-name-slug}.json`

### 2. Invalid Trials Collection
- [x] Add `invalidTrials` array to multi-trial-config-mac.json
- [x] Exclude invalid trials from batch processing
- [ ] Document reasons for invalidation

Current invalid trials:
- **50 Packet Netscout**: Parsing issues
- **50 Packet**: Duplicate/parsing issues  
- **68 Contentguard Holdings, Inc. V. Google**: Page structure errors (1 page per session)
- **72 Taylor V Turner**: Malformed PDF conversion, irregular page boundaries

### 3. Trial Configuration Parameters

#### Essential Parameters
```json
{
  "pageHeaderLines": 2,           // Number of header lines (1-5)
  "summaryCenterDelimiter": "*",  // Custom delimiter or "AUTO"
  "fileConvention": "DATEAMPM",   // File naming pattern
  "sessionTypeMapping": {
    "Trial": "MORNING",           // Full-day transcript
    "AM": "MORNING",
    "PM": "AFTERNOON", 
    "PM1": "EVENING"
  }
}
```

#### Q&A Pattern Configuration
```json
{
  "questionPatterns": ["Q.", "Q:", "Q"],
  "answerPatterns": ["A.", "A:", "A"],
  "attorneyIndicatorPatterns": [
    "BY MR\\. ([A-Z]+)",
    "BY MS\\. ([A-Z]+)"
  ]
}
```

### 4. Header Validation Rules
Indicators of pageHeaderLines problems:
- `Page.headerText` is empty or null
- `Page.parsedTrialPage` differs from `trialPageNumber`
- Exception: When pageHeaderLines=1 and page numbers ≥ 100

### 5. Phase 2 Query Fix
- [ ] Fix trialId filtering in Phase2Processor
- [ ] Ensure sessions are properly filtered by trialId
- [ ] Add validation to prevent cross-trial event assignment
- [x] Add debug logging for trialId tracking

### 6. Configuration Loading Priority
1. Trial-specific trialstyle.json (highest priority)
2. Default trial style from multi-trial-config
3. System defaults (lowest priority)

## Implementation Tasks

### Phase 1: Configuration Infrastructure
- [x] Create configuration storage directory
- [x] Copy existing configurations
- [x] Create invalidTrials collection
- [x] Document trial-specific issues

### Phase 2: Parser Updates
- [ ] Update MultiPassTranscriptParser to respect pageHeaderLines
- [ ] Implement configuration cascade/priority system
- [ ] Add validation for header parsing
- [ ] Handle malformed transcript edge cases

### Phase 3: Phase 2 Processing Fix
- [ ] Fix session query filtering by trialId
- [ ] Add transaction boundaries for trial processing
- [ ] Implement proper isolation between trials
- [ ] Add comprehensive logging

### Phase 4: Testing and Validation
- [ ] Test each trial individually to determine pageHeaderLines
- [ ] Document Q&A patterns for each trial
- [ ] Validate header parsing for all trials
- [ ] Create automated validation suite

## Configuration Documentation

### Trial Status Categories
1. **Active**: Currently being processed
2. **Inactive**: Valid but not currently selected
3. **Invalid**: Has parsing issues, excluded from processing
4. **Completed**: Successfully processed and validated

### File Naming Conventions
- **"Trial" suffix**: Full-day transcript (maps to MORNING)
- **"AM" suffix**: Morning session
- **"PM" suffix**: Afternoon session
- **"PM1" suffix**: Evening session
- **Date patterns**: Various formats need detection

## Testing Process

### Individual Trial Testing
```bash
# Reset database
npx prisma db push --force-reset && npm run seed

# Configure single trial in activeTrials
# Run Phase 1
npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json --parser-mode multi-pass

# Check header parsing
psql -c "SELECT p.\"headerText\", p.\"parsedTrialPage\" FROM \"Page\" p LIMIT 5;"

# Run Phase 2
npx ts-node src/cli/parse.ts parse --phase2 --config config/multi-trial-config-mac.json --trial-id 1
```

### Batch Testing
```bash
# Configure batch in activeTrials (exclude invalid trials)
# Run with debug logging enabled
# Monitor for duplicate events or cross-trial contamination
```

## Success Criteria
1. Each trial processes with correct pageHeaderLines
2. Phase 2 assigns events to correct trials only
3. Invalid trials are excluded from batch processing
4. All configurations are documented and backed up
5. Automated validation catches configuration issues

## Future Enhancements
1. Auto-detect pageHeaderLines from transcript analysis
2. Machine learning for Q&A pattern detection
3. Automatic malformed transcript repair
4. Configuration inheritance for similar trials
5. Web UI for configuration management