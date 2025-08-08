# README.md

# Judicial Transcripts System

A comprehensive system for parsing, analyzing, and searching judicial trial transcripts from LexisNexis and other sources.

## Features

- **Three-Phase Processing Pipeline**
  - Phase 1: Raw parsing of PDF/text transcript files
  - Phase 2: Grouping lines into logical trial events
  - Phase 3: Creating section markers and searchable text blocks

- **Advanced Search Capabilities**
  - ElasticSearch integration for full-text search
  - Search within specific trial sections
  - Pattern-based marker detection

- **Flexible Export Options**
  - Generate clean, readable transcripts
  - Create abridged versions with placeholders
  - AI-powered synopsis generation (future feature)

## Tech Stack

- **Backend**: Node.js, TypeScript, Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Search**: ElasticSearch
- **AI/ML**: LangChain with Anthropic Claude
- **Infrastructure**: Docker, Docker Compose

## Prerequisites

- Node.js 18+ and npm
- Docker and Docker Compose
- PostgreSQL (or use Docker)
- ElasticSearch (or use Docker)

## Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd judicial-transcripts
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Start Docker services**
```bash
docker-compose up -d
```

5. **Set up the database**
```bash
npm run prisma:generate
npm run prisma:migrate
npm run seed
```

## Usage

### Command Line Interface

The system provides a CLI for all major operations:

```bash
# Parse transcripts (all phases)
npm run parse -- --config ./config/my-config.json --all

# Run specific phases
npm run parse -- --phase1  # Raw parsing only
npm run parse -- --phase2  # Line grouping only
npm run parse -- --phase3  # Section markers only

# Reset database
npm run parse -- reset --confirm

# Seed database
npm run parse -- seed
```

### Configuration

Create a configuration JSON file for your trial:

```json
{
  "transcriptPath": "./transcripts/case-123",
  "format": "txt",
  "caseName": "VocalLife vs Amazon",
  "caseNumber": "2:19-CV-123-JRG",
  "phases": {
    "phase1": true,
    "phase2": true,
    "phase3": true
  },
  "elasticsearchOptions": {
    "url": "http://localhost:9200",
    "index": "judicial_transcripts"
  }
}
```

### File Structure

Place your transcript files in a directory with naming convention:
```
transcripts/
  case-123/
    Excerpt1_1001_Morn_JurySelection.txt
    Excerpt2_1001_Aft_OpeningStatements.txt
    ...
```

## Database Schema

The system uses a comprehensive schema with the following key entities:

- **Trial**: Main case information
- **Session**: Individual court sessions (morning/afternoon)
- **Page/Line**: Raw transcript data
- **TrialEvent**: Grouped logical events
- **Marker**: Section boundaries and searchable blocks
- **Attorney/Witness**: Participant tracking

## Processing Phases

### Phase 1: Raw Parsing
- Extracts trial metadata from summary pages
- Parses individual lines with timestamps
- Creates page and session records
- Identifies speakers and court directives

### Phase 2: Line Grouping
- Groups consecutive lines into logical events
- Identifies statement boundaries
- Tracks witness examinations
- Detects court directives

### Phase 3: Section Markers
- Creates paired markers (e.g., jury in/out)
- Detects objections and rulings
- Generates searchable text blocks
- Indexes content in ElasticSearch

## Development

### Running Tests
```bash
npm test
```

### Database Management
```bash
# View database in Prisma Studio
npm run prisma:studio

# Reset database
npm run prisma:reset

# Generate Prisma client
npm run prisma:generate
```

### ElasticSearch Management

Access Kibana at http://localhost:5601 for ElasticSearch management.

## Seed Data

The system includes comprehensive seed data:
- Court directive types
- Search patterns for objections
- System configuration parameters

## API Endpoints (Future)

The system is designed to support REST API endpoints for:
- Upload transcript files
- Query processing status
- Search transcripts
- Export formatted transcripts

## Contributing

1. Follow TypeScript best practices
2. Keep files under 10KB when possible
3. Add logging for debugging
4. Update seed data for new patterns
5. Test with sample transcripts

## License

[License information here]

## Support

For issues or questions, please [contact information here]

## Additional Setup Notes

## Quick Setup Commands

# Install dependencies
npm install

# Start Docker services
docker-compose up -d

# Wait for services
sleep 10

# Generate Prisma client
npm run prisma:generate

# Create database schema
npx prisma db push

# Seed the database
npm run seed

# Test the setup
npm run parse -- --help


Testing the System

Place test transcript files in the transcripts/ directory
Create a config file for your trial (or use example-trial-config.json)
Run the parser:

npm run parse -- --config ./config/example-trial-config.json --all

# gm, above not working, started testing with below options, above you are not supplying a subcommand


# gm, variant for windows (not sure needed)
npm run parse -- --config "config/example-trial-config.json" --all

# these work, need subcommand not sure what extra -- will do above, there are several subcommands
# need a summary from LLM on how to call client
npm run parse parse --directory "F:\\docs\\rj\\JudicialAccess\\Transcripts\\VocalLivevAmazonMix\\pdf-text-extract" --phase1

npm run parse parse -d "F:\\docs\\rj\\JudicialAccess\\Transcripts\\VocalLivevAmazonMix\\pdf-text-extract" --phase1
# not picking up my directory with above command

# lets try
npm run parse parse --config ./config/example-trial-config.json --phase1
# config is not passed in
npm run parse parse --config "config/example-trial-config.json" --phase1
#not picking up my config, works (reads config when I set it as default in parse.ts
#  .option('-c, --config <path>', 'Path to configuration JSON file', './config/example-trial-config.json')


# gm, added after above tests:
New patterns from updated sessions:

# Correct command structure:
npm run parse parse --config "./config/example-trial-config.json" --phase1

# Run all phases:
npm run parse parse --config "./config/example-trial-config.json" --all

# Override directory in config:
npm run parse parse --config "./config/example-trial-config.json" --directory "F:\\docs\\rj\\JudicialAccess\\Transcripts\\VocalLivevAmazonMix\\pdf-text-extract" --phase1

# config is picked up with these npx commands, not sure if phase overrides whats in config
npx ts-node src/cli/parse.ts parse --config "./config/example-trial-config.json" --phase1
npx ts-node src/cli/parse.ts parse --config "./config/example-trial-config.json" --phase2

# changed to (still does not work config option from npm version, parse subcommand now extract):
npx ts-node src/cli/parse.ts extract --config "./config/example-trial-config.json" --phase1

# to reset databae:
npm run parse reset --confirm
npx ts-node src/cli/parse.ts reset --confirm

Then 
#if necessary with changes
npm run prisma:generate
# always to push schema after deleting db
npx prisma db push



Start the API (optional):

npm run api
# or
npm start

Access services:


API: http://localhost:3000
Kibana: http://localhost:5601
Prisma Studio: npm run prisma:studio


Common Issues and Solutions
Issue: Cannot find module errors
Solution: Check all import paths are updated correctly
Issue: Prisma client not generated
Solution: Run npm run prisma:generate
Issue: Database connection failed
Solution:

Ensure Docker is running: docker-compose up -d
Check DATABASE_URL in .env file

Issue: ElasticSearch not connecting
Solution:

Check if ElasticSearch is running: curl http://localhost:9200
Wait for it to fully start (can take 30-60 seconds)

Issue: TypeScript compilation errors
Solution: Run npm run build to see specific errors, fix import paths

## this should be the latest, copy to project-structure.md
judicial-transcripts/
�
+-- .env.example                    # Environment variables template
+-- .env.test                       # Test environment configuration
+-- .eslintrc.json                  # ESLint configuration
+-- .gitignore                      # Git ignore patterns
+-- docker-compose.yml              # Docker services configuration
+-- jest.config.js                  # Jest testing configuration
+-- Makefile                        # Build and run commands
+-- package.json                    # Node.js dependencies and scripts
+-- README.md                       # Project documentation
+-- tsconfig.json                   # TypeScript configuration
+-- project-structure.md            # This file
�
+-- config/                         # Configuration files
�   +-- default-config.json        # Default parsing configuration
�   +-- example-trial-config.json  # Example trial configuration
�
+-- prisma/                         # Database schema
�   +-- schema.prisma              # Prisma ORM schema definition
�
+-- scripts/                        # Utility scripts
�   +-- process-trial.ts           # Standalone trial processing script
�   +-- setup.sh                   # System setup script
�
+-- seed-data/                     # Database seed data
�   +-- court-directives.json     # Court directive types
�   +-- search-patterns.json      # Search pattern definitions
�   +-- system-config.json        # System configuration parameters
�
+-- src/                           # Source code
    +-- api/                       # REST API
    �   +-- server.ts             # Express server and endpoints
    �
    +-- cli/                       # Command line interface
    �   +-- parse.ts              # CLI commands for parsing
    �
    +-- config/                    # Configuration modules
    �   +-- patterns.ts           # Parsing patterns and regex
    �
    +-- parsers/                   # Transcript parsers (all phases)
    �   +-- LineParser.ts         # Parse individual lines
    �   +-- PageHeaderParser.ts   # Parse page headers
    �   +-- Phase2Processor.ts    # Phase 2: Line grouping
    �   +-- Phase3Processor.ts    # Phase 3: Section markers
    �   +-- SummaryPageParser.ts  # Parse summary pages
    �   +-- TranscriptParser.ts   # Phase 1: Main parser
    �
    +-- seed/                      # Database seeding
    �   +-- seedDatabase.ts       # Seed script
    �
    +-- services/                  # Business logic services
    �   +-- ElasticSearchService.ts    # ElasticSearch integration
    �   +-- SearchService.ts           # Search functionality
    �   +-- SynopsisGenerator.ts       # AI synopsis generation
    �   +-- TranscriptExportService.ts # Export transcripts
    �
    +-- tests/                     # All test files (simplified structure)
    �   +-- LineParser.test.ts    # Line parser tests
    �   +-- SearchService.test.ts # Search service tests
    �   +-- TranscriptParser.test.ts # Transcript Parser tests
    �   +-- setup.ts              # Test setup and mocks
    �
    +-- types/                     # TypeScript type definitions
    �   +-- config.types.ts       # Configuration types
    �   +-- patterns.types.ts     # Pattern types
    �
    +-- utils/                     # Utility functions
    �   +-- file-helpers.ts       # File operations
    �   +-- logger.ts             # Winston logger
    �   +-- validation.ts         # Input validation
    �
    +-- index.ts                   # Main entry point
    


## almost, but added transcript parser test above
judicial-transcripts/
�
+-- .env.example                    # Environment variables template
+-- .env.test                       # Test environment configuration
+-- .eslintrc.json                  # ESLint configuration
+-- .gitignore                      # Git ignore patterns
+-- docker-compose.yml              # Docker services configuration
+-- jest.config.js                  # Jest testing configuration
+-- Makefile                        # Build and run commands
+-- package.json                    # Node.js dependencies and scripts
+-- README.md                       # Project documentation
+-- tsconfig.json                   # TypeScript configuration
+-- project-structure.md            # This file
�
+-- config/                         # Configuration files
�   +-- default-config.json        # Default parsing configuration
�   +-- example-trial-config.json  # Example trial configuration
�
+-- prisma/                         # Database schema
�   +-- schema.prisma              # Prisma ORM schema definition
�
+-- scripts/                        # Utility scripts
�   +-- process-trial.ts           # Standalone trial processing script
�   +-- setup.sh                   # System setup script
�
+-- seed-data/                     # Database seed data
�   +-- court-directives.json     # Court directive types
�   +-- search-patterns.json      # Search pattern definitions
�   +-- system-config.json        # System configuration parameters
�
+-- src/                           # Source code
    +-- api/                       # REST API
    �   +-- server.ts             # Express server and endpoints
    �
    +-- cli/                       # Command line interface
    �   +-- parse.ts              # CLI commands for parsing
    �
    +-- config/                    # Configuration modules
    �   +-- patterns.ts           # Parsing patterns and regex
    �
    +-- parsers/                   # Transcript parsers (all phases)
    �   +-- LineParser.ts         # Parse individual lines
    �   +-- PageHeaderParser.ts   # Parse page headers
    �   +-- Phase2Processor.ts    # Phase 2: Line grouping
    �   +-- Phase3Processor.ts    # Phase 3: Section markers
    �   +-- SummaryPageParser.ts  # Parse summary pages
    �   +-- TranscriptParser.ts   # Phase 1: Main parser
    �
    +-- seed/                      # Database seeding
    �   +-- seedDatabase.ts       # Seed script
    �
    +-- services/                  # Business logic services
    �   +-- ElasticSearchService.ts    # ElasticSearch integration
    �   +-- SearchService.ts           # Search functionality
    �   +-- SynopsisGenerator.ts       # AI synopsis generation
    �   +-- TranscriptExportService.ts # Export transcripts
    �
    +-- tests/                     # All test files (simplified structure)
    �   +-- LineParser.test.ts    # Line parser tests
    �   +-- SearchService.test.ts # Search service tests
    �   +-- setup.ts              # Test setup and mocks
    �
    +-- types/                     # TypeScript type definitions
    �   +-- config.types.ts       # Configuration types
    �   +-- patterns.types.ts     # Pattern types
    �
    +-- utils/                     # Utility functions
    �   +-- file-helpers.ts       # File operations
    �   +-- logger.ts             # Winston logger
    �   +-- validation.ts         # Input validation
    �
    +-- index.ts                   # Main entry point
    

## note this will be altered one more time for tests
Final Directory Structure Should Be:

judicial-transcripts/
+-- config/
+-- exports/            (created)
+-- logs/              (created)
+-- prisma/
�   +-- schema.prisma  (added)
+-- scripts/
+-- seed-data/
+-- src/
�   +-- __tests__/     (renamed from tests/)
�   �   +-- parsers/   (created)
�   �   +-- services/  (created)
�   �   +-- setup.ts
�   +-- api/
�   +-- cli/
�   +-- config/
�   +-- parsers/       (all parsers here)
�   +-- seed/
�   +-- services/
�   +-- types/
�   +-- utils/
�   +-- index.ts       (added)
+-- temp/              (created)
+-- transcripts/       (created)
+-- uploads/           (created)
+-- .env
+-- .env.example
+-- .env.test
+-- .eslintrc.json
+-- .gitignore
+-- docker-compose.yml
+-- jest.config.js
+-- Makefile           (renamed)
+-- package.json
+-- README.md
+-- tsconfig.json




