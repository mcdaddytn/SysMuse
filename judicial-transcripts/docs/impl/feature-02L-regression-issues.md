# Feature 02L Regression Issues

## Critical Issues Found During Regression Testing

### 1. Statement Event Count Discrepancy
**Current:** 6,334 statement events  
**Baseline:** 12,265 statement events  
**Difference:** -48%

**Root Cause:** 
The Phase2Processor aggregates consecutive lines from the same speaker into a single statement event (lines 994-999 in Phase2Processor.ts). This is the correct behavior per the original design. However, we're getting fewer statements which suggests:
- Multi-pass parser may not be detecting all speaker changes properly
- Some lines that should have speaker prefixes are missing them

**Action Required:**
- Verify that Phase 1 (multi-pass parser) is correctly identifying ALL speaker prefixes
- Check if strict speaker matching in feature-02L is too restrictive and missing valid speakers

### 2. Trial Event Count Discrepancy  
**Current:** 6,515 trial events
**Baseline:** 12,480 trial events
**Difference:** -48%

**Root Cause:**
Trial events include statement events, so the same issue affects this count.

### 3. Line Count Difference
**Current:** 39,673 lines
**Baseline:** 38,550 lines  
**Difference:** +3% (1,123 extra lines)

**Potential Causes:**
- Multi-pass parser may be including blank lines or page headers as content lines
- Different handling of multi-line content
- CERTIFICATION section lines being counted differently

**Action Required:**
- Compare line-by-line output to identify extra lines
- Check if blank lines are being persisted
- Verify page header handling

### 4. Page Count Difference
**Current:** 1,529 pages
**Baseline:** 1,533 pages
**Difference:** -4 pages

**Action Required:**
- Identify which sessions are missing pages
- Check page detection logic in multi-pass parser

### 5. Missing Entity Parsing

The following entities are not being parsed at all:

#### Jurors (0 vs 39)
- Need to parse juror information from voir dire sections
- Pattern: "JUROR NO. X" or "PROSPECTIVE JUROR [NAME]"
- Reference: Legacy parser implementation

#### Law Firms (0 vs 6)
- Need to parse from APPEARANCES section
- Extract firm names below attorney names
- Create LawFirm entities and associations

#### Addresses (0 vs 7)  
- Need to parse from APPEARANCES section
- Extract addresses for law firms
- Create Address entities and LawFirmOffice associations

#### Court Reporter (0 vs 1)
- Need to parse from summary section
- Pattern: "COURT REPORTER:" or "OFFICIAL COURT REPORTER:"
- Create CourtReporter entity

## Implementation Priority

1. **Fix Statement/Trial Event Counts** (CRITICAL)
   - Debug why we're getting half the expected events
   - Check speaker detection in multi-pass parser
   - Verify statement aggregation logic

2. **Fix Line Count** (HIGH)
   - Each line may contain critical case information
   - 3% difference is too high for legal transcripts
   - Need exact line matching

3. **Implement Missing Entities** (MEDIUM)
   - Juror parsing
   - Law firm and address parsing  
   - Court reporter parsing

4. **Fix Page Count** (LOW)
   - 4 page difference is minor but should be fixed

## Testing Strategy

1. Create a small test file with known counts
2. Run both parsers and compare line-by-line
3. Identify exact differences
4. Fix discrepancies
5. Re-run full regression test

## Notes

- The phased design is correct: Phase 1 parses lines and identifies speakers, Phase 2 creates events with proper aggregation
- Statement aggregation is working as designed - consecutive lines from same speaker should be one statement
- The issue is likely in speaker detection, not aggregation logic