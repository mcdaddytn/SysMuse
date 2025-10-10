#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./import-repo-project.sh <git_repo_url> <project_name> <zip_full_path>
# Example:
#   ./import-repo-project.sh https://github.com/myorg/parent-repo.git judicial-transcripts /home/me/zips/jt.zip

if [ $# -ne 3 ]; then
  echo "Usage: $0 <git_repo_url> <project_name> <zip_full_path>"
  exit 1
fi

REPO_URL="$1"
PROJECT_NAME="$2"
ZIP_PATH="$3"

if [ ! -f "$ZIP_PATH" ]; then
  echo "Zip file not found: $ZIP_PATH"
  exit 1
fi

# Derive local repo directory name from URL (strip .git)
REPO_DIR="$(basename "${REPO_URL}")"
REPO_DIR="${REPO_DIR%.git}"
if [ -z "$REPO_DIR" ]; then
  echo "Could not derive repository directory name from URL."
  exit 1
fi

# Clone into current directory if not present
if [ -d "$REPO_DIR" ]; then
  echo "Directory \"$REPO_DIR\" already exists. Using it."
else
  echo "Cloning $REPO_URL into \"$REPO_DIR\" ..."
  git clone "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"

# Determine current branch (default branch of the clone)
BRANCH="$(git rev-parse --abbrev-ref HEAD || echo main)"
[ -z "$BRANCH" ] && BRANCH="main"

# Refuse to overwrite existing project directory
if [ -e "$PROJECT_NAME" ]; then
  echo "Target directory \"$PROJECT_NAME\" already exists in repo root. Aborting to avoid overwrite."
  exit 1
fi

mkdir -p "$PROJECT_NAME"

# Extract zip into the project directory
# Prefer unzip; fall back to bsdtar or tar if needed.
if command -v unzip >/dev/null 2>&1; then
  echo "Extracting \"$ZIP_PATH\" into \"$PROJECT_NAME\" with unzip ..."
  unzip -q "$ZIP_PATH" -d "$PROJECT_NAME"
elif command -v bsdtar >/dev/null 2>&1; then
  echo "Extracting \"$ZIP_PATH\" into \"$PROJECT_NAME\" with bsdtar ..."
  bsdtar -xf "$ZIP_PATH" -C "$PROJECT_NAME"
else
  echo "Extracting \"$ZIP_PATH\" into \"$PROJECT_NAME\" with tar ..."
  tar -xf "$ZIP_PATH" -C "$PROJECT_NAME"
fi

# Stage, commit, push
git add "$PROJECT_NAME"
git commit -m "Import project ${PROJECT_NAME} from zip" || {
  echo "git commit failed. Nothing to commit or an error occurred."
  exit 1
}

echo "Pushing to origin \"$BRANCH\" ..."
git push origin "$BRANCH"

echo "Import complete."
echo "Repo path: $(pwd)"
