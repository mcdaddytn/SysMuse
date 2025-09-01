# Feature 03C: Mass Trial Conversion and Pattern Analysis

## Overview
Convert approximately 60 trial folders to establish comprehensive file naming conventions, create trialstyle.json configurations for each trial, and analyze witness detection patterns across all cases to build a robust parsing system.

## Objectives
1. Convert all ~60 trial PDF folders to text format
2. Generate trialstyle.json for each trial with proper file ordering
3. Identify and document all file naming conventions
4. Identify trials with non-conforming file names
5. Run phase 1 parsing on all trials
6. Analyze witness patterns across all trials via SQL/text analysis
7. Build comprehensive witness detection service

## Phase 1: Mass Conversion

### 1.1 Directory Structure Setup
```
/input
  /trial-pdfs           # Source PDF directories
    /01 Genband
    /02 Apple v Samsung
    /03 Koninklijke
    ...
    /60 [Last Trial]
    
/output
  /multi-trial          # Converted text + trialstyle.json
    /01 Genband
      *.txt files
      trialstyle.json
    /02 Apple v Samsung
      *.txt files
      trialstyle.json
    ...
```

### 1.2 New File Conventions to Add

#### Currently Supported
- `DATEAMPM`: "Optis Apple August 3 2020 AM.txt"
- `DATEMORNAFT`: "Trial Transcript - Morning Session"
- `DOCID`: Document ID based naming
- `AM and PM`: Full day transcript (e.g., "August 11 2020 AM and PM.txt")

#### New Patterns to Implement
1. **TRIAL_FULLDAY**: "Koninklijke August 22, 2022 Trial.pdf" 
   - Pattern: `[Case] [Date] Trial`
   - Indicates full day transcript
   - Should be sorted after AM/PM sessions of same date

2. **VOLUME_BASED**: "Vol. 1 - Trial Transcript.pdf"
   - Pattern: `Vol[ume]. [N] - [Description]`
   - Sequential volume numbering

3. **DAY_BASED**: "Day 1 - Trial Proceedings.pdf"
   - Pattern: `Day [N] - [Description]`
   - Sequential day numbering

4. **DOCKET_ENTRY**: "ECF No. 123 - Trial Transcript.pdf"
   - Pattern: `ECF No. [N] - [Description]`
   - Based on court docket numbers

5. **LEXIS_FORMAT**: "US_DIS_TXED_2_16cv230_[hash]_NOTICE_OF_FILING"
   - Complex Lexis Nexis format with embedded metadata

### 1.3 Conversion Script Enhancement

```typescript
interface ConversionConfig {
  sourceDir: string;           // Root directory with all trial PDFs
  outputDir: string;           // Output directory for converted files
  parallelJobs: number;        // Number of parallel conversion jobs
  skipExisting: boolean;       // Skip if trialstyle.json exists
  detectConventions: boolean;  // Auto-detect file conventions
  reportUnconforming: boolean; // Report files not matching conventions
}

interface ConversionReport {
  trialName: string;
  fileCount: number;
  convention: FileConvention;
  orderedFiles: string[];
  unidentifiedFiles: string[];
  errors: string[];
  warnings: string[];
}
```

## Phase 2: Pattern Analysis Infrastructure

### 2.1 Database Schema Extensions

```sql
-- Track file conventions per trial
ALTER TABLE "Trial" ADD COLUMN "fileConvention" VARCHAR(50);
ALTER TABLE "Trial" ADD COLUMN "hasUnconformingFiles" BOOLEAN DEFAULT FALSE;

-- Track witness patterns
CREATE TABLE "WitnessPattern" (
  id SERIAL PRIMARY KEY,
  pattern TEXT NOT NULL,
  exampleLine TEXT NOT NULL,
  trialId INTEGER REFERENCES "Trial"(id),
  frequency INTEGER DEFAULT 1,
  components JSONB, -- {name_position: 'before_comma', party_marker: 'PLAINTIFFS', etc}
  createdAt TIMESTAMP DEFAULT NOW()
);

-- Track detection failures for analysis
CREATE TABLE "WitnessDetectionFailure" (
  id SERIAL PRIMARY KEY,
  trialId INTEGER REFERENCES "Trial"(id),
  sessionId INTEGER REFERENCES "Session"(id),
  lineNumber INTEGER,
  lineText TEXT,
  reason TEXT,
  createdAt TIMESTAMP DEFAULT NOW()
);
```

### 2.2 Analysis Queries

```sql
-- Find all unique witness patterns
SELECT DISTINCT 
  REGEXP_REPLACE(line_text, '[A-Z][A-Z\s,."''()-]+', '[NAME]', 'g') as pattern,
  COUNT(*) as occurrences,
  ARRAY_AGG(DISTINCT trial_id) as trials
FROM "Line" 
WHERE line_text LIKE '%WITNESS%' 
  AND line_text LIKE '%SWORN%'
GROUP BY pattern
ORDER BY occurrences DESC;

-- Find witness lines with various party designations
SELECT 
  CASE 
    WHEN line_text LIKE '%PLAINTIFF''S%' THEN 'PLAINTIFF_POSSESSIVE_SINGULAR'
    WHEN line_text LIKE '%PLAINTIFFS''%' THEN 'PLAINTIFF_POSSESSIVE_PLURAL'
    WHEN line_text LIKE '%DEFENDANT''S%' THEN 'DEFENDANT_POSSESSIVE_SINGULAR'
    WHEN line_text LIKE '%DEFENDANTS''%' THEN 'DEFENDANT_POSSESSIVE_PLURAL'
    ELSE 'OTHER'
  END as party_format,
  COUNT(*) as count
FROM "Line"
WHERE line_text LIKE '%WITNESS%SWORN%'
GROUP BY party_format;

-- Find all DIRECT EXAMINATION patterns with preceding line
WITH examination_lines AS (
  SELECT 
    l1.trial_id,
    l1.line_number,
    l1.line_text as exam_line,
    l2.line_text as witness_line
  FROM "Line" l1
  JOIN "Line" l2 ON l1.page_id = l2.page_id 
    AND l2.line_number = l1.line_number - 1
  WHERE l1.line_text LIKE '%DIRECT EXAMINATION%'
    AND l1.line_text NOT LIKE '%REDIRECT%'
)
SELECT * FROM examination_lines;
```

## Phase 3: Witness Detection Service

### 3.1 Flexible Pattern Matcher

```typescript
interface WitnessPattern {
  id: string;
  regex?: RegExp;
  keywords: string[];
  nameExtractor: (line: string) => string | null;
  partyExtractor: (line: string) => 'PLAINTIFF' | 'DEFENDANT' | null;
  swornExtractor: (line: string) => SwornStatus;
  confidence: number;
}

class WitnessDetectionService {
  private patterns: WitnessPattern[] = [];
  
  // Load patterns from database analysis
  async loadPatterns(): Promise<void> {
    // Load from WitnessPattern table
  }
  
  // Detect witness from line
  detectWitness(line: string, context: LineContext): WitnessInfo | null {
    // Try each pattern in order of confidence
    for (const pattern of this.patterns) {
      if (this.matchesPattern(line, pattern)) {
        return this.extractWitnessInfo(line, pattern);
      }
    }
    
    // Fallback to ML-based detection if available
    return this.mlDetection(line, context);
  }
  
  // Learn from corrections
  async learnFromCorrection(
    line: string, 
    detectedInfo: WitnessInfo | null,
    correctInfo: WitnessInfo
  ): Promise<void> {
    // Update pattern confidence scores
    // Add new pattern if needed
  }
}
```

### 3.2 Pattern Examples from Analysis

Based on current findings:

```typescript
const patterns: WitnessPattern[] = [
  {
    id: 'standard_comma_separated',
    keywords: ['WITNESS', 'SWORN'],
    nameExtractor: (line) => {
      const parts = line.split(',');
      return cleanName(parts[0]);
    },
    partyExtractor: (line) => {
      if (line.match(/PLAINTIFF/i)) return 'PLAINTIFF';
      if (line.match(/DEFENDANT/i)) return 'DEFENDANT';
      return null;
    },
    swornExtractor: (line) => {
      if (line.includes('PREVIOUSLY SWORN')) return 'PREVIOUSLY_SWORN';
      return 'SWORN';
    },
    confidence: 0.9
  },
  {
    id: 'parenthetical_sworn',
    keywords: ['Witness', 'sworn'],
    regex: /\(.*[Ww]itness.*sworn.*\)/,
    // ... extractors
    confidence: 0.8
  },
  // More patterns added from analysis...
];
```

## Phase 4: Execution Plan

### 4.1 Batch Conversion Script

```bash
#!/bin/bash
# run-mass-conversion.sh

echo "Starting mass trial conversion..."

# Run conversion with parallel processing
npx ts-node src/cli/convert-pdf.ts \
  --source-dir "./trial-pdfs" \
  --output-dir "./output/multi-trial" \
  --parallel 4 \
  --detect-conventions \
  --create-report

# Generate summary report
npx ts-node src/cli/analyze-conventions.ts \
  --output-dir "./output/multi-trial" \
  --report-file "./conversion-report.json"
```

### 4.2 Phase 1 Mass Parsing

```bash
#!/bin/bash
# run-phase1-all.sh

echo "Running Phase 1 parsing on all trials..."

for dir in ./output/multi-trial/*/; do
  trial_name=$(basename "$dir")
  echo "Processing: $trial_name"
  
  # Create config
  cat > "config/trial-${trial_name}.json" << EOF
{
  "inputDir": "$dir",
  "outputDir": "$dir",
  "logLevel": "info",
  "parserMode": "legacy"
}
EOF
  
  # Run phase 1
  npx ts-node src/cli/parse.ts parse \
    --phase1 \
    --config "config/trial-${trial_name}.json"
done
```

### 4.3 Pattern Analysis Script

```typescript
// src/cli/analyze-witness-patterns.ts

async function analyzeWitnessPatterns() {
  const prisma = new PrismaClient();
  
  // 1. Extract all witness-related lines
  const witnessLines = await prisma.$queryRaw`
    SELECT * FROM "Line" 
    WHERE line_text LIKE '%WITNESS%' 
    AND line_text LIKE '%SWORN%'
  `;
  
  // 2. Cluster similar patterns
  const patterns = clusterPatterns(witnessLines);
  
  // 3. Generate pattern definitions
  const patternDefs = generatePatternDefinitions(patterns);
  
  // 4. Test patterns against known witnesses
  const accuracy = testPatterns(patternDefs);
  
  // 5. Output results
  await savePatternLibrary(patternDefs);
  
  console.log(`Found ${patterns.length} unique patterns`);
  console.log(`Average accuracy: ${accuracy}%`);
}
```

## Success Criteria

1. **Conversion Completeness**
   - All ~60 trials converted successfully
   - trialstyle.json generated for each trial
   - File ordering verified for chronological accuracy

2. **Convention Coverage**
   - 95%+ of files match identified conventions
   - All non-conforming files documented
   - New conventions properly detected and handled

3. **Pattern Detection**
   - 95%+ witness detection accuracy across all trials
   - All pattern variations documented
   - Flexible detection service handles all variants

4. **Database Population**
   - All trials loaded with phase 1 parsing
   - Witness patterns analyzed and stored
   - Ready for phase 2 processing

## Implementation Notes

1. **Performance Considerations**
   - Use parallel processing for PDF conversion
   - Batch database inserts for phase 1
   - Index Line table for pattern searching

2. **Error Handling**
   - Log all conversion failures
   - Continue processing on individual file errors
   - Generate comprehensive error report

3. **Validation**
   - Verify chronological ordering of sessions
   - Check for duplicate files
   - Validate witness name extraction

## Future Enhancements

1. **Machine Learning Integration**
   - Train NER model on witness names
   - Use context embeddings for pattern matching
   - Active learning from corrections

2. **Configuration UI**
   - Web interface for reviewing trialstyle.json
   - Manual correction of file ordering
   - Pattern testing interface

3. **Quality Metrics**
   - Automated quality scoring for each trial
   - Confidence scores for witness detection
   - Data completeness metrics