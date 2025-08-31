# Feature 03B: Fix TypeScript Compilation Errors

## Overview
Clean up existing TypeScript compilation errors to ensure the entire codebase compiles without errors. Most errors are in test files and outdated service methods that need to be updated or removed.

## Current Compilation Errors Analysis

### 1. API Server Errors (2 errors)
**Files:** `src/api/server.ts`
**Error:** `startTime` does not exist in type `MarkerOrderByWithRelationInput`
- Line 86, 269
- **Cause:** Schema change - Marker model likely doesn't have startTime field anymore
- **Fix:** Update to use correct field name or remove ordering by startTime

### 2. Test File Errors - runAllTests.ts (12 errors)
**File:** `src/scripts/tests/runAllTests.ts`
**Errors:**
- `queryName` does not exist in type `ElasticSearchQuery` (5 occurrences)
- Expected 3-4 arguments, but got 2 (5 occurrences)
- Property 'search' does not exist on type 'CombinedSearchService'
- **Cause:** API changes in ElasticSearchService and CombinedSearchService
- **Fix:** Update test calls to match current API or remove obsolete tests

### 3. Test File Errors - testWitnessTestimony.ts (15 errors)
**File:** `src/scripts/tests/testWitnessTestimony.ts`
**Errors:**
- File name casing issue: ElasticsearchService vs ElasticSearchService
- Missing required arguments
- Properties don't exist: `searchQuery`, `totalMatches`, `outputFiles`
- **Cause:** Service refactoring, API changes
- **Fix:** Update imports and API calls or remove if obsolete

### 4. TranscriptExportService Errors (2 errors)
**File:** `src/services/TranscriptExportService.ts`
**Errors:**
- `startTime` does not exist in MarkerOrderByWithRelationInput
- Property 'markers' does not exist on Trial type
- **Cause:** Schema changes
- **Fix:** Update to use correct fields from current schema

### 5. Jest Test Setup Errors (16 errors)
**File:** `src/tests/setup.ts`
**Errors:** Cannot find name 'jest'
- **Cause:** Missing @types/jest or jest configuration
- **Fix:** Install jest types or remove if not using jest

## Implementation Plan

### Priority 1: Fix Critical Service Errors
These affect runtime functionality:

1. **Fix API Server (server.ts)**
   - Check Marker model in schema for correct field names
   - Replace `startTime` with correct field (likely `timestamp` or remove)

2. **Fix TranscriptExportService**
   - Update marker ordering field
   - Fix Trial type reference for markers

### Priority 2: Update or Remove Obsolete Tests
These don't affect runtime but clutter the codebase:

1. **Fix or Remove runAllTests.ts**
   - Check if ElasticSearchService still exists and is needed
   - If yes: Update API calls to match current signatures
   - If no: Delete the file

2. **Fix or Remove testWitnessTestimony.ts**
   - Fix import casing issue
   - Update API calls or remove if service deprecated

3. **Fix Jest Setup**
   - If using Jest: `npm install --save-dev @types/jest`
   - If not using Jest: Delete `src/tests/setup.ts`

## Detailed Fixes

### Fix 1: API Server Marker Ordering
```typescript
// src/api/server.ts
// BEFORE (line 86, 269):
orderBy: { startTime: 'asc' }

// AFTER:
orderBy: { id: 'asc' }  // or remove ordering
```

### Fix 2: ElasticSearch Service Import
```typescript
// src/scripts/tests/testWitnessTestimony.ts
// BEFORE:
import { ElasticsearchService } from '../../services/ElasticsearchService';

// AFTER:
import { ElasticSearchService } from '../../services/ElasticSearchService';
```

### Fix 3: Remove Obsolete Test Properties
```typescript
// src/scripts/tests/runAllTests.ts
// Remove 'queryName' from all query objects
// Update function calls to match current signatures
```

### Fix 4: TranscriptExportService Marker Access
```typescript
// src/services/TranscriptExportService.ts
// Check if markers should be accessed differently
// Possibly through a relation or separate query
```

### Fix 5: Jest Types Installation
```bash
npm install --save-dev @types/jest jest
```

## Decision Matrix

| File | Keep | Fix | Delete | Reason |
|------|------|-----|--------|--------|
| src/api/server.ts | ✓ | ✓ | | Core functionality |
| src/services/TranscriptExportService.ts | ✓ | ✓ | | Core functionality |
| src/scripts/tests/runAllTests.ts | ? | | ? | Check if tests are still relevant |
| src/scripts/tests/testWitnessTestimony.ts | ? | | ? | Check if tests are still relevant |
| src/tests/setup.ts | | | ✓ | Not using Jest in this project |

## Implementation Steps

1. **Analyze Current Schema**
   ```bash
   cat prisma/schema.prisma | grep -A 10 "model Marker"
   ```

2. **Fix Core Services**
   - Update server.ts marker ordering
   - Fix TranscriptExportService marker access

3. **Evaluate Tests**
   - Check if ElasticSearch is still used
   - Determine which tests are valuable
   - Delete obsolete tests

4. **Clean Up**
   - Remove unused imports
   - Delete test setup if not using Jest

## Success Criteria

- [ ] `npx tsc` runs without errors
- [ ] All core services compile cleanly
- [ ] Obsolete code is removed
- [ ] Remaining tests are functional

## Risk Assessment

- **Low Risk:** Deleting obsolete tests
- **Medium Risk:** Changing field names in queries (need to verify against schema)
- **High Risk:** None identified

## Notes

- Most errors appear to be from outdated test files
- Core functionality (parsers, services) seems intact
- Focus on fixing actual service code first, then clean up tests