# Feature 02L Implementation: Strict Speaker Matching

## Critical Issues to Fix

### 1. STOP Using Regular Expressions for Speaker Identification
**Problem**: Regular expressions are matching text that is NOT speakers (e.g., "It says", "The question is", etc.)

**Solution**: Use EXACT string matching with strict position requirements:
- Speaker handle MUST be at position 0 of the line (no leading whitespace)
- Speaker handle MUST have whitespace or end-of-line immediately after
- Comparison MUST be case-sensitive
- NO partial matches, NO pattern matching

### 2. Speaker Handle Types and Rules

#### Fixed Speaker Handles (Exact Matches Only)
```
THE COURT:          -> JUDGE speaker
THE WITNESS:        -> Current witness (context-dependent)
THE CLERK:          -> ANONYMOUS speaker
THE BAILIFF:        -> ANONYMOUS speaker
THE COURT REPORTER: -> Court Reporter speaker
COURTROOM DEPUTY:   -> ANONYMOUS speaker
COURT SECURITY OFFICER: -> ANONYMOUS speaker
```

#### Attorney Speaker Handles (Title + Last Name)
```
MR. LASTNAME:       -> Match to attorney from summary
MS. LASTNAME:       -> Match to attorney from summary
MRS. LASTNAME:      -> Match to attorney from summary
DR. LASTNAME:       -> Match to attorney from summary
```
- Must match attorneys parsed from summary APPEARANCES section
- If no match found, DO NOT create anonymous speaker

#### Q&A Format (ONLY during witness examination)
```
Q.                  -> Current examining attorney (from "BY MR. X:" context)
A.                  -> Current witness being examined
```
- ONLY active during witness examination
- Must be exact match "Q." or "A." at start of line
- Never match "Q" or "A" without period
- Never match "Question" or "Answer"

#### Juror Handles
```
JUROR NO. 1:        -> Specific juror
PROSPECTIVE JUROR LASTNAME: -> During voir dire
```

### 3. What is NOT a Speaker
These should NEVER be identified as speakers:
- "It says" - This is just text
- "The question is" - This is just text
- "says here" - This is just text
- "FOR THE PLAINTIFF" - This is a section header
- "FOR THE DEFENDANTS" - This is a section header
- Any text that doesn't match the exact patterns above

### 4. Implementation Steps

#### Step 1: Replace Pattern Matching with Exact Matching
```typescript
// WRONG - Using regex patterns
const match = /^(MR\.|MS\.).*/.exec(text);

// RIGHT - Exact string comparison
if (text.startsWith('MR. ')) {
  const parts = text.split(':');
  if (parts.length >= 2) {
    const speakerHandle = parts[0].trim();
    // Check if this matches a known attorney
  }
}
```

#### Step 2: Create Speaker Handle Validator
```typescript
function isValidSpeakerHandle(text: string): {isValid: boolean, handle?: string, type?: SpeakerType} {
  // Must start at position 0
  if (text[0] === ' ' || text[0] === '\t') return {isValid: false};
  
  // Check for colon-delimited speakers
  const colonIndex = text.indexOf(':');
  if (colonIndex > 0) {
    const handle = text.substring(0, colonIndex);
    const afterColon = text.substring(colonIndex + 1);
    
    // Must have space or EOL after colon
    if (afterColon.length > 0 && afterColon[0] !== ' ') return {isValid: false};
    
    // Check exact matches for known handles
    switch(handle) {
      case 'THE COURT': return {isValid: true, handle, type: 'JUDGE'};
      case 'THE WITNESS': return {isValid: true, handle, type: 'WITNESS'};
      case 'THE CLERK': return {isValid: true, handle, type: 'ANONYMOUS'};
      // etc...
    }
    
    // Check attorney pattern (but must match known attorney)
    if (handle.startsWith('MR. ') || handle.startsWith('MS. ') || 
        handle.startsWith('MRS. ') || handle.startsWith('DR. ')) {
      // Must lookup in attorney registry
      return checkAttorneyRegistry(handle);
    }
  }
  
  // Check Q&A format (no colon)
  if (text === 'Q.' || text.startsWith('Q. ')) {
    if (inWitnessExamination()) {
      return {isValid: true, handle: 'Q.', type: 'ATTORNEY'};
    }
  }
  if (text === 'A.' || text.startsWith('A. ')) {
    if (inWitnessExamination()) {
      return {isValid: true, handle: 'A.', type: 'WITNESS'};
    }
  }
  
  return {isValid: false};
}
```

### 5. Statement Aggregation Rules

Once a valid speaker is identified:
1. Start a new statement event
2. Continue adding subsequent lines to the same statement UNTIL:
   - Another valid speaker handle is found
   - A section boundary is reached
   - An examination type marker is found (DIRECT EXAMINATION, etc.)
   - A court directive is found ([Jury in.], etc.)

### 6. Missing Components to Parse

#### Law Firms and Addresses
- Parse from attorney blocks in APPEARANCES section
- Look for lines after attorney names that contain firm names and addresses

#### Jurors
- Parse from jury selection/voir dire sections
- Create juror records when "JUROR NO. X" patterns appear

#### Court Reporter
- Parse from summary section "COURT REPORTER:" or "OFFICIAL COURT REPORTER:"

### 7. Testing Targets

After implementation, we should achieve:
- **Line count**: ~38,550 (currently 39,673)
- **Attorneys**: 19 (currently 16)
- **Anonymous Speakers**: 6 (currently 92) - This is the key metric
- **Statement Events**: ~12,265 (currently 10,279)
- **Jurors**: 39 (currently 0)

## Next Steps

1. Remove ALL regex-based speaker patterns from MultiPassContentParser
2. Implement exact string matching for speaker identification
3. Add attorney registry lookup for MR./MS./MRS./DR. patterns
4. Implement proper statement aggregation
5. Parse law firms, addresses, jurors, and court reporter
6. Test against baseline counts

## Key Principle
**Precision over flexibility**: It's better to miss a speaker than to incorrectly identify normal text as a speaker. Every speaker identification must be 100% certain.