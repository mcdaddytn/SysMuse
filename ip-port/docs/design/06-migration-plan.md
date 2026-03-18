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

<!-- Add other components to keep -->

### Database Data

<!-- What data should be preserved through any migration -->

## What to Refactor

<!-- Components that need significant changes but not removal -->

## What to Remove/Rollback

<!-- Components that should be removed or rolled back -->

## Migration Steps

### Phase 1: Schema Changes

<!-- Database schema migrations needed -->

### Phase 2: Service Refactoring

<!-- Backend service changes -->

### Phase 3: API Updates

<!-- API endpoint changes -->

### Phase 4: UI Updates

<!-- Frontend changes -->

### Phase 5: Data Migration

<!-- Data transformation/migration scripts -->

## Testing Strategy

<!-- How to verify the migration is successful -->

## Rollback Procedure

If migration fails:

1. Stop services
2. `git checkout 2200be07b4bb6ed1fcb43c268f22f1dac71cd3c7`
3. Restore database from backup
4. Restart services

<!-- More detailed rollback steps -->
