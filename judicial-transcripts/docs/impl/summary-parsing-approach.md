# Summary Parsing Approach

## Overview
This document describes the improved approach for parsing transcript summary sections, which contain critical metadata about court sessions. The approach handles various formats found across different trials while maintaining accuracy and completeness.

## The Two-Column Format Problem

Transcript summaries use a visual two-column format with a center delimiter (typically ")(" but can vary):

```
PACKET INTELLIGENCE LLC            )(         CIVIL DOCKET NO.
                                   )(         
                                   )(         2:16-CV-230-JRG
                                   )(         
VS.                                )(         MARSHALL, TEXAS
                                   )(         
NETSCOUT SYSTEMS, INC.             )(         
TEKTRONIX COMMUNICATIONS,          )(         OCTOBER 10, 2017
AND TEKTRONIX TEXAS LLC            )(         8:36 A.M.
```

**Left Column**: Contains party names (plaintiff and defendant)
**Right Column**: Contains case metadata (case number, location, date, time)

## Parsing Algorithm

### Step 1: Delimiter Detection
First, detect the center delimiter by analyzing line frequency:
- Common delimiters: ")(" , ") (" , "|" , "||"
- Detection threshold: Must appear in at least 5 lines
- Default fallback: ")("

### Step 2: Line-by-Line Splitting
Process each line to separate left and right content:
```typescript
for (const line of lines) {
  if (line.includes(delimiter)) {
    const delimiterIndex = line.indexOf(delimiter);
    const leftPart = line.substring(0, delimiterIndex).trim();
    const rightPart = line.substring(delimiterIndex + delimiter.length).trim();
    
    if (leftPart) leftSideLines.push(leftPart);
    if (rightPart) rightSideLines.push(rightPart);
  } else {
    // Lines without delimiter typically belong to left side
    // (party names often span multiple lines)
    if (line.trim() && !line.match(/^\d+$/)) {
      leftSideLines.push(line.trim());
    }
  }
}
```

### Step 3: Content Aggregation
After splitting, join and clean each side:
```typescript
const leftSideText = leftSideLines
  .filter(line => line.length > 0)
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();

const rightSideText = rightSideLines
  .filter(line => line.length > 0)
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();
```

### Step 4: Party Name Extraction (Left Side)
Extract plaintiff and defendant from the aggregated left text:

```typescript
// Handle various formats: "VS.", "V.", or standalone
if (leftSideText.includes(' VS. ')) {
  const parts = leftSideText.split(' VS. ');
  plaintiff = parts[0].replace(/,?\s*PLAINTIFF[S]?/i, '').trim();
  defendant = parts[1].replace(/,?\s*DEFENDANT[S]?/i, '').trim();
} else if (leftSideText.includes('VS.')) {
  // Handle standalone VS. (common in some formats)
  const parts = leftSideText.split('VS.');
  plaintiff = parts[0].trim();
  defendant = parts[1].trim();
}
```

**Result for Packet Intelligence case:**
- Plaintiff: "PACKET INTELLIGENCE LLC"
- Defendant: "NETSCOUT SYSTEMS, INC. TEKTRONIX COMMUNICATIONS, AND TEKTRONIX TEXAS LLC"

### Step 5: Metadata Extraction (Right Side)
Parse the aggregated right text for case information:

#### Case Number
```typescript
// Try multiple patterns
let caseNumberMatch = rightSideText.match(/(?:Civil (?:Action |Docket )?No\.?|Case)\s*(\d+:\d+-cv-\d+(?:-\w+)?)/i);
if (!caseNumberMatch) {
  caseNumberMatch = rightSideText.match(/\b(\d+:\d+-CV-\d+(?:-\w+)?)\b/i);
}
```
**Result**: "2:16-CV-230-JRG"

#### Session Date
```typescript
const dateMatch = rightSideText.match(/\b([A-Z]+\s+\d{1,2},?\s+\d{4})\b/);
```
**Result**: "OCTOBER 10, 2017"

#### Session Time
```typescript
const timeMatch = rightSideText.match(/\b(\d{1,2}:\d{2}\s*[AP]\.?M\.?)\b/i);
```
**Result**: "8:36 A.M."

#### Location
```typescript
const locationMatch = rightSideText.match(/\b([A-Z]+,\s+[A-Z]+)\b/);
// Filter out dates and other non-location matches
```
**Result**: "MARSHALL, TEXAS"

## Example Processing

### Input (Raw CASE_TITLE Section):
```
PACKET INTELLIGENCE LLC            )(         CIVIL DOCKET NO.
                                   )(         
                                   )(         2:16-CV-230-JRG
                                   )(         
VS.                                )(         MARSHALL, TEXAS
                                   )(         
NETSCOUT SYSTEMS, INC.             )(         
TEKTRONIX COMMUNICATIONS,          )(         OCTOBER 10, 2017
AND TEKTRONIX TEXAS LLC            )(         8:36 A.M.
```

### After Step 2 (Split):
**Left Side Lines:**
- "PACKET INTELLIGENCE LLC"
- "VS."
- "NETSCOUT SYSTEMS, INC."
- "TEKTRONIX COMMUNICATIONS,"
- "AND TEKTRONIX TEXAS LLC"

**Right Side Lines:**
- "CIVIL DOCKET NO."
- "2:16-CV-230-JRG"
- "MARSHALL, TEXAS"
- "OCTOBER 10, 2017"
- "8:36 A.M."

### After Step 3 (Aggregation):
**Left Side Text:**
"PACKET INTELLIGENCE LLC VS. NETSCOUT SYSTEMS, INC. TEKTRONIX COMMUNICATIONS, AND TEKTRONIX TEXAS LLC"

**Right Side Text:**
"CIVIL DOCKET NO. 2:16-CV-230-JRG MARSHALL, TEXAS OCTOBER 10, 2017 8:36 A.M."

### Final Extracted Data:
```json
{
  "plaintiff": "PACKET INTELLIGENCE LLC",
  "defendant": "NETSCOUT SYSTEMS, INC. TEKTRONIX COMMUNICATIONS, AND TEKTRONIX TEXAS LLC",
  "caseNumber": "2:16-CV-230-JRG",
  "location": "MARSHALL, TEXAS",
  "sessionDate": "2017-10-10",
  "startTime": "08:36:00"
}
```

## SessionSection Storage

The parsed data is stored in multiple SessionSection records:

1. **CASE_TITLE**: Original text with delimiters (preserved for reference)
2. **CIVIL_ACTION_NO**: "2:16-CV-230-JRG"
3. **TRIAL_LOCATION**: "MARSHALL, TEXAS"
4. **TRIAL_DATE**: "OCTOBER 10, 2017"
5. **SESSION_START_TIME**: "8:36 A.M."

## Handling Variations

### Different Delimiter Formats
- Standard Lexis Nexis: ")("
- With spaces: ") ("
- Table format: "|" or "||"
- Auto-detection handles these automatically

### Party Name Variations
- Single line: "VOCALIFE LLC VS. AMAZON.COM, INC."
- Multi-line with VS. on separate line (as shown above)
- With party labels: "PLAINTIFF," or "DEFENDANTS."
- Multiple defendants with "AND" or commas

### Date/Time Formats
- Date: "OCTOBER 10, 2017" or "October 10, 2017"
- Time: "8:36 A.M." or "8:36 a.m." or "08:36 AM"
- Location before or after date

## Benefits of This Approach

1. **Robustness**: Handles various transcript formats without breaking
2. **Completeness**: Extracts all available metadata
3. **Accuracy**: Proper separation prevents mixing of party names with case info
4. **Maintainability**: Clear step-by-step process easy to debug and enhance
5. **Flexibility**: Auto-detection adapts to different delimiter styles

## Implementation Notes

- Located in: `src/parsers/MultiPassContentParser.ts`
- Method: `updateTrialMetadataFromSections()`
- Called during Phase 1 parsing after SessionSections are created
- Updates both Trial and Session records with extracted metadata
- Creates additional SessionSection records for each metadata component

## Testing Checklist

- [ ] Packet Intelligence trial: Parties extracted correctly despite VS. on separate line
- [ ] Vocalife trial: Standard format with inline VS. works
- [ ] Contentguard trial: Different delimiter style handled
- [ ] Session dates: Properly parsed and stored when not in filename
- [ ] Start times: Extracted and converted to proper time format
- [ ] Case numbers: Various formats detected correctly