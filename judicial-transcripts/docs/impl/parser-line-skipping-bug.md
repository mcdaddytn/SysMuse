# Parser Line Skipping Bug - Critical Issue

## Issue Summary
The multi-pass parser is skipping critical lines during parsing, causing speaker attribution failures and missing content. This was discovered in trial "67 Gonzalez V. New Life" where the parser skipped 10 consecutive lines containing the plaintiff attorney's closing argument opening.

## Specific Example - Trial 67, Session 5, Page 40

### What Should Be Parsed (Raw Text File)
Location: `output/multi-trial/67 Gonzalez V. New Life/Gonzalez V. New Life February 11, 2016 AM and PM.txt`
Lines 2130-2160 (Page 40):

```
Line 2130: 10                THE COURT:   All right.    Now I understand.
Line 2131:
Line 2132: 11                Please proceed with your first closing argument.
Line 2133:
Line 2134: 12                MR. MUELLER:   Good morning, ladies and gentlemen.
Line 2135:
Line 2136: 13     First, I'd like to say thank you very much for your time.           This
Line 2137:
Line 2138: 14     is a very important for us, particularly Mr. Gonzalez, and we
Line 2139:
Line 2140: 15     definitely appreciate the hard work that you've put in this
Line 2141:
Line 2142: 16     week listening to the evidence and the witnesses that have
Line 2143:
Line 2144: 17     testified.
Line 2145:
Line 2146: 18                Now, there was a tremendous amount of testimony this
Line 2147:
Line 2148: 19     week on very complex technology, but at the end of the day,
Line 2149:
Line 2150: 20     this is a very simple case.      You heard the Judge give you
Line 2151:
Line 2152: 21     instructions, and in those instructions, he said that we only
Line 2153:
Line 2154: 22     have to prove two things:       That Sugardaddie infringed
Line 2155:
Line 2156: 23     Mr. Gonzalez's patents and the amount of a reasonable royalty.
Line 2157:
Line 2158: 24     And I submit to you that you heard undisputed evidence on both
Line 2159:
Line 2160: 25     of those things.    We clearly got the ball over the 50-yard
```

### What Was Actually Parsed (Database)
Session 5, Page 40 in database:

```
Line 1:  [NO PREFIX]    You want to use 27 in your first closing argument?
Line 2:  [MR. MUELLER]  No. I'd like to reserve seven minutes
Line 3:  [NO PREFIX]    for rebuttal, Your Honor.
Line 4:  [THE COURT]    All right. So you want a warning at 23
Line 5:  [NO PREFIX]    minutes?
Line 6:  [MR. MUELLER]  At 20 minutes, Your Honor.
Line 7:  [THE COURT]    At 20 minutes, with 3 minutes before the 7
Line 8:  [NO PREFIX]    minutes?
Line 9:  [MR. MUELLER]  Yes, Your Honor.
Line 10: [THE COURT]    All right. Now I understand.
Line 11: [NO PREFIX]    Please proceed with your first closing argument.
Line 12: [NO PREFIX]    Mr. Gonzalez's patents and the amount of a reasonable royalty.  ← WRONG!
Line 13: [NO PREFIX]    And I submit to you that you heard undisputed evidence on both
Line 14: [NO PREFIX]    of those things. We clearly got the ball over the 50-yard
```

## The Bug Details

### Lines Completely Skipped
The parser completely skipped these lines from the raw text:
- Line 12: `MR. MUELLER:   Good morning, ladies and gentlemen.`
- Line 13: `First, I'd like to say thank you very much for your time. This`
- Line 14: `is a very important for us, particularly Mr. Gonzalez, and we`
- Line 15: `definitely appreciate the hard work that you've put in this`
- Line 16: `week listening to the evidence and the witnesses that have`
- Line 17: `testified.`
- Line 18: `Now, there was a tremendous amount of testimony this`
- Line 19: `week on very complex technology, but at the end of the day,`
- Line 20: `this is a very simple case. You heard the Judge give you`
- Line 21: `instructions, and in those instructions, he said that we only`
- Line 22: `have to prove two things: That Sugardaddie infringed` (partial)

### Content Misplacement
- Database Line 12 contains text from raw text Line 23
- Database has only 14 lines for this page instead of 25
- The parser jumped from line 11 directly to line 23's content

### Impact on System

1. **Speaker Attribution Failure**:
   - MR. MUELLER's speaker prefix on line 12 was lost
   - His entire opening statement (lines 13-21) was lost
   - The system attributed his closing to THE COURT (Event 4658)

2. **Closing Argument Detection Failure**:
   - The ArgumentFinder could not find plaintiff's closing
   - The LongStatementsAccumulator missed this 2700+ word statement
   - Closing evaluation shows "no candidate sections found"

3. **Trial Line Number Discontinuity**:
   - Trial line 15624 (page line 11) jumps to 15636 (should be line 12)
   - Missing trial line numbers 15625-15635

## Root Cause Analysis

### Initial Hypothesis (Incorrect)
The parser appears to have issues when:
1. There's a speaker change with specific formatting (MR. MUELLER: with colon)
2. Multi-line statements that continue without line numbers on subsequent lines
3. Possibly related to blank lines between numbered lines in the raw text

### Actual Findings (2025-09-21)

After implementing comprehensive logging and diagnostics, we discovered:

1. **The raw text files are correct** - All lines including MR. MUELLER's closing statement are present in the converted text files
2. **Lines are being lost during extraction/metadata phase** - Lines 1-11 are never reaching the `processLineBatch` method
3. **The issue is systematic** - Affects multiple pages across all sessions, not just page 40
4. **Two distinct patterns observed**:
   - **SUMMARY section (Page 1)**: Jump from line 4 to line 23 due to blank lines 5-22 (expected behavior)
   - **PROCEEDINGS section**: Lines 1-11 completely missing, parser starts at line 12 (BUG)

### Key Diagnostic Results

1. **LINE SKIP Detection**:
   ```
   [LINE SKIP] Page 1: Jump from line 4 to line 23 - missing lines 5 to 22
   ```
   This occurs in SUMMARY section where lines 5-22 are blank (only line numbers, no content)

2. **Discontinuity Warnings**:
   ```
   Line number discontinuity on page 40: Prefix shows line 12, calculated line 1 (diff=11)
   ```
   This indicates the parser is receiving line 12 as the first line of the page

3. **Database Storage**:
   - Only 14 lines stored for pages that should have 25 lines
   - Lines are correctly numbered 1-14 but contain content from lines 12-25

### Where Lines Are Lost

The lines are being lost somewhere between:
1. **Text file reading** (lines exist in files ✓)
2. **Metadata extraction** in `MultiPassMetadataExtractor`
3. **Line mapping** in the metadata structure
4. **Batch creation** in `createLineBatches`

The `processLineBatch` method never receives lines 1-11, indicating they're filtered or skipped during extraction.

## Suggested Diagnostics and Fixes

### 1. Line Number Continuity Check (Immediate Implementation)

During Phase 1 parsing, we can detect discontinuities by comparing:
- **linePrefix**: The raw line number from the text (e.g., "12" from "12  MR. MUELLER:")
- **lineNumber**: The calculated line number we assign in our Line model

#### Implementation Strategy

```typescript
// In ContentParser.ts or MultiPassParser.ts during line processing
private checkLineNumberContinuity(
  line: ExtractedLine,
  calculatedLineNumber: number,
  documentSection: DocumentSection
): void {
  // Only check during PROCEEDINGS section where line numbers are reliable
  if (documentSection !== DocumentSection.PROCEEDINGS) {
    return;
  }

  // Extract numeric line number from linePrefix
  const prefixMatch = line.linePrefix?.match(/^\s*(\d+)\s*/);
  if (!prefixMatch) {
    // No line number in prefix - might be continuation line
    return;
  }

  const prefixLineNumber = parseInt(prefixMatch[1]);

  // Compare with our calculated line number
  if (prefixLineNumber !== calculatedLineNumber) {
    this.logger.warn(
      `Line number discontinuity detected at calculated line ${calculatedLineNumber}: ` +
      `Prefix shows line ${prefixLineNumber}, difference of ${Math.abs(prefixLineNumber - calculatedLineNumber)}`
    );

    // Log context for debugging
    this.logger.debug(`  Line text: ${line.text?.substring(0, 50)}...`);
    this.logger.debug(`  Speaker: ${line.speakerPrefix || 'NO SPEAKER'}`);

    // Track discontinuities for summary
    this.discontinuities.push({
      calculatedLine: calculatedLineNumber,
      prefixLine: prefixLineNumber,
      text: line.text?.substring(0, 50),
      page: line.pageNumber
    });
  }
}
```

#### Expected Behavior

- **PROCEEDINGS section**: Line numbers should match exactly
  - Prefix: "12" → Calculated: 12 ✓
  - Prefix: "13" → Calculated: 13 ✓

- **SUMMARY/CERTIFICATION sections**: May have unnumbered lines
  - These sections often have content without line numbers
  - Skip validation for these sections

#### Warning Triggers

The system should log warnings when:
1. Prefix line number jumps (e.g., 11 → 23) but calculated continues (11 → 12)
2. Prefix line number exists but doesn't match calculated
3. Multiple consecutive mismatches occur (indicates systematic problem)

#### Example Detection

In the bug case from Trial 67:
```
Line 11: prefix="11", calculated=11 ✓
Line 12: prefix="23", calculated=12 ✗ WARNING: Discontinuity (diff=11)
Line 13: prefix="24", calculated=13 ✗ WARNING: Discontinuity (diff=11)
```

This would immediately flag that lines 12-22 from the original text were skipped.

### 2. Add Line Counting Diagnostics
```typescript
// In MultiPassParser.ts - Add to parseContent method
private async parseContent(lines: ExtractedLine[], session: Session): Promise<void> {
  const startingLineCount = lines.length;
  let processedLineCount = 0;
  let skippedLineCount = 0;
  let storedLineCount = 0;

  // After processing each batch
  this.logger.debug(`Batch ${batchNum}: Processed ${batchProcessed}, Skipped ${batchSkipped}, Stored ${batchStored}`);

  // At end of processing
  this.logger.info(`Line Processing Summary for Session ${session.id}:`);
  this.logger.info(`  Input lines: ${startingLineCount}`);
  this.logger.info(`  Processed: ${processedLineCount}`);
  this.logger.info(`  Skipped: ${skippedLineCount}`);
  this.logger.info(`  Stored in DB: ${storedLineCount}`);

  if (processedLineCount !== startingLineCount) {
    this.logger.error(`LINE COUNT MISMATCH: Expected ${startingLineCount}, processed ${processedLineCount}`);
  }
}
```

### 2. Add Page Validation
```typescript
// Validate each page has expected number of lines
private validatePageLines(page: Page, expectedLines: number[]): void {
  const actualLines = await prisma.line.findMany({
    where: { pageId: page.id },
    orderBy: { lineNumber: 'asc' }
  });

  const missingLines = expectedLines.filter(num =>
    !actualLines.some(line => line.lineNumber === num)
  );

  if (missingLines.length > 0) {
    this.logger.error(`Page ${page.pageNumber} missing lines: ${missingLines.join(', ')}`);
  }
}
```

### 3. Add Continuity Check
```typescript
// Check for line number gaps
private checkLineContinuity(lines: Line[]): void {
  for (let i = 1; i < lines.length; i++) {
    const expectedLineNum = lines[i-1].lineNumber + 1;
    if (lines[i].lineNumber !== expectedLineNum) {
      const gap = lines[i].lineNumber - lines[i-1].lineNumber - 1;
      this.logger.warn(`Gap detected: Missing ${gap} lines between ${lines[i-1].lineNumber} and ${lines[i].lineNumber}`);
    }
  }
}
```

### 4. Add Speaker Transition Validation
```typescript
// Validate speaker transitions
private validateSpeakerTransition(prevLine: Line, currentLine: Line): void {
  // Check if we're missing a speaker prefix where expected
  if (!currentLine.speakerPrefix &&
      prevLine.text?.includes('Please proceed') &&
      currentLine.lineNumber === prevLine.lineNumber + 1) {
    this.logger.warn(`Possible missing speaker after prompt at line ${currentLine.lineNumber}`);
  }
}
```

### 5. Add Raw Text Comparison
```typescript
// Compare parsed output with raw text
private async compareWithRawText(
  sessionFile: string,
  parsedLines: Line[]
): Promise<void> {
  const rawText = fs.readFileSync(sessionFile, 'utf-8');
  const rawLines = rawText.split('\n');

  // Find lines with line numbers (e.g., "12  MR. MUELLER:")
  const numberedLines = rawLines.filter(line => /^\d+\s/.test(line));

  if (numberedLines.length !== parsedLines.length) {
    this.logger.error(`Line count mismatch: Raw has ${numberedLines.length}, parsed has ${parsedLines.length}`);

    // Find specific missing lines
    for (const rawLine of numberedLines) {
      const lineNum = parseInt(rawLine.match(/^(\d+)/)[1]);
      if (!parsedLines.some(p => p.lineNumber === lineNum)) {
        this.logger.error(`Missing line ${lineNum}: ${rawLine.substring(0, 50)}`);
      }
    }
  }
}
```

## Next Investigation Steps

1. **Check MultiPassMetadataExtractor**:
   - Add logging in `extractMetadata` method to track all lines being read
   - Verify page boundaries are correctly detected
   - Check if lines 1-11 are being read but filtered out

2. **Check Line Filtering**:
   - Review `shouldFilterLine` method in ContentParser
   - Check if `lineFilters` in trialstyle.json are too aggressive
   - Current filters for trial 67:
     ```json
     "lineFilters": {
       "literal": [
         "Shawn M. McRoberts, RMR, CRR",
         "Federal Official Court Reporter"
       ]
     }
     ```

3. **Check Page Boundary Detection**:
   - Verify form feed character detection
   - Check if page header/footer detection is consuming lines
   - Look for off-by-one errors in page line counting

4. **Debug Metadata Structure**:
   - Log the `metadata.lines` Map size vs actual lines in file
   - Check `metadata.fileLineMapping` for missing entries
   - Verify `metadata.pageMapping` is correct

## Testing Strategy

1. **Create test case with the specific problematic text**:
   - Extract lines 2100-2200 from trial 67 as test input
   - Verify all 25 lines of page 40 are parsed correctly
   - Verify speaker attribution for MR. MUELLER

2. **Add regression test**:
   - Count total lines in raw file
   - Count total lines in database after parsing
   - These should match (excluding blank lines)

3. **Add integration test**:
   - Parse trial 67 completely
   - Verify Event 4658 is correctly split
   - Verify Mueller's closing is found by ArgumentFinder

## Temporary Workaround

Until the parser is fixed, we may need to:
1. Manually review trials for missing closing/opening statements
2. Check for trial line number gaps as an indicator of skipped content
3. Compare page line counts between raw text and database

## Related Issues
- Event 4658 incorrectly attributes 2756 words to THE COURT (should be split)
- MarkerSection for CLOSING_STATEMENT_PLAINTIFF not created
- LongStatementsAccumulator cannot find plaintiff closing

## Files Affected
- `/src/parsers/MultiPassParser.ts` - Main parser logic
- `/src/parsers/ContentParser.ts` - Line processing logic
- `/src/phase3/ArgumentFinder.ts` - Cannot find closing due to missing lines
- `/src/services/llm/LLMExtractor.ts` - May fail to extract from incomplete text

## Priority
**CRITICAL** - This bug causes data loss and prevents proper legal document analysis.

## NEW FINDINGS (2025-09-21 Session)

### Database Insert Failure Discovery
- **Lines ARE being extracted correctly** - MetadataExtractor finds all 25 lines on page 4
- **Lines are NOT being saved to database** - Page 4 jumps from line 11 to line 23
- **Line table ID discontinuity** - IDs jump from 79 to 91, suggesting 12 records failed to insert
- **Silent failure** - No error messages during insert, using `skipDuplicates: true` may be hiding errors

### Evidence from Trial 67 Page 4
```
Extraction summary shows:
- Lines extracted: 25
- Line prefixes found: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25

But database shows:
- Lines 1-11: Present
- Lines 12-22: MISSING
- Line 23-25: Present
- Line IDs: Jump from 79 to 91 (12 IDs skipped)
```

### Root Cause Hypothesis
The `prisma.line.createMany({ skipDuplicates: true })` is silently failing for lines 12-22, possibly due to:
1. Unique constraint violations
2. Data validation issues
3. Transaction problems

### Next Steps
1. Remove `skipDuplicates: true` to see actual errors
2. Check for unique constraint violations
3. Add error handling to catch insert failures
4. Implement simple line-by-line insertion mode (no batching, no transactions)
5. Add verbose logging for each insert to identify exactly which lines fail

## Implementation Notes

### Current Batch Insert Code (PROBLEMATIC)
Located in `/src/parsers/MultiPassContentParser.ts`:
```typescript
await this.prisma.line.createMany({
  data: lineData,
  skipDuplicates: true  // HIDES ERRORS!
});
```

### Proposed Simple Insert Mode
```typescript
// Insert one line at a time with proper error handling
for (const line of lineData) {
  try {
    await this.prisma.line.create({ data: line });
    console.log(`Inserted line ${line.lineNumber} with prefix '${line.linePrefix}'`);
  } catch (error) {
    console.error(`FAILED to insert line ${line.lineNumber}:`, error);
    // Log the exact data that failed
    console.error('Failed data:', JSON.stringify(line, null, 2));
  }
}
```

### Batch Processing Issues
- Currently processing in batches of 1000 lines
- Using `createMany` with `skipDuplicates: true`
- No error reporting for individual line failures
- Possible transaction rollback issues
- Complex logic may be interfering with simple inserts

### Simple Mode Requirements
1. NO transactions
2. NO batch inserts (at least for debugging)
3. Insert line-by-line
4. Log every insert attempt
5. Catch and report every error
6. Continue processing even if some lines fail