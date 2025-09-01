# Feature 03R Implementation Guide

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