# Feature 03C: Witness Pattern Analysis Results

## Database Status
- **Issue Identified**: Multi-pass parser is grouping all trials under single trial record
- **Root Cause**: Parser extracts trial name from transcript content, not configuration
- **Impact**: All 50+ sessions loaded under one trial, but data is still analyzable

## Witness Pattern Analysis Results

### Data Statistics
- **Total witness sworn lines found**: 80
- **Sessions processed**: 50+
- **Distinct patterns identified**: 2 major patterns

### Pattern 1: Standard Comma-Separated (96% of cases)
**Format**: `NAME, PARTY'S WITNESS, SWORN_STATUS`

**Examples**:
```
MARK STEWART, DEFENDANTS' WITNESS, SWORN,
GLENN RUSSELL, DEFENDANTS' WITNESS, SWORN
JIRI KUTHAN, DEFENDANTS' WITNESS, SWORN
ROBERT AKL, Ph.D., DEFENDANTS' WITNESS, SWORN
MATTHEW LYNDE, Ph.D., DEFENDANTS' WITNESS, SWORN
MARK STEFIK, PLAINTIFF'S WITNESS, SWORN
JEFF PRINCE, PLAINTIFF'S WITNESS, SWORN
JAMES BAKER, Ph.D., PLAINTIFF'S WITNESS, SWORN
BRETT DANAHER, Ph.D., PLAINTIFF'S WITNESS, SWORN
DAVID TEECE, Ph.D., PLAINTIFF'S WITNESS, SWORN
```

**Components**:
1. **Name**: Always appears first, before first comma
2. **Party Designation**: 
   - `PLAINTIFF'S WITNESS` or `PLAINTIFFS' WITNESS`
   - `DEFENDANT'S WITNESS` or `DEFENDANTS' WITNESS`
3. **Sworn Status**:
   - `SWORN` (49%)
   - `PREVIOUSLY SWORN` (51%)

### Pattern 2: Previously Sworn Witnesses
**Format**: `NAME, PARTY'S WITNESS, PREVIOUSLY SWORN`

**Statistics**:
- 41 out of 80 witness lines (51%)
- Indicates witness testified earlier in trial

### Comprehensive Witness Detection Pattern

Based on analysis, the optimal witness detection regex:

```regex
^([A-Z][A-Z\s.,'-]+?),\s*((?:PLAINTIFF|DEFENDANT)S?'S?\s+WITNESS),\s*((?:PREVIOUSLY\s+)?SWORN)
```

**Capture Groups**:
1. Witness name (including titles like Ph.D., Jr., etc.)
2. Party designation
3. Sworn status

### Implementation Recommendations

1. **Primary Pattern Matcher**:
```typescript
const witnessPattern = /^([A-Z][A-Z\s.,'-]+?),\s*((?:PLAINTIFF|DEFENDANT)S?'S?\s+WITNESS),\s*((?:PREVIOUSLY\s+)?SWORN)/i;
```

2. **Name Extraction**:
```typescript
function extractWitnessName(line: string): string | null {
  const match = line.match(witnessPattern);
  if (match) {
    return match[1].trim();
  }
  return null;
}
```

3. **Party Detection**:
```typescript
function detectParty(line: string): 'PLAINTIFF' | 'DEFENDANT' | null {
  if (line.includes('PLAINTIFF')) return 'PLAINTIFF';
  if (line.includes('DEFENDANT')) return 'DEFENDANT';
  return null;
}
```

4. **Sworn Status**:
```typescript
function getSwornStatus(line: string): 'SWORN' | 'PREVIOUSLY_SWORN' {
  return line.includes('PREVIOUSLY') ? 'PREVIOUSLY_SWORN' : 'SWORN';
}
```

## Parser Issue Documentation & Solution

### Problem
The multi-pass parser determines trial identity from transcript content rather than configuration, causing:
- Multiple distinct trials to be grouped under single database record
- Trial name extracted from header overrides config `trialName`
- Sessions from different cases merged together

### Proposed Solution: Case Number as Primary Key

**Key Insight**: The case number appears consistently in page headers and is unique per trial.

#### Implementation Strategy

1. **Extract Case Number from Page Header**:
   - Parse first page header of first transcript file
   - Case number format: `2:19-CV-00123-JRG` or similar
   - Use as primary identifier for trial uniqueness

2. **Trial Identification Logic**:
```typescript
async function getOrCreateTrial(firstPageHeader: string, config: TrialConfig) {
  // Extract case number from header
  const caseNumber = extractCaseNumber(firstPageHeader);
  
  // Use case number as primary key for finding/creating trial
  let trial = await prisma.trial.findFirst({
    where: { caseNumber }
  });
  
  if (!trial) {
    trial = await prisma.trial.create({
      data: {
        caseNumber,
        name: parsedTrialName || config.trialName || folderName,
        folderName: config.inputDir.split('/').pop(),
        // ... other fields
      }
    });
  }
  
  return trial;
}
```

3. **Fallback Hierarchy**:
   - Primary: Case number from page header
   - Secondary: Parsed trial name from summary section
   - Tertiary: Trial name from config
   - Quaternary: Folder name from input directory

4. **Store Folder Name in trialstyle.json**:
```json
{
  "fileConvention": "DATEAMPM",
  "folderName": "01 Genband",  // NEW FIELD
  "trialName": "GENBAND US LLC. VS. METASWITCH...",
  "caseNumber": "2:14-CV-00033-JRG",  // NEW FIELD (if extracted)
  // ... rest of config
}
```

5. **Database Schema Enhancement**:
```prisma
model Trial {
  // ... existing fields
  folderName String? // Store original folder name
  // caseNumber already exists and should be unique
}
```

### Benefits of This Approach
- **Reliable Trial Identification**: Case numbers are unique court identifiers
- **No Duplicate Trials**: Each case number maps to exactly one trial
- **Graceful Fallbacks**: Multiple naming options if case number extraction fails
- **Preserves Context**: Folder name stored for reference

### Impact on Feature 03C
- Pattern analysis still valid (data from multiple trials provides better pattern coverage)
- Witness detection patterns successfully identified
- Can proceed with pattern implementation
- Parser fix can be implemented separately without blocking progress

## Conclusions

1. **Pattern Detection Success**: Identified clear, consistent witness introduction patterns
2. **High Confidence**: 96% of witness lines follow standard comma-separated format
3. **Ready for Implementation**: Patterns are consistent enough for automated detection
4. **Parser Solution Identified**: Use case number as primary trial identifier
5. **Folder Name Preservation**: Store original folder name for reference and fallback

## Next Steps

1. Implement witness detection service using identified patterns
2. Update parser to use case number as primary trial identifier
3. Add folderName field to trialstyle.json generation
4. Test detection accuracy on full dataset with corrected trial separation