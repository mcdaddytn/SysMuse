# Background LLM Service Guide

## Overview
The Background LLM Service generates AI-powered profiles and summaries for attorneys and trials using configurable LLM providers. It supports batch processing with resume capability and multiple LLM profiles.

## Prerequisites

### Required Environment Variables
Set these in your `.env` file based on which LLM providers you plan to use:

```bash
# For OpenAI (ChatGPT)
OPENAI_API_KEY=your-openai-api-key

# For Anthropic (Claude)
ANTHROPIC_API_KEY=your-anthropic-api-key

# For Google (Gemini)
GOOGLE_API_KEY=your-google-api-key
```

### Database Setup
Ensure your database is populated with attorney and trial data:
```bash
npm run prisma:generate
npm run seed  # If you have seed data
```

## Quick Start

### 1. List Available LLM Profiles
```bash
npm run background-llm list-profiles
```

This shows all configured LLM profiles:
- `chatgpt` (default) - OpenAI GPT-4
- `chatgpt-turbo` - OpenAI GPT-3.5 Turbo
- `claude` - Anthropic Claude 3 Opus
- `claude-sonnet` - Anthropic Claude 3 Sonnet
- `gemini` - Google Gemini Pro

### 2. Generate Attorney Profiles

#### Full Pipeline (Recommended for first run)
```bash
# Using default ChatGPT
npm run background-llm attorneys --full

# Using a specific LLM profile
npm run background-llm attorneys --full --llm-profile=claude

# With custom batch size
npm run background-llm attorneys --full --batch-size=10
```

#### Step-by-Step Approach
```bash
# Step 1: Generate prompt files
npm run background-llm attorneys --generate-prompts

# Step 2: Execute batch processing
npm run background-llm attorneys --execute-batch --batch-size=5

# Continue processing remaining items
npm run background-llm attorneys --execute-batch --batch-size=5
```

### 3. Generate Trial Summaries

#### Full Pipeline
```bash
# Using default settings
npm run background-llm trials --full

# Using specific profile and batch size
npm run background-llm trials --full --llm-profile=gemini --batch-size=3
```

#### Step-by-Step Approach
```bash
# Generate prompts
npm run background-llm trials --generate-prompts

# Process in batches
npm run background-llm trials --execute-batch --llm-profile=chatgpt-turbo
```

### 4. Check Progress
```bash
# Check attorney profile generation status
npm run background-llm status --type=attorneys

# Check trial summary generation status
npm run background-llm status --type=trials
```

## Output Structure

All generated files are stored in the `output/` directory:

```
output/
├── attorneyProfiles/
│   ├── john_doe_12345_profile_prompt.txt     # Generated prompt
│   └── john_doe_12345_profile_response.txt   # LLM response
└── trialSummaries/
    ├── apple_v_samsung_summary_prompt.txt    # Generated prompt
    └── apple_v_samsung_summary_response.txt  # LLM response
```

## Resume Capability

The service automatically tracks completed items by checking for existing response files. When you run batch processing:

1. It scans for existing `*_response.txt` files
2. Skips any items that already have responses
3. Processes only pending items
4. Maintains the original database query order

This means you can safely interrupt processing and resume later without duplicating API calls.

## Advanced Usage

### Custom Configuration File
Create a custom configuration file (e.g., `config/llm-config.json`):

```json
{
  "llmProfiles": {
    "default": "chatgpt-turbo",
    "profiles": {
      "custom-gpt": {
        "provider": "openai",
        "model": "gpt-4-turbo-preview",
        "apiKeyEnv": "OPENAI_API_KEY",
        "maxTokens": 3000,
        "temperature": 0.5,
        "systemPrompt": "You are a senior legal analyst with 20 years of IP litigation experience."
      }
    }
  },
  "processing": {
    "batchSize": 10,
    "retryAttempts": 5,
    "retryDelay": 2000,
    "skipExisting": true,
    "overwritePrompts": false,
    "logSkipped": false
  }
}
```

Use the custom config:
```bash
npm run background-llm attorneys --full --config=config/llm-config.json
```

### Regenerate Prompts
If you need to regenerate prompts (e.g., after updating the prompt template), modify the config to set `overwritePrompts: true` or manually delete the prompt files.

### Processing Specific Attorneys or Trials
Currently, the service processes all attorneys with law firm associations and all trials. To process specific subsets, you would need to modify the service queries in `src/services/background-llm.ts`.

## Troubleshooting

### API Key Issues
```bash
# Verify environment variables are set
echo $OPENAI_API_KEY
echo $ANTHROPIC_API_KEY
echo $GOOGLE_API_KEY
```

### Rate Limiting
If you encounter rate limiting errors:
1. Reduce batch size: `--batch-size=2`
2. Increase retry delay in configuration
3. Use a different LLM profile with higher rate limits

### Missing Dependencies
```bash
# Ensure all dependencies are installed
npm install
npm run prisma:generate
```

### Database Connection Issues
```bash
# Check database is running
npm run docker:up

# Verify database has data
npm run prisma:studio
```

## Cost Considerations

- **ChatGPT (GPT-4)**: ~$0.03 per 1K tokens (most expensive, highest quality)
- **ChatGPT Turbo (GPT-3.5)**: ~$0.002 per 1K tokens (cost-effective)
- **Claude Opus**: ~$0.015 per 1K tokens (high quality)
- **Claude Sonnet**: ~$0.003 per 1K tokens (cost-effective)
- **Gemini Pro**: Free tier available, then usage-based

Each attorney profile or trial summary typically uses 800-1500 tokens total (prompt + response).

## Future Enhancements

### Witness Examination Analysis (Planned)
The service is designed to support contextual analysis by combining multiple LLM outputs:

```javascript
// Future implementation example
const context = {
  trial: await readTrialSummary(trialId),
  attorney: await readAttorneyProfile(attorneyId),
  witness: await readWitnessBackground(witnessId)
};

const analysis = await analyzeExamination(transcriptText, context);
```

This will enable:
- Cross-examination strategy analysis
- Question pattern identification
- Objection analysis
- Key moment extraction

## Best Practices

1. **Start Small**: Test with `--batch-size=1` to verify everything works
2. **Monitor Costs**: Use cheaper models for initial testing
3. **Review Output**: Spot-check generated profiles for quality
4. **Backup Responses**: Periodically backup the `output/` directory
5. **Use Resume Feature**: Don't worry about interruptions - the service will resume where it left off

## Command Reference

```bash
# List all LLM profiles
npm run background-llm list-profiles

# Attorney profiles - full pipeline
npm run background-llm attorneys --full [--llm-profile=NAME] [--batch-size=N]

# Attorney profiles - generate prompts only
npm run background-llm attorneys --generate-prompts

# Attorney profiles - execute batch only
npm run background-llm attorneys --execute-batch [--llm-profile=NAME] [--batch-size=N]

# Trial summaries - full pipeline
npm run background-llm trials --full [--llm-profile=NAME] [--batch-size=N]

# Trial summaries - generate prompts only
npm run background-llm trials --generate-prompts

# Trial summaries - execute batch only
npm run background-llm trials --execute-batch [--llm-profile=NAME] [--batch-size=N]

# Check status
npm run background-llm status --type=attorneys
npm run background-llm status --type=trials
```