# Parsing Patterns and Anti-Patterns Guide

## CRITICAL PRINCIPLES

### 1. ALWAYS Store Extracted Metadata
**ALWAYS** store ALL extracted data in metadata fields (JSON) for debugging and override purposes. This allows:
- Easy debugging of what was extracted
- Manual override files to fix issues
- Visibility into parsing decisions

Example:
```javascript
const extractedMetadata = {
  originalText: file,
  dateFound: true,
  extractedDate: "2020-08-03",
  datePattern: "month_name_pattern",
  extractedMonth: 8,
  extractedDay: 3,
  extractedYear: 2020,
  allPatternsChecked: ["held_on", "month_name", "month_day_year"],
  matchedPattern: "month_name"
};
```

### 2. Avoid Complex Regex
**DO NOT** create complex regex patterns that try to handle all cases in one expression.

❌ **BAD**:
```javascript
const complexRegex = /(?:held on\s+)?(?:(\d{1,2})[_\/](\d{1,2})[_\/](\d{2,4})|(\w+)\s+(\d{1,2}),?\s+(\d{4})|(\d{1,2})[.-](\d{1,2})[.-](\d{2,4}))/gi;
```

✅ **GOOD**: Use simple, specific patterns checked sequentially:
```javascript
// Pattern 1: Check for "held on MM_DD_YY"
if (text.includes('held on')) {
  const parts = text.split('held on ')[1].split(' ')[0].split('_');
  if (parts.length === 3) {
    // Extract month, day, year
  }
}

// Pattern 2: Check for month names
const months = ['january', 'february', ...];
for (const month of months) {
  if (text.toLowerCase().includes(month)) {
    // Extract date after month name
  }
}
```

### 3. Use Progressive Pattern Matching
Check patterns from most specific to most general. Stop when you find a match.

```javascript
let dateFound = false;

// Most specific: "held on MM_DD_YY"
if (!dateFound && text.includes('held on')) {
  // Extract...
  dateFound = true;
}

// Less specific: Month names with various formats
if (!dateFound && hasMonthName(text)) {
  // Extract...
  dateFound = true;
}

// Fallback: Log what couldn't be parsed
if (!dateFound) {
  logger.warn(`Could not parse date from: ${text}`);
}
```

## Common Date Patterns in Transcripts

### Pattern 1: "held on MM_DD_YY"
**Example**: "NOTICE OF FILING OF OFFICIAL TRANSCRIPT of Proceedings held on 10_1_20"
```javascript
const parts = text.split('held on ')[1].split(' ')[0].split('_');
const month = parseInt(parts[0]) - 1; // JS uses 0-indexed months
const day = parseInt(parts[1]);
const year = 2000 + parseInt(parts[2]); // Assume 20XX for two-digit years
```

### Pattern 2: "Month DD, YYYY"
**Example**: "Genband_January 11, 2016 AM.txt"
```javascript
const monthIndex = text.toLowerCase().indexOf(monthName);
const afterMonth = text.substring(monthIndex + monthName.length);
const match = afterMonth.match(/(\d{1,2}),?\s+(\d{4})/);
if (match) {
  const day = parseInt(match[1]);
  const year = parseInt(match[2]);
}
```

### Pattern 3: "Month D YYYY"
**Example**: "Optis Apple August 3 2020 AM.txt"
```javascript
const words = text.split(' ');
for (let i = 0; i < words.length; i++) {
  if (words[i].toLowerCase() === monthName) {
    const day = parseInt(words[i + 1]);
    const year = parseInt(words[i + 2]);
  }
}
```

## Session Type Detection

### Simple Keyword Matching
```javascript
const indicators = [];
const lowerText = text.toLowerCase();

// Collect ALL indicators
if (lowerText.includes('morning')) indicators.push('morning');
if (lowerText.includes('afternoon')) indicators.push('afternoon');
if (lowerText.includes(' am')) indicators.push('am');
if (lowerText.includes(' pm')) indicators.push('pm');
if (lowerText.includes('verdict')) indicators.push('verdict');

// Store in metadata
metadata.sessionTypeIndicators = indicators;

// Determine type
if (indicators.includes('pm') || indicators.includes('afternoon')) {
  sessionType = 'AFTERNOON';
} else if (indicators.includes('am') || indicators.includes('morning')) {
  sessionType = 'MORNING';
}
```

## Anti-Patterns to AVOID

### 1. Complex Regex Without Fallback
❌ **Never** rely on a single complex regex to parse all variations

### 2. Not Storing Original Data
❌ **Never** discard the original text that was parsed

### 3. Silent Failures
❌ **Never** fail silently - always log what couldn't be parsed

### 4. Assuming Format Consistency
❌ **Never** assume all files follow the same format

### 5. Overwriting Without Checking
❌ **Never** overwrite existing data without comparing quality

## Best Practices

### 1. Always Test with Real Data
Before implementing a pattern, check actual filenames/text:
```sql
SELECT DISTINCT "fileName" FROM "Session" ORDER BY "fileName";
```

### 2. Store Everything in Metadata
```javascript
const metadata = {
  originalText: text,
  extractedValues: {...},
  patternsChecked: [...],
  matchedPattern: 'pattern_name',
  confidence: 'high|medium|low',
  warnings: []
};
```

### 3. Provide Override Capability
Design so that metadata can be overridden via JSON files:
```json
{
  "sessions": [{
    "fileName": "Optis Apple August 3 2020 AM.txt",
    "sessionDate": "2020-08-03",
    "startTime": "09:00:00"
  }]
}
```

### 4. Log Extensively During Development
```javascript
logger.debug(`Checking pattern: ${patternName}`);
logger.debug(`Input text: ${text}`);
logger.debug(`Extracted: ${JSON.stringify(extracted)}`);
```

### 5. Handle Edge Cases Explicitly
```javascript
// Handle "AM and PM" as all-day session
if (text.includes('AM and PM')) {
  sessionType = 'ALLDAY';
}
```

## Adding New Patterns

When adding support for new formats:

1. **Analyze actual data first**
   - Query the database for examples
   - Identify the variations

2. **Start simple**
   - Use string methods (split, indexOf, includes)
   - Avoid regex unless absolutely necessary

3. **Test incrementally**
   - Test each pattern separately
   - Verify metadata is captured correctly

4. **Document the pattern**
   - Add to this guide
   - Include real examples

5. **Always provide override capability**
   - Via metadata field
   - Via override JSON files

## Remember

> "Probably 90% of the time I have spent on this project is waiting for bad regex to be fixed"

Simple, readable code that handles specific patterns explicitly is ALWAYS better than complex regex that tries to handle everything.