# Feature 02R Implementation Guide

## Overview
This guide documents the implementation of multi-trial parsing capabilities with proper metadata extraction and organization. The system must handle various trial formats, extract metadata correctly, and prevent duplicate trial creation.

## Completed Work

### 1. Database Schema Updates
- Added `Trial.shortName` field to store folder names from configuration
- Added `Session.shortName` field to store session identifiers (e.g., "Morning", "Afternoon")

### 2. Phase 1 Speaker Resolution Fix
- Removed Q&A speaker resolution from Phase 1 (moved to Phase 2)
- Simplified `identifySpeaker` to only extract basic prefixes
- Speaker registry initialization now only happens in Phase 2

### 3. Page Header Configuration
- Fixed configuration flow: config → MultiPassTranscriptParser → MetadataExtractor
- Added `pageHeaderLines` to MultiPassConfig interface
- MetadataExtractor now properly uses configured header lines (default: 2)

### 4. File Sorting Fix
- Fixed destructuring bug in `parseDateMornAft` method
- Morning sessions now correctly sort before afternoon sessions

### 5. Summary Delimiter Implementation
- Implemented detection and use of `summaryCenterDelimiter` (")(" for Vocalife)
- Left side contains party names (plaintiff, defendant)
- Right side contains case info, dates, times
- Successfully extracts clean plaintiff and defendant names

## Remaining Implementation Tasks

### 1. Remove PROCEEDINGS as SessionSection Type
**Current Issue**: PROCEEDINGS is being created as a SessionSection type but should not exist.

**Implementation**:
- Remove PROCEEDINGS from SessionSectionType enum if present
- Update parser to not create PROCEEDINGS sections
- Content currently marked as PROCEEDINGS should be part of the transcript body

### 2. Parse Right Side of Summary into Separate SessionSections
**Current Issue**: Right side of summary after delimiter contains multiple pieces of metadata that need separate SessionSection records.

**Required SessionSection Types**:
- `CIVIL_ACTION_NO`: Extract case number (e.g., "Civil Action No. 1:20-cv-11424-DJC")
- `TRIAL_LOCATION`: Extract court location (e.g., "Boston, Massachusetts")
- `TRIAL_DATE`: Extract trial date (e.g., "October 1, 2020")
- `SESSION_START_TIME`: Extract session start time (e.g., "9:37 a.m.")

**Implementation**:
```typescript
// After splitting on summaryCenterDelimiter
const rightSideParts = rightSide.split('\n').filter(line => line.trim());

// Parse each line for specific metadata
for (const line of rightSideParts) {
  if (line.includes('Civil Action No.')) {
    // Create CIVIL_ACTION_NO SessionSection
  } else if (line.match(/\d{1,2}:\d{2}\s*[ap]\.m\./i)) {
    // Create SESSION_START_TIME SessionSection
  } else if (line.match(/\w+,\s+\w+\s+\d{1,2},\s+\d{4}/)) {
    // Create TRIAL_DATE SessionSection
  } else if (line.includes(',') && !line.includes('No.')) {
    // Likely TRIAL_LOCATION
  }
}
```

### 3. Populate Session.startTime
**Requirement**: Extract and populate Session.startTime from SESSION_START_TIME SessionSection.

**Implementation**:
- Parse time string (e.g., "9:37 a.m.") into proper DateTime
- Update Session record with extracted startTime

### 4. Automatic summaryCenterDelimiter Detection
**Current Issue**: Delimiter is hardcoded as ")(" but should be auto-detected.

**Detection Algorithm**:
1. Sample first 100 lines of first file
2. Look for patterns that appear consistently (8+ times)
3. Priority order of delimiters:
   - ")(" - Most common in Lexis Nexis format
   - ") (" - With space variant
   - "v." or "vs." - Alternative formats
   - "|" or "||" - Table-style separators

**Implementation**:
```typescript
function detectSummaryCenterDelimiter(lines: string[]): string {
  const candidates = [')(', ') (', '|', '||'];
  const counts = new Map<string, number>();
  
  for (const line of lines) {
    for (const delimiter of candidates) {
      if (line.includes(delimiter)) {
        counts.set(delimiter, (counts.get(delimiter) || 0) + 1);
      }
    }
  }
  
  // Return delimiter with highest count > 5
  let maxCount = 0;
  let bestDelimiter = ')('; // default
  for (const [delimiter, count] of counts) {
    if (count > maxCount && count >= 5) {
      maxCount = count;
      bestDelimiter = delimiter;
    }
  }
  
  return bestDelimiter;
}
```

### 5. Prevent Duplicate Trial Creation
**Current Issue**: Multiple trials being created (pdf, multi-trial, actual trial).

**Requirements**:
- Only one trial per configured folder
- Use case number normalization for matching
- Check existing trials before creating new ones

**Implementation**:
```typescript
// Normalize case number for comparison
function normalizeCaseNumber(caseNo: string): string {
  return caseNo.replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
}

// Before creating trial
const existingTrial = await prisma.trial.findFirst({
  where: {
    OR: [
      { shortName: trialShortName },
      { caseNumber: caseNumber }
    ]
  }
});

if (existingTrial) {
  // Use existing trial
  return existingTrial;
}
```

### 6. Extract Case Number from Page Headers
**Additional Source**: Case number also appears in page headers.

**Implementation**:
- Check Page.headerText for case number pattern
- Use as fallback if not found in summary
- Pattern: Usually "Case X:XX-cv-XXXXX-XXX" format

## Testing Strategy

### Phase 1: Single Trial Testing (Vocalife)
1. Reset database
2. Run PDF conversion
3. Run Phase 1 parsing
4. Verify:
   - Only one trial created
   - Correct metadata extracted
   - No PROCEEDINGS sections
   - All SessionSection types populated

### Phase 2: Multi-Trial Testing
1. Configure multiple trials in config
2. Run full pipeline
3. Verify each trial:
   - Correct delimiter detected
   - Metadata properly extracted
   - No duplicates created
   - Sessions properly linked

## Configuration Requirements

### trialstyle.json Updates
```json
{
  "summaryCenterDelimiter": "AUTO",
  "pageHeaderLines": 2,
  "expectedPatterns": {
    "caseNumber": ["Case \\d+:\\d+-cv-\\d+-\\w+", "Civil Action No\\."],
    "sessionTime": ["\\d{1,2}:\\d{2}\\s*[ap]\\.m\\."]
  }
}
```

### multi-trial-config-mac.json
- Already configured for Vocalife trial
- No additional configuration files needed
- Use existing structure for all trials

## Implementation Order

1. **Immediate**: Remove PROCEEDINGS section type ✅
2. **Next**: Parse right side into separate SessionSections ✅
3. **Then**: Implement delimiter auto-detection ✅
4. **Finally**: Fix multi-trial processing (see below)

## Critical Multi-Trial Processing Issue

**See detailed documentation**: `docs/multi-trial-parsing-fix.md`

### Summary of Issue
The parse.ts file has two critical bugs preventing proper multi-trial processing:
1. Uses partial string matching (`dir.includes(trial)`) instead of exact matching
2. Processes only the first matching trial then exits, instead of looping through all

### Required Fix
- Change to exact directory name matching: `trialsToProcess.includes(dir)`
- Wrap entire trial processing logic in a for loop to handle all matching directories
- Reset trial-specific variables (like `trialStyleConfig`) for each trial

### Current Status
- PDF conversion works for all trials ✅
- Single trial parsing works correctly ✅
- Multi-trial parsing only processes first match ❌
- Need to restructure parse.ts to process all trials in `includedTrials` array

## Success Criteria

- [x] No PROCEEDINGS sections created
- [x] Right side metadata in separate SessionSections
- [x] Session.startTime populated from SESSION_START_TIME
- [x] Automatic delimiter detection working
- [x] No duplicate trials created
- [x] All metadata correctly extracted and stored
- [ ] Multiple trials process successfully in single run

## Testing Status

Successfully tested with Vocalife trial (42 Vocalife Amazon):
- 12 sessions parsed correctly
- Metadata extraction working
- Delimiter auto-detection successful
- CERTIFICATION section correctly identified

Pending: Full multi-trial test with:
- 01 Genband (8 sessions)
- 02 Contentguard (29 sessions)
- 14 Optis (9 sessions)
- 42 Vocalife (12 sessions)
- 50 Packet Netscout (6 sessions)

## Priority Issues and Solutions

### Issue 1: Q/A Speaker Resolution in Phase 1
**Where**: `src/parsers/MultiPassContentParser.ts:523-563`

**Current Code Problem**:
```typescript
// Line 532-535: Attempting speaker resolution in Phase 1
const contextualSpeaker = await this.examinationContext.resolveSpeaker({
  text,
  lineNumber
});
```

**Fix**:
```typescript
private async identifySpeaker(
  text: string,
  lineNumber: number
): Promise<{ prefix: string; type: string } | null> {
  // Phase 1: Only extract basic speaker prefix, no resolution
  return this.extractSpeaker(text);
  // Remove all ExaminationContext calls
}
```

### Issue 2: Page Numbers as Lines
**Where**: `src/parsers/MultiPassContentParser.ts:488-501`

**Add Filter**:
```typescript
// Before processing line
if (/^\d+$/.test(line.cleanText.trim()) && line.cleanText.trim().length <= 4) {
  // Skip standalone page numbers
  continue;
}
```

### Issue 3: Trial Metadata Not Updated
**Where**: `src/parsers/MultiPassContentParser.ts` - after SessionSection parsing

**Add After Line 93**:
```typescript
// After processSessionSections
await this.updateTrialMetadata(sessionId, trialId);
```

**New Method**:
```typescript
private async updateTrialMetadata(sessionId: number, trialId: number): Promise<void> {
  // Query SessionSections
  const sections = await this.prisma.sessionSection.findMany({
    where: { sessionId },
    orderBy: { orderIndex: 'asc' }
  });
  
  const caseTitle = sections.find(s => s.sectionType === 'CASE_TITLE');
  const courtDiv = sections.find(s => s.sectionType === 'COURT_AND_DIVISION');
  
  // Parse plaintiff/defendant from case title
  if (caseTitle) {
    const titleText = caseTitle.sectionText;
    // Parse logic for "VOCALIFE LLC, )( PLAINTIFF"
    const plaintiffMatch = titleText.match(/^([^,]+),.*PLAINTIFF/ms);
    const defendantMatch = titleText.match(/DEFENDANT[S]?\.?\s*\)\(\s*([^)]+)/ms);
    
    await this.prisma.trial.update({
      where: { id: trialId },
      data: {
        name: `${plaintiffMatch?.[1]} v. ${defendantMatch?.[1]}`,
        plaintiff: plaintiffMatch?.[1]?.trim(),
        defendant: defendantMatch?.[1]?.trim()
      }
    });
  }
  
  // Parse court from COURT_AND_DIVISION
  if (courtDiv) {
    const courtMatch = courtDiv.sectionText.match(/UNITED STATES .* COURT/);
    if (courtMatch) {
      await this.prisma.trial.update({
        where: { id: trialId },
        data: { court: courtMatch[0] }
      });
    }
  }
}
```

### Issue 4: Database Schema Updates
**File**: `prisma/schema.prisma`

**Add to Trial model**:
```prisma
model Trial {
  // ... existing fields ...
  shortName    String?  @db.VarChar(255)  // Folder name from config
  // 'name' field remains for full parsed name
}
```

**Add to Session model**:
```prisma
model Session {
  // ... existing fields ...
  shortName    String?  @db.VarChar(255)  // Parsed from filename
  metadata     Json?                      // File convention data
}
```

### Issue 5: Populate New Fields
**Where**: `src/cli/parse.ts:206-220`

**Update Trial Creation**:
```typescript
// Line 220 - when creating trial
const trial = await prisma.trial.create({
  data: {
    name: trialName,
    shortName: path.basename(config.inputDir), // Add this
    caseNumber: caseNumber || 'UNKNOWN',
    // ... rest
  }
});
```

**Where**: `src/parsers/MultiPassContentParser.ts`

**Update Session Metadata**:
```typescript
private async updateSessionMetadata(
  metadata: ParsedMetadata,
  sessionId: number,
  trialId: number
): Promise<void> {
  // Extract shortName from metadata
  const shortName = metadata.originalFileName
    ?.replace(/\.txt$/, '')
    ?.replace(/NOTICE OF FILING.*held on /, '')
    ?.replace(/[()]/g, '');
    
  await this.prisma.session.update({
    where: { id: sessionId },
    data: {
      totalPages: metadata.pages.size,
      transcriptStartPage: metadata.transcriptStartPage,
      shortName,  // Add this
      metadata: {  // Add this
        originalFileName: metadata.originalFileName,
        dateStr: metadata.dateStr,
        sessionType: metadata.sessionType,
        fileConvention: metadata.fileConvention
      }
    }
  });
}
```

## Testing Checklist

1. **Run Phase 1 and verify**:
   - No "Unable to resolve Q/A speaker" warnings
   - Trial.plaintiff != "Unknown Plaintiff"
   - Trial.defendant != "Unknown Defendant"
   - Trial.court != "UNKNOWN COURT"
   - No lines with just page numbers (e.g., "126")

2. **Check database after Phase 1**:
   ```sql
   SELECT shortName, name, plaintiff, defendant, court 
   FROM "Trial" WHERE id = 1;
   
   SELECT shortName, sessionType, metadata 
   FROM "Session" WHERE trialId = 1;
   ```

3. **Verify Phase 2 still works**:
   - Q&A speakers properly resolved
   - Witness context maintained
   - Events created correctly

## Implementation Order

1. **Database Changes First**:
   - Update schema with new fields
   - Run `npx prisma db push`

2. **Fix Phase 1 Speaker Resolution**:
   - Simplify identifySpeaker method
   - Remove ExaminationContext usage

3. **Add Page Number Filter**:
   - Add regex check before line processing

4. **Implement Metadata Extraction**:
   - Add updateTrialMetadata method
   - Call after SessionSection parsing

5. **Populate New Fields**:
   - Update trial creation with shortName
   - Update session with shortName and metadata

6. **Test Full Pipeline**:
   - Reset database
   - Run all phases
   - Verify corrections

## Rollback Plan
If issues arise:
1. Revert MultiPassContentParser changes
2. Keep database fields (nullable, won't break existing)
3. Phase 2 should continue working with raw prefixes

## Notes for Phase 2 Adjustments
Phase 2 may need updates to:
- Handle raw speaker prefixes from Phase 1
- Initialize ExaminationContext properly
- Ensure Q&A resolution still works

## Success Metrics
- Zero Q/A resolution warnings in Phase 1 logs
- All Trial fields populated correctly
- Clean phase separation achieved
- No regression in Phase 2/3 functionality