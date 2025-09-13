# Feature 09A: Background LLM Service

## Overview
Automated LLM-based service for generating contextual summaries and profiles for attorneys, trials, and other judicial transcript entities using ChatGPT and other LLM providers.

## Objectives
1. Generate comprehensive attorney profiles focusing on IP litigation background
2. Create trial summaries with case outcomes and notable performances
3. Build a scalable service for batch processing LLM requests
4. Support future expansion for witness examination analysis with contextual enhancement

## Implementation Components

### 1. Attorney Profile Generation
- Query attorneys linked to law firms from database
- Generate prompts requesting one-page summaries focusing on:
  - Professional background and achievements
  - IP litigation experience and notable cases
  - Educational background
  - Notable verdicts or settlements
- Output format: `{attorneyFingerprint}_profile_prompt.txt` and `{attorneyFingerprint}_profile_response.txt`

### 2. Trial Summary Generation
- Extract trial metadata including:
  - Trial name and case number
  - Date range of sessions
  - Plaintiff and defendant information
  - Law firms involved
- Generate summaries covering:
  - Public case knowledge
  - Verdict and awards
  - Notable performances by attorneys
  - Precedential value and impact on future cases
- Output format: `{trialShortNameHandle}_summary_prompt.txt` and `{trialShortNameHandle}_summary_response.txt`

### 3. Service Architecture

#### Directory Structure
```
output/
├── attorneyProfiles/
│   ├── {attorneyFingerprint}_profile_prompt.txt
│   └── {attorneyFingerprint}_profile_response.txt
└── trialSummaries/
    ├── {trialShortNameHandle}_summary_prompt.txt
    └── {trialShortNameHandle}_summary_response.txt
```

#### Core Service Methods
1. **generatePrompts()**: Creates prompt files for specified entity type
2. **executeBatch()**: Processes prompts in configurable batch sizes (default: 5)
   - Scans for existing response files before batch creation
   - Filters out completed items (where response file exists)
   - Maintains natural query order for unprocessed items
3. **buildContext()**: Assembles contextual information from multiple sources

#### Batch Processing Logic
- **Pre-execution Check**:
  - Scan output directory for existing `*_response.txt` files
  - Build list of pending items (prompt exists but response doesn't)
  - Skip any items where response file already exists
- **Batch Formation**:
  - Select next N unprocessed items (where N = batch size)
  - Maintain database query order for consistency
  - Log skipped items for transparency
- **Execution**:
  - Process only pending items
  - Save responses immediately upon receipt
  - Update progress tracking

#### Smart Resume Capability
```javascript
// Pseudo-code for batch execution
async executeBatch(entityType, batchSize = 5) {
  const allPrompts = await getPromptFiles(entityType);
  const existingResponses = await getResponseFiles(entityType);

  const pending = allPrompts.filter(prompt =>
    !existingResponses.includes(getResponseFileName(prompt))
  );

  const batch = pending.slice(0, batchSize);

  for (const promptFile of batch) {
    const response = await callLLM(promptFile);
    await saveResponse(response);
  }
}
```

### 4. LLM Configuration Profiles

#### Multi-Provider Support
The service supports multiple LLM providers with configurable profiles. Each profile can be selected via command-line or defaults to the configured default profile.

#### Configuration Structure
```json
{
  "llmProfiles": {
    "default": "chatgpt",
    "profiles": {
      "chatgpt": {
        "provider": "openai",
        "model": "gpt-4",
        "apiKeyEnv": "OPENAI_API_KEY",
        "maxTokens": 2000,
        "temperature": 0.3,
        "systemPrompt": "You are an expert legal analyst specializing in IP litigation."
      },
      "chatgpt-turbo": {
        "provider": "openai",
        "model": "gpt-3.5-turbo",
        "apiKeyEnv": "OPENAI_API_KEY",
        "maxTokens": 1500,
        "temperature": 0.3,
        "systemPrompt": "You are an expert legal analyst specializing in IP litigation."
      },
      "claude": {
        "provider": "anthropic",
        "model": "claude-3-opus-20240229",
        "apiKeyEnv": "ANTHROPIC_API_KEY",
        "maxTokens": 2000,
        "temperature": 0.3,
        "systemPrompt": "You are an expert legal analyst specializing in IP litigation."
      },
      "claude-sonnet": {
        "provider": "anthropic",
        "model": "claude-3-sonnet-20240229",
        "apiKeyEnv": "ANTHROPIC_API_KEY",
        "maxTokens": 1500,
        "temperature": 0.3,
        "systemPrompt": "You are an expert legal analyst specializing in IP litigation."
      },
      "gemini": {
        "provider": "google",
        "model": "gemini-pro",
        "apiKeyEnv": "GOOGLE_API_KEY",
        "maxTokens": 2000,
        "temperature": 0.3,
        "systemPrompt": "You are an expert legal analyst specializing in IP litigation."
      },
      "llama": {
        "provider": "ollama",
        "model": "llama2:70b",
        "baseUrl": "http://localhost:11434",
        "maxTokens": 2000,
        "temperature": 0.3,
        "systemPrompt": "You are an expert legal analyst specializing in IP litigation."
      }
    }
  },
  "processing": {
    "batchSize": 5,
    "retryAttempts": 3,
    "retryDelay": 1000,
    "skipExisting": true,
    "overwritePrompts": false,
    "logSkipped": true
  },
  "output": {
    "baseDir": "output",
    "attorneyDir": "attorneyProfiles",
    "trialDir": "trialSummaries"
  }
}
```

### 5. LangChain Integration
- Support for multiple LLM providers via LangChain adapters
- Dynamic provider selection based on profile
- Configurable model parameters per profile
- Token usage tracking per provider
- Response validation

### 6. Future Expansion
- **Witness Examination Analysis**:
  - Combine trial summary, attorney profile, and witness background
  - Analyze question patterns and examination strategies
  - Identify key moments and objections
- **Cross-Reference Context Building**:
  - Pull context from existing LLM results
  - Build hierarchical context chains
  - Support for multi-file context aggregation

## Technical Requirements
- LangChain for unified LLM integration
- Provider-specific SDKs (OpenAI, Anthropic, Google)
- Environment variables for API keys
- Database connectivity for entity queries
- File system management for output organization
- File existence checking for resume capability

## CLI Commands
```bash
# Generate attorney profiles with default LLM profile
npm run background-llm attorneys --generate-prompts
npm run background-llm attorneys --execute-batch --batch-size=5

# Generate with specific LLM profile
npm run background-llm attorneys --execute-batch --llm-profile=claude
npm run background-llm trials --execute-batch --llm-profile=chatgpt-turbo

# Generate trial summaries (uses default profile)
npm run background-llm trials --generate-prompts
npm run background-llm trials --execute-batch --batch-size=5

# Full pipeline with profile override
npm run background-llm attorneys --full --llm-profile=gemini
npm run background-llm trials --full --llm-profile=claude-sonnet

# Status check
npm run background-llm status --type=attorneys
npm run background-llm status --type=trials

# List available LLM profiles
npm run background-llm list-profiles
```

## Profile Selection Logic
1. Check for `--llm-profile` command-line argument
2. If provided, validate profile exists in configuration
3. If not provided, use `default` profile from configuration
4. If profile doesn't exist, throw error with list of available profiles
5. Load profile-specific configuration and API keys

## Success Criteria
1. Successfully generate prompts for all attorneys with law firm associations
2. Successfully generate prompts for all trials with metadata
3. Process batches without exceeding API rate limits
4. Generate coherent, factual summaries
5. Maintain consistent output format and file naming
6. Resume processing from last incomplete item
7. No duplicate API calls for completed items
8. Support seamless switching between LLM providers

## Dependencies
- LangChain (unified LLM interface)
- OpenAI SDK
- Anthropic SDK
- Google Generative AI SDK
- Ollama (for local models)
- Prisma client for database access
- File system utilities (fs/promises)

## Error Handling
- Graceful handling of API failures
- Provider-specific error handling
- Retry logic with exponential backoff
- Partial batch completion tracking
- Clear error logging with provider context
- Fallback to default profile on provider failure (optional)

## Progress Tracking
- Display total items to process
- Show completed items count
- Display current LLM profile in use
- Estimate time remaining based on batch processing rate
- Log skipped items with existing responses
- Track token usage and costs per provider