# LLM Configuration and API Keys

## Overview
The Judicial Transcripts system supports multiple LLM providers for entity extraction and data refinement. This guide covers API key setup, provider configuration, and model selection.

## Supported Providers

### 1. OpenAI (GPT Models)
- **Models**: gpt-4, gpt-4-turbo, gpt-3.5-turbo
- **Best for**: Complex legal entity extraction, high accuracy
- **Rate limits**: Varies by tier

### 2. Anthropic (Claude Models)
- **Models**: claude-3-opus, claude-3-sonnet, claude-3-haiku, claude-2.1
- **Best for**: Long context windows, nuanced understanding
- **Rate limits**: Varies by tier

### 3. Google (Gemini Models)
- **Models**: gemini-pro, gemini-1.5-pro, gemini-1.5-flash
- **Best for**: Multimodal capabilities, cost-effective
- **Rate limits**: Varies by tier

## API Key Configuration

### Method 1: Environment Variables (Recommended)

Create a `.env` file in the project root:

```bash
# OpenAI
OPENAI_API_KEY=sk-...your-key-here...

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...your-key-here...

# Google Gemini
GOOGLE_API_KEY=...your-key-here...

# Default provider (optional)
LLM_PROVIDER=openai  # or anthropic, google
LLM_MODEL=gpt-4      # specific model name
```

### Method 2: System Environment Variables

#### macOS/Linux:
```bash
# Add to ~/.bashrc, ~/.zshrc, or ~/.bash_profile
export OPENAI_API_KEY="sk-...your-key-here..."
export ANTHROPIC_API_KEY="sk-ant-...your-key-here..."
export GOOGLE_API_KEY="...your-key-here..."
export LLM_PROVIDER="openai"
export LLM_MODEL="gpt-4"
```

#### Windows:
```cmd
# Command Prompt (temporary)
set OPENAI_API_KEY=sk-...your-key-here...
set ANTHROPIC_API_KEY=sk-ant-...your-key-here...
set GOOGLE_API_KEY=...your-key-here...

# PowerShell (permanent)
[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", "sk-...", "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "sk-ant-...", "User")
[Environment]::SetEnvironmentVariable("GOOGLE_API_KEY", "...", "User")
```

### Method 3: Configuration File

Update `config/system-config.json`:

```json
{
  "llm": {
    "defaultProvider": "openai",
    "providers": {
      "openai": {
        "apiKey": "${OPENAI_API_KEY}",  // References env var
        "models": {
          "gpt-4": {
            "maxTokens": 4000,
            "temperature": 0.1
          },
          "gpt-4-turbo": {
            "maxTokens": 8000,
            "temperature": 0.1
          }
        }
      },
      "anthropic": {
        "apiKey": "${ANTHROPIC_API_KEY}",
        "models": {
          "claude-3-opus": {
            "maxTokens": 4000,
            "temperature": 0.1
          },
          "claude-3-sonnet": {
            "maxTokens": 4000,
            "temperature": 0.2
          }
        }
      },
      "google": {
        "apiKey": "${GOOGLE_API_KEY}",
        "models": {
          "gemini-pro": {
            "maxTokens": 4000,
            "temperature": 0.1
          },
          "gemini-1.5-pro": {
            "maxTokens": 8000,
            "temperature": 0.1
          }
        }
      }
    }
  }
}
```

## Obtaining API Keys

### OpenAI
1. Visit [OpenAI Platform](https://platform.openai.com/)
2. Sign in or create an account
3. Navigate to API Keys section
4. Click "Create new secret key"
5. Copy and save the key securely

### Anthropic
1. Visit [Anthropic Console](https://console.anthropic.com/)
2. Sign in or create an account
3. Navigate to API Keys
4. Generate a new API key
5. Copy and save the key securely

### Google Gemini
1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with Google account
3. Click "Create API Key"
4. Select your project or create new
5. Copy and save the key securely

## CLI Usage with Different Providers

### Specify Provider and Model
```bash
# Using OpenAI GPT-4
npx ts-node src/cli/override.ts extract \
  --trial-id 1 \
  --provider openai \
  --model gpt-4

# Using Anthropic Claude
npx ts-node src/cli/override.ts extract \
  --trial-id 1 \
  --provider anthropic \
  --model claude-3-opus

# Using Google Gemini
npx ts-node src/cli/override.ts extract \
  --trial-id 1 \
  --provider google \
  --model gemini-pro
```

### Regenerate with Specific Model
```bash
# Regenerate using Claude for better context understanding
npx ts-node src/cli/override.ts regenerate \
  --config multi-trial-config.json \
  --provider anthropic \
  --model claude-3-sonnet \
  --save-prompts
```

### Environment Variable Override
```bash
# Temporary override for single command
LLM_PROVIDER=anthropic LLM_MODEL=claude-3-opus \
  npx ts-node src/cli/override.ts extract --trial-id 1
```

## Model Selection Guidelines

### For Entity Extraction
- **Complex cases with many attorneys**: GPT-4 or Claude-3-opus
- **Simple cases**: GPT-3.5-turbo or Gemini-flash
- **Large batches**: Gemini-1.5-flash (cost-effective)

### For Data Refinement
- **Accuracy critical**: Claude-3-opus or GPT-4
- **Context-heavy**: Claude models (larger context window)
- **Quick iterations**: GPT-3.5-turbo or Gemini-pro

### Cost Optimization
1. **Development/Testing**: Use smaller models (GPT-3.5-turbo, Claude-haiku, Gemini-flash)
2. **Production**: Use larger models for accuracy (GPT-4, Claude-opus)
3. **Batch Processing**: Consider Gemini for cost-effectiveness

## Troubleshooting

### Invalid API Key
```
Error: Invalid API key for provider X
```
**Solution**: Verify key is correct and has not expired

### Rate Limiting
```
Error: Rate limit exceeded
```
**Solution**: 
- Implement exponential backoff
- Upgrade API tier
- Switch to different provider temporarily

### Model Not Available
```
Error: Model X not available for your account
```
**Solution**: 
- Check account tier and permissions
- Use alternative model
- Contact provider support

### No API Key Found
```
Error: No API key found for provider X
```
**Solution**:
1. Check environment variables are set
2. Verify .env file is in project root
3. Ensure variable names are correct

## Security Best Practices

1. **Never commit API keys** to version control
   - Add `.env` to `.gitignore`
   - Use environment variables

2. **Rotate keys regularly**
   - Set expiration reminders
   - Monitor usage

3. **Use separate keys** for development and production
   - Limit development key permissions
   - Monitor production usage

4. **Store keys securely**
   - Use secret management services in production
   - Encrypt keys at rest

## Provider-Specific Features

### OpenAI
- Function calling support
- JSON mode for structured output
- Fine-tuning capabilities

### Anthropic
- 200k token context window (Claude-3)
- Constitutional AI for safety
- Better at following complex instructions

### Google Gemini
- Multimodal support (images + text)
- Competitive pricing
- Integration with Google Cloud services

## Configuration Examples

### High Accuracy Setup
```json
{
  "llm": {
    "defaultProvider": "anthropic",
    "model": "claude-3-opus",
    "temperature": 0.0,
    "maxTokens": 4000
  }
}
```

### Fast Iteration Setup
```json
{
  "llm": {
    "defaultProvider": "openai",
    "model": "gpt-3.5-turbo",
    "temperature": 0.1,
    "maxTokens": 2000
  }
}
```

### Cost-Optimized Setup
```json
{
  "llm": {
    "defaultProvider": "google",
    "model": "gemini-1.5-flash",
    "temperature": 0.1,
    "maxTokens": 2000
  }
}
```