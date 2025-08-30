# CLI Usage Guide

## Overview
The Judicial Transcripts system uses a phased command-line interface for processing transcript files through multiple stages. All operations require a configuration file.

## Critical Requirements

### Configuration File is MANDATORY
- **ALL commands require a configuration JSON file**
- Command-line arguments alone are insufficient
- For Mac testing, always use: `config/example-trial-config-mac.json`

## Processing Phases

### Phase 0: Convert (PDF to Text)
Converts PDF transcript files to text format for processing.

```bash
npm run cli convert config/example-trial-config-mac.json
```

**What it does:**
- Reads PDF files from configured input directory
- Converts to text format preserving structure
- Saves text files for parsing phases

### Phase 1: Initial Parsing
Parses raw transcript text files into database structure.

```bash
npm run cli parse:phase1 config/example-trial-config-mac.json
```

**What it does:**
- Reads transcript text files from configured locations
- Parses transcript structure (sessions, pages, lines)
- Extracts metadata (page headers, line prefixes)
- Identifies speakers, attorneys, witnesses
- Creates initial database records (Trial, Session, Page, Line)

### Phase 2: Enhanced Processing
Enhances parsed data with pattern matching and relationships.

```bash
npm run cli parse:phase2 config/example-trial-config-mac.json
```

**What it does:**
- Links testimonies to witnesses
- Processes examination types
- Identifies document sections (SUMMARY, PROCEEDINGS, CERTIFICATION)
- Builds relationships between entities
- Applies pattern recognition for court activities

### Phase 3: Final Processing
Completes processing with advanced analysis and validation.

```bash
npm run cli parse:phase3 config/example-trial-config-mac.json
```

**What it does:**
- Validates all parsed data
- Creates search indices
- Generates final relationships
- Prepares data for export and analysis

## Configuration File Structure

The configuration file (`config/example-trial-config-mac.json`) contains:

```json
{
  "inputDirectory": "/path/to/transcript/files",
  "outputDirectory": "/path/to/output",
  "databaseConfig": {
    "connectionString": "postgresql://..."
  },
  "transcripts": [
    {
      "fileName": "transcript1.txt",
      "caseNumber": "2:19-CV-00123-JRG",
      "sessionDate": "2021-09-20"
    }
  ],
  "parsingOptions": {
    "enableDebugLogging": false,
    "preserveOriginalText": true
  }
}
```

## Complete Processing Workflow

For a fresh start with new transcript data:

```bash
# 1. Reset database (if needed)
npx prisma db push --force-reset
npx prisma generate

# 2. Load seed data
npm run seed

# 3. Convert PDFs to text (if starting from PDFs)
npm run cli convert config/example-trial-config-mac.json

# 4. Run Phase 1 parsing
npm run cli parse:phase1 config/example-trial-config-mac.json

# 5. Run Phase 2 enhancement
npm run cli parse:phase2 config/example-trial-config-mac.json

# 6. Run Phase 3 final processing
npm run cli parse:phase3 config/example-trial-config-mac.json
```

## Debugging and Testing

### View parsing results
```bash
# Check database after each phase
npm run prisma studio
```

### Run specific test transcript
Always use the test configuration for debugging:
```bash
npm run cli parse:phase1 config/example-trial-config-mac.json
```

### Common Issues

1. **Missing configuration file error**
   - Solution: Always provide the configuration file path

2. **Database connection issues**
   - Solution: Ensure Docker containers are running
   - Check: `docker ps` to verify containers

3. **Parsing errors**
   - Check logs in the output directory
   - Enable debug logging in configuration

## Future CLI Improvements

A redesign is planned (Feature-08) to simplify the CLI syntax:
- Shorter command structure
- Better phase naming
- Unified execution model
- Improved error messages

## Notes

- The current CLI uses a phase-based approach to allow incremental processing
- Each phase builds upon the previous one
- Database state can be backed up after each phase for testing
- No migrations are used during development - database is recreated as needed