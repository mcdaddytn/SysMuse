# Feature-03I: Dynamic Seed File Updates

## Overview
Implement a dynamic seed file update system that allows selective updating of database seed data through upsert operations. This enables users to modify seed files and update only the specific data they want changed without affecting other database records.

## Background
Currently, the seed system runs all seed operations together, which can:
- Overwrite unrelated data
- Require full database resets for simple configuration changes
- Make it difficult to test incremental changes to seed data
- Risk data loss when updating specific configurations

This feature provides granular control over seed data updates, particularly useful for:
- Adjusting accumulator expressions
- Modifying court directive patterns
- Updating search configurations
- Testing different parameter values

## Objectives
1. Enable selective seed file updates via CLI command
2. Use upsert operations with unique keys to prevent duplicates
3. Validate unique key availability before attempting updates
4. Provide clear feedback on update success/failure
5. Maintain data integrity during partial updates

## Functional Requirements

### Core Functionality
1. **Selective Seed Updates**
   - Update specific seed files by name
   - Support multiple files in single command
   - Skip files not specified in update request

2. **Upsert Operations**
   - Use unique keys for conflict resolution
   - Update existing records when keys match
   - Insert new records when keys don't exist
   - Preserve unmodified fields during updates

3. **Unique Key Validation**
   - Check for unique constraints in schema
   - Verify unique key fields exist in data
   - Report errors for tables without unique keys
   - Prevent updates that would violate constraints

4. **Supported Seed Files**
   - `accumulator-expressions.json`
   - `accumulator-expressions-extended.json`
   - `court-directives.json`
   - `elasticsearch-expressions.json`
   - `marker-templates.json`
   - `search-patterns.json`
   - `system-config.json`

## Technical Design

### Architecture
```
CLI Command (seed-update)
    ├── SeedUpdateService
    │   ├── FileValidator
    │   ├── SchemaAnalyzer
    │   └── UpsertExecutor
    └── Logging/Reporting
```

### Implementation Components

#### 1. CLI Command
```typescript
// src/cli/seed-update.ts
interface SeedUpdateOptions {
  files: string[];        // Seed files to update
  dryRun?: boolean;       // Preview changes without applying
  force?: boolean;        // Skip confirmation prompts
  verbose?: boolean;      // Detailed logging
}
```

#### 2. Schema Analyzer
```typescript
interface TableSchema {
  tableName: string;
  uniqueKeys: string[];
  hasUniqueConstraint: boolean;
  upsertStrategy: 'single' | 'composite' | 'none';
}

class SchemaAnalyzer {
  analyzeTable(tableName: string): TableSchema
  validateUpsertability(table: TableSchema, data: any[]): boolean
}
```

#### 3. Seed File Mapping
```typescript
const SEED_FILE_MAPPINGS = {
  'accumulator-expressions.json': {
    table: 'AccumulatorExpression',
    uniqueKey: 'name',
    processor: 'accumulatorProcessor'
  },
  'court-directives.json': {
    table: 'CourtDirectiveType',
    uniqueKey: 'name',
    processor: 'directiveProcessor'
  },
  // ... other mappings
};
```

#### 4. Upsert Executor
```typescript
class UpsertExecutor {
  async upsertRecords(
    table: string,
    uniqueKey: string | string[],
    records: any[]
  ): Promise<UpsertResult> {
    // Use Prisma upsert for each record
    // Track success/failure counts
    // Return detailed results
  }
}
```

## Usage Examples

### Basic Update
```bash
# Update accumulator expressions from modified file
npx ts-node src/cli/seed-update.ts --file accumulator-expressions.json

# Output:
# Loading seed file: accumulator-expressions.json
# Target table: AccumulatorExpression
# Unique key: name
# Records to process: 6
# 
# Updated: 4 records
# Inserted: 2 records
# Skipped: 0 records
# Errors: 0
```

### Multiple Files
```bash
# Update multiple seed files
npx ts-node src/cli/seed-update.ts \
  --file accumulator-expressions.json \
  --file court-directives.json

# Process each file sequentially
```

### Dry Run Mode
```bash
# Preview changes without applying
npx ts-node src/cli/seed-update.ts \
  --file accumulator-expressions.json \
  --dry-run

# Output:
# DRY RUN MODE - No changes will be applied
# 
# Would update:
#   - judge_attorney_interaction (windowSize: 10 → 6)
#   - objection_sustained (thresholdValue: 0.7 → 0.8)
# Would insert:
#   - new_accumulator_pattern
```

### Verbose Output
```bash
# Detailed logging
npx ts-node src/cli/seed-update.ts \
  --file accumulator-expressions.json \
  --verbose

# Shows each record being processed
```

## Validation Rules

### Pre-Update Validation
1. **File Existence**: Verify seed file exists
2. **JSON Validity**: Ensure file is valid JSON
3. **Schema Match**: Validate data structure matches table schema
4. **Unique Key Presence**: Confirm unique key fields in data
5. **Type Compatibility**: Check data types match database schema

### Update Validation
1. **Constraint Checks**: Prevent unique constraint violations
2. **Foreign Key Validation**: Ensure referenced records exist
3. **Required Fields**: Verify all required fields present
4. **Data Integrity**: Validate enum values and formats

### Error Handling
```typescript
class SeedUpdateError extends Error {
  constructor(
    message: string,
    public file: string,
    public record?: any,
    public details?: any
  ) {
    super(message);
  }
}

// Example errors:
// - "No unique key found for table AccumulatorExpression"
// - "Duplicate key 'objection_sustained' in seed file"
// - "Invalid enum value 'INVALID' for field expressionType"
```

## Implementation Steps

### Phase 1: Core Infrastructure
1. Create `SeedUpdateService` class
2. Implement `SchemaAnalyzer` for unique key detection
3. Build seed file to table mapping
4. Add basic upsert functionality

### Phase 2: CLI Integration
1. Create `seed-update.ts` CLI command
2. Add command-line argument parsing
3. Implement dry-run mode
4. Add progress reporting

### Phase 3: Validation & Safety
1. Add comprehensive validation
2. Implement transaction support
3. Add rollback capability
4. Create backup before updates

### Phase 4: Testing & Documentation
1. Unit tests for each component
2. Integration tests with sample data
3. Update documentation
4. Add examples to README

## Testing Strategy

### Unit Tests
```typescript
describe('SeedUpdateService', () => {
  it('should detect unique keys from schema');
  it('should validate seed file format');
  it('should perform upsert operations');
  it('should handle missing unique keys');
  it('should rollback on error');
});
```

### Integration Tests
1. Test with actual seed files
2. Verify database state after updates
3. Test conflict resolution
4. Validate error scenarios

### Test Scenarios
1. **Update existing records**: Modify accumulator window sizes
2. **Insert new records**: Add new accumulator expressions
3. **Mixed operations**: Some updates, some inserts
4. **Error conditions**: Duplicate keys, invalid data
5. **Rollback**: Ensure clean rollback on failure

## Security Considerations
1. **Input Validation**: Sanitize all input data
2. **SQL Injection**: Use parameterized queries
3. **File Access**: Restrict to seed-data directory
4. **Permissions**: Verify user has update permissions
5. **Audit Trail**: Log all update operations

## Performance Considerations
1. **Batch Operations**: Process records in batches
2. **Transaction Size**: Limit transaction scope
3. **Index Usage**: Leverage unique indexes
4. **Memory Management**: Stream large files
5. **Progress Reporting**: Show progress for long operations

## Success Criteria
1. ✅ Can update specific seed files via CLI
2. ✅ Uses upsert to prevent duplicates
3. ✅ Validates unique keys before updates
4. ✅ Provides clear success/error feedback
5. ✅ Maintains data integrity
6. ✅ Supports dry-run mode
7. ✅ Handles errors gracefully
8. ✅ Works with all seed file types

## Future Enhancements
1. **Bulk Operations**: Update multiple tables in single transaction
2. **Diff Reporting**: Show detailed before/after comparison
3. **Backup/Restore**: Automatic backup before updates
4. **Version Control**: Track seed file versions
5. **Web UI**: GUI for seed management
6. **Scheduled Updates**: Cron-based seed updates
7. **Validation Rules**: Custom validation per table
8. **Merge Strategies**: Different conflict resolution options

## Example: Updating Accumulator Expressions

### Step 1: Modify seed file
```json
// accumulator-expressions.json
{
  "name": "judge_attorney_interaction",
  "windowSize": 5,  // Changed from 6
  "thresholdValue": 0.9,  // Changed from 1.0
  // ... other fields
}
```

### Step 2: Run update command
```bash
npx ts-node src/cli/seed-update.ts --file accumulator-expressions.json
```

### Step 3: Verify update
```sql
SELECT name, "windowSize", "thresholdValue" 
FROM "AccumulatorExpression" 
WHERE name = 'judge_attorney_interaction';
```

## Dependencies
- Prisma Client for database operations
- Commander.js for CLI parsing
- Chalk for colored output
- Ora for progress spinners
- Joi for validation (optional)