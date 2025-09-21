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

## Root Cause Hypothesis

The parser appears to have issues when:
1. There's a speaker change with specific formatting (MR. MUELLER: with colon)
2. Multi-line statements that continue without line numbers on subsequent lines
3. Possibly related to blank lines between numbered lines in the raw text

## Suggested Diagnostics and Fixes

### 1. Add Line Counting Diagnostics
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