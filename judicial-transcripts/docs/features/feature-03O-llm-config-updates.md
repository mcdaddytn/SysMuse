# Feature-03O: LLM Configuration Updates for Trial Metadata

## Overview
Updates required for LLM-generated trial-metadata.json files to properly support ConditionalInsert and entity associations.

## Configuration Changes Required

### 1. Override Actions
- Change all entity `overrideAction` fields from `"Upsert"` to `"ConditionalInsert"`
- This prevents duplicate entities on repeated imports
- Exception: Addresses can use `"Upsert"` with `overrideKey: "fullAddress"`

### 2. Address Configuration
```json
{
  "overrideAction": "Upsert",
  "overrideKey": "fullAddress",
  "fullAddress": "Complete address string"
}
```
- Addresses should use Upsert to avoid duplicates
- Must specify `fullAddress` as the override key
- Ensures addresses are matched by their complete address string

### 3. Import Flags in Metadata
```json
"metadata": {
  "extractedAt": "...",
  "model": "...",
  "trialPath": "...",
  "userReviewed": true,
  "importAttorney": true,
  "importJudge": false,
  "importCourtReporter": false
}
```
- `importAttorney`: Default true - attorneys are trial-specific
- `importJudge`: Default false - judges often shared across trials
- `importCourtReporter`: Default false - court reporters often shared

### 4. TrialAttorney Records
Must generate TrialAttorney associations:
```json
"TrialAttorney": [
  {
    "id": 1,
    "trialId": 1,
    "attorneyId": 1,
    "speakerId": null,
    "role": "PLAINTIFF",
    "lawFirmId": 1,
    "lawFirmOfficeId": 1,
    "overrideAction": "ConditionalInsert",
    "overrideKey": "composite"
  }
]
```
- Links attorneys to specific trials with roles
- `speakerId`: Set to null (created during parsing)
- `role`: PLAINTIFF, DEFENDANT, THIRD_PARTY, or UNKNOWN
- `overrideAction`: Use ConditionalInsert
- `overrideKey`: Use "composite" (based on trialId+attorneyId unique constraint)

### 5. Entity Fingerprints
Ensure all entities have proper fingerprints:
- `attorneyFingerprint`: lastname_firstname format
- `lawFirmFingerprint`: normalized firm name
- `lawFirmOfficeFingerprint`: firmfingerprint_city format
- `judgeFingerprint`: lastname_firstname format
- `courtReporterFingerprint`: lastname_firstname format

## Implementation Notes

### ConditionalInsert Behavior
- Only inserts if entity doesn't exist
- Prevents duplicate entries on repeated imports
- Cascading entities (LawFirm, LawFirmOffice) only imported if parent entities are being imported

### Import Order
1. Addresses (no dependencies)
2. Trials (no dependencies)
3. LawFirms (imported if attorneys being imported)
4. LawFirmOffices (imported if law firms being imported)
5. Attorneys (based on importAttorney flag)
6. Judges (based on importJudge flag)
7. CourtReporters (based on importCourtReporter flag)
8. TrialAttorneys (links attorneys to trials)

### Testing Checklist
- [ ] First import creates all entities
- [ ] Second import skips existing entities (ConditionalInsert)
- [ ] Addresses don't duplicate (Upsert with fullAddress key)
- [ ] Import flags control which entities are imported
- [ ] TrialAttorney associations created correctly
- [ ] LawFirms/Offices imported when attorneys imported