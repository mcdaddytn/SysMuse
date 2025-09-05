# Feature-02Y: Configuration Management and Schema Enhancements

## Overview
Restructure configuration management to use custom configuration system with proper file organization and naming conventions. Add schema enhancements for better tracking and reporting.

## Core Components

### 1. Configuration Restructuring

#### Directory Structure
```
config/
├── trialstyle.json                    # Default configuration
├── trial-configs/
│   ├── custom/                        # Custom trial configurations (diff from default)
│   │   ├── 01_Genband.json
│   │   ├── 02_Contentguard.json
│   │   └── 42_Vocalife_Amazon.json
│   └── merged/                        # Full merged configs (last run)
│       ├── 01_Genband.json
│       ├── 02_Contentguard.json
│       └── 42_Vocalife_Amazon.json
```

#### File Naming Convention
- **shortName**: Original directory name (e.g., "42 Vocalife Amazon")
- **shortNameHandle**: Result of `generateFileToken(shortName)` (e.g., "42_Vocalife_Amazon")
- Use shortNameHandle for all config file names (both custom and merged)

### 2. Configuration System

#### Custom Configuration Files
- Located in `config/trial-configs/custom/[shortNameHandle].json`
- Contains ONLY properties that differ from default `config/trialstyle.json`
- Common customizations:
  - `pageHeaderLines`
  - `orderedFiles`
  - `questionPatterns`
- Merged with default to create active configuration

#### Active Configuration
- Created by merging default + custom configurations
- Stored in destination: `[outputDir]/[shortName]/trialstyle.json`
- Copied to: `config/trial-configs/merged/[shortNameHandle].json`

### 3. Entity Override System

#### Override Files
- **Purpose**: Data files for entity updates (Trial, Attorney, Witness, etc.)
- **Sources**: Manual edits or LLM generation
- **NOT in source control** (managed separately)

#### Override File Locations
- **Input directories**: `[inputDir]/[shortName]/`
  - `Attorney.json`
  - `Witness.json`
  - `Trial.json`
- **Output directories**: `[outputDir]/[shortName]/`
  - Active versions used during processing
  - May be modified by LLM generation

Note: `inputDir` and `outputDir` refer to the directories specified in the main workflow configuration (e.g., multi-trial-config-mac.json)

#### Override File Management
- Output files are imported during processing
- Input files are reference copies
- Explicit CLI command copies from output back to input

#### Override Processing Rules
- **Unique Key Required**: Each record must have a unique key for updates (either `id` or another unique field)
- **Override Actions**:
  - `"Update"` (default): Updates existing records using unique key
  - `"Add"`: Creates new records
- **ID Handling for New Records**:
  - IDs in override files are used for relationship correlation within the file
  - Auto-generated database IDs are used for actual records
  - Related entities with foreign keys should be in the same override file
- **Entity Naming**: Use singular entity name as JSON key (e.g., "Attorney" not "attorneys")

### 4. Schema Enhancements

#### Trial Entity Updates
```prisma
model Trial {
  // ... existing fields ...
  shortName        String?      // Directory name (e.g., "42 Vocalife Amazon")
  shortNameHandle  String?      // Generated via generateFileToken(shortName)
}
```

#### Session Ordinals
```prisma
model Session {
  // ... existing fields ...
  ordinal     Int?  // Order within trial (1, 2, 3...)
}
```

#### TrialEvent Ordinals
```prisma
model TrialEvent {
  // ... existing fields ...
  ordinal     Int?  // Global order within entire trial
}
```

#### WitnessCalledEvent Enhancement
```prisma
model WitnessCalledEvent {
  // ... existing fields ...
  attorneyId  Int?
  attorney    Attorney? @relation(fields: [attorneyId], references: [id])
}
```

#### Line Session Numbers
```prisma
model Line {
  // ... existing fields ...
  sessionLineNumber Int?  // Line number within session (field exists, needs to be populated)
}
```

### 5. Attorney Association System

#### Speaker Prefix Convention
- Default pattern: `TITLE. LASTNAME`
- Examples: `MR. FABRICANT`, `MS. DOAN`
- Configurable in trialstyle.json:
```json
{
  "attorneyPrefixFormat": "TITLE_LASTNAME"
}
```

#### TrialAttorney Overrides
- Import attorneys via override files
- Maintain proper associations through ID correlation

### 6. Command-Line Operations

#### New CLI Commands

##### Sync Override Files
```bash
# Copy entity override files from output back to input for active trials
npx ts-node src/cli/sync.ts overrides

# Extract custom config (diff from default) and save to trial-configs/custom/
npx ts-node src/cli/sync.ts config
```

##### Restore Override Files
```bash
# Copy override files from input to output for active trials (for processing)
npx ts-node src/cli/restore.ts overrides
```

##### Generate Override Files
```bash
# Generate attorney overrides from LLM for active trials
npx ts-node src/cli/generate.ts attorneys

# Generate witness overrides from LLM for active trials
npx ts-node src/cli/generate.ts witnesses
```

Note: All commands operate on trials listed in `activeTrials` in the main workflow configuration

### 7. Workflow Integration

#### Processing Workflow
1. Check for custom configuration in `trial-configs/custom/[shortNameHandle].json`
2. Merge custom config with default `trialstyle.json`
3. Check for entity override files in input directory
4. Copy entity overrides to output directory
5. Process trial with merged configuration
6. Import entity overrides during processing
7. Save full merged config to `trial-configs/merged/[shortNameHandle].json`

#### Override Generation Workflow
1. LLM generates entity override files
2. Files saved to output: `[outputDir]/[shortName]/`
3. Existing files backed up with `.bk` extension
4. Manual review and tweaking
5. Test by re-running processing
6. Use explicit CLI command to sync back to input

#### Configuration Sync Workflow
1. After successful processing, active trialstyle.json exists in output
2. Run `sync config` command to:
   - Calculate diff between active and default configurations
   - Save diff to `trial-configs/custom/[shortNameHandle].json`
3. Run `sync overrides` command to:
   - Copy entity override files from output to input

### 8. Implementation Tasks

1. **Database Schema Updates**
   - Add Trial.shortName and Trial.shortNameHandle fields
   - Add ordinal fields (Session.ordinal, TrialEvent.ordinal)
   - Add WitnessCalledEvent.attorneyId relationship

2. **Configuration Management**
   - Create directory structure for trial-configs/custom and trial-configs/merged
   - Implement shortNameHandle generation using existing generateFileToken
   - Build configuration diff calculation logic
   - Create merge system for custom + default configs

3. **CLI Command Implementation**
   - `src/cli/sync.ts` - Sync configs and overrides to input
   - `src/cli/restore.ts` - Restore overrides from input  
   - `src/cli/generate.ts` - Generate overrides via LLM

4. **Parser Updates**
   - Calculate Line.sessionLineNumber during parsing
   - Set ordinals for sessions and events
   - Associate attorneys with witness called events

### 9. Data Formats

#### Custom Configuration Format (trial-configs/custom/)
```json
{
  "pageHeaderLines": 3,
  "orderedFiles": ["file1.txt", "file2.txt"],
  "questionPatterns": ["Q.", "Question:"]
}
```

#### Entity Override Format (Attorney.json)
```json
{
  "Attorney": [
    {
      "id": 1,  // Used as unique key for update
      "name": "John Doe",
      "speakerPrefix": "MR. DOE",
      "role": "PLAINTIFF",
      "lawFirmName": "Doe & Associates"
      // overrideAction: "Update" (default, can be omitted)
    },
    {
      "overrideAction": "Add",
      "id": 101,  // Temporary ID for relationship correlation only
      "name": "Jane Smith",
      "speakerPrefix": "MS. SMITH",
      "role": "DEFENDANT",
      "lawFirmName": "Smith & Partners"
    }
  ]
}
```

#### Entity Override Format (Witness.json)
```json
{
  "Witness": [
    {
      "name": "Jane Smith",  // Using name as unique key
      "witnessType": "FACT_WITNESS",
      "witnessCaller": "PLAINTIFF"
    },
    {
      "overrideAction": "Add",
      "name": "Dr. John Expert",
      "witnessType": "EXPERT_WITNESS",
      "witnessCaller": "DEFENDANT",
      "expertField": "Software Engineering"
    }
  ]
}
```

#### Entity Override Format (Trial.json)
```json
{
  "Trial": {
    "caseNumber": "2:19-CV-00123-JRG",  // Using caseNumber as unique key
    "plaintiff": "VocaLife LLC",
    "defendant": "Amazon.com, Inc.",
    "court": "United States District Court",
    "district": "Eastern District of Texas",
    "division": "Marshall Division"
  }
}
```

#### Entity Override Format (Marker.json) - Multiple Related Entities
```json
{
  "Marker": [
    {
      "overrideAction": "Add",
      "id": 1001,  // Temporary ID for correlation
      "name": "Opening Statement - Plaintiff",
      "markerType": "OPENING_STATEMENT",
      "startLineId": 150,
      "endLineId": 450
    }
  ],
  "MarkerSection": [
    {
      "overrideAction": "Add",
      "markerId": 1001,  // References temporary Marker ID above
      "sectionName": "Introduction",
      "startLineId": 150,
      "endLineId": 200
    },
    {
      "overrideAction": "Add", 
      "markerId": 1001,  // References same temporary Marker ID
      "sectionName": "Main Argument",
      "startLineId": 201,
      "endLineId": 400
    }
  ]
}
```

### 10. Success Criteria

- [ ] Trial.shortName and shortNameHandle fields populated
- [ ] Custom configuration files in trial-configs/custom/
- [ ] Merged configuration files in trial-configs/merged/
- [ ] Entity override files managed in input and output directories
- [ ] Ordinal fields populated correctly (Session.ordinal, TrialEvent.ordinal)
- [ ] Line.sessionLineNumber calculated and populated
- [ ] WitnessCalledEvent.attorneyId relationship added
- [ ] Attorney associations working through override files
- [ ] CLI commands for sync/restore/generate implemented
- [ ] LLM generation saves to output directory
- [ ] Backup system (.bk files) prevents data loss
- [ ] Configuration diff calculation working correctly
- [ ] All commands operate on activeTrials from workflow configuration

## Notes

- Custom configuration system reduces duplication (only store diffs)
- Entity override files enable manual and LLM-assisted data corrections
- Ordinal fields enable better reporting and navigation
- Clear separation between source control (configs) and managed data (overrides)
- All commands use activeTrials from main workflow configuration
- Simplified directory structure with files at trial level (no additional subdirectories)