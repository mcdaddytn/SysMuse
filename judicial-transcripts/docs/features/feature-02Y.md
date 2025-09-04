# Feature-02Y: TrialCorpus and Configuration Management System

## Overview
Introduce TrialCorpus entity to group related trials for search and speaker resolution scope. Restructure configuration management to use custom configuration system with proper file organization and naming conventions.

## Core Components

### 1. TrialCorpus Entity
- **Purpose**: Group related trials for scoped search and entity resolution
- **Initial corpus**: "Gilstrap Trials" - all trials from Judge Gilstrap, Eastern District of Texas
- **Benefits**:
  - Scoped Elasticsearch indexing
  - Attorney/speaker name collision management
  - Logical grouping for reporting and analysis

### 2. Configuration Restructuring

#### Directory Structure
```
config/
├── trialstyle.json                    # Default configuration
├── trial-configs/
│   ├── custom/                        # Custom trial configurations (diff from default)
│   │   ├── genband.json
│   │   ├── contentguard.json
│   │   └── vocalife-amazon.json
│   └── merged/                        # Full merged configs (last run)
│       ├── genband/
│       │   └── trialstyle.json
│       ├── contentguard/
│       │   └── trialstyle.json
│       └── vocalife-amazon/
│           └── trialstyle.json
```

#### File Naming Convention
- **shortName**: Original directory name (e.g., "42 Vocalife Amazon")
- **shortNameHandle**: Result of `generateFileToken(shortName)` (e.g., "vocalife-amazon")
- Use shortNameHandle for:
  - Config file names in `trial-configs/custom/`
  - Directory names in `trial-configs/merged/`
  - Override file references

### 3. Configuration System

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
- Copied to: `config/trial-configs/merged/[shortNameHandle]/trialstyle.json`

### 4. Entity Override System

#### Override Files
- **Purpose**: Data files for entity updates (Trial, Attorney, Witness, etc.)
- **Sources**: Manual edits or LLM generation
- **NOT in source control** (managed separately)

#### Override File Locations
- **Source directories**: `[sourceDir]/[shortName]/overrides/`
  - `attorneys.json`
  - `witnesses.json`
  - `trial-metadata.json`
- **Destination directories**: `[outputDir]/[shortName]/overrides/`
  - Active versions used during processing
  - May be modified by LLM generation

#### Override File Management
- Destination files are imported during processing
- Source files are reference copies
- Explicit CLI command copies from destination back to source

### 5. Schema Enhancements

#### New Entity: TrialCorpus
```prisma
model TrialCorpus {
  id          Int      @id @default(autoincrement())
  name        String   @unique
  description String?
  trials      Trial[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

#### Trial Entity Updates
```prisma
model Trial {
  // ... existing fields ...
  corpusId         Int?
  corpus           TrialCorpus? @relation(fields: [corpusId], references: [id])
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
  sessionLineNumber Int?  // Line number within session
}
```

### 6. Attorney Association System

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
- Scope resolution within TrialCorpus

### 7. Command-Line Operations

#### New CLI Commands

##### Sync Override Files
```bash
# Copy entity override files from destination back to source
npx ts-node src/cli/sync.ts overrides --trial [shortName]

# Copy all trial override files to source
npx ts-node src/cli/sync.ts overrides --all

# Extract custom config (diff from default) and save to trial-configs/custom/
npx ts-node src/cli/sync.ts config --trial [shortName]

# Extract and save all custom configs
npx ts-node src/cli/sync.ts config --all
```

##### Restore Override Files
```bash
# Copy override files from source to destination (for processing)
npx ts-node src/cli/restore.ts overrides --trial [shortName]

# Restore all trial override files
npx ts-node src/cli/restore.ts overrides --all
```

##### Generate Override Files
```bash
# Generate attorney overrides from LLM
npx ts-node src/cli/generate.ts attorneys --trial [shortName]

# Generate witness overrides from LLM
npx ts-node src/cli/generate.ts witnesses --trial [shortName]
```

### 8. Workflow Integration

#### Processing Workflow
1. Check for custom configuration in `trial-configs/custom/[shortNameHandle].json`
2. Merge custom config with default `trialstyle.json`
3. Check for entity override files in source directory
4. Copy entity overrides to destination directory
5. Process trial with merged configuration
6. Import entity overrides during processing
7. Save full merged config to `trial-configs/merged/[shortNameHandle]/trialstyle.json`

#### Override Generation Workflow
1. LLM generates entity override files
2. Files saved to destination: `[outputDir]/[shortName]/overrides/`
3. Existing files backed up with `.bk` extension
4. Manual review and tweaking
5. Test by re-running processing
6. Use explicit CLI command to sync back to source

#### Configuration Sync Workflow
1. After successful processing, active trialstyle.json exists in destination
2. Run `sync config` command to:
   - Calculate diff between active and default configurations
   - Save diff to `trial-configs/custom/[shortNameHandle].json`
3. Run `sync overrides` command to:
   - Copy entity override files from destination to source

### 9. Implementation Tasks

1. **Database Schema Updates**
   - Add TrialCorpus entity
   - Add ordinal fields
   - Add WitnessCalledEvent.attorneyId
   - Add Line.sessionLineNumber

2. **Configuration Management**
   - Create directory structure for trial-configs/custom and trial-configs/merged
   - Implement shortNameHandle generation using existing generateFileToken
   - Build configuration diff calculation logic
   - Create merge system for custom + default configs

3. **CLI Command Implementation**
   - `src/cli/sync.ts` - Sync configs and overrides to source
   - `src/cli/restore.ts` - Restore overrides from source  
   - `src/cli/generate.ts` - Generate overrides via LLM

4. **Parser Updates**
   - Calculate sessionLineNumber during parsing
   - Set ordinals for sessions and events
   - Associate attorneys with witness called events

5. **TrialCorpus Seed Data**
   - Create JSON seed file for Gilstrap Trials corpus
   - Map all current trials to corpus

### 10. Data Formats

#### TrialCorpus Seed Format
```json
{
  "corpus": {
    "name": "Gilstrap Trials",
    "description": "Trials from Judge Rodney Gilstrap, Eastern District of Texas",
    "trials": [
      { 
        "shortName": "42 Vocalife Amazon",
        "shortNameHandle": "vocalife-amazon",
        "caseNumber": "2:19-CV-00123-JRG"
      },
      { 
        "shortName": "01 Genband",
        "shortNameHandle": "genband", 
        "caseNumber": "2:16-CV-00348-JRG"
      }
    ]
  }
}
```

#### Custom Configuration Format (trial-configs/custom/)
```json
{
  "pageHeaderLines": 3,
  "orderedFiles": ["file1.txt", "file2.txt"],
  "questionPatterns": ["Q.", "Question:"]
}
```

#### Entity Override Format (overrides/attorneys.json)
```json
{
  "attorneys": [
    {
      "name": "John Doe",
      "speakerPrefix": "MR. DOE",
      "role": "PLAINTIFF",
      "lawFirmName": "Doe & Associates"
    }
  ]
}
```

### 11. Success Criteria

- [ ] TrialCorpus entity created and seeded
- [ ] Trial.shortName and shortNameHandle fields populated
- [ ] Custom configuration files in trial-configs/custom/
- [ ] Merged configuration files in trial-configs/merged/[shortNameHandle]/
- [ ] Entity override files managed in source and destination directories
- [ ] Ordinal fields populated correctly (Session.ordinal, TrialEvent.ordinal)
- [ ] Line.sessionLineNumber calculated accurately
- [ ] WitnessCalledEvent.attorneyId relationship added
- [ ] Attorney associations working through override files
- [ ] CLI commands for sync/restore/generate implemented
- [ ] LLM generation saves to destination overrides directory
- [ ] Backup system (.bk files) prevents data loss
- [ ] Configuration diff calculation working correctly

## Notes

- This feature provides foundational improvements for configuration and data management
- TrialCorpus enables future multi-corpus support and scoped search
- Custom configuration system reduces duplication (only store diffs)
- Entity override files enable manual and LLM-assisted data corrections
- Ordinal fields enable better reporting and navigation
- Clear separation between source control (configs) and managed data (overrides)