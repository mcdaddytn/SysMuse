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