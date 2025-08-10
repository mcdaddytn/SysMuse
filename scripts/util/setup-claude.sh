#!/bin/bash

echo "Setting up Claude Code configuration..."

# Create .claude directory if it doesn't exist
if [ ! -d "$HOME/.claude" ]; then
    echo "Creating ~/.claude directory..."
    mkdir -p "$HOME/.claude"
else
    echo "~/.claude directory already exists"
fi

# Create settings.json with model and login method
echo "Creating settings.json with Claude Opus 4.1 and claudeai login..."
cat > "$HOME/.claude/settings.json" << 'SETTINGS'
{
  "model": "claude-opus-4-1-20250805",
  "forceLoginMethod": "claudeai"
}
SETTINGS

# Verify the setup
echo ""
echo "✅ Setup complete!"
echo ""
echo "Configuration created at: ~/.claude/settings.json"
echo "Contents:"
cat "$HOME/.claude/settings.json"

