# Workflow Configuration Settings

## Buffer Size Configuration

The workflow configuration includes settings to control buffer sizes for subprocess execution:

### `workflow.maxBuffer`
- **Purpose**: Controls the maximum buffer size (in bytes) for subprocess output when running phase commands
- **Default**: 209715200 (200MB)
- **When to increase**: If you encounter `ENOBUFS` errors during phase2 or other processing steps
- **Recommended values**:
  - Small trials: 104857600 (100MB)
  - Medium trials: 209715200 (200MB) - default
  - Large trials: 524288000 (500MB)
  - Very large trials: 1073741824 (1GB)

### `workflow.execTimeout`
- **Purpose**: Maximum time (in milliseconds) a subprocess can run before timing out
- **Default**: 1200000 (20 minutes)
- **When to increase**: For very large trials that take longer to process

## Example Configuration

```json
{
  "workflow": {
    "enableLLMOverrides": true,
    "enableLLMMarkers": true,
    "cleanupPhase2After": false,
    "phase2RetentionHours": 24,
    "execTimeout": 1200000,
    "maxBuffer": 209715200,
    "autoReview": {
      "overrides": true,
      "markers1": true,
      "markers2": true
    }
  }
}
```

## Troubleshooting

### ENOBUFS Error
If you encounter `spawnSync /bin/sh ENOBUFS` errors:
1. Increase `maxBuffer` in your config file
2. Start with doubling the current value
3. Monitor system memory usage
4. Consider processing trials individually rather than in batch

### Memory Usage
The maxBuffer setting directly impacts memory usage. Ensure your system has enough RAM:
- 200MB buffer = ~400MB RAM usage per process
- 500MB buffer = ~1GB RAM usage per process
- 1GB buffer = ~2GB RAM usage per process