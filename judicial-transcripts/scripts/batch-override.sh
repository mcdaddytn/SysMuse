#!/bin/bash
# Batch Override Generation Script
# Processes all trials in multi-trial output directory

# Configuration
INPUT_DIR="output/multi-trial"
OUTPUT_DIR="output/overrides/batch"
PROVIDER="${1:-openai}"
MODEL="${2:-gpt-4}"
SAVE_PROMPTS="${3:-false}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo "========================================="
echo "Batch Override Generation"
echo "========================================="
echo "Input: $INPUT_DIR"
echo "Output: $OUTPUT_DIR"
echo "Provider: $PROVIDER"
echo "Model: $MODEL"
echo "Save Prompts: $SAVE_PROMPTS"
echo "========================================="

# Check for API key
if [ "$PROVIDER" = "openai" ] && [ -z "$OPENAI_API_KEY" ]; then
    echo -e "${RED}Error: OPENAI_API_KEY not set${NC}"
    exit 1
elif [ "$PROVIDER" = "anthropic" ] && [ -z "$ANTHROPIC_API_KEY" ]; then
    echo -e "${RED}Error: ANTHROPIC_API_KEY not set${NC}"
    exit 1
elif [ "$PROVIDER" = "google" ] && [ -z "$GOOGLE_API_KEY" ]; then
    echo -e "${RED}Error: GOOGLE_API_KEY not set${NC}"
    exit 1
fi

# Count trials
TOTAL=$(ls -d "$INPUT_DIR"/*/ 2>/dev/null | wc -l)
if [ "$TOTAL" -eq 0 ]; then
    echo -e "${RED}No trials found in $INPUT_DIR${NC}"
    exit 1
fi

echo "Found $TOTAL trials to process"
echo ""

# Run batch extraction
if [ "$SAVE_PROMPTS" = "true" ]; then
    npx ts-node src/cli/override.ts batch-extract \
        --input-dir "$INPUT_DIR" \
        --output-dir "$OUTPUT_DIR" \
        --provider "$PROVIDER" \
        --model "$MODEL" \
        --save-prompts \
        --resume
else
    npx ts-node src/cli/override.ts batch-extract \
        --input-dir "$INPUT_DIR" \
        --output-dir "$OUTPUT_DIR" \
        --provider "$PROVIDER" \
        --model "$MODEL" \
        --resume
fi

# Check results
echo ""
echo "========================================="
echo "Validation"
echo "========================================="

# Count generated files
GENERATED=$(ls -1 "$OUTPUT_DIR"/*.json 2>/dev/null | wc -l)
echo "Generated override files: $GENERATED/$TOTAL"

# Validate JSON files
INVALID=0
for file in "$OUTPUT_DIR"/*.json; do
    if [ -f "$file" ]; then
        if ! jq empty "$file" 2>/dev/null; then
            echo -e "${RED}Invalid JSON: $(basename "$file")${NC}"
            INVALID=$((INVALID + 1))
        fi
    fi
done

if [ "$INVALID" -gt 0 ]; then
    echo -e "${YELLOW}Warning: $INVALID invalid JSON files found${NC}"
fi

# Check for missing trials
echo ""
echo "Checking for missing trials..."
MISSING=0
for trial_dir in "$INPUT_DIR"/*/; do
    trial_name=$(basename "$trial_dir")
    if [ ! -f "$OUTPUT_DIR/${trial_name}.json" ]; then
        echo -e "${YELLOW}Missing: $trial_name${NC}"
        MISSING=$((MISSING + 1))
    fi
done

if [ "$MISSING" -eq 0 ]; then
    echo -e "${GREEN}All trials have override files!${NC}"
else
    echo -e "${YELLOW}Missing override files: $MISSING${NC}"
fi

echo ""
echo "========================================="
echo "Summary"
echo "========================================="
echo "Total trials: $TOTAL"
echo "Generated files: $GENERATED"
echo "Invalid JSON: $INVALID"
echo "Missing files: $MISSING"
echo "Output directory: $OUTPUT_DIR"
echo ""

if [ "$GENERATED" -eq "$TOTAL" ] && [ "$INVALID" -eq 0 ]; then
    echo -e "${GREEN}✓ Batch processing completed successfully!${NC}"
    exit 0
else
    echo -e "${YELLOW}⚠ Batch processing completed with issues${NC}"
    exit 1
fi