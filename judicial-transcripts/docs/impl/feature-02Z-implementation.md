# Feature-02Z: Advanced Configuration Management Implementation Guide

## Overview
This feature implements advanced configuration management capabilities for the judicial transcript parsing system, including manual file ordering, statement text processing modes, LLM metadata control, and improved configuration merging.

## Implementation Status
✅ **COMPLETED** - All components implemented and tested

## Components Modified

### 1. Type Definitions (`src/types/config.types.ts`)

#### Added Types
```typescript
export type FileConvention = 'AUTO' | 'MANUAL' | 'DATEAMPM' | 'DATEMORNAFT' | 'DOCID';
export type StatementCleanMode = 'NONE' | 'REMOVEEXTRASPACE';
```

#### Extended TrialStyleConfig Interface
```typescript
export interface TrialStyleConfig {
  // ... existing fields ...
  statementCleanMode?: StatementCleanMode;  // Controls space cleaning in statements
  llmParsePages?: number;  // Number of pages to extract for LLM metadata (default: 2)
  // ... rest of interface ...
}
```

### 2. Statement Text Processing (`src/parsers/Phase2Processor.ts`)

#### Statement Append Mode Implementation
- **Method**: `combineStatementText(lines: any[]): string`
- **Functionality**: Combines statement lines based on `statementAppendMode` configuration
- **Supported Modes**:
  - `'space'`: Join with single space
  - `'newline'`: Join with `\n`
  - `'windowsNewline'`: Join with `\r\n`
  - `'unixNewline'`: Join with `\n`

#### Statement Clean Mode Implementation
- **Integrated in**: `combineStatementText` method
- **Modes**:
  - `'NONE'`: No cleaning (default)
  - `'REMOVEEXTRASPACE'`: Removes multiple consecutive spaces

#### Trial-Specific Configuration Loading
- **Method**: `loadTrialStyleConfig()`
- **Enhancement**: Uses `trial.shortName` to locate correct subdirectory
- **Removed**: Fallback to root `trialstyle.json` (shouldn't exist)

### 3. File Convention Detection (`src/parsers/FileConventionDetector.ts`)

#### MANUAL Mode Implementation
```typescript
if (isManualMode) {
  // In MANUAL mode, preserve orderedFiles and unidentifiedFiles from source
  convention = 'MANUAL';
  orderedFiles = defaultConfig?.orderedFiles || [];
  unidentifiedFiles = defaultConfig?.unidentifiedFiles || [];
}
```

#### Configuration Merging Strategy
```typescript
const config: TrialStyleConfig = {
  // Set defaults first
  pageHeaderLines: 2,
  statementAppendMode: 'space',
  statementCleanMode: 'NONE',
  
  // Spread all fields from defaultConfig (preserves all custom fields)
  ...(defaultConfig || {}),
  
  // Override only detected/generated fields
  fileConvention: convention === 'AUTO' ? 'DATEAMPM' : convention,
  orderedFiles,
  unidentifiedFiles,
  // ... other fields
}
```

### 4. Workflow Control (`src/services/EnhancedTrialWorkflowService.ts`)

#### No Regeneration Mode
```typescript
// If noRegenLLMMetadata is set and metadata exists, skip regeneration
if (this.config.workflow?.noRegenLLMMetadata) {
  logger.info(`noRegenLLMMetadata is set and metadata exists, skipping LLM generation`);
  return false;
}
```

### 5. LLM Metadata Extraction (`src/services/llm/LLMExtractor.ts`)

#### Enhanced extractFromTrialFolder Method
```typescript
async extractFromTrialFolder(trialPath: string): Promise<ExtractedEntities | null> {
  // Load trialstyle.json for configuration
  const trialStyleConfig = this.loadTrialStyleConfig(trialPath);
  
  // Use orderedFiles if available
  let transcriptFiles = trialStyleConfig.orderedFiles || this.getFilesFromDirectory(trialPath);
  
  // Use configured page limit
  const pageLimit = trialStyleConfig.llmParsePages || 2;
  const header = await this.extractTranscriptHeader(firstTranscript, pageLimit);
}
```

### 6. Configuration Files

#### Base Configuration (`config/trialstyle.json`)
```json
{
  "fileConvention": "AUTO",
  "fileSortingMode": "AUTO",
  "pageHeaderLines": 3,
  "statementAppendMode": "space",
  "statementCleanMode": "REMOVEEXTRASPACE",
  "llmParsePages": 2,
  "orderedFiles": [],
  "unidentifiedFiles": []
}
```

#### Workflow Configuration (`config/multi-trial-config-*.json`)
```json
{
  "workflow": {
    "enableLLMOverrides": true,
    "enableLLMMarkers": true,
    "noRegenLLMMetadata": true,
    "cleanupPhase2After": false,
    "phase2RetentionHours": 24
  }
}
```

## Configuration Hierarchy

1. **Base Configuration**: `config/trialstyle.json`
2. **Trial-Specific Override**: `[source-dir]/[trial-name]/trialstyle.json`
3. **Generated Configuration**: `[output-dir]/[trial-name]/trialstyle.json`

### Merge Process
1. Load base configuration from `config/trialstyle.json`
2. Merge with trial-specific overrides from source directory
3. Apply auto-detection only for non-MANUAL fields
4. Write merged configuration to output directory

## Usage Examples

### Example 1: Manual File Ordering
```json
{
  "fileConvention": "MANUAL",
  "orderedFiles": [
    "Opening_Statements.txt",
    "Witness_1_Direct.txt",
    "Witness_1_Cross.txt",
    "Closing_Arguments.txt"
  ],
  "unidentifiedFiles": [
    "scratch_notes.txt"
  ]
}
```

### Example 2: Custom Statement Processing
```json
{
  "statementAppendMode": "space",
  "statementCleanMode": "REMOVEEXTRASPACE"
}
```

### Example 3: Extended LLM Extraction
```json
{
  "llmParsePages": 5,
  "orderedFiles": ["Trial_Day_1_AM.txt", "Trial_Day_1_PM.txt"]
}
```

### Example 4: Preventing Metadata Regeneration
```json
{
  "workflow": {
    "noRegenLLMMetadata": true
  }
}
```

## Key Features

### 1. MANUAL File Convention Mode
- **Purpose**: Allows explicit control over file processing order
- **Use Case**: Non-standard file naming conventions or specific ordering requirements
- **Behavior**: Bypasses auto-detection and uses provided `orderedFiles` list

### 2. Statement Text Processing
- **Append Mode**: Controls how multi-line statements are joined
- **Clean Mode**: Removes extra spaces while preserving original Line records
- **Preservation**: Original text in Line table remains unchanged

### 3. LLM Parse Pages Configuration
- **Purpose**: Control how much content LLM sees for metadata extraction
- **Default**: 2 pages
- **Override**: Per-trial configuration via `llmParsePages`
- **File Selection**: Uses first file from `orderedFiles` if available

### 4. No Regeneration Mode
- **Purpose**: Prevent overwriting manually edited metadata
- **Configuration**: `workflow.noRegenLLMMetadata: true`
- **Behavior**: Skip LLM metadata generation if `trial-metadata.json` exists

## Migration Notes

### For Existing Trials
1. Existing trials without `statementCleanMode` default to `'NONE'`
2. Existing trials without `llmParsePages` default to `2`
3. Existing trials with `fileConvention: 'AUTO'` continue auto-detection

### For New Trials
1. Place custom `trialstyle.json` in source directory
2. Set `fileConvention: 'MANUAL'` if using custom ordering
3. Configure `llmParsePages` based on transcript header size
4. Enable `noRegenLLMMetadata` to preserve manual edits

## Testing Checklist

- [x] MANUAL file convention preserves orderedFiles
- [x] Statement append modes work correctly
- [x] Statement clean mode removes extra spaces
- [x] LLM uses configured page count
- [x] noRegenLLMMetadata prevents regeneration
- [x] Configuration merging preserves all fields
- [x] Phase2 finds trial-specific configurations
- [x] Multi-trial processing respects per-trial configs

## Related Features
- Feature-02S: Data corrections and overrides
- Feature-02P: Q&A pattern configuration
- Feature-03C: Trial metadata extraction

## Implementation Date
September 11, 2025

## Authors
- Implementation: Claude (Assistant)
- Requirements: User
- Testing: User confirmed functionality