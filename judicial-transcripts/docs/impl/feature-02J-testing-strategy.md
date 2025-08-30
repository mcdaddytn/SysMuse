# Feature 02J Testing Strategy: Multi-Pass Parser Regression Testing

## Current Issues Identified

### 1. Critical Problems
- **Wrong Trial Creation**: Creating "MULTI-PASS-TEST" trial instead of using actual trial from config
- **Only 2 Sessions**: Processing only 2 of 12 transcript files
- **Page Header Parsing**: Not correctly extracting page headers
- **Document Section Detection**: All lines marked as UNKNOWN instead of SUMMARY/PROCEEDINGS/CERTIFICATION
- **Not Starting in SUMMARY**: Should begin with SUMMARY section detection

### 2. Expected Behavior (from Legacy Parser)
- Should process all 12 transcript files in the directory
- Should use existing trial or create proper trial from transcript metadata
- Should correctly identify document sections
- Should match baseline record counts from `docs/baseline-record-counts.md`

## Testing Strategy

### Phase 1: Fix Critical Issues

#### 1.1 Trial and Session Management
```typescript
// WRONG - Current Implementation
const newTrial = await prisma.trial.create({
  data: {
    name: 'Multi-Pass Parser Test',
    caseNumber: 'MULTI-PASS-TEST',
    // ...
  }
});

// CORRECT - Should Use Legacy Parser Logic
// 1. Check for existing trial by case number
// 2. Parse case information from SUMMARY section
// 3. Create trial with actual case data
```

**Fix Location**: `src/cli/parse.ts` lines 123-140

#### 1.2 Process All Files
- Current: Stops after 2 files
- Expected: Process all 12 files
- Fix: Complete the loop through all files

#### 1.3 Document Section Detection
- Current: All lines marked as UNKNOWN
- Expected: SUMMARY → PROCEEDINGS → CERTIFICATION
- Fix: `MultiPassStructureAnalyzer.ts` - Start with SUMMARY detection

### Phase 2: Regression Testing Framework

#### 2.1 Create Comparison Script
```bash
#!/bin/bash
# scripts/compare-parsers.sh

echo "=== Parser Comparison Test ==="

# 1. Backup current state
./db/backupdb.sh current-state

# 2. Run Legacy Parser
echo "Running Legacy Parser..."
npx prisma db push --force-reset
npm run seed
npm run cli parse --phase1 --config config/example-trial-config-mac.json --parser-mode legacy
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts \
  -c "SELECT 'Legacy Results:' as parser; \
      SELECT table_name, COUNT(*) FROM information_schema.tables \
      WHERE table_schema = 'public' GROUP BY table_name;" > legacy-counts.txt

# 3. Run Multi-Pass Parser  
echo "Running Multi-Pass Parser..."
npx prisma db push --force-reset
npm run seed
npm run cli parse --phase1 --config config/example-trial-config-mac.json --parser-mode multi-pass
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts \
  -c "SELECT 'Multi-Pass Results:' as parser; \
      SELECT table_name, COUNT(*) FROM information_schema.tables \
      WHERE table_schema = 'public' GROUP BY table_name;" > multipass-counts.txt

# 4. Compare Results
diff legacy-counts.txt multipass-counts.txt
```

#### 2.2 Key Metrics to Compare

| Metric | Baseline (Legacy) | Multi-Pass | Status |
|--------|------------------|------------|--------|
| Trials | 1 | ? | ❌ |
| Sessions | 12 | 2 | ❌ |
| Pages | 1533 | 4 | ❌ |
| Lines | 38550 | 4236 | ❌ |
| Speakers | 81 | ? | ❌ |
| SessionSections | 108 | ? | ❌ |

### Phase 3: Detailed Testing Points

#### 3.1 Page Header Detection Tests
```typescript
// Test Cases for MultiPassMetadataExtractor
describe('Page Header Detection', () => {
  it('should detect single-line headers: "1    UNITED STATES DISTRICT COURT    1"');
  it('should detect multi-line headers across 3 lines');
  it('should extract correct page numbers');
  it('should handle headers with PageID');
});
```

#### 3.2 Section Detection Tests
```typescript
// Test Cases for MultiPassStructureAnalyzer
describe('Section Detection', () => {
  it('should start with SUMMARY section');
  it('should detect PROCEEDINGS after SUMMARY');
  it('should detect CERTIFICATION at end');
  it('should handle sections spanning multiple pages');
});
```

#### 3.3 Content Parsing Tests
```typescript
// Test Cases for MultiPassContentParser
describe('Content Parsing', () => {
  it('should extract speakers correctly');
  it('should parse timestamps in PROCEEDINGS');
  it('should extract attorney information from SUMMARY');
  it('should create correct number of lines per page');
});
```

### Phase 4: Implementation Fixes Priority

1. **IMMEDIATE** (Blocking all testing):
   - Fix trial creation to use actual case data
   - Process all 12 files, not just 2
   - Fix section detection to start with SUMMARY

2. **HIGH** (Core functionality):
   - Fix page header detection patterns
   - Correct line prefix extraction
   - Proper speaker identification

3. **MEDIUM** (Data accuracy):
   - Session metadata extraction
   - Attorney/Judge/Court Reporter parsing
   - Timestamp parsing

### Phase 5: Validation Checkpoints

#### 5.1 Quick Validation (After Each Fix)
```sql
-- Run after each fix to check progress
SELECT 
  'Sessions' as entity, COUNT(*) as count FROM "Session"
UNION ALL
SELECT 'Pages', COUNT(*) FROM "Page"  
UNION ALL
SELECT 'Lines', COUNT(*) FROM "Line"
UNION ALL
SELECT 'Lines-SUMMARY', COUNT(*) FROM "Line" WHERE "documentSection" = 'SUMMARY'
UNION ALL
SELECT 'Lines-PROCEEDINGS', COUNT(*) FROM "Line" WHERE "documentSection" = 'PROCEEDINGS'
UNION ALL
SELECT 'Lines-UNKNOWN', COUNT(*) FROM "Line" WHERE "documentSection" = 'UNKNOWN';
```

#### 5.2 Full Regression Test
Compare against `docs/baseline-record-counts.md`:
- Total records: 65,560
- All 31 tables should match

### Phase 6: Debug Output Analysis

Enable debug output to diagnose issues:
```bash
npm run cli parse --phase1 \
  --config config/example-trial-config-mac.json \
  --parser-mode multi-pass \
  --debug-output
```

Check debug files in `debug-output/` directory:
- `metadata-*.json` - Verify page and line extraction
- `structure-*.json` - Verify section boundaries

## Success Criteria

### Minimum Viable Fix
- [ ] Processes all 12 transcript files
- [ ] Creates correct trial (not test trial)
- [ ] Identifies SUMMARY sections
- [ ] Identifies PROCEEDINGS sections
- [ ] Creates ~38,550 lines (±5%)

### Full Success
- [ ] All record counts match baseline within 1%
- [ ] Document sections correctly identified
- [ ] Page headers properly extracted
- [ ] Speakers correctly identified
- [ ] All tests pass

## Next Session Action Items

1. **Fix Trial Logic**: 
   - Copy trial creation logic from `TranscriptParser.ts`
   - Use actual case metadata

2. **Fix File Processing**:
   - Ensure all 12 files are processed
   - Check for early exit conditions

3. **Fix Section Detection**:
   - Default to SUMMARY for first ~100 lines
   - Implement proper state transitions

4. **Run Regression Test**:
   - Execute comparison script
   - Document differences
   - Iterate on fixes

## Commands for Next Session

```bash
# 1. Check current state
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts \
  -c "SELECT COUNT(*) FROM \"Session\";"

# 2. Reset and test legacy parser
npx prisma db push --force-reset
npm run seed
npm run cli parse --phase1 --config config/example-trial-config-mac.json --parser-mode legacy

# 3. Check legacy results
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts \
  -c "SELECT table_name, COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' GROUP BY table_name ORDER BY table_name;"

# 4. Reset and test multi-pass parser
npx prisma db push --force-reset  
npm run seed
npm run cli parse --phase1 --config config/example-trial-config-mac.json --parser-mode multi-pass

# 5. Compare results
# Should match baseline in docs/baseline-record-counts.md
```

## Reference Files

- **Baseline Counts**: `docs/baseline-record-counts.md`
- **Legacy Parser**: `src/parsers/TranscriptParser.ts` (reference implementation)
- **Multi-Pass Parser**: `src/parsers/MultiPassTranscriptParser.ts` (needs fixes)
- **Test Script**: `scripts/test-multi-pass.sh`
- **Config**: `config/example-trial-config-mac.json`

## Conclusion

The multi-pass parser architecture is sound, but the implementation has critical bugs:
1. Not using the existing parser's trial/session management logic
2. Not processing all files
3. Not detecting document sections correctly

These are fixable issues that require aligning the multi-pass implementation with the legacy parser's proven logic while maintaining the clean separation of concerns.