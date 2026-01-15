#!/bin/bash

# Switch Claude Code model script

echo "Claude Code Model Switcher"
echo "=========================="
echo ""
echo "Select a model:"
echo "1) Claude Opus 4.1"
echo "2) Claude Sonnet 4.5"
echo "3) Claude Haiku 4 (latest)"
echo "4) Use default model (remove explicit setting)"
echo ""
read -p "Enter your choice (1-4): " choice

case $choice in
    1)
        MODEL="claude-opus-4-1-20250805"
        MODEL_NAME="Claude Opus 4.1"
        USE_DEFAULT=false
        ;;
    2)
        MODEL="claude-sonnet-4-5-20250929"
        MODEL_NAME="Claude Sonnet 4.5"
        USE_DEFAULT=false
        ;;
    3)
        MODEL="claude-haiku-4-20250514"
        MODEL_NAME="Claude Haiku 4"
        USE_DEFAULT=false
        ;;
    4)
        MODEL_NAME="Default Model"
        USE_DEFAULT=true
        ;;
    *)
        echo "Invalid choice. Exiting."
        exit 1
        ;;
esac

echo ""
echo "Switching to $MODEL_NAME..."

# Create .claude directory if it doesn't exist
if [ ! -d "$HOME/.claude" ]; then
    echo "Creating ~/.claude directory..."
    mkdir -p "$HOME/.claude"
fi

# Check if settings.json exists and read current content
if [ -f "$HOME/.claude/settings.json" ]; then
    # Read existing settings and update/remove model field
    # Using Python for JSON manipulation
    python3 << PYTHON_SCRIPT
import json
import os

settings_path = os.path.expanduser("~/.claude/settings.json")

# Read existing settings
try:
    with open(settings_path, 'r') as f:
        settings = json.load(f)
except:
    settings = {}

# Update or remove model
if '$USE_DEFAULT' == 'true':
    # Remove model field if it exists
    settings.pop('model', None)
else:
    # Set model field
    settings['model'] = '$MODEL'

# Write back
with open(settings_path, 'w') as f:
    json.dump(settings, f, indent=2)
PYTHON_SCRIPT
else
    # Create new settings.json
    if [ "$USE_DEFAULT" = "true" ]; then
        cat > "$HOME/.claude/settings.json" << SETTINGS_EOF
{
  "forceLoginMethod": "claudeai"
}
SETTINGS_EOF
    else
        cat > "$HOME/.claude/settings.json" << SETTINGS_EOF
{
  "model": "$MODEL",
  "forceLoginMethod": "claudeai"
}
SETTINGS_EOF
    fi
fi

echo ""
if [ "$USE_DEFAULT" = "true" ]; then
    echo "✅ Explicit model setting removed - using default model"
else
    echo "✅ Model switched to $MODEL_NAME"
fi
echo ""
echo "Configuration updated at: ~/.claude/settings.json"
echo "Current settings:"
cat "$HOME/.claude/settings.json"
echo ""
echo "⚠️  Please restart Claude Code for the change to take effect."
