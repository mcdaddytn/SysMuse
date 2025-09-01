# Documentation Conventions Guide

## Overview
This guide establishes conventions for creating and organizing documentation in the Judicial Transcripts project. All Claude sessions and contributors should follow these conventions to maintain consistency.

## Directory Structure

All documentation MUST be placed under the `docs/` directory with the following structure:

```
docs/
├── features/           # Feature specification files
├── feature-assets/     # Supporting assets for features
├── impl/              # Implementation guides and status documents
├── development-notes/ # Development notes and research
└── *.md              # General documentation files
```

## File Naming Conventions

### Feature Files
- **Location**: `docs/features/`
- **Format**: `feature-XXX.md` where XXX is the feature ID (e.g., 02A, 03B)
- **DO NOT** add descriptive suffixes to the filename
  - ✅ Correct: `feature-02M.md`
  - ❌ Wrong: `feature-02M-regression-fixes.md`
- The feature description should be in the file content, not the filename

### Implementation Guides
- **Location**: `docs/impl/`
- **Format**: `feature-XXX-implementation.md`
- **Purpose**: Detailed documentation of how a feature was implemented
- **Example**: `feature-02P-implementation.md`

### Status Documents
- **Location**: `docs/impl/`
- **Format**: `STATUS-FEATURE-XXX.md`
- **Purpose**: Capture test results, current state, or investigation findings
- **Example**: `STATUS-FEATURE-02B.md`
- Use STATUS documents when testing something and capturing observations

### Feature Assets
- **Location**: `docs/feature-assets/feature-XXX/`
- **Structure**: Each feature gets its own subdirectory
- **Contents**: Code samples, data files, configuration examples
- **Include**: A README.md explaining the assets

## Script Files

### Build and Test Scripts
- **Location**: `scripts/` directory (NOT in docs)
- **Shell scripts**: `*.sh` for Unix/Mac
- **Batch files**: `*.bat` for Windows
- **Examples**:
  - `scripts/run-phase1-all.sh`
  - `scripts/reset-elasticsearch.sh`
  - `scripts/test-all-queries.sh`

### Database Scripts
- **Location**: `scripts/db/` for database-specific scripts
- **Examples**:
  - `scripts/db/backupdb.sh`
  - `scripts/db/restoredb.sh`

## Content Guidelines

### Feature Specifications
1. Use clear, numbered sections
2. Include acceptance criteria
3. Reference related features
4. Provide examples where applicable

### Implementation Guides
1. Document the approach taken
2. List files modified/created
3. Include code snippets for key changes
4. Note any challenges or decisions made
5. Reference the feature specification

### Status Documents
1. Include date/timestamp
2. Document the current state
3. List what was tested
4. Capture results and observations
5. Note any issues or next steps

## Version Control Best Practices

1. **Check in all documentation** - Documentation is part of the codebase
2. **Use meaningful commit messages** - Reference feature IDs where applicable
3. **Keep documentation updated** - Update docs when implementation changes

## Special Files

### CLAUDE.md
- **Location**: Project root
- **Purpose**: Instructions for Claude sessions
- **Update**: When project conventions or key information changes

### Database Testing Guide
- **Location**: `docs/database-testing-guide.md`
- **Purpose**: Critical database operations and testing procedures

### Coding Conventions
- **Location**: `docs/coding-conventions.md`
- **Purpose**: Code style and implementation patterns

## Examples

### Creating a New Feature
1. Create specification: `docs/features/feature-04A.md`
2. Create assets directory: `docs/feature-assets/feature-04A/`
3. Add README: `docs/feature-assets/feature-04A/README.md`
4. After implementation: `docs/impl/feature-04A-implementation.md`
5. If testing: `docs/impl/STATUS-FEATURE-04A.md`

### Documenting a Fix
1. Create status doc: `docs/impl/STATUS-FEATURE-XXX.md`
2. Document the issue, investigation, and solution
3. Update relevant implementation guide if needed

## Quick Reference

| Document Type | Location | Naming Format | Example |
|--------------|----------|---------------|---------|
| Feature Spec | `docs/features/` | `feature-XXX.md` | `feature-02M.md` |
| Implementation | `docs/impl/` | `feature-XXX-implementation.md` | `feature-02M-implementation.md` |
| Status | `docs/impl/` | `STATUS-FEATURE-XXX.md` | `STATUS-FEATURE-02M.md` |
| Assets | `docs/feature-assets/` | `feature-XXX/` | `feature-02M/` |
| Scripts | `scripts/` | `*.sh` or `*.bat` | `run-phase1-all.sh` |

## Important Notes

- Never place documentation in the project root (except CLAUDE.md)
- Always use the established naming conventions
- Keep filenames concise - details go in the content
- Check existing documentation before creating new files
- Update this guide if new conventions are established