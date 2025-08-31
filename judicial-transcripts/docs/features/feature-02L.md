# Feature 02L: Strict Speaker Matching

## Overview
Replace all regular expression-based speaker identification with exact string matching to eliminate false positives and achieve precise speaker identification.

## Problem Statement
Current implementation uses regular expressions that are matching text that is clearly NOT speakers:
- "It says" being identified as a speaker
- "The question is" being identified as a speaker  
- "FOR THE PLAINTIFF" being identified as a speaker
- 92 anonymous speakers being created when there should only be 6

## Solution Requirements

### 1. Exact String Matching Only
- NO regular expressions for speaker identification
- Speaker handle must start at position 0 (no leading whitespace)
- Must have whitespace or EOL immediately after the handle
- Case-sensitive comparison

### 2. Valid Speaker Handles

#### Court Officials (Exact Matches)
- `THE COURT:` → JUDGE
- `THE WITNESS:` → Current witness
- `THE CLERK:` → Anonymous
- `THE BAILIFF:` → Anonymous
- `THE COURT REPORTER:` → Court Reporter
- `COURTROOM DEPUTY:` → Anonymous
- `COURT SECURITY OFFICER:` → Anonymous

#### Attorneys (Title + Last Name from Registry)
- `MR. [LASTNAME]:` → Must match attorney from summary
- `MS. [LASTNAME]:` → Must match attorney from summary
- `MRS. [LASTNAME]:` → Must match attorney from summary
- `DR. [LASTNAME]:` → Must match attorney from summary

If the lastname doesn't match a known attorney, it is NOT a speaker.

#### Q&A Format (Examination Context Only)
- `Q.` → Examining attorney (only during witness examination)
- `A.` → Current witness (only during witness examination)

These are EXACT matches. Never match:
- `Q` (without period)
- `A` (without period)
- `Question`
- `Answer`
- `Q:` or `A:` (with colon instead of period)

#### Jurors
- `JUROR NO. [NUMBER]:` → Specific juror
- `PROSPECTIVE JUROR [NAME]:` → During voir dire

### 3. Configuration Support

Add trial-specific configuration for Q&A patterns:
```json
{
  "speakerConfig": {
    "enableQA": true,
    "qaPatterns": {
      "question": "Q.",
      "answer": "A."
    },
    "excludePatterns": ["Q", "A", "Q:", "A:"]
  }
}
```

### 4. Statement Aggregation

Once a valid speaker is identified:
1. Create a new statement event
2. Add subsequent lines to the same statement until:
   - Another valid speaker is found
   - A section boundary is reached
   - An examination marker appears
   - A court directive appears

### 5. Success Metrics

| Metric | Current | Target | Key Indicator |
|--------|---------|--------|---------------|
| Anonymous Speakers | 92 | 6 | ⭐ Primary metric |
| Total Speakers | 191 | 81 | |
| Attorneys | 16 | 19 | |
| Statement Events | 10,279 | 12,265 | |
| Lines | 39,673 | 38,550 | |

The anonymous speaker count is the key metric - reducing from 92 to 6 proves we've eliminated false positives.

## Implementation Checklist

- [ ] Remove all regex patterns from `SPEAKER_PATTERNS` in MultiPassContentParser
- [ ] Implement `isValidSpeakerHandle()` function with exact string matching
- [ ] Add attorney registry lookup for title+lastname patterns
- [ ] Add examination context checking for Q/A patterns
- [ ] Implement proper statement aggregation logic
- [ ] Add configuration support for Q/A patterns
- [ ] Parse law firms and addresses from APPEARANCES section
- [ ] Parse jurors from jury selection sections
- [ ] Parse court reporter from summary
- [ ] Test against baseline metrics

## Code Example

```typescript
// WRONG - Current approach with regex
const SPEAKER_PATTERNS = [
  { pattern: /^THE COURT:/i, type: 'JUDGE' },
  { pattern: /^Q\.?\s*/i, type: 'QUESTION' },
  // These patterns are too loose!
];

// RIGHT - Exact matching approach
function isValidSpeakerHandle(text: string): SpeakerMatch | null {
  // Position 0 check
  if (text[0] === ' ' || text[0] === '\t') return null;
  
  // Exact matches for court officials
  if (text === 'THE COURT:' || text.startsWith('THE COURT: ')) {
    return { handle: 'THE COURT', type: 'JUDGE' };
  }
  
  // Q&A only in examination context
  if (text === 'Q.' || text.startsWith('Q. ')) {
    if (this.examinationContext.isInExamination()) {
      return { handle: 'Q.', type: 'ATTORNEY' };
    }
  }
  
  // Attorney with registry check
  const colonPos = text.indexOf(':');
  if (colonPos > 0) {
    const handle = text.substring(0, colonPos);
    if (handle.startsWith('MR. ') || handle.startsWith('MS. ')) {
      const attorney = this.attorneyRegistry.findByHandle(handle);
      if (attorney) {
        return { handle, type: 'ATTORNEY', speakerId: attorney.speakerId };
      }
    }
  }
  
  return null;
}
```

## Notes
- This is a critical fix to achieve baseline parity
- The key principle: **Precision over coverage** - better to miss a speaker than create false positives
- Every speaker identification must be 100% certain
- No fuzzy matching, no patterns, no "close enough" - exact matches only