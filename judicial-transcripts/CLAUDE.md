# Judicial Transcripts System

## Project Overview
System to parse judicial transcripts from Lexis Nexis and other sources into a database for advanced analysis, search (Elasticsearch + LLM), and flexible export capabilities.

## Key Documentation
- **Tech Stack & Conventions**: `docs/coding-conventions.md`
- **Source Material Format**: `docs/transcript-conventions.md`
- **Database & Testing**: `docs/database-testing-guide.md` ⚠️ MUST READ
- **API Design**: `api-documentation.md`
- **Architecture**: `project-structure.md`
- **Sample Data**: `samples/transcripts/`

## Feature Implementation
Features are defined in `docs/features/` directory. Each feature file contains complete specifications.

To implement a feature, use:
**"Implement docs/features/[feature-name].md"**

## Development Process
1. Read feature specification completely
2. Review relevant sample data in `samples/`
3. Follow conventions in `docs/coding-conventions.md`
4. Reference transcript format details in `docs/transcript-conventions.md`
5. Implement with tests and documentation