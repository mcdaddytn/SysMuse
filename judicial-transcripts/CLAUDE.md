# Judicial Transcripts System

## Project Overview
System to parse judicial transcripts from Lexis Nexis and other sources into a database for advanced analysis, search (Elasticsearch + LLM), and flexible export capabilities.

## Key Documentation
- **Tech Stack & Conventions**: `docs/coding-conventions.md`
- **Source Material Format**: `docs/transcript-conventions.md`
- **Database & Testing**: `docs/database-testing-guide.md` ⚠️ MUST READ
- **Pattern Abstraction**: `docs/pattern-abstraction-guide.md`
- **Feature Assets**: `docs/feature-assets-guide.md` ⚠️ IMPORTANT
- **API Design**: `api-documentation.md`
- **Architecture**: `project-structure.md`
- **Sample Data**: `samples/transcripts/`

## Feature Implementation
Features are defined in `docs/features/` directory. Each feature file contains complete specifications.
Supporting assets (code, data, samples) are in `docs/feature-assets/feature-NN/` directories.

To implement a feature:
1. **Read**: `docs/features/[feature-name].md`
2. **Check assets**: `docs/feature-assets/[feature-name]/README.md`
3. **Implement**: Follow the specification using provided assets

## Development Process
1. Read feature specification completely
2. Check for feature assets in `docs/feature-assets/feature-NN/`
3. Review relevant sample data in `samples/` and feature assets
4. Convert any CSV/Excel data to JSON seed format
5. Follow conventions in `docs/coding-conventions.md`
6. Reference transcript format details in `docs/transcript-conventions.md`
7. Implement with tests and documentation