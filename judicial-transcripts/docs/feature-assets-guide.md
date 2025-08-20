# Feature Assets Organization Guide

## Overview
This guide defines the standard structure for organizing feature-related assets including code excerpts, data files, seed data, and other supporting materials referenced in feature specification documents.

## Directory Structure

```
docs/
├── features/                      # Feature specification documents
│   ├── feature-01.md             # Feature spec document
│   ├── feature-02.md
│   └── ...
│
├── feature-assets/               # All feature-related assets
│   ├── feature-01/              # Assets for feature-01
│   │   ├── code/                # Code excerpts/examples
│   │   │   ├── example-parser.ts
│   │   │   └── sample-query.sql
│   │   ├── data/                # Raw data files
│   │   │   ├── input-data.csv
│   │   │   └── test-cases.xlsx
│   │   ├── seed/                # Converted seed data (JSON)
│   │   │   ├── attorneys.json
│   │   │   └── witnesses.json
│   │   ├── samples/             # Sample transcript excerpts
│   │   │   └── exhibit-handling.txt
│   │   └── README.md            # Asset inventory and notes
│   │
│   ├── feature-02/
│   │   ├── code/
│   │   ├── data/
│   │   ├── seed/
│   │   └── README.md
│   │
│   └── shared/                  # Assets used by multiple features
│       ├── common-patterns.json
│       └── utility-functions.ts
```

## Asset Categories

### 1. Code Assets (`code/`)
- **Purpose**: Reference implementations, algorithm examples, SQL queries
- **Formats**: `.ts`, `.js`, `.sql`, `.json`
- **Naming**: Descriptive names with appropriate extensions
- **Usage**: Referenced in feature specs for implementation guidance

### 2. Data Files (`data/`)
- **Purpose**: Raw input data that needs processing
- **Formats**: `.csv`, `.xlsx`, `.txt`, `.pdf`
- **Naming**: `[description]-[version].[ext]` (e.g., `attorney-list-v1.csv`)
- **Processing**: Document conversion process in feature spec

### 3. Seed Data (`seed/`)
- **Purpose**: JSON files ready for database seeding
- **Formats**: `.json` only
- **Structure**: Must match Prisma schema format
- **Naming**: Match database table names (e.g., `attorneys.json`, `witnesses.json`)

### 4. Sample Files (`samples/`)
- **Purpose**: Example transcript excerpts demonstrating patterns
- **Formats**: `.txt`, `.md`
- **Usage**: Testing pattern recognition and parsing logic

## Referencing Assets in Feature Specs

### Standard Reference Format
```markdown
## Required Assets

### Code References
- Parser implementation: [`feature-assets/feature-03/code/custom-parser.ts`](../feature-assets/feature-03/code/custom-parser.ts)
- SQL query: [`feature-assets/feature-03/code/analysis-query.sql`](../feature-assets/feature-03/code/analysis-query.sql)

### Data Files
- Attorney list (CSV): [`feature-assets/feature-03/data/attorneys.csv`](../feature-assets/feature-03/data/attorneys.csv)
  - Conversion required: CSV → JSON seed data
  - Target: [`feature-assets/feature-03/seed/attorneys.json`](../feature-assets/feature-03/seed/attorneys.json)

### Sample Transcripts
- Exhibit handling example: [`feature-assets/feature-03/samples/exhibit-pattern.txt`](../feature-assets/feature-03/samples/exhibit-pattern.txt)
```

## Asset Processing Workflow

### 1. CSV to JSON Seed Data Conversion

```markdown
## Data Conversion Instructions

### Source: `data/attorneys.csv`
Columns: 
- name (string)
- bar_number (string) 
- firm (string)
- role (enum: PLAINTIFF|DEFENDANT)

### Target: `seed/attorneys.json`
```json
[
  {
    "name": "John Smith",
    "barNumber": "12345",
    "firm": "Smith & Associates",
    "role": "PLAINTIFF"
  }
]
```

### Conversion Script
```bash
npm run convert:csv -- feature-assets/feature-03/data/attorneys.csv
```
```

### 2. Excel to JSON Conversion

```markdown
## Excel Data Processing

### Source: `data/witness-list.xlsx`
- Sheet: "Witnesses"
- Columns: A=Name, B=Type, C=Side

### Processing Steps:
1. Export sheet as CSV
2. Run conversion script
3. Validate against schema
4. Save to `seed/witnesses.json`
```

## Feature Asset README Template

Each feature asset directory should contain a README.md:

```markdown
# Feature-03 Assets

## Overview
Assets for Feature-03: Advanced Witness Testimony Parsing

## File Inventory

### Code (`code/`)
- `witness-parser.ts` - Custom parser for witness examination
- `testimony-query.sql` - SQL for testimony extraction

### Data (`data/`)
- `witnesses-v1.csv` - Initial witness list (50 records)
- `examination-types.xlsx` - Examination type mappings

### Seed (`seed/`)
- `witnesses.json` - Converted witness data (generated from CSV)
- `examination_types.json` - Examination type seed data

### Samples (`samples/`)
- `direct-examination.txt` - Sample direct examination
- `cross-examination.txt` - Sample cross examination

## Conversion Notes
- CSV conversion performed on 2024-01-15
- Excel data manually reviewed before conversion
- Seed data validated against schema v2.1

## Dependencies
- Feature-01 assets (shared patterns)
- Common utility functions
```

## Implementation Process

### For Feature Developers

1. **Create feature directory**:
   ```bash
   mkdir -p docs/feature-assets/feature-NN
   mkdir -p docs/feature-assets/feature-NN/{code,data,seed,samples}
   ```

2. **Add assets as needed**:
   - Place raw data in `data/`
   - Add code examples in `code/`
   - Convert data to JSON in `seed/`
   - Include samples in `samples/`

3. **Document in feature spec**:
   ```markdown
   ## Implementation Assets
   All supporting files are located in [`docs/feature-assets/feature-NN/`](../feature-assets/feature-NN/)
   
   See [`docs/feature-assets/feature-NN/README.md`](../feature-assets/feature-NN/README.md) for detailed inventory.
   ```

4. **Create asset README**:
   - List all files with descriptions
   - Document conversion processes
   - Note any dependencies

### For Claude/AI Implementation

When implementing a feature:

1. **Check for assets**:
   ```bash
   ls -la docs/feature-assets/feature-NN/
   ```

2. **Read asset README**:
   ```bash
   cat docs/feature-assets/feature-NN/README.md
   ```

3. **Process data files**:
   - Convert CSV/Excel to JSON if needed
   - Validate against schema
   - Save to appropriate seed directory

4. **Use code references**:
   - Review provided code examples
   - Adapt to current codebase conventions
   - Integrate with existing patterns

## Best Practices

### DO:
- ✅ Keep assets organized by feature
- ✅ Document all conversions and transformations
- ✅ Use relative links in markdown
- ✅ Validate seed data against schema
- ✅ Include sample data for testing
- ✅ Version data files when updating

### DON'T:
- ❌ Mix assets from different features
- ❌ Check in large binary files (use .gitignore)
- ❌ Use absolute paths in references
- ❌ Skip validation of seed data
- ❌ Delete raw data after conversion
- ❌ Hardcode values that should be in seed data

## Git Considerations

### .gitignore Patterns
```gitignore
# Large data files
docs/feature-assets/**/data/*.xlsx
docs/feature-assets/**/data/*.pdf
docs/feature-assets/**/data/*.zip

# Keep CSV files under 1MB
!docs/feature-assets/**/data/*.csv

# Always include seed data
!docs/feature-assets/**/seed/*.json

# Include all code and samples
!docs/feature-assets/**/code/*
!docs/feature-assets/**/samples/*
```

## Utility Scripts

### CSV to JSON Converter
Location: `scripts/convert-csv-to-json.ts`

Usage:
```bash
npm run convert:csv -- \
  --input docs/feature-assets/feature-03/data/attorneys.csv \
  --output docs/feature-assets/feature-03/seed/attorneys.json \
  --schema attorney
```

### Data Validator
Location: `scripts/validate-seed-data.ts`

Usage:
```bash
npm run validate:seed -- docs/feature-assets/feature-03/seed/attorneys.json
```

## Examples

### Feature with CSV Data
See: `docs/feature-assets/example-csv/` for a complete example of CSV data conversion

### Feature with Code Excerpts
See: `docs/feature-assets/example-code/` for code organization patterns

### Feature with Sample Transcripts
See: `docs/feature-assets/example-samples/` for transcript excerpt organization