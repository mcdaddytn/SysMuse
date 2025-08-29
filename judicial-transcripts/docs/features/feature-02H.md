# Feature 02H: Fix SessionSection Parsing and Line Capture

## Overview
Complete the SessionSection implementation by fixing line prefix cleaning issues and ensuring all transcript lines (SUMMARY, PROCEEDINGS, and CERTIFICATION) are captured in the Line table with proper documentSection values.

## Background
Feature 02G successfully implemented SessionSection parsing but has three remaining issues:
1. Some SessionSection text still contains line prefixes
2. SUMMARY and CERTIFICATION lines are not being stored in the Line table  
3. All lines are marked as documentSection='PROCEEDINGS' instead of their actual sections

## Requirements

### 1. Fix SessionSection Text Cleaning
- **Problem**: SessionSection records (particularly APPEARANCES sections) still contain line prefixes like "17     FOR THE PLAINTIFF:"
- **Solution**: 
  - Improve `SessionSectionParser.cleanSectionText()` to handle all line prefix patterns
  - Must handle both SUMMARY format (7-char prefix) and PROCEEDINGS format (13-char prefix)
  - Must handle lines that may not have been properly parsed by LineParser

### 2. Capture All Lines in Line Table
- **Current State**: Only PROCEEDINGS lines are stored (37,319 lines)
- **Required State**: All lines from all sections should be stored
  - SUMMARY section lines (approximately first 100 lines)
  - PROCEEDINGS section lines (main content)
  - CERTIFICATION section lines (last page)
- **Implementation**:
  - Store lines during SUMMARY parsing before creating SessionSections
  - Store lines during CERTIFICATION section parsing
  - Ensure proper page assignment for all lines

### 3. Set Correct documentSection Values
- **Current**: All lines have documentSection='PROCEEDINGS'
- **Required**: Lines should have correct documentSection based on where they appear:
  - `UNKNOWN` - Before any section is identified
  - `SUMMARY` - Lines in the summary section (before PROCEEDINGS)
  - `PROCEEDINGS` - Main transcript content
  - `CERTIFICATION` - Certification section at end

### 4. Prepare for Format Variations
- Create robust parsing that can handle variations in summary formatting
- Document the different summary formats encountered
- Ensure the parser can gracefully handle missing or differently formatted sections

## Implementation Notes

### SessionSection Text Cleaning Algorithm
```typescript
// Improved cleaning should:
1. Parse each line with LineParser to get text without prefix
2. If LineParser returns null/blank, try manual prefix removal:
   - Check for 7-char numeric prefix (SUMMARY)
   - Check for 13-char timestamp+number prefix (PROCEEDINGS)
   - Check for simple leading number + spaces
3. Skip page header lines (containing "Case", "Document", "PageID")
4. Join cleaned lines with newlines
```

### Line Storage During Section Parsing
```typescript
// In TranscriptParser:
1. During SUMMARY section (lines 0-100):
   - Create page for SUMMARY if needed
   - Store each line with documentSection='SUMMARY'
   - Collect lines for SessionSection parsing

2. During CERTIFICATION section:
   - Continue storing lines with documentSection='CERTIFICATION'
   - Don't skip line storage when section changes

3. Ensure currentSection is properly passed to line records
```

### Testing Criteria
1. Run query to verify all documentSections are represented:
   ```sql
   SELECT "documentSection", COUNT(*) 
   FROM "Line" 
   GROUP BY "documentSection" 
   ORDER BY COUNT(*) DESC;
   ```
   - Should show SUMMARY, PROCEEDINGS, and CERTIFICATION sections

2. Verify SessionSection text has no line prefixes:
   ```sql
   SELECT id, "sectionType", SUBSTRING("sectionText", 1, 100) 
   FROM "SessionSection" 
   WHERE "sectionText" ~ '^\s*\d+\s+';
   ```
   - Should return 0 rows

3. Verify total line count increases (should be > 37,319)

## Success Criteria
- [ ] All SessionSection.sectionText fields are clean (no line prefixes or page headers)
- [ ] Line table contains records for SUMMARY, PROCEEDINGS, and CERTIFICATION sections
- [ ] Each line has the correct documentSection value based on its location
- [ ] Total line count in database reflects all lines in transcripts
- [ ] Implementation handles format variations gracefully

## Future Considerations
- Support for different transcript formats beyond Vocalife
- Configurable section detection patterns
- Validation of section content completeness
- Export functionality for cleaned sections