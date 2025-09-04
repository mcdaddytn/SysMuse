# Witness Examination Sequence Rules

## Overview
This document defines the rules and patterns for witness examination sequences within individual witness testimony sections.

## Base Examination Types
1. **Direct Examination** - Initial questioning by the party who called the witness
2. **Cross Examination** - Questioning by opposing party
3. **Redirect Examination** - Follow-up by calling party
4. **Recross Examination** - Follow-up by opposing party

## Sequence Rules by Calling Party

### Plaintiff Called Witness
```
Examination Type          | Conducted By | Required | Notes
--------------------------|--------------|----------|------------------------
Direct Examination        | Plaintiff    | Yes      | Always first
Cross Examination         | Defense      | No       | Defense may decline
Redirect Examination      | Plaintiff    | No       | Only if cross occurred
Recross Examination       | Defense      | No       | Only if redirect occurred
[Additional Redirects]    | Plaintiff    | No       | Rare, requires permission
[Additional Recrosses]    | Defense      | No       | Rare, requires permission
```

### Defense Called Witness
```
Examination Type          | Conducted By | Required | Notes
--------------------------|--------------|----------|------------------------
Direct Examination        | Defense      | Yes      | Always first
Cross Examination         | Plaintiff    | No       | Plaintiff may decline
Redirect Examination      | Defense      | No       | Only if cross occurred
Recross Examination       | Plaintiff    | No       | Only if redirect occurred
[Additional Redirects]    | Defense      | No       | Rare, requires permission
[Additional Recrosses]    | Plaintiff    | No       | Rare, requires permission
```

## Valid Examination Sequences

### Common Patterns (80% of cases)
1. `Direct → Cross`
2. `Direct → Cross → Redirect`
3. `Direct → Cross → Redirect → Recross`

### Less Common Patterns (15% of cases)
4. `Direct` (no cross-examination)
5. `Direct → Cross → Redirect → Recross → Redirect`

### Rare Patterns (5% of cases)
6. `Direct → Cross → Redirect → Recross → Redirect → Recross`
7. `Direct → Cross → Redirect → Recross → Redirect → Recross → Redirect`
8. Extended sequences with 4+ redirect/recross cycles

## Implementation Rules

### Validation Logic
```typescript
interface ExaminationSequenceValidator {
  // Check if sequence follows alternating pattern
  validateSequence(examinations: ExaminationType[]): ValidationResult;
  
  // Check if examining attorney matches expected party
  validateExaminer(examination: Examination, callingParty: Party): boolean;
  
  // Flag unusual patterns (>4 total examinations)
  flagUnusualPattern(examinations: ExaminationType[]): Warning[];
}
```

### Sequence Constraints
1. **First examination MUST be Direct**
2. **Examinations must alternate between parties**
3. **Cannot have consecutive examinations by same party**
4. **Redirect only valid after Cross**
5. **Recross only valid after Redirect**

### Edge Cases

#### Judge Examination
- Judge may ask questions at any point
- Not counted in formal sequence
- Should be marked separately as `JUDGE_QUESTIONING`

#### Voir Dire During Testimony
- Mini-examination about admissibility
- Occurs outside main sequence
- Mark as `VOIR_DIRE_EXAMINATION`

#### Recalled Witness
- Starts new examination sequence
- Previous testimony referenced but not continued
- Mark parent section as `WITNESS_RECALL`

## Detection Patterns for LLM/Parser

### Start of Examination
Look for phrases:
- "Direct examination by [NAME]"
- "Cross-examination by [NAME]"
- "Redirect examination"
- "Recross examination"
- "Further redirect"
- "Additional recross"

### End of Examination
Look for phrases:
- "No further questions"
- "Pass the witness"
- "Nothing further"
- "That's all I have"
- "Witness excused"
- "You may step down"

### Party Identification
- Track which attorney belongs to which party
- Use attorney roster from trial metadata
- Validate against expected sequence

## Marker Generation Strategy

### Automatic Detection (High Confidence)
1. Explicit examination announcements by court reporter
2. Clear attorney transitions with "No further questions"
3. Judge statements like "You may cross-examine"

### LLM-Assisted Detection (Medium Confidence)
1. Attorney name changes in speaker labels
2. Question style changes (leading vs. non-leading)
3. Topic shifts indicating new examination phase

### Manual Override Required (Low Confidence)
1. Ambiguous transitions
2. Multiple attorneys for same party
3. Interrupted examinations
4. Technical difficulties causing breaks

## Statistics for Validation

### Expected Durations
- Direct: 30-120 minutes (typical)
- Cross: 20-90 minutes (typical)
- Redirect: 10-30 minutes (typical)
- Recross: 5-20 minutes (typical)

### Warning Thresholds
- Total examinations > 6: Flag for review
- Any examination > 3 hours: Flag for review
- Sequence violations: Always flag
- Missing Direct examination: Error

## JSON Schema for Examination Markers

```json
{
  "examinationSequence": {
    "witnessName": "Dr. John Smith",
    "callingParty": "PLAINTIFF",
    "examinations": [
      {
        "type": "DIRECT_EXAMINATION",
        "examiner": "MR. FABRICANT",
        "party": "PLAINTIFF",
        "startMarker": "Direct-Smith-001",
        "endMarker": "Direct-Smith-End-001",
        "duration": "45 minutes",
        "lineRange": [1001, 1450]
      },
      {
        "type": "CROSS_EXAMINATION",
        "examiner": "MS. JONES",
        "party": "DEFENSE",
        "startMarker": "Cross-Smith-001",
        "endMarker": "Cross-Smith-End-001",
        "duration": "30 minutes",
        "lineRange": [1451, 1750]
      },
      {
        "type": "REDIRECT_EXAMINATION",
        "examiner": "MR. FABRICANT",
        "party": "PLAINTIFF",
        "startMarker": "Redirect-Smith-001",
        "endMarker": "Redirect-Smith-End-001",
        "duration": "10 minutes",
        "lineRange": [1751, 1850]
      }
    ],
    "validationStatus": {
      "sequenceValid": true,
      "examinersValid": true,
      "warnings": [],
      "confidence": 0.95
    }
  }
}
```