# Feature 02W: LLM-Based Participant Extraction from Summary

## Overview
Extract trial participants (attorneys, judge, court reporter, etc.) from the SUMMARY document section using LLM parsing. This approach provides more accurate and flexible extraction than regex patterns, handling varied formatting across different transcripts.

## Problem Statement
Current regex-based parsing misses many participants because:
1. Attorney formatting varies widely across transcripts
2. Defendant attorneys often appear in different sessions
3. Law firm associations are inconsistently formatted
4. Names with special characters, titles, and suffixes are hard to parse
5. Plaintiff/defendant associations are not always clear

## Solution Approach

### Phase 1: Extract and Clean Summary Text
1. Query all Lines with `documentSection = 'SUMMARY'` for a trial
2. Strip out:
   - Page headers
   - Line numbers/prefixes
   - Timestamps
   - Extra whitespace
3. Organize by session to maintain context
4. Create clean text blocks for LLM processing

### Phase 2: LLM Parsing
Send cleaned summary text to LLM with structured prompt requesting:
- Judge name, title, and honorific
- Plaintiff attorneys with law firms
- Defendant attorneys with law firms
- Court reporter name
- Court information (name, division, district)
- Case caption (plaintiff vs defendant full names)

### Phase 3: Database Storage
Store extracted information in:
- `Attorney` table with proper associations
- `Judge` table with cross-trial matching capability
- `LawFirm` and `LawFirmOffice` tables
- `CourtReporter` table

### Phase 4: Seed File Generation
Create JSON seed files for:
- Known judges (searchable across trials)
- Recurring attorneys
- Law firms and offices
- Court reporters

## Implementation

### 1. Summary Text Extraction Query
```sql
-- Get clean summary text for a trial
SELECT 
  s.id as session_id,
  s."sessionDate",
  STRING_AGG(
    REGEXP_REPLACE(
      REGEXP_REPLACE(l.text, '^\d+\s+', ''),  -- Remove line numbers
      '\s+', ' ', 'g'  -- Normalize whitespace
    ),
    E'\n'
    ORDER BY p."pageNumber", l."lineNumber"
  ) as clean_text
FROM "Line" l
JOIN "Page" p ON l."pageId" = p.id
JOIN "Session" s ON p."sessionId" = s.id
WHERE s."trialId" = $1
  AND l."documentSection" = 'SUMMARY'
  AND l.text IS NOT NULL
  AND LENGTH(l.text) > 0
GROUP BY s.id, s."sessionDate"
ORDER BY s.id;
```

### 2. LLM Prompt Template
```typescript
const prompt = `
Extract participant information from this trial transcript summary:

${summaryText}

Return a JSON object with the following structure:
{
  "judge": {
    "name": "Full name",
    "title": "Official title",
    "honorific": "Honorific (e.g., Honorable)"
  },
  "plaintiffAttorneys": [
    {
      "name": "Full name",
      "firstName": "First name",
      "lastName": "Last name",
      "middleInitial": "Middle initial if present",
      "suffix": "Jr., III, etc.",
      "lawFirm": "Law firm name",
      "lawFirmOffice": "City, State if mentioned"
    }
  ],
  "defendantAttorneys": [
    // Same structure as plaintiffAttorneys
  ],
  "courtReporter": {
    "name": "Full name",
    "certificationNumber": "If mentioned"
  },
  "court": {
    "name": "Full court name",
    "division": "Division if mentioned",
    "district": "District if mentioned"
  },
  "caseCaption": {
    "plaintiff": "Full plaintiff name(s)",
    "defendant": "Full defendant name(s)"
  }
}

Important:
- Separate attorneys by plaintiff/defendant based on "FOR THE PLAINTIFF" and "FOR THE DEFENDANT" sections
- Include all attorneys listed, even if law firm is not mentioned
- Preserve exact spelling of names
- Law firm names often end with LLP, L.L.P., PC, etc.
`;
```

### 3. Processing Pipeline
```typescript
interface ParticipantExtractor {
  // Extract and clean summary text
  async extractSummaryText(trialId: number): Promise<string>;
  
  // Send to LLM for parsing
  async parseWithLLM(summaryText: string): Promise<ParsedParticipants>;
  
  // Store in database
  async storeParticipants(trialId: number, participants: ParsedParticipants): Promise<void>;
  
  // Generate seed files
  async generateSeedFiles(participants: ParsedParticipants): Promise<void>;
}
```

### 4. Database Storage Strategy

#### Attorney Creation
```typescript
async function createAttorneyWithLawFirm(
  trialId: number,
  attorneyData: ParsedAttorney,
  side: 'PLAINTIFF' | 'DEFENDANT'
) {
  // Create or find law firm
  let lawFirmId = null;
  if (attorneyData.lawFirm) {
    const lawFirm = await prisma.lawFirm.upsert({
      where: { name: attorneyData.lawFirm },
      update: {},
      create: { name: attorneyData.lawFirm }
    });
    lawFirmId = lawFirm.id;
  }
  
  // Create speaker
  const speaker = await prisma.speaker.create({
    data: {
      trialId,
      speakerPrefix: `${guessTitle(attorneyData.firstName)} ${attorneyData.lastName.toUpperCase()}`,
      speakerHandle: `ATTORNEY_${attorneyData.lastName.toUpperCase()}`,
      speakerType: 'ATTORNEY'
    }
  });
  
  // Create attorney
  await prisma.attorney.create({
    data: {
      name: attorneyData.name,
      firstName: attorneyData.firstName,
      lastName: attorneyData.lastName,
      middleInitial: attorneyData.middleInitial,
      suffix: attorneyData.suffix,
      speakerId: speaker.id,
      lawFirmId
    }
  });
}
```

#### Judge Cross-Trial Matching
```typescript
async function createOrMatchJudge(trialId: number, judgeData: ParsedJudge) {
  // Generate fingerprint for cross-trial matching
  const fingerprint = generateJudgeFingerprint(judgeData.name);
  
  // Check if judge exists globally
  const existingJudge = await prisma.judge.findFirst({
    where: { judgeFingerprint: fingerprint }
  });
  
  if (existingJudge) {
    // Link existing judge to this trial
    await prisma.trialJudge.create({
      data: {
        trialId,
        judgeId: existingJudge.id
      }
    });
  } else {
    // Create new judge
    const speaker = await prisma.speaker.create({
      data: {
        trialId,
        speakerPrefix: 'THE COURT',
        speakerHandle: 'JUDGE',
        speakerType: 'JUDGE'
      }
    });
    
    await prisma.judge.create({
      data: {
        trialId,
        name: judgeData.name,
        title: judgeData.title,
        honorific: judgeData.honorific,
        judgeFingerprint: fingerprint,
        speakerId: speaker.id
      }
    });
  }
}
```

### 5. Seed File Format
```json
{
  "judges": [
    {
      "name": "RODNEY GILSTRAP",
      "title": "UNITED STATES DISTRICT JUDGE",
      "honorific": "HONORABLE",
      "fingerprint": "gilstrap_rodney",
      "court": "Eastern District of Texas",
      "division": "Marshall"
    }
  ],
  "attorneys": [
    {
      "name": "Kurt M. Pankratz",
      "firstName": "Kurt",
      "middleInitial": "M",
      "lastName": "Pankratz",
      "lawFirm": "BAKER BOTTS L.L.P.",
      "barNumber": "TX12345",
      "fingerprint": "pankratz_kurt_m"
    }
  ],
  "lawFirms": [
    {
      "name": "BAKER BOTTS L.L.P.",
      "offices": [
        {
          "city": "Dallas",
          "state": "Texas",
          "address": "2001 Ross Avenue"
        }
      ]
    }
  ],
  "courtReporters": [
    {
      "name": "Shelly Holmes",
      "certificationNumber": "CSR 13236",
      "company": "Southern District Reporters"
    }
  ]
}
```

## Export Template for Summary
```mustache
TRIAL SUMMARY
=============
Case: {{caseNumber}}
{{#court}}
Court: {{name}}
{{#division}}Division: {{division}}{{/division}}
{{#district}}District: {{district}}{{/district}}
{{/court}}

{{#judge}}
PRESIDING JUDGE:
{{honorific}} {{name}}
{{title}}
{{/judge}}

APPEARANCES:

FOR THE PLAINTIFF:
{{#plaintiffAttorneys}}
  {{name}}
  {{#lawFirm}}{{lawFirm}}{{/lawFirm}}
  {{#lawFirmOffice}}{{lawFirmOffice}}{{/lawFirmOffice}}
  
{{/plaintiffAttorneys}}

FOR THE DEFENDANT:
{{#defendantAttorneys}}
  {{name}}
  {{#lawFirm}}{{lawFirm}}{{/lawFirm}}
  {{#lawFirmOffice}}{{lawFirmOffice}}{{/lawFirmOffice}}
  
{{/defendantAttorneys}}

{{#courtReporter}}
COURT REPORTER:
{{name}}
{{#certificationNumber}}{{certificationNumber}}{{/certificationNumber}}
{{/courtReporter}}
```

## Testing Strategy

### 1. Validation Queries
```sql
-- Check extraction completeness
SELECT 
  t.id,
  t."caseNumber",
  COUNT(DISTINCT a.id) as attorney_count,
  COUNT(DISTINCT CASE WHEN at."side" = 'PLAINTIFF' THEN a.id END) as plaintiff_attorneys,
  COUNT(DISTINCT CASE WHEN at."side" = 'DEFENDANT' THEN a.id END) as defendant_attorneys,
  COUNT(DISTINCT j.id) as judge_count,
  COUNT(DISTINCT lf.id) as lawfirm_count
FROM "Trial" t
LEFT JOIN "Attorney" a ON a."speakerId" IN (
  SELECT id FROM "Speaker" WHERE "trialId" = t.id
)
LEFT JOIN "AttorneyTrial" at ON at."attorneyId" = a.id AND at."trialId" = t.id
LEFT JOIN "Judge" j ON j."trialId" = t.id
LEFT JOIN "LawFirm" lf ON lf.id = a."lawFirmId"
GROUP BY t.id, t."caseNumber"
ORDER BY t.id;
```

### 2. Cross-Trial Judge Matching
```sql
-- Find judges across multiple trials
SELECT 
  j.name,
  j."judgeFingerprint",
  COUNT(DISTINCT j."trialId") as trial_count,
  STRING_AGG(DISTINCT t."caseNumber", ', ') as cases
FROM "Judge" j
JOIN "Trial" t ON t.id = j."trialId"
GROUP BY j.name, j."judgeFingerprint"
HAVING COUNT(DISTINCT j."trialId") > 1
ORDER BY trial_count DESC;
```

## Benefits
1. **Accuracy**: LLM handles varied formatting better than regex
2. **Flexibility**: Adapts to new formats without code changes
3. **Completeness**: Extracts all available information
4. **Reusability**: Seed files accelerate future parsing
5. **Searchability**: Enables cross-trial participant searches

## Future Enhancements
1. Confidence scoring for extracted data
2. Manual review interface for corrections
3. Automatic learning from corrections
4. Integration with bar association APIs for attorney verification
5. Court directory integration for judge information
6. Batch processing for multiple trials
7. Incremental updates for new sessions

## Success Criteria
1. Extract 95%+ of attorneys from summary sections
2. Correctly associate attorneys with plaintiff/defendant
3. Successfully match judges across trials
4. Generate reusable seed files
5. Handle special characters and name variations
6. Process a trial in under 30 seconds