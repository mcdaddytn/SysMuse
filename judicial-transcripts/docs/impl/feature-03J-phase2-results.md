# Phase 2 Testing Results

## Current Issue
Phase2 is creating duplicate attorneys instead of using existing ones from overrides.

## What Happened

### Before Phase2
- 19 attorneys from overrides (with speaker prefixes like "MR. BAXTER")
- 0 speakers
- 0 TrialAttorney associations

### After Phase2 Started
- 34 attorneys (15 new ones created)
- 41 speakers created
- 0 TrialAttorney associations (still broken)

## The Problem

Phase2Processor creates attorneys from session metadata without checking for existing attorneys:

1. **Duplicate Creation**: 
   - Override has: "Mr. Samuel F. Baxter" with prefix "MR. BAXTER"
   - Phase2 created: "Jeffery D. Baxter" with speaker linked to "MR. BAXTER"
   
2. **No Fingerprint Matching**:
   - Phase2 doesn't check attorneyFingerprint before creating
   - Doesn't match by speakerPrefix either

3. **Missing TrialAttorney Links**:
   - Override imports don't create TrialAttorney associations
   - Phase2 creates attorneys but also doesn't link them properly

## Root Cause

In `Phase2Processor.ts` around line 340-366:
```typescript
// Creates new attorney without checking for existing ones
const attorney = await tx.attorney.create({
  data: {
    name: attorneyData.name,
    // ... other fields
    speakerId: speaker.id
  }
});
```

Should instead:
1. Check for existing attorney by fingerprint or speakerPrefix
2. If found, update to link speaker
3. If not found, create new
4. Always create TrialAttorney association

## Required Fix for Phase2

Phase2Processor needs to:
1. Generate fingerprint for attorney from session metadata
2. Check if attorney exists with that fingerprint
3. If exists:
   - Create speaker and link to existing attorney
   - Create TrialAttorney association
4. If not exists:
   - Create new attorney with speaker
   - Create TrialAttorney association

## Workaround for Testing

To properly test speaker identification with current code:
1. Reset database
2. Import overrides (creates attorneys with prefixes)
3. Manually create TrialAttorney associations
4. Run phase1 (extracts lines with prefixes)
5. Modify Phase2 to use existing attorneys
6. Run phase2

## Next Feature Needed

A new feature is needed to properly integrate overrides with the workflow:
- Override import should create TrialAttorney associations
- Phase2 should check for existing attorneys before creating
- Workflow should support override-based initialization