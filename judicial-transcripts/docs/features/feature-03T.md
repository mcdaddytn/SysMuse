# Feature-03T: Transcript Post-Processor System

## Overview
Implement a post-processor system to transform converted transcript text files to normalize formatting differences introduced by different court reporters. The initial implementation will support normalizing witness declaration patterns.

## Requirements

### Configuration
- Add `postProcessorMode` field to `trialstyle.json` with possible values:
  - `NONE` (default if omitted)
  - `NORMALIZEWITNESS`
- Process runs after PDF-to-text conversion, before parsing phases

### Post-Processor Workflow
1. Check `postProcessorMode` in trial's `trialstyle.json`
2. If mode is not `NONE`:
   - Back up all transcript `.txt` files with `_conv` suffix
   - Apply transformation based on mode
   - Update `conversion-summary.json` to track post-processing completion

### NORMALIZEWITNESS Transformation

#### Purpose
Convert witness declaration blocks to match expected parser patterns when different court reporters use different conventions.

#### Input Pattern (Non-Standard)
```
14                    WILLIAM HENRY MANGIONE-SMITH, PhD, SWORN,
15       testified under oath as follows:
16                                  DIRECT EXAMINATION
17       BY MR. RENNIE:
```

#### Output Pattern (Normalized for PLAINTIFF)
```
14   WILLIAM HENRY MANGIONE-SMITH, PhD, PLAINTIFF'S WITNESS, PREVIOUSLY SWORN
15                                  DIRECT EXAMINATION
16   BY MR. RENNIE:
```

#### Output Pattern (Normalized for DEFENDANT)
```
14   WILLIAM HENRY MANGIONE-SMITH, PhD, DEFENDANTS' WITNESS, PREVIOUSLY SWORN
15                                  DIRECT EXAMINATION
16   BY MR. RENNIE:
```

#### Transformation Rules
1. **Build attorney mapping**:
   - Read `trial-metadata.json`
   - Map each attorney's `speakerPrefix` to their side (PLAINTIFF/DEFENDANT)
   - Use Attorney and TrialAttorney data to determine associations

2. **Identify witness declarations**:
   - Find patterns with witness name followed by "SWORN" or "PREVIOUSLY SWORN"
   - Look for "testified under oath as follows:" line
   - Followed by "DIRECT EXAMINATION" (with or without "CONTINUED")
   - Followed by "BY MR./MS. [NAME]:"

3. **Apply transformations**:
   - Determine if witness is plaintiff's or defendant's based on examining attorney
   - Insert "PLAINTIFF'S WITNESS, " or "DEFENDANTS' WITNESS, " after witness name
   - Remove "testified under oath as follows:" line
   - Preserve "PREVIOUSLY SWORN" if present
   - Maintain line spacing and formatting

4. **Scope**:
   - Only transform DIRECT EXAMINATION declarations
   - Do not modify CROSS-EXAMINATION or other examination types
   - Preserve all other text exactly as-is

### File Management
- Original files: `output/[trial]/[date]/[filename].txt`
- Backup files: `output/[trial]/[date]/[filename]_conv.txt`
- Processed files replace originals at same path

### Tracking
Update `conversion-summary.json`:
```json
{
  "postProcessorMode": "NORMALIZEWITNESS",
  "postProcessorCompleted": true,
  "postProcessorTimestamp": "2024-XX-XX HH:MM:SS",
  "filesProcessed": 25,
  "backupSuffix": "_conv"
}
```

## Implementation Targets
Initial trials to configure with `postProcessorMode: NORMALIZEWITNESS`:
- 73 Tq Delta, Llc V. Commscope
- 83 Koninklijke

## Technical Design

### Module Structure
```
src/services/postprocessor/
  PostProcessor.ts          - Main post-processor class
  NormalizeWitnessProcessor.ts - NORMALIZEWITNESS implementation
  types.ts                  - Type definitions
```

### Integration Points
1. **PDF Converter**: Run post-processor after text conversion
2. **Trial Style**: Read `postProcessorMode` from `trialstyle.json`
3. **Trial Metadata**: Access attorney mappings
4. **Conversion Summary**: Update tracking information

### Key Classes
```typescript
interface PostProcessorConfig {
  mode: 'NONE' | 'NORMALIZEWITNESS';
  trialId: string;
  outputDir: string;
}

interface AttorneyMapping {
  speakerPrefix: string;
  side: 'PLAINTIFF' | 'DEFENDANT';
  fullName: string;
}

class PostProcessor {
  async process(config: PostProcessorConfig): Promise<void>
  async backupFiles(outputDir: string, suffix: string): Promise<void>
  async updateConversionSummary(outputDir: string, mode: string): Promise<void>
}

class NormalizeWitnessProcessor {
  async buildAttorneyMapping(trialMetadata: any): Promise<Map<string, AttorneyMapping>>
  async processFile(filePath: string, attorneyMap: Map<string, AttorneyMapping>): Promise<void>
  determineWitnessSide(attorneyName: string, attorneyMap: Map<string, AttorneyMapping>): string
}
```

## Testing Strategy
1. Test with trials 73 and 83 first
2. Verify backup files are created correctly
3. Validate transformation accuracy
4. Ensure parser compatibility with normalized output
5. Check conversion-summary.json updates

## Success Criteria
- Post-processor correctly identifies and transforms witness declarations
- Backup files preserve original content
- Normalized text is compatible with existing parser
- No data loss during transformation
- Conversion tracking accurately reflects processing status