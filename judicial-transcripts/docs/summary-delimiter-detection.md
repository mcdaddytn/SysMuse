# Summary Center Delimiter Detection

## Overview
The summaryCenterDelimiter is critical for properly parsing the CASE_TITLE and other summary sections in judicial transcripts. It separates the left column (party names, labels) from the right column (case info, dates, values).

## Detection Algorithm

### Common Delimiters (in order of precedence)
1. **")("** - Two characters (most common in Eastern District of Texas)
2. **()**  - Two characters  
3. **)\*** - Two characters
4. **\*(** - Two characters
5. **)**  - Single character
6. **(**  - Single character
7. **\*** - Single character

### Detection Logic
```
1. Read first 100 lines of first transcript
2. For each delimiter candidate (starting with 2-char patterns):
   - Count occurrences in the sample
   - If count >= 3, this is likely the delimiter
   - Stop at first match
3. If AUTO is specified, use detected delimiter
4. Store in trialstyle.json for consistency
```

## Example: Vocalife Trial
```
4      VOCALIFE LLC,                       )(
5            PLAINTIFF,                    )(    CIVIL ACTION NO.
6                                          )(    2:19-CV-123-JRG
7      VS.                                 )(    MARSHALL, TEXAS
8                                          )(
9      AMAZON.COM, INC. and                )(
10     AMAZON.COM LLC,                     )(    OCTOBER 1, 2020
11           DEFENDANTS.                   )(    9:24 A.M.
```

Delimiter: ")(" appears 8 times in first 100 lines

## Implementation Status
- [ ] Add delimiter detection to FileConventionDetector
- [ ] Pass delimiter to SessionSectionParser
- [ ] Use delimiter to split summary lines before parsing
- [ ] Update MultiPassContentParser to use split lines

## Usage in Parsing
Once detected, use the delimiter to:
1. Split each summary line into left and right parts
2. Parse CASE_TITLE from left side only (party names)
3. Parse case number, dates from right side
4. Clean up extracted values by removing delimiter characters