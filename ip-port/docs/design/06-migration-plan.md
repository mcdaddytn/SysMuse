# Migration Plan & Rollback Strategy

## Rollback Point

**Safe rollback commit:** `2200be07b4bb6ed1fcb43c268f22f1dac71cd3c7` (Feb 26, 2026)

This commit predates all major Phase 3 changes. If needed, we can revert to this state.

Note: Commit `a844af6f` is unrelated (patent download Java project).

## What to Keep

### Structured Question Prompt Files

The JSON template files created for structured questions are valuable and should be retained with potential minor structural changes:

- `data/scoring-templates/*.json`
- Question definitions, scoring rubrics, etc.

There will be no need to remove or change any of these during the migration.  After system is stabilized we may refactor templates, adding questions or rearranging taxonomical levels at which questions are asked - during the major migration, we are just changing structure of the data.

### Database Data

All data should be preserved although some may be refactored and copied in to new table structures.

## What to Refactor

We are refactoring the taxonomy (super-sectors, sectors, sub-sectors becoming more generalized taxonomy), adding associations to taxonomy from patent and potentially other entities to be added in the future and decoupling direct classification fields in entities like the patent - through joins we can link to taxonomical entities to fulfil current functionality of super-sector/sector/sub-sector associations for patents - allowing a single taxonomical classification (with multiple hierarhcical levels) with our new schema allowing more flexible associations in the future.

## What to Remove/Rollback

We were working on normalization and refactoring the scoring screens - and we are continuing that effort based on specifications here - so perhaps recent changes would be rolled back if easier to reconcile with new requirements - but I am not sure if that is necessary - it might be just as easy to move forward with current changes.


## Migration Steps

### Phase 1: Schema Changes

<!-- Database schema migrations needed -->

More generalized taxonomy
More generalized scoring
Moving taxonomical fields from direct entities like patent to new joinable tables

Implement prefixes within taxonomy so everything identifier is unique globalkly
Make sure we have "general" category that is catch all at every level, so we have mutually exclusive and collectively exhaustive


### Phase 2: Service Refactoring
<!-- Backend service changes -->
Supporting the refactoring presented in these docs collectively
Adding more flexibility in snapshot creation and expansion

Early on, we want services that can be used for claude skills to query data in an existing instance
We will use the services on a working instance to do regresssion testing as we change and enhance the model for more flexibility


### Phase 3: API Updates
<!-- API endpoint changes -->
Supporting the refactoring presented in these docs collectively

### Phase 4: UI Updates
<!-- Frontend changes -->
Supporting the refactoring presented in these docs collectively

### Phase 5: Data Migration
<!-- Data transformation/migration scripts -->
Supporting the refactoring presented in these docs collectively

## Testing Strategy
<!-- How to verify the migration is successful -->
We should be able to create new v2 scoring snapshots expanding from existing scores with normalization to older scores.  From there we should be able to enrich using this scoring snapshot after applying as default.


## Rollback Procedure

If migration fails:

1. Stop services
2. `git checkout 2200be07b4bb6ed1fcb43c268f22f1dac71cd3c7`
3. Restore database from backup
4. Restart services

<!-- More detailed rollback steps -->
