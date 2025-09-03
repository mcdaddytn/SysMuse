# Feature 03G: Enhanced Page Header Parsing with Page Breaks

## Overview
Improve page header parsing accuracy by utilizing page break characters from PDF conversion and implementing automatic header format detection that handles variations without additional configuration.

## Problem Statement
Current page header parsing has limitations:
1. Cannot reliably detect the start of each page without page break markers
2. Header components (especially page numbers) appear in different positions within the same trial
3. Whitespace and newline variations cause parsing errors
4. The trailing page number (`parsedTrialPage`) sometimes appears as the first line instead of last
5. Page ID and line numbers shift positions based on formatting

## Solution
Enable page break preservation during PDF conversion and implement intelligent header parsing that:
- Uses page break characters to precisely identify page boundaries
- Automatically detects header component positions without configuration
- Handles all variations within a single trial
- Uses only the existing `pageHeaderLines` configuration parameter

## Technical Specification

### 1. PDF Conversion Change

Change PDF to text conversion setting:
```json
{
  "nopgbrk": false  // Preserve page break characters (was: true)
}
```

This will insert a form feed character (`\f` or ASCII 12) at each page boundary in the converted text.

### 2. Automatic Header Pattern Detection

The parser will automatically detect and handle these common header variations within the same trial:

#### Variation 1: Standard Format
```
Case 2:13-CV-1112-JRG    JURY TRIAL    Day 1    Page 1 of 200
1:1 - 25:25                                                    1
```

#### Variation 2: Inverted Format (page number first)
```
1
Case 2:13-CV-1112-JRG    JURY TRIAL    Day 1    Page 1 of 200
1:1 - 25:25
```

#### Variation 3: Split Components
```
Case 2:13-CV-1112-JRG    JURY TRIAL    Day 1    Page 1 of 200

1:1 - 25:25
                                                               1
```

#### Variation 4: Compressed Format
```
Case 2:13-CV-1112-JRG    JURY TRIAL    Day 1    Page 1 of 200
1:1 - 25:25    1
```

### 3. Smart Header Parser Implementation

```typescript
interface ParsedPageHeader {
  // Main header line (case info through "Page X of Y")
  headerMainLine: string;
  caseNumber: string | null;
  parsedPageNumber: number | null;  // From "Page X of Y"
  parsedTotalPages: number | null;  // From "Page X of Y"
  
  // Line range (e.g., "1:1 - 25:25")
  lineRangeText: string | null;
  startLineNumber: number | null;
  endLineNumber: number | null;
  
  // Standalone page number (the trailing/leading integer)
  parsedTrialPage: number | null;
  
  // Metadata
  headerLinesUsed: number;
  remainingLines: string[];  // Non-header lines for transcript
}

class SmartPageHeaderParser {
  private pageHeaderLines: number;  // Only configuration needed
  
  constructor(pageHeaderLines: number) {
    this.pageHeaderLines = pageHeaderLines;
  }
  
  parseHeader(lines: string[], pageStartIndex: number): ParsedPageHeader {
    const result: ParsedPageHeader = {
      headerMainLine: '',
      caseNumber: null,
      parsedPageNumber: null,
      parsedTotalPages: null,
      lineRangeText: null,
      startLineNumber: null,
      endLineNumber: null,
      parsedTrialPage: null,
      headerLinesUsed: 0,
      remainingLines: []
    };
    
    // Extract the header lines based on configuration
    const headerCandidates = lines.slice(
      pageStartIndex, 
      Math.min(pageStartIndex + this.pageHeaderLines, lines.length)
    );
    
    // Track which lines contain which components
    let mainLineIndex = -1;
    let lineRangeIndex = -1;
    let standalonePageIndex = -1;
    
    // Scan all header candidate lines for patterns
    headerCandidates.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;  // Skip blank lines
      
      // Pattern 1: Main header line (Case info through Page X of Y)
      if (this.isMainHeaderLine(trimmed)) {
        mainLineIndex = index;
        this.extractMainHeaderInfo(trimmed, result);
      }
      
      // Pattern 2: Line range (e.g., "1:1 - 25:25" or "Lines 1-25")
      else if (this.isLineRange(trimmed)) {
        lineRangeIndex = index;
        this.extractLineRange(trimmed, result);
      }
      
      // Pattern 3: Standalone page number (just an integer)
      else if (this.isStandalonePageNumber(trimmed)) {
        standalonePageIndex = index;
        result.parsedTrialPage = parseInt(trimmed);
      }
      
      // Pattern 4: Combined patterns (e.g., "1:1 - 25:25    1")
      else if (this.hasCombinedPatterns(trimmed)) {
        this.extractCombinedPatterns(trimmed, result, index);
      }
    });
    
    // Determine how many lines were actually used for header
    const maxUsedIndex = Math.max(mainLineIndex, lineRangeIndex, standalonePageIndex);
    result.headerLinesUsed = maxUsedIndex + 1;
    
    // Any remaining lines within pageHeaderLines that weren't used
    // should be considered potential transcript content
    if (maxUsedIndex + 1 < this.pageHeaderLines) {
      result.remainingLines = headerCandidates.slice(maxUsedIndex + 1);
    }
    
    return result;
  }
  
  private isMainHeaderLine(line: string): boolean {
    // Main header contains case number and "Page X of Y"
    return /Case\s+[\w:.-]+/i.test(line) && /Page\s+\d+\s+of\s+\d+/i.test(line);
  }
  
  private extractMainHeaderInfo(line: string, result: ParsedPageHeader): void {
    result.headerMainLine = line;
    
    // Extract case number
    const caseMatch = line.match(/Case\s+([\w:.-]+)/i);
    if (caseMatch) {
      result.caseNumber = caseMatch[1];
    }
    
    // Extract page X of Y
    const pageMatch = line.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
    if (pageMatch) {
      result.parsedPageNumber = parseInt(pageMatch[1]);
      result.parsedTotalPages = parseInt(pageMatch[2]);
    }
  }
  
  private isLineRange(line: string): boolean {
    // Matches patterns like "1:1 - 25:25" or "Lines 1-25" or "1:1 to 25:25"
    return /^\s*(?:Lines?\s+)?(\d+)(?::\d+)?\s*[-–to]+\s*(\d+)(?::\d+)?\s*$/.test(line);
  }
  
  private extractLineRange(line: string, result: ParsedPageHeader): void {
    result.lineRangeText = line;
    
    const match = line.match(/(\d+)(?::\d+)?\s*[-–to]+\s*(\d+)(?::\d+)?/);
    if (match) {
      result.startLineNumber = parseInt(match[1]);
      result.endLineNumber = parseInt(match[2]);
    }
  }
  
  private isStandalonePageNumber(line: string): boolean {
    // Just a number, possibly with whitespace
    return /^\s*\d+\s*$/.test(line);
  }
  
  private hasCombinedPatterns(line: string): boolean {
    // Check if line has multiple components (e.g., line range + page number)
    const hasLineRange = /(\d+)(?::\d+)?\s*[-–to]+\s*(\d+)(?::\d+)?/.test(line);
    const hasTrailingNumber = /\s+(\d+)\s*$/.test(line);
    
    return hasLineRange && hasTrailingNumber;
  }
  
  private extractCombinedPatterns(line: string, result: ParsedPageHeader, index: number): void {
    // Extract line range first
    const lineRangeMatch = line.match(/(\d+)(?::\d+)?\s*[-–to]+\s*(\d+)(?::\d+)?/);
    if (lineRangeMatch) {
      result.lineRangeText = lineRangeMatch[0];
      result.startLineNumber = parseInt(lineRangeMatch[1]);
      result.endLineNumber = parseInt(lineRangeMatch[2]);
      
      // Check for trailing page number after line range
      const remaining = line.substring(lineRangeMatch.index! + lineRangeMatch[0].length);
      const trailingMatch = remaining.match(/\s+(\d+)\s*$/);
      if (trailingMatch) {
        result.parsedTrialPage = parseInt(trailingMatch[1]);
      }
    }
  }
}
```

### 4. Integration with Page Break Detection

```typescript
class MultiPassParser {
  private headerParser: SmartPageHeaderParser;
  
  constructor(config: any) {
    // Only need pageHeaderLines from config
    this.headerParser = new SmartPageHeaderParser(config.pageHeaderLines || 3);
  }
  
  async parseTranscript(filePath: string, sessionId: number): Promise<boolean> {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    
    // Find page boundaries using page breaks
    const pageStarts: number[] = [0];  // First page starts at line 0
    
    lines.forEach((line, index) => {
      if (line.includes('\f')) {  // Form feed character
        // Next line after page break is start of new page
        pageStarts.push(index + 1);
      }
    });
    
    // Process each page
    for (let i = 0; i < pageStarts.length; i++) {
      const pageStartLine = pageStarts[i];
      const pageEndLine = pageStarts[i + 1] || lines.length;
      
      // Parse header - it will automatically detect the format
      const headerResult = this.headerParser.parseHeader(lines, pageStartLine);
      
      // Calculate actual transcript start
      const transcriptStartLine = pageStartLine + headerResult.headerLinesUsed;
      
      // Get transcript lines, including any unused header space
      const transcriptLines = [
        ...headerResult.remainingLines,
        ...lines.slice(transcriptStartLine, pageEndLine)
      ];
      
      // Store page information
      await this.savePage({
        sessionId,
        pageNumber: headerResult.parsedTrialPage || 
                   headerResult.parsedPageNumber || 
                   i + 1,  // Fallback to sequential numbering
        totalPages: headerResult.parsedTotalPages,
        startLine: headerResult.startLineNumber,
        endLine: headerResult.endLineNumber,
        headerText: lines.slice(pageStartLine, 
                               pageStartLine + headerResult.headerLinesUsed).join('\n'),
        content: transcriptLines
      });
    }
    
    return true;
  }
}
```

### 5. Key Features

1. **No Additional Configuration**: Uses only the existing `pageHeaderLines` parameter
2. **Automatic Format Detection**: Handles all variations within the same trial
3. **Pattern Recognition**: Identifies header components regardless of position
4. **Smart Line Usage**: Only consumes lines that contain header information
5. **Content Preservation**: Returns unused header lines as transcript content

## Benefits

1. **Zero Configuration**: No need to specify header formats or variations
2. **Trial Flexibility**: Handles format changes within the same trial
3. **Accurate Parsing**: Correctly identifies all header components
4. **Content Safety**: Never loses transcript content
5. **Page Precision**: Exact page boundaries from page break characters

## Implementation Steps

1. **Update PDF Conversion**:
   ```typescript
   // In PDF conversion configuration
   const pdfConfig = {
     nopgbrk: false  // Change from true to false
   };
   ```

2. **Implement Smart Parser**:
   - Create `SmartPageHeaderParser` class
   - Add pattern detection methods
   - Handle all known variations

3. **Update Multi-Pass Parser**:
   - Detect page boundaries using `\f` character
   - Apply smart header parsing
   - Process remaining content

4. **Testing**:
   - Test with trials containing format variations
   - Verify all header components are extracted
   - Ensure no content loss
   - Validate with and without page breaks

## Examples of Handled Variations

All these variations are handled automatically without configuration:

```
// Variation A: Standard
Case 2:13-CV-1112-JRG    JURY TRIAL    Day 1    Page 1 of 200
1:1 - 25:25                                                    1

// Variation B: Inverted
1
Case 2:13-CV-1112-JRG    JURY TRIAL    Day 1    Page 1 of 200
1:1 - 25:25

// Variation C: Split with whitespace
Case 2:13-CV-1112-JRG    JURY TRIAL    Day 1    Page 1 of 200

1:1 - 25:25
1

// Variation D: Combined on one line
Case 2:13-CV-1112-JRG    JURY TRIAL    Day 1    Page 1 of 200
1:1 - 25:25    1

// Variation E: Extra whitespace
Case 2:13-CV-1112-JRG    JURY TRIAL    Day 1    Page 1 of 200


1:1 - 25:25                                                    1
```

## Success Criteria

1. Page breaks are preserved in converted text files
2. All header variations are correctly parsed without configuration
3. Header components are identified regardless of position
4. No transcript content is lost
5. Works within single trials with format variations
6. Uses only `pageHeaderLines` configuration parameter