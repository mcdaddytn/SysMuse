#!/usr/bin/env bash
set -euo pipefail

MARK_START="# >>> terminal-speedup >>>"
MARK_END="# <<< terminal-speedup <<<"

detect_rc_file() {
  local shell_base rc
  shell_base="$(basename "${SHELL:-}")"
  case "$shell_base" in
    zsh)  rc="$HOME/.zshrc" ;;
    bash) 
      if [ -f "$HOME/.bash_profile" ]; then
        rc="$HOME/.bash_profile"
      elif [ -f "$HOME/.bashrc" ]; then
        rc="$HOME/.bashrc"
      else
        rc="$HOME/.bash_profile"
      fi
      ;;
    *)
      # Fallback: prefer zshrc if present, else bash_profile
      if [ -f "$HOME/.zshrc" ]; then
        rc="$HOME/.zshrc"
      else
        rc="$HOME/.bash_profile"
      fi
      ;;
  esac
  printf "%s" "$rc"
}

append_block_if_missing() {
  local rc_file="$1"
  mkdir -p "$(dirname "$rc_file")"

  if [ -f "$rc_file" ] && grep -qF "$MARK_START" "$rc_file"; then
    echo "[info] Configuration block already present in $rc_file"
    return 0
  fi

  # Backup if the file exists
  if [ -f "$rc_file" ]; then
    local backup="$rc_file.bak.$(date +%Y%m%d%H%M%S)"
    cp "$rc_file" "$backup"
    echo "[info] Backed up $rc_file -> $backup"
  else
    # Ensure the file exists
    touch "$rc_file"
  fi

  cat >> "$rc_file" <<'EOF'

# >>> terminal-speedup >>>
# Added by install-terminal-speedup.sh to improve typing/deletion responsiveness.
# 1) Set fast key-repeat globally (macOS) and prefer repeats over accent menu.
# 2) Enable chunk deletes & saner word boundaries in zsh/bash.
# Notes:
#  - Re-login (or reboot) after the first change for macOS key-repeat to fully apply.
#  - For Terminal.app, enable: Settings → Profiles → Keyboard → "Use Option as Meta key".
#  - For iTerm2, set: Profiles → Keys → "Left/Right Option key acts as +Esc".

# --- macOS key-repeat tuning (applies once or when different) ---
__ts_apply_macos_defaults() {
  command -v defaults >/dev/null 2>&1 || return 0

  local kr ikr pah cur_kr cur_ikr cur_pah
  kr=1          # fastest repeat
  ikr=10        # short initial delay
  pah=false     # disable press-and-hold accent popup

  cur_kr="$(defaults read -g KeyRepeat 2>/dev/null || echo "")"
  cur_ikr="$(defaults read -g InitialKeyRepeat 2>/dev/null || echo "")"
  cur_pah="$(defaults read -g ApplePressAndHoldEnabled 2>/dev/null || echo "")"

  if [ "$cur_kr" != "$kr" ] || [ "$cur_ikr" != "$ikr" ] || [ "$cur_pah" != "$pah" ]; then
    defaults write -g KeyRepeat -int "$kr"
    defaults write -g InitialKeyRepeat -int "$ikr"
    defaults write -g ApplePressAndHoldEnabled -bool "$pah"
    killall cfprefsd >/dev/null 2>&1 || true
    echo "[terminal-speedup] Applied macOS key-repeat: KeyRepeat=$kr InitialKeyRepeat=$ikr ApplePressAndHoldEnabled=$pah" >&2
    echo "[terminal-speedup] Log out/in (or reboot) for full effect." >&2
  fi
}

# --- Shell-side editing improvements ---
__ts_shell_bindings() {
  # Common: make Ctrl+S usable by disabling XON/XOFF flow control (optional).
  # stty -ixon 2>/dev/null || true

  if [ -n "$ZSH_VERSION" ]; then
    # Smarter word boundaries like bash; better for Option+Backspace/Option+D
    autoload -Uz select-word-style 2>/dev/null && select-word-style bash

    # Ensure ESC-DEL and ESC-d do word deletes (helps when Option sends Meta as ESC-prefix)
    bindkey -M emacs '^[^?' backward-kill-word 2>/dev/null
    bindkey -M emacs '^[d'   kill-word          2>/dev/null

    # Handy line ops (usually defaults, but ensure they're set)
    bindkey '^U' kill-whole-line 2>/dev/null
    bindkey '^K' kill-line       2>/dev/null

  elif [ -n "$BASH_VERSION" ]; then
    # Ensure emacs-style keys are active
    set -o emacs

    # Bash Readline bindings for word deletes and line kills
    bind 'set enable-meta-key on'
    bind '"\e\C-?": backward-kill-word'   # ESC + DEL
    bind '"\ed": kill-word'               # ESC + d
    bind '"\C-u": unix-line-discard'      # Ctrl+U
    bind '"\C-k": kill-line'              # Ctrl+K
  fi
}

# Run once per shell start (lightweight)
__ts_apply_macos_defaults
__ts_shell_bindings
# <<< terminal-speedup <<<

EOF

  echo "[ok] Appended terminal-speedup block to $rc_file"
}

main() {
  local rc_file
  rc_file="$(detect_rc_file)"
  echo "[info] Target shell rc: $rc_file"
  append_block_if_missing "$rc_file"
  echo
  echo "[next] Open a NEW terminal window to load the shell changes."
  echo "[note] macOS key-repeat changes may require logging out/in (or reboot)."
}

main "$@"
