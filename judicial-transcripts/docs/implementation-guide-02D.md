# Implementation Guide for Feature 02D: WitnessCalledEvent Parsing

## Overview
The goal is to detect and create WitnessCalledEvent records whenever a witness is called to testify or when their examination type changes. The system should detect exactly 58 events based on the transcript data (38 standalone EXAMINATION/DEPOSITION lines expected, but accounting for witness state transitions).

## Key Concepts

### 1. Examination Types
These appear as **standalone lines** (exact text after timestamp/line number parsing):
- `DIRECT EXAMINATION`
- `CROSS-EXAMINATION` 
- `REDIRECT EXAMINATION`
- `RECROSS-EXAMINATION`
- `DIRECT EXAMINATION CONTINUED`
- `CROSS-EXAMINATION CONTINUED`
- `REDIRECT EXAMINATION CONTINUED` (if exists)
- `RECROSS-EXAMINATION CONTINUED` (if exists)

### 2. Video Depositions
These appear as **standalone lines**:
- `PRESENTED BY VIDEO DEPOSITION`
- `VIDEO DEPOSITION`

### 3. Witness Line Format
Witness information appears on a separate line BEFORE the examination type:
```
QI "PETER" LI, PLAINTIFF'S WITNESS, SWORN
CROSS-EXAMINATION CONTINUED
```
or
```
JOSEPH C. MCALEXANDER, III, PLAINTIFF'S WITNESS, PREVIOUSLY SWORN
DIRECT EXAMINATION
```

## Parsing Rules

### Rule 1: Witness Introduction
When `DIRECT EXAMINATION` appears:
- Look at the line immediately before for witness information
- Parse: `NAME, [PLAINTIFF'S|DEFENDANT'S] WITNESS, [SWORN|PREVIOUSLY SWORN]`
- Create witness if not exists
- Set as current witness in state
- Create WitnessCalledEvent

### Rule 2: Video Depositions
When `PRESENTED BY VIDEO DEPOSITION` or `VIDEO DEPOSITION` appears:
- Look at the line immediately before for witness information
- Same parsing as DIRECT EXAMINATION
- Create WitnessCalledEvent with VIDEO_DEPOSITION type

### Rule 3: Examination Changes (Same Witness)
When `CROSS-EXAMINATION`, `REDIRECT EXAMINATION`, or `RECROSS-EXAMINATION` appears WITHOUT `CONTINUED`:
- Use the current witness from state (witness stays on stand between examination types)
- The witness doesn't leave the stand when examination type changes
- Create WitnessCalledEvent with current witness info
- This happens in sequence: DIRECT → CROSS → REDIRECT → RECROSS

### Rule 4: Continued Examinations
When any examination type has `CONTINUED`:
- This means the witness is being recalled from a previous session
- Look at the line immediately before for witness information
- Usually marked as `PREVIOUSLY SWORN`
- Update witness state
- Create WitnessCalledEvent

### Rule 5: Witness State Management
- **Within a session**: Witness state persists across examination type changes
- **Across sessions**: Witness state should persist UNLESS:
  - A new witness is explicitly called (DIRECT EXAMINATION with witness name)
  - A CONTINUED examination appears (witness recalled, check preceding line)

## Expected Event Sequence Example

```
Session 1:
Line 100: JOHN DOE, PLAINTIFF'S WITNESS, SWORN
Line 101: DIRECT EXAMINATION
→ Create Event: JOHN DOE, DIRECT_EXAMINATION, SWORN

Line 200: CROSS-EXAMINATION  
→ Create Event: JOHN DOE (from state), CROSS_EXAMINATION, SWORN

Line 300: REDIRECT EXAMINATION
→ Create Event: JOHN DOE (from state), REDIRECT_EXAMINATION, SWORN

Session 2:
Line 400: JOHN DOE, PLAINTIFF'S WITNESS, PREVIOUSLY SWORN
Line 401: CROSS-EXAMINATION CONTINUED
→ Create Event: JOHN DOE, CROSS_EXAMINATION, PREVIOUSLY_SWORN, continued=true

Line 500: REDIRECT EXAMINATION
→ Create Event: JOHN DOE (from state), REDIRECT_EXAMINATION, PREVIOUSLY_SWORN

Line 600: JANE SMITH, DEFENDANT'S WITNESS, SWORN  
Line 601: DIRECT EXAMINATION
→ Create Event: JANE SMITH, DIRECT_EXAMINATION, SWORN (replaces JOHN DOE in state)
```

## Implementation Approach

### Phase2Processor.checkExaminationChange() Method
1. Check if line exactly matches one of the examination patterns or video deposition patterns
2. Determine if CONTINUED is present
3. If CONTINUED or DIRECT EXAMINATION or VIDEO DEPOSITION:
   - Look back at preceding line for witness information
   - Parse witness name, caller (PLAINTIFF/DEFENDANT), sworn status
   - Create/update witness record
   - Set as current witness in state
4. Else (CROSS, REDIRECT, RECROSS without CONTINUED):
   - Use current witness from state
   - If no witness in state, log warning (shouldn't happen in valid transcript)
5. Create WitnessCalledEvent with all information
6. Return true to indicate event was processed

### State Management
```typescript
interface ProcessingState {
  currentWitness: WitnessInfo | null;  // Persists across examination changes
  currentExaminationType: ExaminationType | null;
  // ... other fields
}
```

### Critical Points
1. **DO NOT** reset witness state between sessions automatically
2. **DO** update witness state when:
   - New witness called (DIRECT EXAMINATION with witness name before)
   - Witness recalled (any CONTINUED examination with witness name before)
3. **ALWAYS** create an event when an examination line is detected
4. **EXACT** text matching - no partial matches or case-insensitive for examination types
5. Witness names can include nicknames in quotes: `QI "PETER" LI`

## Database Schema Requirements
- WitnessCalledEvent must track:
  - witnessId (foreign key)
  - examinationType (enum)
  - swornStatus (SWORN, PREVIOUSLY_SWORN, NOT_SWORN)
  - continued (boolean)
  - presentedByVideo (boolean for video depositions)

## Testing Validation
- Should create exactly 58 WitnessCalledEvent records
- 34 EXAMINATION lines + 4 DEPOSITION lines = 38 standalone lines
- But accounting for witness state transitions and continued examinations
- Each examination type change is a separate event

## Common Pitfalls to Avoid
1. Don't look for witness names embedded in sentences
2. Don't treat examination keywords in regular text as events
3. Don't reset witness state inappropriately
4. Don't miss CONTINUED examinations that need witness lookup
5. Don't create duplicate witness records for the same person