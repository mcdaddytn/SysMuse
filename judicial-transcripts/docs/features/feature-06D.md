# Feature-06D: Centralized Logging Configuration

## Overview
The logging system has been enhanced with centralized configuration support, configurable log file naming strategies, timestamp-appended filenames, and separate warning-level logs. All CLI commands now use a centralized `config/log-config.json` file for consistent logging behavior across the entire system.

## Requirements

### 1. Log File Naming Strategies
- **Default Mode**: Static filenames (`combined.log`, `error.log`, `warning.log`)
- **Timestamp Mode**: Append datetime to filenames (`combined-2025-01-09-143022.log`)

### 2. Warning Level Logs
- Separate warning-level log file in addition to existing error and combined logs
- Warning log contains ONLY warnings (not errors)
- Apply same naming strategy as other log files

### 3. Centralized Configuration
- Single `config/log-config.json` file for all CLI commands
- Support predefined logging profiles in configuration
- Easy switching between profiles with single configuration key
- Default to timestamp mode for better log management
- Automatic initialization at CLI startup

## Configuration

### Centralized Configuration File
The logging configuration is now stored in `config/log-config.json` and is automatically loaded by all CLI commands.

### Configuration Structure
```json
{
  "logging": {
    "profile": "AppendDatetime",  // or "Default"
    "profiles": {
      "Default": {
        "appendTimestamp": false,
        "timestampFormat": "",
        "logLevel": "info",
        "enableWarningLog": true,
        "logDirectory": "logs"
      },
      "AppendDatetime": {
        "appendTimestamp": true,
        "timestampFormat": "YYYY-MM-DD-HHmmss",
        "logLevel": "info",
        "enableWarningLog": true,
        "logDirectory": "logs"
      }
    }
  }
}
```

### Console Level Control
Each profile can specify a separate console log level:
```json
{
  "consoleLevel": "info"  // Console output level (can differ from file log level)
}
```

### Available Profiles
- **Default**: Static filenames without timestamps
- **AppendDatetime**: Timestamped filenames (default)
- **Debug**: Debug level logging with timestamps
- **Production**: Warning level and above only

## Implementation Details

### 1. Logger Initialization
- Read logging configuration from main config file
- Create appropriate filenames based on configuration
- Initialize Winston transports with configured filenames

### 2. Filename Generation
```typescript
function generateLogFilename(baseName: string, config: LogConfig): string {
  if (config.appendTimestamp) {
    const timestamp = moment().format(config.timestampFormat);
    const ext = path.extname(baseName);
    const name = path.basename(baseName, ext);
    return `${name}-${timestamp}${ext}`;
  }
  return baseName;
}
```

### 3. Log Files Generated

#### Default Profile
- `logs/combined.log` - All log levels
- `logs/error.log` - Error level only
- `logs/warning.log` - Warning level only (if enabled)

#### AppendDatetime Profile
- `logs/combined-2025-01-09-143022.log` - All log levels
- `logs/error-2025-01-09-143022.log` - Error level only
- `logs/warning-2025-01-09-143022.log` - Warning level only (if enabled)

## Implementation Changes

### 1. Centralized Configuration
- Created `config/log-config.json` for unified logging settings
- Removed logging configuration from individual config files
- All CLI entry points now use `initializeLogger()` from `log-config-loader.ts`

### 2. Warning Log Filter
- Warning log now contains ONLY warnings (excludes errors)
- Implemented custom Winston filter for warning level

### 3. Logger Initialization
- Logger reconfiguration properly updates existing logger instance
- Console and file log levels can be controlled independently

## Usage Examples

### Centralized Configuration in log-config.json
```json
{
  "profile": "AppendDatetime",
  "profiles": {
    "Default": {
      "appendTimestamp": false,
      "timestampFormat": "",
      "logLevel": "info",
      "enableWarningLog": true,
      "logDirectory": "logs",
      "consoleLevel": "info"
    },
    "AppendDatetime": {
      "appendTimestamp": true,
      "timestampFormat": "YYYY-MM-DD-HHmmss",
      "logLevel": "info",
      "enableWarningLog": true,
      "logDirectory": "logs",
      "consoleLevel": "info"
    }
  }
}
```

### Quick Profile Switching
Edit `config/log-config.json`:
```json
// To use default (static) filenames:
"profile": "Default"

// To use timestamp-appended filenames:
"profile": "AppendDatetime"

// To use debug logging:
"profile": "Debug"

// To use production logging (warnings and errors only):
"profile": "Production"
```

## Benefits

1. **Log Rotation**: Timestamp mode naturally creates new log files for each run
2. **Historical Tracking**: Preserve logs from previous runs without manual backup
3. **Flexibility**: Easy switching between modes via configuration
4. **Debugging**: Separate warning logs help identify potential issues
5. **Production Ready**: Default timestamp mode prevents log file conflicts

## Migration Notes

### Changes from Previous Implementation
1. **Centralized Configuration**: Logging config moved from individual files to `config/log-config.json`
2. **Automatic Loading**: All CLI commands automatically load the centralized config
3. **Warning Log Fix**: Warning log now correctly excludes error messages
4. **Console Level Control**: Can set different log levels for console vs files

### Backward Compatibility
- If `config/log-config.json` is not found, defaults to timestamp mode
- Existing logs directory structure is preserved
- Legacy logger initialization still works but is deprecated

## Testing

### Test Cases
1. Verify Default profile creates static filenames
2. Verify AppendDatetime profile creates timestamped files
3. Verify warning log is created when enabled
4. Verify log level filtering works correctly
5. Verify profile switching works without restart

### Example Commands
```bash
# All commands now use centralized logging automatically
npm run convert-pdf config/multi-trial-config-mac.json
npx ts-node src/cli/parse.ts parse --phase1 --config config/multi-trial-config-mac.json
npx ts-node src/cli/phase3.ts process

# Verify log files created with timestamps
ls -la logs/ | grep $(date '+%Y-%m-%d')
```

## Success Criteria
✅ Centralized logging configuration in `config/log-config.json`
✅ Log files created with appropriate names based on configuration
✅ Warning-level log file contains ONLY warnings (not errors)
✅ Easy profile switching through single configuration key
✅ Default behavior uses timestamp mode
✅ All CLI commands use centralized configuration
✅ Console and file log levels can be controlled independently
✅ No breaking changes to existing logging functionality