# Cache & Database Migration Plan

## Executive Summary

The current file-based cache system has caused significant operational issues:
- LLM enrichment jobs ran repeatedly on the same patents because results weren't imported to cache
- Cache directory reads (30K+ files) cause performance bottlenecks
- No single source of truth - data scattered across files, cache directories, and database
- Difficult to migrate/backup system state

This document outlines a three-phase approach to address these issues.

---

## Phase 1: Short-Term Fixes (Today)

### 1.1 Fix "Cache loading..." UI Issue

**Problem**: When pressing refresh on Jobs & Enrichment page, the "Cache loading..." message appears and doesn't clear. The tier size selection resets.

**Root Cause Investigation Needed**:
- Check if `POST /api/scores/reload` is completing but not signaling UI
- Check if enrichment cache TTL-based refresh is causing issues
- Verify the loading state is being properly cleared in Vue component

**Files to Check**:
- `frontend/src/pages/JobQueuePage.vue` - reload button handler
- `src/api/routes/scores.routes.ts` - reload endpoint
- `src/api/routes/patents.routes.ts` - enrichment cache invalidation

**Fix Approach**:
1. Ensure reload endpoint returns after all caches are cleared
2. Make UI wait for response before clearing loading state
3. Preserve tier size in localStorage or component state across reloads

### 1.2 Backup Cache Files

**Immediate Action**: Archive all cache directories to external storage.

```bash
# Create timestamped backup
BACKUP_DIR="/Volumes/ExternalDrive/ip-port-backup-$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"

# Copy cache directories
cp -r cache/llm-scores "$BACKUP_DIR/"
cp -r cache/prosecution-scores "$BACKUP_DIR/"
cp -r cache/ipr-scores "$BACKUP_DIR/"
cp -r cache/patent-families "$BACKUP_DIR/"
cp -r cache/api "$BACKUP_DIR/"

# Copy database
cp prisma/dev.db "$BACKUP_DIR/"

# Copy output files
cp -r output "$BACKUP_DIR/"

# Create manifest
echo "Backup created: $(date)" > "$BACKUP_DIR/manifest.txt"
echo "LLM scores: $(ls cache/llm-scores/*.json | wc -l)" >> "$BACKUP_DIR/manifest.txt"
echo "Prosecution: $(ls cache/prosecution-scores/*.json | wc -l)" >> "$BACKUP_DIR/manifest.txt"
echo "IPR: $(ls cache/ipr-scores/*.json | wc -l)" >> "$BACKUP_DIR/manifest.txt"
echo "Families: $(ls cache/patent-families/parents/*.json | wc -l)" >> "$BACKUP_DIR/manifest.txt"
```

---

## Phase 2: Medium-Term Migration (This Week)

### 2.1 Machine Migration Package

Create a complete export/import system for moving to another machine.

#### Export Script (`scripts/export-system.sh`)

```bash
#!/bin/bash
# Export entire system state for migration

EXPORT_DIR="${1:-./export-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$EXPORT_DIR"

echo "Exporting system to $EXPORT_DIR..."

# 1. Database export
echo "Exporting database..."
cp prisma/dev.db "$EXPORT_DIR/database.db"

# Also export as SQL for portability
sqlite3 prisma/dev.db .dump > "$EXPORT_DIR/database.sql"

# 2. Cache directories (compress for transfer)
echo "Compressing cache directories..."
tar -czf "$EXPORT_DIR/cache-llm-scores.tar.gz" -C cache llm-scores
tar -czf "$EXPORT_DIR/cache-prosecution-scores.tar.gz" -C cache prosecution-scores
tar -czf "$EXPORT_DIR/cache-ipr-scores.tar.gz" -C cache ipr-scores
tar -czf "$EXPORT_DIR/cache-patent-families.tar.gz" -C cache patent-families
tar -czf "$EXPORT_DIR/cache-api.tar.gz" -C cache api

# 3. Output files
echo "Compressing output files..."
tar -czf "$EXPORT_DIR/output.tar.gz" output

# 4. Configuration
echo "Copying configuration..."
cp -r config "$EXPORT_DIR/"
cp .env "$EXPORT_DIR/env.txt"  # Rename to avoid auto-loading

# 5. Create manifest
echo "Creating manifest..."
cat > "$EXPORT_DIR/manifest.json" << EOF
{
  "export_date": "$(date -Iseconds)",
  "source_machine": "$(hostname)",
  "database_size": "$(du -h prisma/dev.db | cut -f1)",
  "cache_counts": {
    "llm_scores": $(ls cache/llm-scores/*.json 2>/dev/null | wc -l | tr -d ' '),
    "prosecution_scores": $(ls cache/prosecution-scores/*.json 2>/dev/null | wc -l | tr -d ' '),
    "ipr_scores": $(ls cache/ipr-scores/*.json 2>/dev/null | wc -l | tr -d ' '),
    "patent_families": $(ls cache/patent-families/parents/*.json 2>/dev/null | wc -l | tr -d ' ')
  },
  "git_commit": "$(git rev-parse HEAD)",
  "git_branch": "$(git branch --show-current)"
}
EOF

echo ""
echo "Export complete: $EXPORT_DIR"
echo "Total size: $(du -sh "$EXPORT_DIR" | cut -f1)"
```

#### Import Script (`scripts/import-system.sh`)

```bash
#!/bin/bash
# Import system state from export package

IMPORT_DIR="${1:?Usage: import-system.sh <export-dir>}"

if [ ! -f "$IMPORT_DIR/manifest.json" ]; then
  echo "Error: Not a valid export directory (missing manifest.json)"
  exit 1
fi

echo "Importing system from $IMPORT_DIR..."
cat "$IMPORT_DIR/manifest.json" | jq .

read -p "Continue with import? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  exit 1
fi

# 1. Database
echo "Importing database..."
cp "$IMPORT_DIR/database.db" prisma/dev.db

# 2. Cache directories
echo "Extracting cache directories..."
mkdir -p cache
tar -xzf "$IMPORT_DIR/cache-llm-scores.tar.gz" -C cache
tar -xzf "$IMPORT_DIR/cache-prosecution-scores.tar.gz" -C cache
tar -xzf "$IMPORT_DIR/cache-ipr-scores.tar.gz" -C cache
tar -xzf "$IMPORT_DIR/cache-patent-families.tar.gz" -C cache
tar -xzf "$IMPORT_DIR/cache-api.tar.gz" -C cache

# 3. Output files
echo "Extracting output files..."
tar -xzf "$IMPORT_DIR/output.tar.gz"

# 4. Configuration
echo "Copying configuration..."
cp -r "$IMPORT_DIR/config" .
echo "NOTE: Review $IMPORT_DIR/env.txt and update .env manually"

# 5. Verify
echo ""
echo "Import complete. Verifying..."
echo "Database: $(du -h prisma/dev.db | cut -f1)"
echo "LLM scores: $(ls cache/llm-scores/*.json 2>/dev/null | wc -l)"
echo "Prosecution: $(ls cache/prosecution-scores/*.json 2>/dev/null | wc -l)"
echo "IPR: $(ls cache/ipr-scores/*.json 2>/dev/null | wc -l)"
echo "Families: $(ls cache/patent-families/parents/*.json 2>/dev/null | wc -l)"

echo ""
echo "Next steps:"
echo "1. Review and update .env file"
echo "2. Run: npm install"
echo "3. Run: npx prisma generate"
echo "4. Run: npm run dev"
```

### 2.2 Database Recreation from Import

For cases where we need to rebuild the database from scratch:

```bash
# scripts/rebuild-database.sh

#!/bin/bash
# Rebuild database from cache files and configuration

echo "This will rebuild the database from cache files."
echo "Existing database will be backed up."

# Backup existing
mv prisma/dev.db "prisma/dev.db.backup-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true

# Reset database
npx prisma db push --force-reset

# Re-seed sectors
npx tsx scripts/seed-sectors.ts

# Import scoring profiles
npx tsx scripts/seed-scoring-profiles.ts

# Import LLM scores to database (new script needed)
npx tsx scripts/sync-cache-to-db.ts

echo "Database rebuilt."
```

---

## Phase 3: Long-Term Architecture (Design Review)

### 3.1 Current Architecture Problems

```
Current State:
┌─────────────────────────────────────────────────────────────┐
│                     File System                              │
├─────────────────────────────────────────────────────────────┤
│  cache/llm-scores/           (13K+ JSON files)              │
│  cache/prosecution-scores/   (9K+ JSON files)               │
│  cache/ipr-scores/          (8K+ JSON files)                │
│  cache/patent-families/     (10K+ JSON files)               │
│  output/*.json              (portfolio snapshots)           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   SQLite (Prisma)                           │
├─────────────────────────────────────────────────────────────┤
│  ScoringProfile, ScoringWeight                              │
│  Sector, SuperSector                                        │
│  (Patent table exists but not primary data store)           │
└─────────────────────────────────────────────────────────────┘

Problems:
1. No single source of truth for patent enrichment data
2. File I/O bottlenecks (reading 30K+ files)
3. Cache invalidation is manual and error-prone
4. No transactional consistency
5. Difficult to query across enrichment types
6. Can't scale to multiple portfolios efficiently
```

### 3.2 Proposed Heterogeneous Database Architecture

```
Proposed Architecture:
┌─────────────────────────────────────────────────────────────┐
│                    PostgreSQL (Primary)                      │
├─────────────────────────────────────────────────────────────┤
│  Patents         - Core patent data, ownership, dates       │
│  PatentScores    - All computed scores (LLM, IPR, etc.)     │
│  Portfolios      - Portfolio definitions and membership      │
│  Sectors         - Sector rules and assignments             │
│  ScoringProfiles - Scoring configuration                    │
│  Jobs            - Enrichment job queue and history         │
│  AuditLog        - Change tracking                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ├──────────────────────────────┐
                              ↓                              ↓
┌─────────────────────────────────────┐  ┌───────────────────────────────┐
│         Redis (Cache Layer)          │  │    Elasticsearch (Search)     │
├─────────────────────────────────────┤  ├───────────────────────────────┤
│  Session data                        │  │  Full-text patent search      │
│  API response caching                │  │  Claim text search            │
│  Enrichment job queue                │  │  Prior art similarity         │
│  Rate limiting counters              │  │  Faceted filtering            │
│  Real-time computation cache         │  │  Aggregations                 │
└─────────────────────────────────────┘  └───────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              S3/MinIO (Document Storage)                     │
├─────────────────────────────────────────────────────────────┤
│  Raw API responses (PatentsView, USPTO)                     │
│  LLM analysis full text                                     │
│  Prosecution documents                                      │
│  Export archives                                            │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 Database Selection Rationale

| Database | Use Case | Why |
|----------|----------|-----|
| **PostgreSQL** | Primary data store | ACID compliance, JSON support, mature ecosystem, excellent for relational data with complex queries |
| **Redis** | Caching & queuing | Sub-millisecond reads, pub/sub for real-time updates, built-in TTL, job queue support (BullMQ) |
| **Elasticsearch** | Search & analytics | Full-text search across patent claims, aggregations for dashboards, scales horizontally |
| **S3/MinIO** | Document storage | Cost-effective for large blobs, versioning, lifecycle policies |

### 3.4 Migration Strategy

**Phase 3A: PostgreSQL Migration**
1. Update Prisma schema to use PostgreSQL
2. Create migration scripts for existing SQLite data
3. Add PatentEnrichment table to store all enrichment data
4. Migrate file-based cache to database rows
5. Update API services to read from database

**Phase 3B: Redis Integration**
1. Add Redis for API response caching
2. Implement job queue with BullMQ
3. Add cache invalidation on data updates
4. Real-time dashboard updates via pub/sub

**Phase 3C: Elasticsearch (Optional)**
1. Index patent titles, abstracts, claims
2. Add full-text search API
3. Power advanced filtering in UI

### 3.5 Simplified Schema for PatentEnrichment

```prisma
model Patent {
  id                String   @id  // Patent number
  title             String
  abstract          String?
  patentDate        DateTime
  expirationDate    DateTime?
  assignee          String
  cpcCodes          String[]

  // Relationships
  portfolios        PortfolioPatent[]
  enrichment        PatentEnrichment?
  familyRelations   PatentFamily[]

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model PatentEnrichment {
  id                String   @id @default(cuid())
  patentId          String   @unique
  patent            Patent   @relation(fields: [patentId], references: [id])

  // LLM Scores (nullable until enriched)
  llmEnrichedAt     DateTime?
  eligibilityScore  Int?
  validityScore     Int?
  claimBreadth      Int?
  enforcementClarity Int?
  designAroundDifficulty Int?
  llmSummary        String?
  llmTechSolution   String?

  // Prosecution Scores
  prosEnrichedAt    DateTime?
  prosecutionScore  Int?
  officeActionCount Int?
  rceCount          Int?
  timeToGrantMonths Int?

  // IPR Scores
  iprEnrichedAt     DateTime?
  iprRiskScore      Int?
  hasIprHistory     Boolean?
  petitionsCount    Int?
  claimsInvalidated Int?

  // Citations
  citationsEnrichedAt DateTime?
  forwardCitations  Int?
  backwardCitations Int?
  competitorCitations Int?

  // Computed composite scores
  baseScore         Float?
  compositeScore    Float?

  // Metadata
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([llmEnrichedAt])
  @@index([baseScore])
  @@index([compositeScore])
}

model Portfolio {
  id          String   @id @default(cuid())
  name        String
  description String?

  patents     PortfolioPatent[]

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model PortfolioPatent {
  portfolioId String
  patentId    String
  addedAt     DateTime @default(now())

  portfolio   Portfolio @relation(fields: [portfolioId], references: [id])
  patent      Patent    @relation(fields: [patentId], references: [id])

  @@id([portfolioId, patentId])
}
```

### 3.6 Benefits of New Architecture

| Benefit | Current | Proposed |
|---------|---------|----------|
| Query speed | O(n) file reads | O(1) indexed lookup |
| Data consistency | Manual sync | ACID transactions |
| Cache invalidation | Error-prone | Automatic via triggers |
| Multi-portfolio | Not supported | Native support |
| Backup/restore | Manual file copy | pg_dump/restore |
| Scalability | Single machine | Horizontal scaling |
| Search | Basic filtering | Full-text search |

---

## Implementation Priority

### This Week
1. [ ] Fix "Cache loading..." UI bug
2. [ ] Create export/import scripts
3. [ ] Test migration on second laptop
4. [ ] Backup all cache files to external drive

### Next 2 Weeks
5. [ ] Design PostgreSQL schema in detail
6. [ ] Create migration scripts
7. [ ] Implement PatentEnrichment table
8. [ ] Update enrichment services to write to DB
9. [ ] Add Redis for caching (optional)

### Future
10. [ ] Elasticsearch for search (if needed)
11. [ ] Multi-portfolio support
12. [ ] S3 for document storage (if needed)

---

## Questions for Discussion

1. **PostgreSQL hosting**: Local PostgreSQL, Docker, or cloud (Supabase/Neon)?
2. **Redis necessity**: Is Redis needed immediately, or can we start with just PostgreSQL?
3. **Migration approach**: Big bang migration or gradual (dual-write for transition)?
4. **Multi-portfolio**: What's the priority timeline for supporting multiple portfolios?
5. **Search requirements**: How important is full-text search across patent claims?

---

## Appendix: Current Cache Statistics

```
Cache Directory Sizes (as of 2026-01-30):
- cache/llm-scores/: 13,737 files (~200MB)
- cache/prosecution-scores/: 9,198 files (~50MB)
- cache/ipr-scores/: 8,316 files (~30MB)
- cache/patent-families/: 10,787 files (~100MB)
- Total: ~42,000 files, ~400MB

Database:
- prisma/dev.db: ~5MB

Output:
- streaming-candidates-*.json: ~50MB each
```
