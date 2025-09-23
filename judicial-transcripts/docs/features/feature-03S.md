# Feature-03S: Improved Juror Handling and Persistence

## Overview
Enhance the parsing and persistence of juror records to properly handle special juror roles and resolve speaker reconciliation issues.

## Problem Statement
1. Special jurors (THE FOREPERSON, THE PRESIDING OFFICER) are not being persisted correctly with null name/lastName/alias fields
2. Other juror conventions (THE PANEL MEMBER, VENIRE MEMBER) need proper handling
3. Database integrity errors occur when juror names match attorney naming conventions (e.g., "MR. SMITH")
4. Juror records need consistent persistence across different trial conventions

## Requirements

### 1. Special Juror Persistence
Persist special jurors with proper name parsing:

#### THE FOREPERSON
- name: 'THE'
- lastName: 'FOREPERSON'
- alias: 'THE FOREPERSON'
- Role: Special juror who announces verdict (used for Jury Verdict section detection)

#### THE PRESIDING OFFICER
- name: 'THE'
- lastName: 'PRESIDING OFFICER'
- alias: 'THE PRESIDING OFFICER'
- Role: Same as THE FOREPERSON (verdict announcer)

### 2. Regular Juror Convention Handling
Handle additional juror naming conventions:

#### VENIRE MEMBER
- name: 'VENIRE'
- lastName: 'MEMBER'
- alias: 'VENIRE MEMBER'

#### THE PANEL MEMBER
- name: 'THE'
- lastName: 'PANEL MEMBER'
- alias: 'THE PANEL MEMBER'

#### Numbered Panel Members
- Example: "PANEL MEMBER NO. 19"
- Parse appropriately while maintaining the full alias

### 3. Attorney/Juror Name Collision Resolution
- When a speaker format matches attorney convention (e.g., "MR. SMITH")
- First check if it matches an existing attorney in the trial
- If no attorney match, check against juror aliases
- Properly reconcile as juror to avoid database integrity errors

## Implementation Details

### Database Schema
No schema changes required. Using existing fields:
- `name`: First part of parsed name
- `lastName`: Last part of parsed name
- `alias`: Full original text as it appears in transcript

### Affected Components
1. **Parser**: Update juror name parsing logic
2. **Speaker Reconciliation**: Add juror check before attorney matching
3. **Person Service**: Ensure proper juror persistence
4. **Jury Verdict Detection**: Maintain compatibility with special juror roles

### Testing Trials
- Trials 73 & 83: Test "THE PRESIDING OFFICER" handling
- Any trial with "THE FOREPERSON": Test standard special juror
- Trials with jury selection: Test attorney/juror collision cases

## Success Criteria
1. All special jurors persist with proper name/lastName/alias values
2. No database integrity errors during juror/attorney name collisions
3. Jury Verdict section detection continues to work with special jurors
4. All juror naming conventions handled consistently

## Implementation Steps
1. Update juror parsing logic in phase1 parser
2. Modify speaker reconciliation to check jurors before attorneys
3. Add proper name parsing for special juror formats
4. Test with specified trials
5. Verify Jury Verdict section detection still works

## Notes
- THE FOREPERSON and THE PRESIDING OFFICER are functionally equivalent (verdict announcers)
- Regular jurors use various conventions but don't have special roles
- Maintain backward compatibility with existing jury verdict detection patterns