# Feature 02M Implementation Guide

## Session Summary
In this session, we:
1. Implemented strict speaker matching from feature-02L
2. Discovered significant regression issues through systematic comparison
3. Created regression testing infrastructure
4. Identified root causes for discrepancies

## Key Achievements

### 1. Regression Testing Infrastructure
- Created `scripts/export-comparison-data.ts` to export parser output
- Created `scripts/compare-parsers.ts` for side-by-side comparison
- Established baseline data from legacy parser
- Documented repeatable testing process

### 2. Feature-02L Implementation
- Implemented strict speaker matching (no regex patterns)
- Reduced anonymous speakers from 92 to 2 (huge improvement!)
- Fixed false positive speaker detection

### 3. Issue Discovery
Through systematic comparison, we found:
- Complete session missing (JURY_VERDICT - 136 pages)
- Individual missing pages (4 pages)
- Statement event count at 50% of expected
- Line parsing differences

## Code Changes Made

### MultiPassContentParser.ts
- Replaced regex SPEAKER_PATTERNS with exact match COURT_OFFICIALS
- Implemented strict extractSpeaker() method
- Added attorney registry lookup
- Q/A patterns only valid during examination context

### SpeakerRegistry.ts
- Added `registerAttorney()` method
- Added `findAttorneyByHandle()` method
- Added attorneysByHandle Map for quick lookup

### ExaminationContextManager.ts
- Added `isInExamination()` method to validate Q/A context

## Regression Test Results

| Metric | Legacy | Multi-pass | Status |
|--------|--------|------------|--------|
| Pages | 1533 | 1529 | ❌ Missing 4 + entire session |
| Lines | 38,550 | 39,673 | ❌ +3% difference |
| Statement Events | 12,422 | 6,334 | ❌ -49% |
| Anonymous Speakers | 14 | 2 | ✅ Improved! |
| Attorneys | 19 | 16 | ❌ Missing 3 |
| Jurors | 39 | 0 | ❌ Not implemented |

## Root Causes Identified

### Missing JURY_VERDICT Session
- File exists but not being processed
- Filename pattern might not match: `(Bench Trial_Jury Verdict) be.txt`
- Needs investigation in file selection logic

### Statement Event Count
- Multi-pass aggregates ~6.8 lines per statement
- Legacy aggregates ~4.75 lines per statement
- Legacy might split on:
  - Page boundaries
  - Timestamp changes
  - After court directives
  - Other conditions beyond speaker changes

### Line Differences
- First lines completely different between parsers
- Suggests fundamental difference in line extraction
- May be related to page header handling

## Current Session Progress (Aug 31, 2025)

### Regression Testing Setup Complete
Successfully established clean baseline comparison between legacy and multi-pass parsers:

#### Clean Baseline Data
- Legacy parser: 1533 pages, 38550 lines, 20 speakers
- Multi-pass parser: 1529 pages, 39673 lines, 39 speakers
- JURY_VERDICT session: Correctly parsed (136 pages) but labeled as SPECIAL vs JURY_VERDICT

#### Critical Issues Identified
1. **Missing Last Pages** (4 pages total)
   - Session 2020-10-01 AFTERNOON: Missing page 157
   - Session 2020-10-05 AFTERNOON: Missing page 121  
   - Session 2020-10-06 MORNING: Missing page 142
   - Session 2020-10-08 MORNING: Missing page 109
   - Pattern: Always the last page of certain sessions

2. **Line Extraction Differences**
   - First lines completely different between parsers
   - Legacy starts with actual content (e.g., "Around the time of my joining...")
   - Multi-pass starts with numbers (e.g., "972...")
   - Indicates fundamental difference in line extraction logic

3. **Entity Parsing Gaps**
   - Law firms: 0 vs 6 (not implemented)
   - Addresses: 0 vs 7 (not implemented)
   - Court reporters: 0 vs 1 (not implemented)
   - Attorneys: 16 vs 19 (missing 3)

### Next Session Tasks

#### Immediate Fixes (Priority Order)
1. **Fix missing last pages**
   - Check page boundary detection in MultiPassMetadataExtractor
   - Verify end-of-file handling
   - Ensure last page of each session is captured

2. **Fix line extraction**
   - Compare line extraction logic between parsers
   - Multi-pass may be including line numbers as content
   - Ensure consistent line text extraction

3. **Run Phase 2 comparison**
   - After fixing above issues, run phase2 for both parsers
   - Compare statement aggregation (target: 12,422 statements)
   - Verify speaker identification improvements

## Lessons Learned

1. **Regression testing is critical** - We found major issues only through comparison
2. **Side-by-side comparison is essential** - Abstract metrics hide specific problems
3. **Legacy code is the specification** - It works correctly, we must match it
4. **Small differences matter** - 3% line difference is unacceptable for legal transcripts

## Reproducible Testing Process

### Clean Comparison Workflow
```bash
# 1. Clean baseline for legacy parser
npx prisma db push --force-reset && npm run seed
npx ts-node src/cli/parse.ts parse --phase1 --config config/example-trial-config-mac.json --parser-mode legacy
npx ts-node scripts/export-comparison-data.ts data-export-legacy

# 2. Clean baseline for multi-pass parser  
npx prisma db push --force-reset && npm run seed
npx ts-node src/cli/parse.ts parse --phase1 --config config/example-trial-config-mac.json --parser-mode multi-pass
npx ts-node scripts/export-comparison-data.ts data-export-multipass

# 3. Compare results
npx ts-node scripts/compare-parsers.ts data-export-legacy data-export-multipass
```

## Success Metrics for Completion

- [ ] All 1533 pages parsed (currently 1529 - missing 4)
- [ ] Lines match legacy ± 1% (currently +3% difference)
- [ ] Statement events: 12,422 ± 1% (requires phase2)
- [ ] All entity types parsed (missing law firms, addresses, court reporter)
- [ ] Regression test passes

## Files to Review Next Session

1. `src/parsers/MultiPassTranscriptParser.ts` - File selection logic
2. `src/parsers/TranscriptParser.ts` - Legacy statement creation
3. `src/parsers/Phase2Processor.ts` - Statement aggregation logic
4. `config/example-trial-config-mac.json` - File patterns