# Feature 02M: Multi-pass Parser Regression Fixes

## Overview
Fix critical regression issues found when comparing multi-pass parser output to legacy parser baseline.

## Current Status
We have successfully set up side-by-side comparison infrastructure and identified specific issues.

## Critical Issues Found

### 1. Missing JURY_VERDICT Session (136 pages)
- **File**: `NOTICE OF FILING OF OFFICIAL TRANSCRIPT of Proceedings held on 10_8_20 (Bench Trial_Jury Verdict) be.txt`
- **Impact**: Entire session not being parsed by multi-pass parser
- **Root Cause**: Unknown - needs investigation

### 2. Missing Individual Pages (4 pages)
- Page 157 from 10/1/20 Afternoon session
- Page 121 from 10/5/20 Afternoon session  
- Page 142 from 10/6/20 Morning session
- Page 109 from 10/8/20 Morning session
- **Pattern**: Last page of each session might be missing

### 3. Statement Event Count (6,334 vs 12,422 baseline)
- **Finding**: Multi-pass creates half the statement events
- **Average lines per statement**: 6.8 (multi) vs 4.75 (legacy)
- **Root Cause**: Multi-pass is aggregating more aggressively
- **Investigation Needed**: Determine if legacy parser splits on additional conditions (page boundaries, timestamps, etc.)

### 4. Line Count Difference (+1,123 lines)
- Multi-pass: 39,673 lines
- Legacy: 38,550 lines
- **Difference**: +3% extra lines
- **Issue**: Line content completely different (line numbers don't match)

### 5. Missing Entity Parsing
- **Jurors**: 0 vs 39 baseline
- **Law Firms**: 0 vs 6 baseline
- **Addresses**: 0 vs 7 baseline
- **Court Reporter**: 0 vs 1 baseline
- **Attorney Count**: 16 vs 19 baseline

## Comparison Infrastructure Created

### Export Script
- `scripts/export-comparison-data.ts` - Exports parser output to JSON
- `scripts/compare-parsers.ts` - Compares legacy vs multi-pass output

### Data Directories
- `data-export-legacy/` - Legacy parser output
- `data-export-multipass/` - Multi-pass parser output

### Files Exported
- `statistics.json` - Record counts for all tables
- `pages.json` - All pages with session info
- `lines-first-1000.json` - First 1000 lines
- `lines-last-1000.json` - Last 1000 lines
- `statements-sample.json` - First 500 statement events
- `speakers.json` - All speakers

## Regression Testing Process

1. **Reset database**: `npx prisma db push --force-reset`
2. **Seed database**: `npm run seed`
3. **Run legacy parser**:
   - `npx ts-node src/cli/parse.ts parse --phase1 --config config/example-trial-config-mac.json --parser-mode legacy`
   - `npx ts-node src/cli/parse.ts parse --phase2 --config config/example-trial-config-mac.json --trial-id 1`
4. **Export legacy data**: `npx ts-node scripts/export-comparison-data.ts data-export-legacy`
5. **Reset and run multi-pass parser**:
   - Reset DB and seed
   - `npx ts-node src/cli/parse.ts parse --phase1 --config config/example-trial-config-mac.json --parser-mode multi-pass`
   - Run phase2
6. **Export multi-pass data**: `npx ts-node scripts/export-comparison-data.ts data-export-multipass`
7. **Compare**: `npx ts-node scripts/compare-parsers.ts`

## Priority Fixes

### High Priority
1. Fix missing JURY_VERDICT session parsing
2. Fix missing individual pages (last page detection)
3. Investigate statement event creation logic

### Medium Priority
1. Fix line count discrepancy
2. Implement juror parsing
3. Fix attorney count

### Low Priority
1. Implement law firm parsing
2. Implement address parsing
3. Implement court reporter parsing

## Next Steps

1. Debug why JURY_VERDICT session file isn't being processed
2. Check page boundary detection in multi-pass parser
3. Analyze statement creation conditions in legacy parser
4. Implement missing entity parsers based on legacy code

## Success Criteria

- All sessions and pages parsed (1533 pages)
- Statement events within 1% of baseline (12,422 ± 124)
- Line count within 1% of baseline (38,550 ± 385)
- All entity types parsed (jurors, law firms, etc.)
- Anonymous speakers reduced (target: 2-6)