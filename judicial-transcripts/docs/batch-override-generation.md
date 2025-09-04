# Batch Override Generation for All Trials

## Overview
This document provides commands and strategies for generating override files for all trials in the corpus using the Entity Override System.

## Approach Options

### Option 1: Transcript-Based Extraction
Extract entities directly from transcript headers (first 2 pages of first session).

**Pros:**
- Direct from source documents
- No dependency on parsing quality
- Captures all header information

**Cons:**
- Requires well-formatted headers
- May miss entities mentioned later

### Option 2: Database-Based Generation
Use existing parsed data from database after running phase1/phase2 parsing.

**Pros:**
- Leverages existing parsing work
- Can use SessionSection excerpts
- Includes all discovered entities

**Cons:**
- Depends on parsing quality
- Requires database population first

## Recommended Workflow

### Step 1: Prepare Trials
Ensure all trials are parsed to at least Phase 1:

```bash
# Parse all trials with multi-pass parser
for trial_dir in output/multi-trial/*/; do
  trial_name=$(basename "$trial_dir")
  echo "Parsing $trial_name..."
  
  # Create config for this trial
  cat > temp-config.json << EOF
{
  "trials": [{
    "shortName": "$trial_name",
    "inputPath": "$trial_dir",
    "outputPath": "$trial_dir"
  }]
}
EOF
  
  # Run phase1 parsing
  npx ts-node src/cli/parse.ts parse --phase1 \
    --config temp-config.json \
    --parser-mode multi-pass
done
```

### Step 2: Generate Overrides from Transcripts

#### Single Command for All Trials
```bash
# Extract entities from all trial transcripts
npx ts-node src/cli/override.ts extract \
  --all-trials "output/multi-trial" \
  --provider openai \
  --model gpt-4 \
  --output "output/overrides/all-trials.json" \
  --save-prompt
```

#### Individual Processing with Progress
```bash
# Process each trial individually for better control
trials_dir="output/multi-trial"
output_dir="output/overrides/individual"
mkdir -p "$output_dir"

for trial_dir in "$trials_dir"/*/; do
  trial_name=$(basename "$trial_dir")
  echo "Processing $trial_name..."
  
  npx ts-node src/cli/override.ts extract \
    --trial-path "$trial_dir" \
    --provider openai \
    --model gpt-4 \
    --output "$output_dir/${trial_name}.json" \
    --save-prompt
    
  # Optional: Import immediately
  # npx ts-node src/cli/override.ts import "$output_dir/${trial_name}.json"
  
  echo "Completed $trial_name"
  echo "---"
done
```

### Step 3: Database-Based Regeneration

If trials are already in the database:

```bash
# Get all trial IDs from database
trial_ids=$(docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts \
  -t -c "SELECT id FROM \"Trial\" ORDER BY id")

# Regenerate overrides for each trial
for trial_id in $trial_ids; do
  echo "Regenerating overrides for trial $trial_id..."
  
  npx ts-node src/cli/override.ts regenerate \
    --trial-id "$trial_id" \
    --provider openai \
    --model gpt-4 \
    --save-prompts \
    --output-dir "output/overrides/regenerated"
done
```

### Step 4: Batch Processing with Multi-Trial Config

Create a comprehensive configuration file:

```bash
# Generate multi-trial config from directory structure
cat > multi-trial-all.json << 'EOF'
{
  "includedTrials": [
EOF

# Add each trial to config
for trial_dir in output/multi-trial/*/; do
  trial_name=$(basename "$trial_dir")
  echo "    \"$trial_name\"," >> multi-trial-all.json
done

# Close the JSON
sed -i '$ s/,$//' multi-trial-all.json  # Remove last comma
cat >> multi-trial-all.json << 'EOF'
  ],
  "outputDir": "output/overrides/batch"
}
EOF

# Run batch regeneration
npx ts-node src/cli/override.ts regenerate \
  --config multi-trial-all.json \
  --provider openai \
  --model gpt-4 \
  --save-prompts
```

## CLI Commands Summary

### Extract from All Trials (Transcript-Based)
```bash
npx ts-node src/cli/override.ts extract \
  --all-trials "output/multi-trial" \
  --provider anthropic \
  --model claude-3-sonnet-20240229 \
  --save-prompt
```

### Regenerate from Database (All Trials)
```bash
# First, create a list of all trial IDs
echo "SELECT id FROM \"Trial\"" | \
  docker exec -i judicial-postgres psql -U judicial_user -d judicial_transcripts -t \
  > trial-ids.txt

# Process each trial
while read -r trial_id; do
  npx ts-node src/cli/override.ts regenerate \
    --trial-id "$trial_id" \
    --provider openai \
    --model gpt-4 \
    --save-prompts
done < trial-ids.txt
```

### Generate Prompts Only (No LLM Calls)
```bash
# Useful for reviewing prompts before running expensive LLM operations
for trial_dir in output/multi-trial/*/; do
  npx ts-node src/cli/override.ts extract \
    --trial-path "$trial_dir" \
    --save-prompt \
    --output "output/prompts-only/$(basename "$trial_dir").json"
done
```

## Progress Monitoring

### Simple Progress Counter
```bash
#!/bin/bash
total=$(ls -d output/multi-trial/*/ | wc -l)
current=0

for trial_dir in output/multi-trial/*/; do
  current=$((current + 1))
  echo "[$current/$total] Processing $(basename "$trial_dir")..."
  
  npx ts-node src/cli/override.ts extract \
    --trial-path "$trial_dir" \
    --provider openai \
    --model gpt-4 \
    --output "output/overrides/$(basename "$trial_dir").json"
done

echo "Completed $total trials"
```

### With Error Handling
```bash
#!/bin/bash
success=0
failed=0
failed_trials=""

for trial_dir in output/multi-trial/*/; do
  trial_name=$(basename "$trial_dir")
  
  if npx ts-node src/cli/override.ts extract \
    --trial-path "$trial_dir" \
    --provider openai \
    --model gpt-4 \
    --output "output/overrides/${trial_name}.json" 2>/dev/null; then
    success=$((success + 1))
    echo "✅ $trial_name"
  else
    failed=$((failed + 1))
    failed_trials="$failed_trials $trial_name"
    echo "❌ $trial_name"
  fi
done

echo "---"
echo "Success: $success"
echo "Failed: $failed"
if [ $failed -gt 0 ]; then
  echo "Failed trials:$failed_trials"
fi
```

## Optimization Tips

### 1. Use Cheaper Models for Initial Extraction
```bash
# First pass with GPT-3.5-turbo
--provider openai --model gpt-3.5-turbo

# Refinement with GPT-4 for problematic cases
--provider openai --model gpt-4
```

### 2. Parallel Processing
```bash
# Process 4 trials in parallel
ls -d output/multi-trial/*/ | xargs -P 4 -I {} bash -c '
  trial_dir="{}"
  trial_name=$(basename "$trial_dir")
  npx ts-node src/cli/override.ts extract \
    --trial-path "$trial_dir" \
    --provider openai \
    --model gpt-4 \
    --output "output/overrides/${trial_name}.json"
'
```

### 3. Batch by Provider
```bash
# Use different providers to avoid rate limits
# Google for first third
# OpenAI for second third  
# Anthropic for last third
```

## Next Steps (Future Implementation)

```typescript
// Proposed batch command implementation
program
  .command('batch-extract')
  .description('Extract entities from all trials in a directory')
  .option('--input-dir <dir>', 'Directory containing trial folders')
  .option('--output-dir <dir>', 'Directory for override files')
  .option('--provider <provider>', 'LLM provider')
  .option('--model <model>', 'LLM model')
  .option('--parallel <n>', 'Number of parallel processes', '1')
  .option('--resume', 'Resume from last processed trial')
  .option('--dry-run', 'Show what would be processed without executing')
  .action(async (options) => {
    // Implementation for efficient batch processing
    // - Progress tracking
    // - Error recovery
    // - Parallel execution
    // - Result aggregation
  });
```

## Validation After Batch Processing

```bash
# Count generated files
ls -1 output/overrides/*.json | wc -l

# Validate all generated JSON files
for file in output/overrides/*.json; do
  if ! jq empty "$file" 2>/dev/null; then
    echo "Invalid JSON: $file"
  fi
done

# Check for missing trials
for trial_dir in output/multi-trial/*/; do
  trial_name=$(basename "$trial_dir")
  if [ ! -f "output/overrides/${trial_name}.json" ]; then
    echo "Missing override for: $trial_name"
  fi
done
```

## Import All Generated Overrides

```bash
# Import all override files to database
for file in output/overrides/*.json; do
  echo "Importing $(basename "$file")..."
  npx ts-node src/cli/override.ts import "$file"
done
```