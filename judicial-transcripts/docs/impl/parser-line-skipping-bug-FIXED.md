# Parser Line Skipping Bug - FIXED

## Root Cause
The bug was caused by **page line counters resetting between batches**. When processing lines in batches of 100, if a page's lines were split across batches, the line counter would reset to 1 for each batch, causing duplicate `(pageId, lineNumber)` keys.

### Example:
- Batch 1: Lines from page 3 (lines 20-25) and page 4 (lines 1-11)
- Batch 2: Page 4 (lines 12-25) - **these were numbered 1-14 instead of 12-25**

## The Fix

### 1. Main Fix: Persistent Page Line Counter
**File:** `/src/parsers/MultiPassContentParser.ts`

Changed the `pageLinesCount` from a local variable in `processLineBatch()` to a class member that persists across batches:

```typescript
// BEFORE - local variable resets each batch:
private async processLineBatch(...) {
  const pageLinesCount = new Map<number, number>();
}

// AFTER - class member persists:
class ContentParser {
  private pageLinesCount: Map<number, number> = new Map();

  async parseContent(...) {
    this.pageLinesCount.clear(); // Reset only at session start
  }
}
```

### 2. Secondary Fix: Smart Header Parser
**File:** `/src/parsers/SmartPageHeaderParser.ts`

Fixed the header parser to only consume lines up to the last line with actual header content, instead of blindly using all configured header lines:

```typescript
// BEFORE:
result.headerLinesUsed = Math.min(headerCandidates.length, this.pageHeaderLines);

// AFTER:
result.headerLinesUsed = Math.max(2, lastContentLine + 1);
result.headerLinesUsed = Math.min(result.headerLinesUsed, this.pageHeaderLines);
```

### 3. Diagnostic Enhancement: Simple Insert Mode
**File:** `/src/parsers/MultiPassContentParser.ts`

Added a simple insert mode (enabled via `SIMPLE_INSERT_MODE=true`) that:
- Inserts lines one at a time instead of in batches
- Reports exact error messages for each failed insert
- Shows which lines fail with their page ID and line number

This mode was crucial for diagnosing the unique constraint violations.

## Testing

### To verify the fix:
```bash
# Reset database
npx prisma db push --force-reset

# Run with simple mode for detailed debugging
export SIMPLE_INSERT_MODE=true
npx ts-node src/cli/parse.ts parse --phase1 --config config/test-trial-67.json

# Or run with normal batch mode
npx ts-node src/cli/parse.ts parse --phase1 --config config/test-trial-67.json
```

### Expected Result:
- All lines should insert successfully
- No duplicate key violations
- Page 40 should contain all 25 lines including MR. MUELLER's closing statement

## What Was NOT the Problem

These were investigated but were NOT the cause:
- Lines were being extracted correctly from the text files
- The metadata extraction was working properly
- The database schema was correct
- The line prefixes were correct

The ONLY issue was the page line counter resetting between batches.

## Lessons Learned

1. **Don't hide errors**: `skipDuplicates: true` masked the real problem
2. **State management across batches**: When processing in batches, ensure counters and state persist appropriately
3. **Simple debugging modes are valuable**: The simple insert mode made the issue immediately obvious
4. **The simplest explanation is often correct**: A basic counter reset was the entire problem