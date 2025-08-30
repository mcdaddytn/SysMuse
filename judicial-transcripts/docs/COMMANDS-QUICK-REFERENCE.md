# Quick Command Reference

## Database Operations
```bash
# Reset database and schema
npx prisma db push --force-reset

# Generate Prisma client
npx prisma generate

# Load seed data
npm run seed

# Open database GUI
npm run prisma studio
```

## Parsing Commands

### Phase 1: Initial Parsing
```bash
# Legacy Parser (default, well-tested)
npx ts-node src/cli/parse.ts parse --phase1 --config config/example-trial-config-mac.json --parser-mode legacy

# Multi-Pass Parser (new, modular architecture)
npx ts-node src/cli/parse.ts parse --phase1 --config config/example-trial-config-mac.json --parser-mode multi-pass

# With debug output (multi-pass only)
npx ts-node src/cli/parse.ts parse --phase1 --config config/example-trial-config-mac.json --parser-mode multi-pass --debug-output
```

### Phase 2: Enhanced Processing
```bash
npx ts-node src/cli/parse.ts parse --phase2 --config config/example-trial-config-mac.json --trial-id 1
```

### Phase 3: Final Processing
```bash
npx ts-node src/cli/phase3.ts process
```

## Complete Reset and Parse Sequence
```bash
# 1. Reset database
npx prisma db push --force-reset

# 2. Load seed data
npm run seed

# 3. Parse with chosen parser
npx ts-node src/cli/parse.ts parse --phase1 --config config/example-trial-config-mac.json --parser-mode multi-pass

# 4. Run phase 2
npx ts-node src/cli/parse.ts parse --phase2 --config config/example-trial-config-mac.json --trial-id 1

# 5. Run phase 3
npx ts-node src/cli/phase3.ts process
```

## Docker Operations
```bash
# Check running containers
docker ps

# Access PostgreSQL
docker exec -it judicial-postgres psql -U judicial_user -d judicial_transcripts

# Check record counts
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts -c "SELECT 'Sessions' as entity, COUNT(*) FROM \"Session\" UNION ALL SELECT 'Pages', COUNT(*) FROM \"Page\" UNION ALL SELECT 'Lines', COUNT(*) FROM \"Line\";"
```

## Backup/Restore (if scripts exist)
```bash
# Create backup
../scripts/db/backupdb.sh phase1

# Restore backup
../scripts/db/restoredb.sh phase1
```

## Notes
- **ALWAYS** use the configuration file - command line arguments alone don't work
- Default config for Mac testing: `config/example-trial-config-mac.json`
- Parser modes: `legacy` (default) or `multi-pass` (new)
- Trial ID is usually 1 for phase 2