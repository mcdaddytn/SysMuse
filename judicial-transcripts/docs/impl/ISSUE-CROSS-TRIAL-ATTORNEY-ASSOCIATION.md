# Cross-Trial Attorney Association Issue

## Problem Statement

Attorneys who appear in multiple trials are not being properly associated across trials, leading to phase3 statement detection failures. Specifically, MR. DACUS appears in multiple trials but is not being correctly identified in the "12 Gree Supercell" trial, causing defense opening statements to not be found.

## Current Behavior

### Database Structure
- **Attorney** table: Shared across all trials (uses `attorneyFingerprint` for deduplication)
- **TrialAttorney** table: Per-trial attorney records linking Attorney to specific trials
- **Speaker** table: Per-trial speaker records for transcript parsing

### Observed Issue in Gree Supercell Trial (ID: 5)

1. MR. DACUS has a TrialAttorney record but with role `THIRD_PARTY` instead of correct side (PLAINTIFF/DEFENDANT)
2. The attorney association is present but the role is incorrect
3. This causes phase3 to not find defense opening statements as it filters by attorney role

```json
{
  "id": 61,
  "trialId": 5,
  "attorneyId": 2,
  "speakerId": 216,
  "role": "THIRD_PARTY",  // Should be DEFENDANT
  "attorney": {
    "name": "Deron R. Dacus",
    "speakerPrefix": "MR. DACUS",
    "attorneyFingerprint": "dacus_deron"
  }
}
```

## Root Cause

MR. DACUS is not present in the trial-metadata.json file that seeds attorney information. The LLM metadata extraction is only parsing limited pages from the PDF, missing the attorney introduction section.

## Prescribed Solution

### Step 1: Create trialstyle.json Override

Create a `trialstyle.json` file in the PDF source directory for the trial with the following content:

```json
{
  "llmParsePages": 3
}
```

This will override the default LLM parsing parameters to include more pages.

### Step 2: File Placement

Place the `trialstyle.json` file at:
```
/Users/gmcaveney/GrassLabel Dropbox/Grass Label Home/docs/transcripts/pdf/12 Gree Supercell/trialstyle.json
```

### Step 3: Regenerate Metadata

Run the LLM metadata extraction to regenerate `trial-metadata.json`:

```bash
# Command to regenerate metadata with LLM parsing
npm run generate-metadata --trial "12 Gree Supercell"
```

### Step 4: Verify Attorney Presence

Check that MR. DACUS is now present in the regenerated metadata with correct role assignment.

### Step 5: Re-import Trial

Delete and re-import the trial to properly seed attorney associations:

```bash
# Delete trial
npx ts-node src/cli/delete-trial.ts delete "12 Gree Supercell" --force

# Re-run phase1 with updated metadata
npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json
```

## Implementation Notes

### Attorney Association Logic

The system should follow this hierarchy for attorney association:

1. **Attorney Record**:
   - Shared across trials via `attorneyFingerprint`
   - Created once per unique attorney

2. **TrialAttorney Record**:
   - Created per trial
   - Links Attorney to specific trial with role (PLAINTIFF/DEFENDANT)
   - Must have correct role for phase3 detection

3. **Speaker Record**:
   - Created per trial during phase2
   - Linked to TrialAttorney via `speakerId`

### Phase2 Association Process

When Phase2Processor encounters an attorney speaker:

1. Check if speaker pattern matches attorney prefix (MR./MS./MRS./DR. LASTNAME)
2. Look up TrialAttorney by speakerPrefix within trial scope
3. If TrialAttorney exists without speakerId, create/link Speaker
4. If no TrialAttorney exists, create unlinked Speaker (warning condition)

### Fingerprint Matching

Attorney fingerprints should enable cross-trial matching:
- Format: `lastname_firstname` (lowercase)
- Example: `dacus_deron`
- Allows same Attorney record to be used across multiple trials

## Verification Steps

After implementation, verify:

1. **Metadata Check**:
   ```bash
   cat output/multi-trial/12\ Gree\ Supercell/trial-metadata.json | grep -i dacus
   ```

2. **Database Check**:
   ```sql
   SELECT ta.*, a.name, a.speakerPrefix
   FROM TrialAttorney ta
   JOIN Attorney a ON ta.attorneyId = a.id
   WHERE ta.trialId = 5 AND a.speakerPrefix LIKE '%DACUS%';
   ```

3. **Phase3 Check**:
   ```bash
   cat output/longstatements/12\ Gree\ Supercell/opening-evaluation.json
   ```
   Should show defense opening statements found

## Related Issues

- Attorney-speaker association fixed in commit a63fcd6
- Recent regression where association logic was bypassed
- Cross-trial attorney deduplication via fingerprints

## Future Improvements

1. **Automatic Page Detection**: Implement logic to automatically determine how many pages to parse for attorney extraction
2. **Attorney Role Inference**: Better logic to infer attorney role from context if not explicit in metadata
3. **Validation**: Add validation to ensure all TrialAttorney records have valid roles (not THIRD_PARTY unless intended)
4. **Cross-Trial Report**: Tool to show which attorneys appear in multiple trials and their roles

## References

- Original issue: `docs/impl/ISSUE-ATTORNEY-SPEAKER-ASSOCIATION.md`
- Trial metadata format: `docs/transcript-conventions.md`
- Phase2 processor: `src/parsers/Phase2Processor.ts`
- Phase3 argument finder: `src/phase3/ArgumentFinder.ts`