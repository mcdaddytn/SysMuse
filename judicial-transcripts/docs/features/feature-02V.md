# Feature 02V: Attorney Identification and Witness Association

## CRITICAL ISSUE: REGEX FRAGILITY
**Regular expressions have consumed over 90% of project time and resources in circular fixes.**
- Every regex "fix" breaks previously working scenarios
- Pattern variations in real transcripts are extensive and unpredictable
- Current approach is fundamentally flawed and unsustainable

### Required Approach:
1. Parse ALL valid trials into database
2. Search for ALL variations of witness patterns
3. Document every variation found
4. Build comprehensive pattern matching WITHOUT fragile regex
5. Abstract all pattern matching out of code in future refactor

## Overview
Improve attorney identification from "BY MR./MS." patterns and ensure proper witness-attorney associations during examinations.

## Current Issues

### 1. BY MR./MS. Pattern Mishandling
- **Problem**: "BY MR. SMITH:" lines are being created as ANONYMOUS speakers
- **Should Be**: These are attorney indicators that follow witness examination headers
- **Purpose**: Identifies which attorney is conducting the examination

### 2. Pattern Structure
```
WITNESS NAME, PLAINTIFF'S WITNESS
DIRECT EXAMINATION
BY MR. SMITH:
Q. [Question from attorney]
A. [Answer from witness]
```

The "BY MR." line is NOT a speaker prefix but an attorney identifier that:
- Follows the examination type line
- Identifies the examining attorney
- Should establish context for subsequent Q. lines

### 3. Missing Witness Detection
- **Issue**: Trial 1 (Genband) shows only 4 witnesses, likely missing many
- **Probable Cause**: Witnesses called with different patterns not being detected
- **Patterns to check**:
  - Video deposition witnesses
  - Witnesses called without explicit "PLAINTIFF'S/DEFENDANT'S WITNESS" 
  - Witnesses with "PREVIOUSLY SWORN" status
  - Witnesses in continued examinations

### 4. Attorney Association Fallback
Even without "BY MR." parsing, Q. lines should:
- Be associated with a generic attorney (plaintiff/defendant side)
- Track which side is examining based on witness caller
- Use examination type to infer attorney side:
  - DIRECT: Same side as witness caller
  - CROSS: Opposite side from witness caller

## Implementation Requirements

### Phase 2 Processing Should:

1. **Detect "BY MR./MS." patterns**:
   - Parse attorney name from "BY MR. LASTNAME:" format
   - Create or find attorney record
   - Set as examining attorney for current context
   - Associate subsequent Q. lines with this attorney

2. **Fallback attorney assignment**:
   - If no specific attorney identified, use generic side-based attorney
   - Track examination type and witness caller to determine side
   - Ensure Q. lines always have attorney association

3. **Improved witness detection**:
   - Check for all witness calling patterns
   - Handle video depositions
   - Track witness context across session boundaries
   - Detect witnesses in various formats

## Test Cases

### Test 1: Basic BY MR. Pattern
```
JOHN DOE, PLAINTIFF'S WITNESS
DIRECT EXAMINATION  
BY MR. SMITH:
Q. State your name.
A. John Doe.
```
Expected: 
- Attorney "MR. SMITH" created
- Q. associated with MR. SMITH
- A. associated with JOHN DOE

### Test 2: Cross-Examination Without BY MR.
```
JOHN DOE, PLAINTIFF'S WITNESS  
CROSS-EXAMINATION
Q. You work for plaintiff?
A. Yes.
```
Expected:
- Q. associated with generic DEFENDANT attorney
- A. associated with JOHN DOE

### Test 3: Video Deposition
```
JANE SMITH, DEFENDANT'S WITNESS
VIDEO DEPOSITION
```
Expected:
- JANE SMITH detected as witness
- Video deposition event created

## Related Features
- Feature-02D: Witness Detection
- Feature-02R: Attorney Parsing
- Feature-02S: Data Corrections

## Test Data - Trial 01 Genband

### Expected Witnesses (9 total):
1. BRENDON MILLS (Plaintiff)
2. JOHN MCCREADY (Plaintiff)  
3. MARK STEWART (Defendant)
4. TIM WILLIAMS, Ph.D. (Defendant)
5. ROBERT AKL, Ph.D. (Defendant)
6. ERIC BURGER, Ph.D. (Defendant)
7. MATTHEW LYNDE, Ph.D. (Defendant)
8. LANCE GUNDERSON (Defendant)
9. MARK LANNING (Plaintiff)

### Actually Found in Database (12 total):
**Plaintiff Witnesses (4):**
1. BRENDON MILLS ✓
2. JOHN MCCREADY ✓
3. BILL BECKMANN, Ph.D. (not in expected list)
4. MARK LANNING ✓

**Defendant Witnesses (8) - NOT DETECTED BY PHASE 2:**
1. ERIC BURGER, Ph.D. ✓
2. GLENN RUSSELL (not in expected list)
3. JIRI KUTHAN (not in expected list)
4. LANCE GUNDERSON ✓
5. MARK STEWART ✓
6. MATTHEW LYNDE, Ph.D. ✓
7. ROBERT AKL, Ph.D. ✓
8. TIM WILLIAMS, Ph.D. ✓

### Issue Analysis:
- Phase 2 only detected 4 witnesses (all plaintiff)
- Phase 1 has all 12 witnesses in the text
- **Problem**: Phase 2 is not detecting DEFENDANTS' witnesses (uses plural "DEFENDANTS'" not "DEFENDANT'S")
- **Additional witnesses found**: BILL BECKMANN, GLENN RUSSELL, JIRI KUTHAN

## ALL WITNESS PATTERN VARIATIONS FOUND (58 Trials, 65,003 Pages)

### Pattern Categories Found:

#### 1. Side Variations (CRITICAL - MUST HANDLE ALL):
- **PLAINTIFF'S WITNESS** (singular possessive)
- **PLAINTIFFS' WITNESS** (plural possessive) 
- **PLAINTIFFS WITNESS** (no apostrophe)
- **DEFENDANT'S WITNESS** (singular possessive)
- **DEFENDANTS' WITNESS** (plural possessive)
- **DEFENDANTS' WITNESSES** (plural)
- **DEFENSE WITNESS** (alternative term)

#### 2. Sworn Status Variations:
- **SWORN**
- **PREVIOUSLY SWORN**
- **SWORN,** (with comma)
- **PREVIOUSLY SWORN,** (with comma)
- **(no sworn status)** - many witnesses have no sworn indicator

#### 3. Video/Deposition Patterns:
- **BY VIDEO DEPOSITION**
- **PRESENTED BY VIDEO DEPOSITION**
- **BY VIDEOTAPED DEPOSITION**
- **BY SWORN VIDEOTAPED DEPOSITION**
- **PRESENTED BY VIDEO TRIAL DEPOSITION**
- **VIDEO DEPOSITION** (standalone after witness name)

#### 4. Name Patterns with Titles:
- **Name, Ph.D.**
- **Name, PH.D.**
- **Dr. Name**
- **Name, III** (suffix)
- **Name "Nickname" Lastname**
- **Name with hyphenated parts**

#### 5. Multi-line Patterns:
Many witnesses appear in lists where context matters:
- Previous line: Another witness name
- Current line: Witness name and designation  
- Next line: "THE WITNESS:" or another witness or examination type

#### 6. Complete Pattern Examples:
- `JOHN DOE, PLAINTIFF'S WITNESS, SWORN`
- `JANE SMITH, DEFENDANTS' WITNESS, PREVIOUSLY SWORN`
- `DR. WILLIAM JONES, PLAINTIFFS WITNESS`
- `MARY JOHNSON, BY VIDEO DEPOSITION`
- `ROBERT BROWN, Ph.D., DEFENDANT'S WITNESS, SWORN,`

### Key Findings:
1. **3,759 lines contain "WITNESS" across 55 of 58 trials**
2. **Apostrophe placement varies wildly** (PLAINTIFF'S, PLAINTIFFS', PLAINTIFFS)
3. **Plural forms are common** (DEFENDANTS' not just DEFENDANT'S)
4. **Video depositions have multiple formats**
5. **Sworn status is often missing**
6. **Multi-line context is crucial** for proper parsing

## Status
- [x] Document current implementation gaps
- [x] Identify all witness calling patterns across ALL trials
- [x] Document ALL witness pattern variations
- [ ] Fix witness detection to handle ALL variations WITHOUT REGEX
- [ ] Fix BY MR. pattern recognition
- [ ] Implement attorney fallback logic
- [ ] Test with multiple trials