# Judicial Transcripts System - Project Structure

## Current Directory Structure

```
judicial-transcripts/
│
├── .env.example                    # Environment variables template
├── .env.test                       # Test environment configuration
├── .eslintrc.json                  # ESLint configuration
├── .gitignore                      # Git ignore patterns
├── docker-compose.yml              # Docker services configuration
├── jest.config.js                  # Jest testing configuration
├── Makefile                        # Build and run commands
├── package.json                    # Node.js dependencies and scripts
├── README.md                       # Project documentation
├── tsconfig.json                   # TypeScript configuration
├── project-structure.md            # This file
│
├── config/                         # Configuration files
│   ├── default-config.json        # Default parsing configuration
│   └── example-trial-config.json  # Example trial configuration
│
├── prisma/                         # Database schema
│   └── schema.prisma              # Prisma ORM schema definition
│
├── scripts/                        # Utility scripts
│   ├── process-trial.ts           # Standalone trial processing script
│   └── setup.sh                   # System setup script
│
├── seed-data/                     # Database seed data
│   ├── court-directives.json     # Court directive types
│   ├── search-patterns.json      # Search pattern definitions
│   └── system-config.json        # System configuration parameters
│
└── src/                           # Source code
    ├── api/                       # REST API
    │   └── server.ts             # Express server and endpoints
    │
    ├── cli/                       # Command line interface
    │   └── parse.ts              # CLI commands for parsing
    │
    ├── config/                    # Configuration modules
    │   └── patterns.ts           # Parsing patterns and regex
    │
    ├── parsers/                   # Transcript parsers (all phases)
    │   ├── LineParser.ts         # Parse individual lines
    │   ├── PageHeaderParser.ts   # Parse page headers
    │   ├── Phase2Processor.ts    # Phase 2: Line grouping
    │   ├── Phase3Processor.ts    # Phase 3: Section markers
    │   ├── SummaryPageParser.ts  # Parse summary pages
    │   └── TranscriptParser.ts   # Phase 1: Main parser
    │
    ├── seed/                      # Database seeding
    │   └── seedDatabase.ts       # Seed script
    │
    ├── services/                  # Business logic services
    │   ├── ElasticSearchService.ts    # ElasticSearch integration
    │   ├── SearchService.ts           # Search functionality
    │   ├── SynopsisGenerator.ts       # AI synopsis generation
    │   └── TranscriptExportService.ts # Export transcripts
    │
    ├── tests/                     # All test files (simplified structure)
    │   ├── LineParser.test.ts    # Line parser tests
    │   ├── SearchService.test.ts # Search service tests
    │   ├── TranscriptParser.test.ts # Transcript Parser tests
    │   └── setup.ts              # Test setup and mocks
    │
    ├── types/                     # TypeScript type definitions
    │   ├── config.types.ts       # Configuration types
    │   └── patterns.types.ts     # Pattern types
    │
    ├── utils/                     # Utility functions
    │   ├── file-helpers.ts       # File operations
    │   ├── logger.ts             # Winston logger
    │   └── validation.ts         # Input validation
    │
    └── index.ts                   # Main entry point

## old one below
judicial-transcripts/
│
├── .env.example                    # Environment variables template
├── .env.test                       # Test environment configuration
├── .eslintrc.json                  # ESLint configuration
├── .gitignore                      # Git ignore patterns
├── docker-compose.yml              # Docker services configuration
├── jest.config.js                  # Jest testing configuration
├── Makefile                        # Build and run commands (rename from Makefile.txt)
├── package.json                    # Node.js dependencies and scripts
├── README.md                       # Project documentation
├── tsconfig.json                   # TypeScript configuration
├── project-structure.md            # This file
│
├── config/                         # Configuration files
│   ├── default-config.json        # Default parsing configuration
│   └── example-trial-config.json  # Example trial configuration
│
├── prisma/                         # Database schema
│   └── schema.prisma              # Prisma ORM schema definition
│
├── scripts/                        # Utility scripts
│   ├── process-trial.ts           # Standalone trial processing script
│   └── setup.sh                   # System setup script
│
├── seed-data/                     # Database seed data
│   ├── court-directives.json     # Court directive types
│   ├── search-patterns.json      # Search pattern definitions
│   └── system-config.json        # System configuration parameters
│
└── src/                           # Source code
    ├── api/                       # REST API
    │   └── server.ts             # Express server and endpoints
    │
    ├── cli/                       # Command line interface
    │   └── parse.ts              # CLI commands for parsing
    │
    ├── config/                    # Configuration modules
    │   └── patterns.ts           # Parsing patterns and regex
    │
    ├── parsers/                   # Transcript parsers (all phases)
    │   ├── LineParser.ts         # Parse individual lines
    │   ├── PageHeaderParser.ts   # Parse page headers
    │   ├── Phase2Processor.ts    # Phase 2: Line grouping
    │   ├── Phase3Processor.ts    # Phase 3: Section markers
    │   ├── SummaryPageParser.ts  # Parse summary pages
    │   └── TranscriptParser.ts   # Phase 1: Main parser
    │
    ├── seed/                      # Database seeding
    │   └── seedDatabase.ts       # Seed script
    │
    ├── services/                  # Business logic services
    │   ├── ElasticSearchService.ts    # ElasticSearch integration
    │   ├── SearchService.ts           # Search functionality
    │   ├── SynopsisGenerator.ts       # AI synopsis generation
    │   └── TranscriptExportService.ts # Export transcripts
    │
    ├── __tests__/                 # Test files (rename from 'tests')
    │   ├── parsers/
    │   │   └── LineParser.test.ts
    │   ├── services/
    │   │   └── SearchService.test.ts
    │   └── setup.ts              # Test setup and mocks
    │
    ├── types/                     # TypeScript type definitions
    │   ├── config.types.ts       # Configuration types
    │   └── patterns.types.ts     # Pattern types
    │
    └── utils/                     # Utility functions
        ├── file-helpers.ts       # File operations
        ├── logger.ts             # Winston logger
        └── validation.ts         # Input validation
```

## Required Directories (create if not exist)

```
├── logs/                          # Application logs
├── uploads/                       # Uploaded transcript files
├── exports/                       # Exported transcripts
├── transcripts/                   # Input transcript files
└── temp/                          # Temporary files
```

## File Organization Notes

### Parser Files Location
All parser files have been consolidated into the `src/parsers/` directory:
- Phase 1 parsers: `TranscriptParser.ts`, `LineParser.ts`, `PageHeaderParser.ts`, `SummaryPageParser.ts`
- Phase 2 processor: `Phase2Processor.ts`
- Phase 3 processor: `Phase3Processor.ts`

### Import Path Updates Required
Since parsers are now in a single directory, update imports in these files:

1. **TranscriptParser.ts** - Update imports:
```typescript
import { SummaryPageParser } from './SummaryPageParser';
import { LineParser } from './LineParser';
import { PageHeaderParser } from './PageHeaderParser';
```

2. **Phase2Processor.ts** - Already correct

3. **Phase3Processor.ts** - Already correct

4. **cli/parse.ts** - Update imports:
```typescript
import { TranscriptParser } from '../parsers/TranscriptParser';
import { Phase2Processor } from '../parsers/Phase2Processor';
import { Phase3Processor } from '../parsers/Phase3Processor';
```

### Missing Files to Add

1. **prisma/schema.prisma** - Copy from the artifact "judicial-transcripts-schema"
2. **src/index.ts** - Main entry point (if needed)

### Corrections Needed

1. Rename `Makefile.txt` to `Makefile`
2. Rename `src/tests/` directory to `src/__tests__/`
3. Create subdirectories in `__tests__`:
   - `src/__tests__/parsers/`
   - `src/__tests__/services/`

## Development Workflow

### Initial Setup
```bash
# Install dependencies
npm install

# Run setup script
./scripts/setup.sh

# Or manually:
docker-compose up -d
npm run prisma:generate
npm run prisma:migrate
npm run seed
```

### Running the System
```bash
# Parse transcripts
npm run parse -- --config ./config/example-trial-config.json --all

# Start API server
npm run start

# Run tests
npm test
```

### Database Management
```bash
# View database
npm run prisma:studio

# Reset database
npm run prisma:reset

# Seed database
npm run seed
```

## Environment Variables

Required in `.env`:
- `DATABASE_URL` - PostgreSQL connection string
- `ELASTICSEARCH_URL` - ElasticSearch URL
- `ANTHROPIC_API_KEY` - API key for synopsis generation
- `LOG_LEVEL` - Logging level (info, warn, error)
- `PORT` - API server port (default: 3000)