# Database Insert Failure Issue - Lines Silently Failing to Save

## Issue Summary
Lines 12-22 on page 4 of Trial 67 are being correctly extracted by the parser but are FAILING to insert into the database. The failure is silent due to `skipDuplicates: true` hiding errors.

## Critical Evidence
1. **Extraction is working**: Page 4 shows "Lines extracted: 25" with all prefixes 1-25 found
2. **Database is missing lines**: Only lines 1-11 and 23-25 are in database
3. **ID discontinuity**: Line table IDs jump from 79 to 91 (12 IDs skipped = 12 failed inserts)

## Current Problem Code
File: `/src/parsers/MultiPassContentParser.ts`
```typescript
if (lineData.length > 0) {
  this.logger.debug(`Creating ${lineData.length} lines in database for batch`);
  await this.prisma.line.createMany({
    data: lineData,
    skipDuplicates: true  // <-- THIS HIDES ERRORS!
  });
}
```

## Immediate Fix Needed
1. **Add simple insert mode** - Insert lines one at a time with full error reporting
2. **Remove skipDuplicates** - We need to see the actual errors
3. **Add detailed logging** - Log every insert attempt and failure

## Proposed Simple Mode Implementation
```typescript
// Add a flag for simple mode
const useSimpleMode = process.env.SIMPLE_INSERT_MODE === 'true';

if (useSimpleMode) {
  // Simple line-by-line insert with full error reporting
  let successCount = 0;
  let failCount = 0;

  for (const line of lineData) {
    try {
      await this.prisma.line.create({ data: line });
      successCount++;
      this.logger.debug(`✓ Inserted line ${line.lineNumber} (prefix: '${line.linePrefix}')`);
    } catch (error) {
      failCount++;
      this.logger.error(`✗ FAILED line ${line.lineNumber} (prefix: '${line.linePrefix}')`);
      this.logger.error(`  Error: ${error.message}`);
      this.logger.error(`  Data: ${JSON.stringify(line, null, 2)}`);

      // Check for specific constraint violations
      if (error.code === 'P2002') {
        this.logger.error(`  Unique constraint violation on: ${error.meta?.target}`);
      }
    }
  }

  this.logger.info(`Insert summary: ${successCount} succeeded, ${failCount} failed`);
} else {
  // Original batch mode (keep for performance once fixed)
  await this.prisma.line.createMany({
    data: lineData,
    skipDuplicates: true
  });
}
```

## Possible Root Causes
1. **Unique constraint violation** - Maybe lines 12-22 already exist from a previous run?
2. **Data validation** - Something about these specific lines violates schema constraints
3. **Character encoding** - Special characters in the text causing issues
4. **Field length** - Text might be too long for the column

## Test Plan
1. Clear database completely
2. Run with SIMPLE_INSERT_MODE=true
3. Parse just the first session of trial 67
4. Check logs for exactly which lines fail and why
5. Fix the root cause
6. Re-test with batch mode

## Success Criteria
- All 25 lines from page 4 are in the database
- No gaps in line numbers
- No gaps in Line table IDs (except for truly blank lines)
- Clear error messages for any failures