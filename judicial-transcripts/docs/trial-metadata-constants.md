# Trial Metadata Constants for Test Cases

## Court Information (Same for all test trials)
- **Court**: UNITED STATES DISTRICT COURT
- **District**: EASTERN DISTRICT OF TEXAS  
- **Division**: MARSHALL DIVISION

## Trial-Specific Information

### 42 Vocalife Amazon
- **Plaintiff**: VOCALIFE LLC
- **Defendant**: AMAZON.COM, INC. and AMAZON.COM LLC
- **Case Number**: 2:19-CV-123-JRG

### Other trials (to be determined from first page analysis)
- Will analyze first pages to extract patterns

## Parsing Strategy
1. **CASE_TITLE Section**: 
   - Combine all lines, remove extra whitespace
   - Split on "VS." or "V." to get plaintiff and defendant
   - Extract case number from the combined text

2. **COURT_AND_DIVISION Section**:
   - Combine all lines
   - Extract court, district, and division from known patterns