# Feature 09D Implementation Guide

## How to Add New Summary Components

This guide explains how to add new summary components to the LLM summary generation system.

## Overview

The system is designed to be extensible. Adding a new summary component requires updates to:
1. Configuration file
2. Context template
3. GUI integration (if applicable)
4. Database mapping (if new section type)

## Step-by-Step Guide

### Example: Adding Plaintiff Rebuttal (Completed)

We'll use the recently added Plaintiff Rebuttal as a complete example.

### Step 1: Update Configuration File

**File**: `config/llm-summaries.json`

Add the new component to the appropriate summary type:

```json
{
  "summaryTypes": {
    "LLMSummary1": {
      "components": [
        // ... existing components ...
        {
          "name": "Plaintiff_Rebuttal",
          "sourceFile": "FullText/Plaintiff_Rebuttal.txt",
          "contextTemplate": "plaintiff-rebuttal-context.txt",
          "dependencies": ["trialSummary"],
          "outputFile": "Plaintiff_Rebuttal.txt"
        }
      ]
    }
  }
}
```

**Configuration Fields**:
- `name`: Component identifier (must match CLI parameter)
- `sourceFile`: Path to source text relative to trial directory
- `contextTemplate`: Template filename in `templates/` directory
- `dependencies`: Required dependencies (usually ["trialSummary"])
- `outputFile`: Output filename in LLMSummary directory

### Step 2: Create Context Template

**Directory**: `templates/`
**File**: `plaintiff-rebuttal-context.txt` (or your component name)

Template structure:
```text
Analyze the following [COMPONENT TYPE] from an intellectual property trial.
Provide a strategic analysis (1-2 pages) that examines:

TRIAL CONTEXT:
{{trialSummary}}

[COMPONENT] TO ANALYZE:
{{sourceText}}

ANALYSIS REQUIREMENTS:

1. [SPECIFIC ANALYSIS POINT 1]
- Sub-point
- Sub-point

2. [SPECIFIC ANALYSIS POINT 2]
- Sub-point
- Sub-point

[Additional sections as needed]

FORMAT: Provide a flowing narrative analysis, not a bullet-point list.
```

**Template Variables**:
- `{{trialSummary}}`: Automatically replaced with trial summary
- `{{sourceText}}`: Automatically replaced with source transcript
- `{{trialName}}`: Trial name (optional)
- `{{componentType}}`: Component type (optional)

### Step 3: Update GUI Integration (If Needed)

**File**: `src/services/SummaryService.ts`

If the component maps to a new MarkerSectionType, add the mapping:

```typescript
let llmFileName = '';
if (section.markerSectionType === 'OPENING_STATEMENT_PLAINTIFF') {
  llmFileName = 'Plaintiff_Opening_Statement.txt';
}
// ... other mappings ...
else if (section.markerSectionType === 'CLOSING_REBUTTAL_PLAINTIFF') {
  llmFileName = 'Plaintiff_Rebuttal.txt';  // NEW
}
```

### Step 4: Ensure Source Files Exist

The source files must be present in `output/markersections/[Trial]/FullText/`

Check availability:
```bash
find output/markersections/*/FullText -name "Plaintiff_Rebuttal.txt" | wc -l
```

### Step 5: Generate Summaries

**Single Trial**:
```bash
npm run background-llm -- trial-components \
  --trial "01 Genband" \
  --components "Plaintiff_Rebuttal"
```

**Batch Processing**:
```bash
npm run background-llm -- trial-components --batch \
  --trials "01 Genband,02 Contentguard,03 Core Wireless" \
  --components "Plaintiff_Rebuttal"
```

**All Components** (includes new component automatically):
```bash
npm run background-llm -- trial-components \
  --trial "01 Genband" \
  --components "all"
```

## Common Component Types to Add

### 1. Defense Rebuttal
```json
{
  "name": "Defense_Rebuttal",
  "sourceFile": "FullText/Defense_Rebuttal.txt",
  "contextTemplate": "defense-rebuttal-context.txt",
  "dependencies": ["trialSummary"],
  "outputFile": "Defense_Rebuttal.txt"
}
```

### 2. Jury Instructions
```json
{
  "name": "Jury_Instructions",
  "sourceFile": "FullText/Jury_Instructions.txt",
  "contextTemplate": "jury-instructions-context.txt",
  "dependencies": ["trialSummary"],
  "outputFile": "Jury_Instructions.txt"
}
```

### 3. Expert Witness Testimony
```json
{
  "name": "Expert_Witness_[Name]",
  "sourceFile": "FullText/WitTest_[Name].txt",
  "contextTemplate": "expert-witness-context.txt",
  "dependencies": ["trialSummary", "witnessProfile"],
  "outputFile": "Expert_[Name].txt"
}
```

## Adding a New Summary Type (LLMSummary2, etc.)

### Step 1: Define in Configuration

```json
{
  "summaryTypes": {
    "LLMSummary2": {
      "description": "Witness examination analysis",
      "outputDir": "LLMSummary2",
      "llmProfile": "claude-sonnet",
      "outputFormat": "2-3 pages",
      "components": [
        {
          "name": "Plaintiff_Key_Witness",
          "sourceFile": "FullText/WitTest_[Name].txt",
          "contextTemplate": "witness-examination-context.txt",
          "dependencies": ["trialSummary", "attorneyProfile"],
          "outputFile": "Plaintiff_Key_Witness.txt"
        }
      ]
    }
  }
}
```

### Step 2: Use in CLI

```bash
npm run background-llm -- trial-components \
  --trial "01 Genband" \
  --summary-type "LLMSummary2" \
  --components "all"
```

## Testing New Components

### 1. Verify Configuration
```bash
cat config/llm-summaries.json | jq '.summaryTypes.LLMSummary1.components[] | select(.name=="Plaintiff_Rebuttal")'
```

### 2. Check Template
```bash
ls -la templates/*rebuttal*
```

### 3. Test Single Generation
```bash
npm run background-llm -- trial-components \
  --trial "01 Genband" \
  --components "Plaintiff_Rebuttal"
```

### 4. Verify Output
```bash
ls -la output/markersections/"01 Genband"/LLMSummary1/Plaintiff_Rebuttal.txt
```

### 5. Test API Access
```typescript
// src/scripts/test-component.ts
const summary = await summaryService.getSummary(sectionId, 'llmsummary1');
console.log(summary);
```

## Troubleshooting

### Issue: Component Not Generating

**Check**:
1. Source file exists: `ls output/markersections/*/FullText/[Component].txt`
2. Configuration is correct: `cat config/llm-summaries.json`
3. Template exists: `ls templates/[template-name].txt`
4. Dependencies exist (trial summary)

### Issue: GUI Not Showing Summary

**Check**:
1. MarkerSectionType mapping in `SummaryService.ts`
2. Database has the section: Check with prisma query
3. API returns summary: Test with curl/postman

### Issue: Batch Processing Fails

**Solutions**:
1. Reduce batch size: `--batch-size 5`
2. Check for special characters in trial names
3. Ensure all trials have required dependencies

## Best Practices

### 1. Template Design
- Keep analysis focused (1-2 pages)
- Use clear section headers
- Include specific analysis points
- Request narrative format, not bullets

### 2. Naming Conventions
- Component names: `[Party]_[Type]_[Descriptor].txt`
- Templates: `[party]-[type]-context.txt`
- Maintain consistency with existing patterns

### 3. Dependency Management
- Always require trialSummary for context
- Add other dependencies sparingly
- Document why each dependency is needed

### 4. Testing
- Test with one trial before batch processing
- Verify output quality manually
- Check GUI integration immediately

## Advanced Topics

### Custom LLM Profiles

Add to `config/llm-models.json`:
```json
{
  "profiles": {
    "gpt4-turbo": {
      "provider": "openai",
      "model": "gpt-4-turbo",
      "maxTokens": 4000,
      "temperature": 0.3
    }
  }
}
```

Use in configuration:
```json
{
  "llmProfile": "gpt4-turbo"
}
```

### Conditional Components

For components that may not exist in all trials:
```json
{
  "name": "Plaintiff_Rebuttal",
  "sourceFile": "FullText/Plaintiff_Rebuttal.txt",
  "optional": true,  // Skip if source doesn't exist
  "dependencies": ["trialSummary"],
  "outputFile": "Plaintiff_Rebuttal.txt"
}
```

### Multiple Source Files

For components combining multiple sources:
```json
{
  "name": "All_Expert_Testimony",
  "sourceFiles": [
    "FullText/WitTest_Expert1.txt",
    "FullText/WitTest_Expert2.txt"
  ],
  "combineMethod": "concatenate",
  "contextTemplate": "all-experts-context.txt",
  "dependencies": ["trialSummary"],
  "outputFile": "All_Expert_Testimony.txt"
}
```

## Maintenance Checklist

When adding new components:
- [ ] Update `config/llm-summaries.json`
- [ ] Create context template in `templates/`
- [ ] Update `SummaryService.ts` if new section type
- [ ] Test with single trial
- [ ] Test batch processing
- [ ] Verify GUI integration
- [ ] Update documentation
- [ ] Commit configuration and template files

## Support

For issues or questions:
1. Check existing components for examples
2. Review error logs in `output/batch-llm-summaries.log`
3. Test with verbose output: Add logging to `BackgroundLLMService`
4. Verify dependencies are properly generated