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
