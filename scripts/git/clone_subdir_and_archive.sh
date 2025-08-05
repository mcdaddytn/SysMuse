#!/bin/bash
set -e

# Check arguments
if [ $# -ne 2 ]; then
  echo "Usage: $0 <repo_url> <subdir_path_within_repo>"
  echo "Example: $0 https://github.com/user/repo.git Project1"
  exit 1
fi

REPO_URL="$1"
SUBDIR="$2"

# Extract repo name
REPO_NAME="${REPO_URL##*/}"
REPO_NAME="${REPO_NAME%.git}"

# Timestamp for archive
TIMESTAMP=$(date +"%m%d%Y%H%M%S")
ARCHIVE_NAME="${SUBDIR##*/}_${TIMESTAMP}.zip"

# Create a temp directory to work in
WORK_DIR="${REPO_NAME}_temp"
mkdir "$WORK_DIR"
cd "$WORK_DIR"

# Initialize repo and enable sparse checkout
git init
git remote add origin "$REPO_URL"
git config core.sparseCheckout true
echo "$SUBDIR/*" >> .git/info/sparse-checkout

# Pull only the subdirectory (assumes 'main' branch)
git pull origin main

# Zip the subdirectory
cd "$SUBDIR/.."
zip -r "../../$ARCHIVE_NAME" "${SUBDIR##*/}"

echo "Archived $SUBDIR to $ARCHIVE_NAME"

# Cleanup
cd ../..
rm -rf "$WORK_DIR"

