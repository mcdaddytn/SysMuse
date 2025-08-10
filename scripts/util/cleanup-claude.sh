# First, let's backup just in case you need them later
mkdir -p ~/claude-old-backup
cp -r ~/.claude ~/claude-old-backup/
cp ~/.claude.json ~/claude-old-backup/
cp ~/.claude.json.backup ~/claude-old-backup/

# Now remove the old files
rm -rf ~/.claude
rm ~/.claude.json
rm ~/.claude.json.backup