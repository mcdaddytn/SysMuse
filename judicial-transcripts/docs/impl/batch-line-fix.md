# Batch Line Counter Fix - Minimal Changes Required

## THE CORE PROBLEM
When processing transcript lines in batches of 100-1000, the page line counter resets for each batch. This causes lines from the same page that span multiple batches to have duplicate line numbers, violating the unique constraint on `(pageId, lineNumber)`.

## REQUIRED FIXES

### Fix 1: Make Page Line Counter Persist Across Batches
**File:** `/src/parsers/MultiPassContentParser.ts`

#### Add class member (around line 63):
```typescript
private pageLinesCount: Map<number, number> = new Map();  // Track lines per page ACROSS batches
```

#### Clear it at session start (around line 82 in `parseContent` method):
```typescript
// Reset page line counts for this session
this.pageLinesCount.clear();
```

#### Remove the local variable in `processLineBatch` (around line 505):
```typescript
// DELETE THIS LINE:
const pageLinesCount = new Map<number, number>();
```

#### Update references to use class member (around lines 541-543):
```typescript
// Change from:
const currentPageLines = pageLinesCount.get(location.pageNumber) || 0;
const pageLineNumber = currentPageLines + 1;
pageLinesCount.set(location.pageNumber, pageLineNumber);

// Change to:
const currentPageLines = this.pageLinesCount.get(location.pageNumber) || 0;
const pageLineNumber = currentPageLines + 1;
this.pageLinesCount.set(location.pageNumber, pageLineNumber);
```

### Fix 2: Smart Header Parser Improvement (OPTIONAL but recommended)
**File:** `/src/parsers/SmartPageHeaderParser.ts`

#### Change header lines calculation (around line 174):
```typescript
// BEFORE:
result.headerLinesUsed = Math.min(headerCandidates.length, this.pageHeaderLines);

// AFTER:
// Only consume lines up to the last line with header content
result.headerLinesUsed = Math.max(2, lastContentLine + 1);
result.headerLinesUsed = Math.min(result.headerLinesUsed, this.pageHeaderLines);
```

#### Fix initial value of lastContentLine (around line 60):
```typescript
// BEFORE:
let lastContentLine = -1;  // Track last line with header content

// AFTER:
let lastContentLine = 0;  // Track last line with header content (0-based index)
```

## VERIFICATION

After applying these fixes, test with:
```bash
# Clean database
npx prisma db push --force-reset

# Parse trial 67 (known to have the issue)
npx ts-node src/cli/parse.ts parse --phase1 --config config/test-trial-67.json
```

Expected: No errors, all lines inserted successfully.

## WHAT NOT TO CHANGE

These changes were for diagnostics only and are NOT required for the fix:
- Simple insert mode code
- Removal of `skipDuplicates: true`
- Debug logging and warnings
- Line continuity checking
- All the diagnostic output in MetadataExtractor

The ONLY required change is making the page line counter persist across batches.