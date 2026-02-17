#!/usr/bin/env bash
# fix-claude-code.sh
# Installs Claude Code (if needed) and ensures it's accessible on your PATH.
# Usage: bash fix-claude-code.sh

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*"; }

# ── 1. Check for Node.js ────────────────────────────────────────────
if ! command -v node &>/dev/null; then
    error "Node.js is not installed. Claude Code requires Node.js >= 18."
    echo "  Install via: https://nodejs.org or 'nvm install --lts'"
    exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if (( NODE_MAJOR < 18 )); then
    error "Node.js v${NODE_MAJOR} detected — Claude Code requires >= 18."
    echo "  Upgrade via: nvm install --lts"
    exit 1
fi
info "Node.js $(node -v) detected"

# ── 2. Check for npm ────────────────────────────────────────────────
if ! command -v npm &>/dev/null; then
    error "npm not found. Install Node.js which includes npm."
    exit 1
fi
info "npm $(npm -v) detected"

# ── 3. Determine npm global bin directory ────────────────────────────
NPM_GLOBAL_BIN="$(npm prefix -g)/bin"
info "npm global bin directory: $NPM_GLOBAL_BIN"

# ── 4. Install / update Claude Code ─────────────────────────────────
if command -v claude &>/dev/null; then
    info "Claude Code is already installed at: $(which claude)"
    warn "Updating to latest version..."
    npm install -g @anthropic-ai/claude-code@latest
else
    warn "Claude Code not found on PATH — installing..."
    npm install -g @anthropic-ai/claude-code@latest
fi

# ── 5. Verify the binary exists ─────────────────────────────────────
CLAUDE_BIN="$NPM_GLOBAL_BIN/claude"
if [[ ! -f "$CLAUDE_BIN" && ! -L "$CLAUDE_BIN" ]]; then
    # Try to find it elsewhere
    CLAUDE_BIN=$(find "$(npm root -g)/.." -name "claude" -type f -o -name "claude" -type l 2>/dev/null | head -1)
    if [[ -z "$CLAUDE_BIN" ]]; then
        error "Installation seemed to succeed but 'claude' binary not found."
        error "Try: npm install -g @anthropic-ai/claude-code@latest"
        exit 1
    fi
    NPM_GLOBAL_BIN="$(dirname "$CLAUDE_BIN")"
fi
info "Claude binary found at: $CLAUDE_BIN"

# ── 6. Ensure the bin dir is on PATH ────────────────────────────────
if echo "$PATH" | tr ':' '\n' | grep -qx "$NPM_GLOBAL_BIN"; then
    info "$NPM_GLOBAL_BIN is already on your PATH"
else
    warn "$NPM_GLOBAL_BIN is NOT on your PATH — fixing..."

    EXPORT_LINE="export PATH=\"$NPM_GLOBAL_BIN:\$PATH\""

    # Detect shell and pick the right RC file
    CURRENT_SHELL="$(basename "${SHELL:-/bin/bash}")"
    case "$CURRENT_SHELL" in
        zsh)  RC_FILES=("$HOME/.zshrc" "$HOME/.zprofile") ;;
        fish)
            # Fish uses a different syntax
            FISH_DIR="$HOME/.config/fish"
            mkdir -p "$FISH_DIR"
            FISH_LINE="fish_add_path $NPM_GLOBAL_BIN"
            if ! grep -qF "$NPM_GLOBAL_BIN" "$FISH_DIR/config.fish" 2>/dev/null; then
                echo "$FISH_LINE" >> "$FISH_DIR/config.fish"
                info "Added to $FISH_DIR/config.fish"
            fi
            RC_FILES=() ;;
        *)    RC_FILES=("$HOME/.bashrc" "$HOME/.profile") ;;
    esac

    ADDED=false
    for rc in "${RC_FILES[@]}"; do
        if [[ -f "$rc" ]]; then
            if ! grep -qF "$NPM_GLOBAL_BIN" "$rc" 2>/dev/null; then
                echo "" >> "$rc"
                echo "# Added by fix-claude-code.sh — Claude Code PATH" >> "$rc"
                echo "$EXPORT_LINE" >> "$rc"
                info "Added PATH export to $rc"
                ADDED=true
            else
                info "$rc already contains the PATH entry"
                ADDED=true
            fi
            break
        fi
    done

    if [[ "$ADDED" != "true" && "$CURRENT_SHELL" != "fish" ]]; then
        # Create .bashrc if nothing existed
        RC="${RC_FILES[0]}"
        echo "# Added by fix-claude-code.sh — Claude Code PATH" > "$RC"
        echo "$EXPORT_LINE" >> "$RC"
        info "Created $RC with PATH export"
    fi

    # Apply to current session
    export PATH="$NPM_GLOBAL_BIN:$PATH"
    info "PATH updated for current session"
fi

# ── 7. Final verification ───────────────────────────────────────────
if command -v claude &>/dev/null; then
    echo ""
    info "Claude Code is ready! Version: $(claude --version 2>/dev/null || echo 'installed')"
    echo ""
    echo "  Run 'claude' to start."
    echo ""
    echo "  If this is a new terminal session and 'claude' isn't found,"
    echo "  run: source ~/.bashrc  (or ~/.zshrc for zsh)"
else
    echo ""
    warn "Installed but not yet on PATH in this session."
    echo "  Run:  source ~/.bashrc   (or open a new terminal)"
    echo "  Then: claude"
fi
