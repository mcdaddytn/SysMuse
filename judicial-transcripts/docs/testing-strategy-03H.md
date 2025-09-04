# Testing Strategy for Feature 03H: Entity Override System

## Overview
This document outlines the testing approach for the Entity Override System with LLM Extraction capabilities.

## Testing Phases

### Phase 1: Unit Testing
Test individual components in isolation.

#### 1.1 OverrideImporter Tests
```bash
# Test data validation
npx ts-node src/cli/override.ts import samples/invalid-data.json --validate-only

# Test correlation mapping
npx ts-node src/cli/override.ts import samples/test-correlations.json --verbose

# Test duplicate handling
npx ts-node src/cli/override.ts import samples/duplicate-entities.json
```

#### 1.2 Speaker Handle Generation Tests
```javascript
// Test cases for speaker handle generation
const testCases = [
  { input: "MR. JOHN SMITH", expected: "MR_JOHN_SMITH" },
  { input: "MS. JANE DOE-JONES", expected: "MS_JANE_DOE_JONES" },
  { input: "DR. ROBERT O'MALLEY", expected: "DR_ROBERT_OMALLEY" },
  { input: "THE HONORABLE JUDGE", expected: "THE_HONORABLE_JUDGE" }
];
```

### Phase 2: Integration Testing
Test component interactions and data flow.

#### 2.1 Import → Database → Export Cycle
```bash
# 1. Reset database
npx prisma db push --force-reset

# 2. Import test data
npx ts-node src/cli/override.ts import \
  docs/feature-assets/feature-03H/vocalife-complete-overrides.json

# 3. Export and verify
npx ts-node src/cli/override.ts export --trial-id 1 --output test-export.json

# 4. Compare import vs export
diff docs/feature-assets/feature-03H/vocalife-complete-overrides.json test-export.json
```

#### 2.2 LLM Extraction Testing
```bash
# Test with different providers (use test API keys)
export OPENAI_API_KEY="test-key"
npx ts-node src/cli/override.ts extract \
  --trial-path "output/multi-trial/42 Vocalife Amazon" \
  --provider openai \
  --model gpt-3.5-turbo \
  --save-prompt

# Verify prompt generation without API key
unset OPENAI_API_KEY
npx ts-node src/cli/override.ts regenerate \
  --trial-id 1 \
  --save-prompts
```

### Phase 3: End-to-End Testing
Test complete workflows with real data.

#### 3.1 Single Trial Workflow
```bash
# 1. Parse trial with multi-pass parser
npx ts-node src/cli/parse.ts parse --phase1 \
  --config config/example-trial-config-mac.json \
  --parser-mode multi-pass

# 2. Extract entities using LLM
npx ts-node src/cli/override.ts extract \
  --trial-path "output/multi-trial/42 Vocalife Amazon" \
  --provider openai \
  --model gpt-4 \
  --output overrides/vocalife-extracted.json

# 3. Import extracted entities
npx ts-node src/cli/override.ts import overrides/vocalife-extracted.json

# 4. Regenerate with refinements
npx ts-node src/cli/override.ts regenerate \
  --trial-id 1 \
  --use-existing \
  --save-prompts
```

#### 3.2 Batch Processing Test
```bash
# Process multiple trials
for trial in output/multi-trial/*; do
  echo "Processing $trial"
  npx ts-node src/cli/override.ts extract \
    --trial-path "$trial" \
    --output "overrides/$(basename "$trial").json" \
    --save-prompt
done
```

### Phase 4: Performance Testing

#### 4.1 Large Dataset Test
```bash
# Time import of large override file
time npx ts-node src/cli/override.ts import large-override-file.json

# Measure memory usage
/usr/bin/time -l npx ts-node src/cli/override.ts import large-override-file.json
```

#### 4.2 Concurrent Processing Test
```bash
# Test parallel extraction (simulated)
npx ts-node src/cli/override.ts extract --all-trials output/multi-trial
```

### Phase 5: Validation Testing

#### 5.1 Data Integrity Tests
- Verify all relationships are preserved
- Check for orphaned records
- Validate speaker handle uniqueness
- Confirm role assignments

#### 5.2 LLM Output Validation
```bash
# Validate extracted JSON structure
npx ts-node src/cli/override.ts extract \
  --trial-path "output/multi-trial/42 Vocalife Amazon" \
  --output test-extraction.json

# Use JSON schema validation
ajv validate -s schemas/override-schema.json -d test-extraction.json
```

## Test Data Sets

### Minimal Test Set
- Single trial with 2 attorneys
- One law firm, one address
- Judge and court reporter

### Standard Test Set  
- Vocalife trial (19 attorneys, 6 firms)
- Complete entity relationships
- Multiple offices per firm

### Edge Cases Test Set
- Attorneys with same name
- Missing middle names/initials
- Special characters in names
- Multiple trials with shared attorneys

## Automated Test Commands

### Quick Validation Suite
```bash
# Run all validation tests
npm run test:override:validate
```

### Full Test Suite
```bash
# Complete test run
npm run test:override:full
```

## Success Criteria

### Functional Requirements
- [ ] All entity types can be imported
- [ ] Relationships are correctly mapped
- [ ] Speaker handles match consistently
- [ ] LLM extraction produces valid JSON
- [ ] Export preserves all data

### Performance Requirements
- [ ] Import: < 1 second for 100 entities
- [ ] Export: < 2 seconds for complete trial
- [ ] LLM extraction: < 30 seconds per trial
- [ ] Batch processing: Linear scaling

### Data Quality Requirements
- [ ] 100% relationship preservation
- [ ] No duplicate speakers created
- [ ] Consistent ID correlation
- [ ] Valid JSON output
- [ ] Proper error reporting

## Error Scenarios to Test

1. **Invalid JSON Format**
   - Malformed JSON
   - Missing required fields
   - Type mismatches

2. **Relationship Errors**
   - Missing referenced entities
   - Circular dependencies
   - Invalid role assignments

3. **LLM Failures**
   - API key missing
   - Rate limiting
   - Invalid model name
   - Network timeout

4. **Database Conflicts**
   - Duplicate case numbers
   - Unique constraint violations
   - Transaction failures

## Regression Testing

After any changes:
1. Run minimal test set
2. Verify prompt generation
3. Check speaker handle generation
4. Validate relationship mapping
5. Test export/import cycle

## Manual Testing Checklist

- [ ] Import sample override file
- [ ] Generate prompts for one trial
- [ ] Review generated prompt quality
- [ ] Test with each LLM provider
- [ ] Verify database state after import
- [ ] Export and reimport data
- [ ] Check speaker handle consistency
- [ ] Validate attorney-firm relationships

## Monitoring and Logging

### Key Metrics to Track
- Import success rate
- LLM extraction accuracy
- Processing time per trial
- API usage per provider
- Error frequency by type

### Log Analysis Commands
```bash
# Check for import errors
grep "ERROR" logs/override-*.log

# Count successful extractions
grep "Extraction successful" logs/llm-*.log | wc -l

# Monitor API usage
grep "API call" logs/llm-*.log | grep -c "provider:"
```