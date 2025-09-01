# Address Truncation Fix Implementation Guide

## Problem Statement
Address lines in transcript SUMMARY sections are being incorrectly truncated when stored in SessionSection records. Lines that start with numbers (like street addresses) are having those numbers removed as if they were line prefixes.

### Examples of Truncation
- "230 Park Avenue" becomes "rk Avenue"  
- "104 East Houston Street" becomes "st Houston Street"
- "801 Fourth Avenue" becomes "urth Avenue"
- "2040 Main Street" is preserved (inconsistent behavior)

## Current State (as of 2025-08-29)

### Where Addresses Are Being Stored
- Originally expected in `SessionSection` with `sectionType = 'APPEARANCES'`
- Currently being stored in `SessionSection` with `sectionType = 'CASE_TITLE'`
- The section type detection logic may have changed

### Files Modified
1. **`src/parsers/SessionSectionParser.ts`** - Main file with the cleaning logic
   - Method: `cleanSectionText()` 
   - Current approach: Check for continuation lines first, then handle address detection
   - Issue: Still not working correctly

2. **`src/parsers/TranscriptParser.ts`** - Updated for feature-02H
   - Properly captures SUMMARY, PROCEEDINGS, and CERTIFICATION lines
   - Line numbering fixed (pageLineNumber, sessionLineNumber, trialLineNumber)

### The Core Issue
The problem occurs in `SessionSectionParser.cleanSectionText()` method. The issue is multi-layered:

1. **Continuation lines** (lines starting with spaces) contain the addresses:
   ```
   21     FABRICANT LLP
            230 Park Avenue, 3rd Floor W.
            New York, NY 10169
   ```
   The indented lines should be preserved as-is.

2. **LineParser interference**: The `LineParser.parse()` method is called first and incorrectly removes what it thinks are line numbers from address lines.

3. **Pattern confusion**: Lines like "230 Park Avenue" match the pattern for line numbers (number + spaces + text).

## Attempted Fixes

### Fix 1: Handle continuation lines separately
```typescript
// Check if line starts with spaces (continuation line)
if (line.match(/^\s+/)) {
  // This is a continuation line - just trim and keep it
  const trimmed = line.trim();
  if (trimmed) {
    cleanedLines.push(trimmed);
  }
  continue;
}
```
**Result**: Partially working but addresses still truncated

### Fix 2: Detect address patterns
```typescript
// Check if the original line looks like it might be an address line
if (line.match(/^\d{1,4}\s+[A-Z][a-z]/)) {
  // Starts with 1-4 digits followed by a capitalized word
  // Don't trust LineParser's result - use the original line
  cleanedLines.push(line.trim());
}
```
**Result**: Not working - addresses still truncated

## Root Cause Analysis

The truncation happens because:
1. Lines with leading spaces have their spaces counted as part of a "line prefix"
2. The line "          230 Park Avenue" is being treated as having prefix "          230 Pa"
3. The parsing logic is incorrectly identifying the number after spaces as a line number

## Next Steps to Fix

### Option 1: Fix LineParser
- Modify `src/parsers/LineParser.ts` to not parse lines that start with multiple spaces
- Lines with leading spaces should be treated as continuation lines, not parsed for line numbers

### Option 2: Bypass LineParser for SUMMARY sections
- In `cleanSectionText()`, don't use LineParser at all for SUMMARY format text
- Implement custom logic that only removes actual line prefixes (e.g., "21     " at position 0)

### Option 3: Rewrite cleanSectionText logic
- Process lines in order, tracking context
- When a line starts at position 0 with a line number, remove it
- When a line starts with spaces, it's a continuation - preserve entirely
- Never remove numbers from continuation lines

## Test Cases

### Test Data
```
17     FOR THE PLAINTIFF:
18     MR. ALFRED R. FABRICANT
          MR. PETER LAMBRIANAKOS
19     MR. VINCENT J. RUBINO, III
          MS. AMY PARK
20     MR. ENRIQUE ITURRALDE
          FABRICANT LLP
21     230 Park Avenue, 3rd Floor W.
          New York, NY 10169
```

### Expected Output
```
FOR THE PLAINTIFF:
MR. ALFRED R. FABRICANT
MR. PETER LAMBRIANAKOS
MR. VINCENT J. RUBINO, III
MS. AMY PARK
MR. ENRIQUE ITURRALDE
FABRICANT LLP
230 Park Avenue, 3rd Floor W.
New York, NY 10169
```

### Current (Incorrect) Output
```
FOR THE PLAINTIFF:
MR. ALFRED R. FABRICANT
MR. PETER LAMBRIANAKOS
MR. VINCENT J. RUBINO, III
MS. AMY PARK
MR. ENRIQUE ITURRALDE
FABRICANT LLP
rk Avenue, 3rd Floor W.
New York, NY 10169
```

## Testing Commands

### Reset and parse
```bash
npx prisma db push --force-reset
npm run seed
npm run parse -- parse --config config/example-trial-config-mac.json --phase1
```

### Check results
```bash
npx ts-node src/scripts/tests/checkAddresses.ts
```

## Related Features
- **Feature-02H**: SessionSection text cleaning and Line table population
  - Successfully captures SUMMARY/PROCEEDINGS/CERTIFICATION lines
  - Line numbering working correctly
  - SessionSection text cleaning still has address truncation issue

## Session Restart Instructions
1. Review this guide to understand the current state
2. Check `src/parsers/SessionSectionParser.ts` line 651-720 for current implementation
3. The issue is in how continuation lines (with leading spaces) are being processed
4. Test with the Mac configuration: `config/example-trial-config-mac.json`
5. Focus on fixing the `cleanSectionText()` method to properly handle indented address lines