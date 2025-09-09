# Feature-06D: Configurable Logging with Timestamp Options

## Overview
Enhance the logging system to support configurable log file naming strategies, including timestamp-appended filenames and separate warning-level logs. This feature allows users to easily switch between different logging profiles through configuration files.

## Requirements

### 1. Log File Naming Strategies
- **Default Mode**: Static filenames (`combined.log`, `error.log`, `warning.log`)
- **Timestamp Mode**: Append datetime to filenames (`combined-2025-01-09-143022.log`)

### 2. Warning Level Logs
- Add separate warning-level log file in addition to existing error and combined logs
- Apply same naming strategy as other log files

### 3. Configuration Profiles
- Support predefined logging profiles in configuration
- Easy switching between profiles with single configuration key
- Default to timestamp mode for better log management

## Configuration Schema

### Logging Configuration Structure
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

### Alternative Simplified Configuration
```json
{
  "logging": {
    "appendTimestamp": true,        // Enable/disable timestamp appending
    "timestampFormat": "YYYY-MM-DD-HHmmss",  // Format for timestamp
    "logLevel": "info",             // Default log level
    "enableWarningLog": true,       // Enable separate warning log
    "logDirectory": "logs"          // Directory for log files
  }
}
```

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

## Usage Examples

### Configuration in multi-trial-config-mac.json
```json
{
  "trials": [...],
  "logging": {
    "profile": "AppendDatetime"
  },
  "loggingProfiles": {
    "Default": {
      "appendTimestamp": false,
      "logLevel": "info",
      "enableWarningLog": true
    },
    "AppendDatetime": {
      "appendTimestamp": true,
      "timestampFormat": "YYYY-MM-DD-HHmmss",
      "logLevel": "info",
      "enableWarningLog": true
    }
  }
}
```

### Quick Profile Switching
```json
// To use default (static) filenames:
"logging": { "profile": "Default" }

// To use timestamp-appended filenames:
"logging": { "profile": "AppendDatetime" }
```

## Benefits

1. **Log Rotation**: Timestamp mode naturally creates new log files for each run
2. **Historical Tracking**: Preserve logs from previous runs without manual backup
3. **Flexibility**: Easy switching between modes via configuration
4. **Debugging**: Separate warning logs help identify potential issues
5. **Production Ready**: Default timestamp mode prevents log file conflicts

## Migration Notes

### Backward Compatibility
- If no logging configuration is present, default to timestamp mode
- Existing logs directory structure is preserved
- Console logging remains unchanged

### Configuration Priority
1. Check for `logging.profile` and use referenced profile
2. If no profile, use direct `logging` configuration
3. If no logging configuration, use default timestamp mode

## Testing

### Test Cases
1. Verify Default profile creates static filenames
2. Verify AppendDatetime profile creates timestamped files
3. Verify warning log is created when enabled
4. Verify log level filtering works correctly
5. Verify profile switching works without restart

### Example Test Commands
```bash
# Test with Default profile
npm run parse -- --phase1 --config config/test-default-logging.json

# Test with AppendDatetime profile  
npm run parse -- --phase1 --config config/test-timestamp-logging.json

# Verify log files created
ls -la logs/
```

## Success Criteria
- Log files are created with appropriate names based on configuration
- Warning-level log file is generated when enabled
- Easy profile switching through single configuration key
- Default behavior uses timestamp mode
- No breaking changes to existing logging functionality