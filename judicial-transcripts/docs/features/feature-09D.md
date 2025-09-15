# Feature 09D: Trial Component LLM Summary Generation

## Overview
Generate AI-powered summaries of specific trial transcript components (opening statements, closing statements, witness examinations) using configurable context templates and dependency management.

## Business Value
- Provides strategic analysis of trial components beyond raw transcript text
- Enables quick understanding of attorney strategies and key arguments
- Creates structured summaries highlighting patterns and tactics
- Supports comparative analysis between plaintiff and defense approaches

## Technical Specification

### Summary Types and Structure

#### LLMSummary1: Opening and Closing Statements
Location: `output/markersections/[Trial Name]/LLMSummary1/`

Components (matching FullText naming convention):
- `Plaintiff_Opening_Statement.txt`
- `Plaintiff_Closing_Statement.txt`
- `Defense_Opening_Statement.txt`
- `Defense_Closing_Statement.txt`

Dependencies:
- Trial summary from `output/trialSummaries/`
- Source text from `output/markersections/[Trial Name]/FullText/`

#### Future Summary Types (Placeholders)
- **LLMSummary2**: Individual witness examinations
  - Dependencies: Trial summary, attorney profiles, witness profiles
- **LLMSummary3**: Expert testimony analysis
  - Dependencies: Trial summary, expert profiles, technical documentation

### Context Templates

Each component type has its own context template:
- `templates/plaintiff-opening-context.txt`
- `templates/plaintiff-closing-context.txt`
- `templates/defense-opening-context.txt`
- `templates/defense-closing-context.txt`

Templates include:
1. Role-specific analysis prompts
2. Strategic focus areas
3. Placeholder for trial summary context
4. Expected output format (1-2 pages)

### Configuration

#### Summary Configuration File
`config/llm-summaries.json`:
```json
{
  "summaryTypes": {
    "LLMSummary1": {
      "description": "Opening and closing statement analysis",
      "components": [
        {
          "name": "Plaintiff_Opening_Statement",
          "sourceFile": "FullText/Plaintiff_Opening_Statement.txt",
          "contextTemplate": "plaintiff-opening-context.txt",
          "dependencies": ["trialSummary"],
          "outputFile": "Plaintiff_Opening_Statement.txt"
        },
        {
          "name": "Plaintiff_Closing_Statement",
          "sourceFile": "FullText/Plaintiff_Closing_Statement.txt",
          "contextTemplate": "plaintiff-closing-context.txt",
          "dependencies": ["trialSummary"],
          "outputFile": "Plaintiff_Closing_Statement.txt"
        },
        {
          "name": "Defense_Opening_Statement",
          "sourceFile": "FullText/Defense_Opening_Statement.txt",
          "contextTemplate": "defense-opening-context.txt",
          "dependencies": ["trialSummary"],
          "outputFile": "Defense_Opening_Statement.txt"
        },
        {
          "name": "Defense_Closing_Statement",
          "sourceFile": "FullText/Defense_Closing_Statement.txt",
          "contextTemplate": "defense-closing-context.txt",
          "dependencies": ["trialSummary"],
          "outputFile": "Defense_Closing_Statement.txt"
        }
      ],
      "outputFormat": "1-2 pages",
      "llmProfile": "claude-sonnet"
    }
  }
}
```

### CLI Interface

```bash
# Generate specific component summaries
npm run background-llm -- trial-components \
  --trial="04 Intellectual Ventures" \
  --components="Plaintiff_Opening_Statement,Defense_Closing_Statement" \
  --summary-type="LLMSummary1"

# Generate all components for a trial
npm run background-llm -- trial-components \
  --trial="04 Intellectual Ventures" \
  --all \
  --summary-type="LLMSummary1"

# Batch process multiple trials
npm run background-llm -- trial-components \
  --batch \
  --trials="01 Genband,04 Intellectual Ventures,05 Personalized Media v Zynga" \
  --summary-type="LLMSummary1"
```

### Implementation Details

#### Component Summary Service
- Extends `BackgroundLLMService` class
- Handles dependency checking and resolution
- Manages context template variable substitution
- Creates output directory structure
- Tracks completion status

#### Dependency Management
1. Check if required dependencies exist (e.g., trial summary)
2. Generate missing dependencies if needed
3. Load dependency content for context inclusion
4. Proceed with component summary generation

#### Context Building
1. Load component-specific template
2. Load source transcript text
3. Load dependency content (trial summary)
4. Substitute template variables:
   - `{{trialSummary}}`
   - `{{sourceText}}`
   - `{{trialName}}`
   - `{{componentType}}`

### Advanced Features (Future Implementation)

#### Advanced Feature 1: Cost Estimation
Add to `llm-models.json`:
```json
{
  "profiles": {
    "claude-sonnet": {
      "costs": {
        "inputTokensPer1K": 0.003,
        "outputTokensPer1K": 0.015
      }
    }
  }
}
```

CLI command:
```bash
npm run background-llm -- trial-components \
  --dry-run \
  --estimate-cost \
  --trial="04 Intellectual Ventures"
```

#### Advanced Feature 2: Dependency Tree Resolution
Automatic dependency resolution:
- Build dependency graph
- Topological sort for execution order
- Parallel execution where possible
- Wait for prerequisites before downstream tasks

### Testing Plan

1. Generate trial summaries for 5 trials (if not existing)
2. Generate 4 component summaries for each trial (20 total)
3. Verify output structure and content quality
4. Test dependency checking and generation
5. Validate context template substitution

### Success Criteria

- Successfully generates strategic analysis of statements
- Highlights attorney tactics and arguments
- Provides comparative insights between sides
- Maintains consistent 1-2 page output format
- Properly manages dependencies
- Creates organized output structure

### File Structure Example

```
output/
├── trialSummaries/
│   └── 04_intellectual_ventures_summary_response.txt
└── markersections/
    └── 04 Intellectual Ventures/
        ├── FullText/
        │   ├── Plaintiff_Opening_Statement.txt
        │   ├── Plaintiff_Closing_Statement.txt
        │   ├── Defense_Opening_Statement.txt
        │   └── Defense_Closing_Statement.txt
        ├── Abridged1/
        │   ├── Plaintiff_Opening_Statement.txt
        │   ├── Plaintiff_Closing_Statement.txt
        │   ├── Defense_Opening_Statement.txt
        │   └── Defense_Closing_Statement.txt
        └── LLMSummary1/
            ├── Plaintiff_Opening_Statement.txt
            ├── Plaintiff_Closing_Statement.txt
            ├── Defense_Opening_Statement.txt
            └── Defense_Closing_Statement.txt
```

Note: All summary directories use the same filename convention, allowing easy switching between summary types by changing only the directory name (FullText → Abridged1 → LLMSummary1).

### Error Handling

- Missing source files: Skip with warning
- Missing dependencies: Attempt generation or skip
- LLM failures: Retry with exponential backoff
- Partial completion: Track and resume

### Performance Considerations

- Batch API calls where possible
- Cache dependency content
- Parallel processing for independent components
- Progress tracking and resumption

## Implementation Priority

1. Core component summary generation
2. Dependency checking
3. Context template system
4. CLI interface
5. Testing with 5 trials
6. Advanced features (cost estimation, dependency trees)