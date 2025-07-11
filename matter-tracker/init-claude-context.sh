#!/bin/bash

# Script to initialize Claude Code with project context
# Usage: ./init-claude-context.sh [feature-name]

FEATURE=$1

echo "Initializing Claude Code context..."
echo "================================"
echo ""
echo "Project Guidelines:"
echo "- .claude/project-guidelines.md"
echo "- .claude/coding-conventions.md"
echo "- .claude/architecture-overview.md"
echo ""

if [ -n "$FEATURE" ]; then
    echo "Feature Requirements:"
    echo "- docs/features/${FEATURE}-requirements.md"
    echo ""
fi

echo "Instructions for Claude Code:"
echo "-----------------------------"
echo "Please read the following files to understand this project:"
echo "1. Start with .claude/project-guidelines.md for coding standards"
echo "2. Review .claude/architecture-overview.md for system design"

if [ -n "$FEATURE" ]; then
    echo "3. Read docs/features/${FEATURE}-requirements.md for the feature to implement"
    echo ""
    echo "After reading these files, please confirm you understand:"
    echo "- The coding conventions to follow"
    echo "- The architecture patterns in use"
    echo "- The specific feature requirements"
    echo ""
    echo "Then we can begin implementation following our established patterns."
else
    echo ""
    echo "When you're ready, I'll provide the specific feature requirements."
fi