# Feature 03I Implementation Status

## Feature: Fix Attorney-Speaker Association with Metadata Enhancement

**Status**: NOT STARTED  
**Priority**: HIGH  
**Blocked By**: None  
**Estimated Effort**: Medium (4-6 hours)

## Problem Summary

Attorney speakers created during Phase 2 parsing are not properly associated with attorney records and don't receive metadata enhancement from LLM-generated data.

## Current Issues

### 1. Duplicate Speakers (CRITICAL)
- Same attorney has multiple speaker records
- Example: "MR. KELLMAN" (no attorney) and "MR. KELLMAN" (with attorney)
- Example: "MS. NOWIERSKI" and "MR. NOWIERSKI" for same person

### 2. Missing Attorney Associations (CRITICAL)
- Speakers like "MR. KELLMAN", "MR. DAVIS", "MR. IVEY" have no attorney records
- These should match metadata and create enhanced attorney records

### 3. Wrong Gender Prefixes (HIGH)
- Female attorneys showing as "MR." (e.g., "MR. NOWIERSKI" for Ms. Lauren Nowierski)
- Caused by incorrect parsing of APPEARANCES section

### 4. No Fingerprint Enhancement (HIGH)
- Attorneys created without fingerprints from metadata
- Prevents cross-trial attorney matching

## Work Completed

✅ Attorney metadata loading in AttorneyService  
✅ Fingerprint and speakerPrefix matching logic  
✅ Metadata enhancement logic in createOrUpdateAttorney  
✅ Configuration flag for enabling metadata (useAttorneyMetadata)  

## Work Required

### Phase 2 Processor Integration
**File**: `src/parsers/Phase2Processor.ts`
- [ ] Add AttorneyService initialization with trialStyleConfig
- [ ] Replace direct speaker creation with AttorneyService calls
- [ ] Pass attorney role information through processing

### Speaker Registry Updates
**File**: `src/services/speakers/SpeakerRegistry.ts`
- [ ] Add attorney matching before creating new speakers
- [ ] Implement speaker deduplication logic
- [ ] Add fingerprint-based consolidation

### Summary Parser Fix
**File**: `src/parsers/SummaryPageParser.ts` (or relevant parser)
- [ ] Fix gender prefix extraction from APPEARANCES
- [ ] Extract complete attorney information
- [ ] Pass full attorney data to AttorneyService

### Testing
- [ ] Test with "04 Intellectual Ventures" trial
- [ ] Verify all 19 attorneys properly associated
- [ ] Verify fingerprints applied from metadata
- [ ] Verify no duplicate speakers

## Implementation Notes

### Key Integration Point
```typescript
// Phase2Processor needs to change from:
const speaker = await this.createSpeaker(prefix, type);

// To:
if (type === 'ATTORNEY') {
  const attorneyService = new AttorneyService(this.prisma, this.config);
  await attorneyService.createOrUpdateAttorney(trialId, attorneyInfo, role);
}
```

### Metadata File Location
- Default: `./output/multi-trial/attorney-metadata.json`
- Contains 91 attorneys across 8 trials
- Loaded automatically when `useAttorneyMetadata: true` in trialstyle.json

## Risks

1. **Breaking Change**: Modifying Phase2Processor could affect existing parsing
2. **Performance**: Additional attorney lookups may slow parsing
3. **Data Migration**: Existing incorrectly parsed data needs cleanup

## Success Criteria

1. Single speaker record per attorney
2. All attorney speakers have associated attorney records
3. Correct gender prefixes for all attorneys
4. Fingerprints populated from metadata
5. Cross-trial attorney matching works

## Related Documentation

- Feature Spec: `/docs/features/feature-03I.md`
- Attorney Metadata Implementation: `/docs/impl/attorney-metadata-implementation.md`
- Commands Reference: `/COMMANDS-QUICK-REFERENCE.md`

## Next Steps

1. Review Phase2Processor to understand current speaker creation flow
2. Implement AttorneyService integration in Phase2Processor
3. Fix summary parser gender prefix extraction
4. Test with full "04 Intellectual Ventures" trial
5. Clean up existing incorrect data

## Database Cleanup Required

After implementation, run:
```bash
# Clean up incorrect records
npx ts-node scripts/cleanup-incorrect-records.ts --force

# Re-import metadata
npx ts-node scripts/import-attorney-metadata.ts

# Re-run parsing
npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json --parser-mode multi-pass
npx ts-node src/cli/parse.ts parse --phase2 --config config/multi-trial-config-mac.json
```