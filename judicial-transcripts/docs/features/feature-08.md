# Feature 08: CLI Redesign for Improved Usability

## Overview
Redesign the command-line interface to provide a cleaner, more intuitive syntax while maintaining all current functionality. The new design will eliminate awkward command structures and provide consistent, predictable behavior.

## Background

### Current Problems

1. **Awkward Syntax**: Current commands like `parse:phase1` with phase2 switches are confusing
2. **Inconsistent Naming**: Mix of "parse", "phase", and numbered phases lacks clarity
3. **Configuration Handling**: Not always clear that configuration file is mandatory
4. **Poor Error Messages**: Users don't get clear guidance when commands fail
5. **Verbose Commands**: Long command strings for simple operations

### Current Structure
```bash
# Current awkward syntax
npm run cli parse:phase1 config/example-trial-config-mac.json
npm run cli parse:phase2 config/example-trial-config-mac.json
npm run cli parse:phase3 config/example-trial-config-mac.json
```

## Requirements

### 1. New Command Structure

#### Primary Command
Replace `npm run cli` with a shorter, clearer command:

**Option A: Using 'jt' (Judicial Transcripts)**
```bash
jt convert config.json
jt parse config.json
jt enhance config.json
jt finalize config.json
```

**Option B: Using 'exec' with subcommands**
```bash
npm run exec convert config.json
npm run exec parse config.json
npm run exec enhance config.json
npm run exec finalize config.json
```

**Option C: Using descriptive phase names**
```bash
npm run process extract config.json    # PDF to text
npm run process parse config.json      # Initial parsing
npm run process enhance config.json    # Enhancement
npm run process complete config.json   # Final processing
```

### 2. Command Naming Improvements

Replace generic "phase1/2/3" with descriptive names:

| Current | New | Description |
|---------|-----|-------------|
| convert | extract | Extract text from PDFs |
| parse:phase1 | parse | Parse transcript structure |
| parse:phase2 | enhance | Enhance with patterns and relationships |
| parse:phase3 | finalize | Complete processing and validation |

### 3. Configuration File Handling

#### Default Configuration
- Check for default config file if none specified
- Search order:
  1. `./config.json` (current directory)
  2. `./config/default.json`
  3. `./config/example-trial-config-mac.json` (for Mac)

#### Clear Error Messages
```
ERROR: Configuration file required
Please specify a configuration file:
  npm run process parse config/example-trial-config-mac.json

Or create a default configuration:
  cp config/example-trial-config-mac.json config/default.json
```

### 4. Unified Execution Model

#### Single Entry Point
Create a single CLI entry point that handles all commands:

```typescript
// src/cli/index.ts
interface CLICommand {
  name: string;
  description: string;
  handler: (config: Config) => Promise<void>;
  requiresDatabase: boolean;
  requiresInput: boolean;
}

const commands: Map<string, CLICommand> = new Map([
  ['extract', extractCommand],
  ['parse', parseCommand],
  ['enhance', enhanceCommand],
  ['finalize', finalizeCommand],
  ['reset', resetCommand],
  ['status', statusCommand]
]);
```

### 5. Additional Commands

#### Status Command
Show current processing state:
```bash
npm run status config.json

Output:
Database Status: Connected
Last Processing: Phase 2 (Enhanced) - 2024-01-15 10:30
Transcripts: 3 loaded, 2 processed
Next Step: Run 'npm run process finalize config.json'
```

#### Reset Command
Clean database and start fresh:
```bash
npm run reset [--confirm]
```

#### Help Command
Provide clear usage information:
```bash
npm run help

Commands:
  extract   - Extract text from PDF files
  parse     - Parse transcript structure
  enhance   - Enhance with patterns
  finalize  - Complete processing
  status    - Show current state
  reset     - Reset database
  
Usage:
  npm run [command] config.json
  
Example:
  npm run parse config/example-trial-config-mac.json
```

### 6. Progress Reporting

Provide clear feedback during processing:

```
Processing: example-trial.txt
[██████████----------] 50% | Page 125/250 | ETA: 2m 30s
Status: Parsing witness testimony...
```

### 7. Batch Processing

Support processing multiple transcripts:

```bash
# Process all transcripts in config
npm run parse-all config.json

# Process specific transcript
npm run parse config.json --transcript trial1.txt
```

## Implementation Plan

### Phase 1: Core Redesign
1. Create new CLI entry point
2. Implement command routing
3. Add configuration validation

### Phase 2: Command Migration
1. Map old commands to new structure
2. Maintain backward compatibility
3. Add deprecation warnings

### Phase 3: Enhanced Features
1. Add progress reporting
2. Implement status command
3. Add help system

### Phase 4: Documentation
1. Update all documentation
2. Create migration guide
3. Update CLAUDE.md

## Benefits

### User Experience
- Clearer, more intuitive commands
- Better error messages
- Progress feedback
- Consistent behavior

### Developer Experience
- Single entry point
- Unified command structure
- Easier to extend
- Better testing

### Maintenance
- Centralized command handling
- Consistent error handling
- Easier debugging
- Clear code structure

## Success Criteria

1. **Simplicity**: Commands are intuitive and easy to remember
2. **Consistency**: All commands follow same pattern
3. **Clarity**: Error messages guide users to solution
4. **Compatibility**: Support migration from old commands
5. **Documentation**: Complete, clear documentation

## Migration Strategy

### Transition Period
1. Implement new CLI alongside old
2. Old commands show deprecation warning
3. Provide migration guide
4. Remove old CLI after transition

### Deprecation Messages
```
WARNING: 'parse:phase1' is deprecated
Please use: npm run parse config.json
See migration guide: docs/cli-migration.md
```

## Configuration Example

New simplified configuration structure:
```json
{
  "mode": "development",
  "input": {
    "type": "text",
    "directory": "/path/to/transcripts"
  },
  "database": {
    "url": "postgresql://..."
  },
  "processing": {
    "parallel": true,
    "verbose": false
  },
  "transcripts": [
    {
      "file": "trial1.txt",
      "metadata": {
        "caseNumber": "2:19-CV-00123-JRG",
        "date": "2021-09-20"
      }
    }
  ]
}
```

## Future Enhancements

1. **Interactive Mode**: Guide users through configuration
2. **Web Interface**: Optional web UI for monitoring
3. **Scheduling**: Support scheduled processing
4. **Plugins**: Allow custom processing steps
5. **Export Commands**: Direct export to various formats