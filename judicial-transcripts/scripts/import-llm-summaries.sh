#!/bin/bash

# Import LLM Summaries Script
# Usage: ./import-llm-summaries.sh <source_path>
# Example: ./import-llm-summaries.sh "/Users/gmac/GrassLabel Dropbox/Grass Label Home/docs/docsxfer/jud-tran"

# Check if source path is provided
if [ $# -eq 0 ]; then
    echo "Usage: $0 <source_path>"
    echo "Example: $0 \"/Users/gmac/GrassLabel Dropbox/Grass Label Home/docs/docsxfer/jud-tran\""
    exit 1
fi

SOURCE_PATH="$1"
DEST_PATH="output"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Verify source path exists
if [ ! -d "$SOURCE_PATH" ]; then
    echo -e "${RED}Error: Source path does not exist: $SOURCE_PATH${NC}"
    exit 1
fi

echo -e "${GREEN}Starting LLM Summaries Import${NC}"
echo "Source: $SOURCE_PATH"
echo "Destination: $DEST_PATH"
echo ""

# 1. Copy attorneyProfiles
if [ -d "$SOURCE_PATH/attorneyProfiles" ]; then
    echo -e "${YELLOW}Copying attorneyProfiles...${NC}"
    if [ ! -d "$DEST_PATH/attorneyProfiles" ]; then
        mkdir -p "$DEST_PATH/attorneyProfiles"
    fi
    cp -r "$SOURCE_PATH/attorneyProfiles/"* "$DEST_PATH/attorneyProfiles/" 2>/dev/null
    COUNT=$(ls -1 "$DEST_PATH/attorneyProfiles" 2>/dev/null | wc -l)
    echo -e "${GREEN}✓ Copied $COUNT attorney profiles${NC}"
else
    echo -e "${YELLOW}⚠ No attorneyProfiles directory found in source${NC}"
fi

# 2. Copy trialSummaries
if [ -d "$SOURCE_PATH/trialSummaries" ]; then
    echo -e "${YELLOW}Copying trialSummaries...${NC}"
    if [ ! -d "$DEST_PATH/trialSummaries" ]; then
        mkdir -p "$DEST_PATH/trialSummaries"
    fi
    cp -r "$SOURCE_PATH/trialSummaries/"* "$DEST_PATH/trialSummaries/" 2>/dev/null
    COUNT=$(ls -1 "$DEST_PATH/trialSummaries" 2>/dev/null | wc -l)
    echo -e "${GREEN}✓ Copied $COUNT trial summaries${NC}"
else
    echo -e "${YELLOW}⚠ No trialSummaries directory found in source${NC}"
fi

# 3. Copy LLMSummary1 directories for matching trials in markersections
if [ -d "$SOURCE_PATH/markersections" ] && [ -d "$DEST_PATH/markersections" ]; then
    echo -e "${YELLOW}Copying LLMSummary1 directories for matching trials...${NC}"
    COPIED_COUNT=0
    SKIPPED_COUNT=0
    
    # Iterate through destination trials
    for DEST_TRIAL_DIR in "$DEST_PATH/markersections"/*; do
        if [ -d "$DEST_TRIAL_DIR" ]; then
            TRIAL_NAME=$(basename "$DEST_TRIAL_DIR")
            SOURCE_TRIAL_DIR="$SOURCE_PATH/markersections/$TRIAL_NAME"
            
            # Check if corresponding source trial exists
            if [ -d "$SOURCE_TRIAL_DIR" ]; then
                SOURCE_LLM_DIR="$SOURCE_TRIAL_DIR/LLMSummary1"
                
                # Check if LLMSummary1 exists in source
                if [ -d "$SOURCE_LLM_DIR" ]; then
                    echo "  Copying: $TRIAL_NAME/LLMSummary1"
                    # Remove existing LLMSummary1 if it exists (to overwrite)
                    if [ -d "$DEST_TRIAL_DIR/LLMSummary1" ]; then
                        rm -rf "$DEST_TRIAL_DIR/LLMSummary1"
                    fi
                    cp -r "$SOURCE_LLM_DIR" "$DEST_TRIAL_DIR/"
                    COPIED_COUNT=$((COPIED_COUNT + 1))
                else
                    echo "  No LLMSummary1 found for: $TRIAL_NAME"
                fi
            else
                echo "  Skipping: $TRIAL_NAME (not found in source)"
                SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
            fi
        fi
    done
    
    echo -e "${GREEN}✓ Copied LLMSummary1 for $COPIED_COUNT trials${NC}"
    if [ $SKIPPED_COUNT -gt 0 ]; then
        echo -e "${YELLOW}  Skipped $SKIPPED_COUNT trials (not found in source)${NC}"
    fi
else
    echo -e "${YELLOW}⚠ markersections directory not found in source or destination${NC}"
fi

echo ""
echo -e "${GREEN}Import completed successfully!${NC}"

# Show summary
echo ""
echo "Summary:"
if [ -d "$DEST_PATH/attorneyProfiles" ]; then
    COUNT=$(ls -1 "$DEST_PATH/attorneyProfiles" 2>/dev/null | wc -l)
    echo "  - Attorney Profiles: $COUNT files"
fi
if [ -d "$DEST_PATH/trialSummaries" ]; then
    COUNT=$(ls -1 "$DEST_PATH/trialSummaries" 2>/dev/null | wc -l)
    echo "  - Trial Summaries: $COUNT files"
fi
if [ -d "$DEST_PATH/markersections" ]; then
    COUNT=$(find "$DEST_PATH/markersections" -type d -name "LLMSummary1" 2>/dev/null | wc -l)
    echo "  - Marker Section LLM Summaries: $COUNT directories"
fi