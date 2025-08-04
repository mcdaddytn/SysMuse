#!/bin/bash

# Exit on error
set -e

# Check for argument
if [ $# -ne 1 ]; then
  echo "Usage: $0 <git_repo_url>"
  exit 1
fi

REPO_URL="$1"
REPO_NAME=$(basename -s .git "$REPO_URL")
TIMESTAMP=$(date +"%m%d%Y%H%M%S")
ZIP_NAME="${REPO_NAME}_${TIMESTAMP}.zip"

# Clone repo
git clone "$REPO_URL" "$REPO_NAME"

# Zip the repo
cd "$REPO_NAME/.."
zip -r "$ZIP_NAME" "$REPO_NAME"

echo "Cloned '$REPO_NAME' and archived as '$ZIP_NAME'"
