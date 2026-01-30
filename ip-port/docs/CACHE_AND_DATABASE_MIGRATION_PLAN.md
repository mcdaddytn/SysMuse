# Cache & Database Migration Plan

## Executive Summary

The current file-based cache system has caused significant operational issues:
- LLM enrichment jobs ran repeatedly on the same patents because results weren't imported to cache
- Cache directory reads (30K+ files) cause performance bottlenecks
- No single source of truth - data scattered across files, cache directories, and database
- Difficult to migrate/backup system state

This document outlines a three-phase approach to address these issues.

**Current Stack**: PostgreSQL (via Docker) with Prisma ORM, file-based caching

---

## Phase 1: Short-Term Fixes (Today) ✓ COMPLETED

### 1.1 Fix "Cache loading..." UI Issue ✓
- Fixed static "Cache: loading..." text in sidebar - now shows actual cache stats
- Tier size now persists in localStorage (defaults to 1000)

### 1.2 Backup Cache Files
**Immediate Action**: Archive all cache directories to external storage.

```bash
# Use the export script
./scripts/export-system.sh /Volumes/ExternalDrive/ip-port-backup
```

---

## Phase 2: Medium-Term Migration (This Week)

### 2.1 Machine Migration Package ✓ COMPLETED

Export/import scripts created:
- `scripts/export-system.sh` - Creates complete backup package
- `scripts/import-system.sh` - Restores system on new machine

#### Export Process
```bash
./scripts/export-system.sh /path/to/export

# Creates:
# - database.sql (PostgreSQL dump)
# - cache-*.tar.gz (compressed cache directories)
# - output.tar.gz (analysis results)
# - config/ (configuration files)
# - manifest.json (metadata)
```

#### Import Process
```bash
./scripts/import-system.sh /path/to/export

# Then:
npm install
npx prisma generate
npm run dev
```

### 2.2 Update Export Script for PostgreSQL

The export script needs to use `pg_dump` instead of file copy:

```bash
# PostgreSQL export
pg_dump $DATABASE_URL > "$EXPORT_DIR/database.sql"

# PostgreSQL import
psql $DATABASE_URL < "$IMPORT_DIR/database.sql"
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
│                   PostgreSQL (Prisma)                        │
├─────────────────────────────────────────────────────────────┤
│  ScoringProfile, ScoringWeight                              │
│  Sector, SuperSector                                        │
│  ApiRequestCache (metadata only)                            │
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
Proposed Architecture (Azure-First):
┌─────────────────────────────────────────────────────────────┐
│           Azure Database for PostgreSQL (Primary)            │
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
          ┌───────────────────┼───────────────────┐
          ↓                   ↓                   ↓
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Azure Cache    │  │  Azure Cosmos   │  │  Azure Blob     │
│  for Redis      │  │  DB (Graph API) │  │  Storage        │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│ Session data    │  │ Patent families │  │ Raw API resp.   │
│ API caching     │  │ Citation graphs │  │ LLM full text   │
│ Job queues      │  │ Ownership trees │  │ Prosecution doc │
│ Rate limiting   │  │ Competitor nets │  │ Export archives │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                              │
                              ↓
                   ┌─────────────────────┐
                   │  Azure AI Search    │
                   │  (+ Vector Search)  │
                   ├─────────────────────┤
                   │ Full-text patent    │
                   │ Claim similarity    │
                   │ Prior art search    │
                   │ Semantic queries    │
                   └─────────────────────┘
```

### 3.3 Database Selection Rationale

| Database | Azure Service | Use Case | Why |
|----------|---------------|----------|-----|
| **PostgreSQL** | Azure Database for PostgreSQL | Primary data store | ACID compliance, JSON support, mature ecosystem, pgvector extension for embeddings |
| **Redis** | Azure Cache for Redis | Caching & queuing | Sub-millisecond reads, pub/sub for real-time, job queue support (BullMQ) |
| **Graph DB** | Azure Cosmos DB (Gremlin API) | Relationship traversal | Patent families, citation networks, ownership hierarchies |
| **Vector DB** | Azure AI Search or PostgreSQL pgvector | Semantic search | Claim similarity, prior art, semantic patent search |
| **Blob Storage** | Azure Blob Storage | Document storage | Cost-effective for large files, lifecycle policies |

---

## 3.4 Supabase vs. Azure-Hosted PostgreSQL

### Supabase Benefits
| Feature | Benefit |
|---------|---------|
| Built-in auth | JWT auth, row-level security out of box |
| Real-time subscriptions | WebSocket-based live queries |
| Auto-generated APIs | REST and GraphQL from schema |
| pgvector built-in | Vector similarity search included |
| Edge functions | Serverless compute at edge |
| Dashboard | Visual database management |
| Rapid prototyping | Faster development cycle |

### Supabase Concerns for Enterprise
| Concern | Issue |
|---------|-------|
| Data residency | Limited region control (not all Azure regions) |
| Compliance | May not meet all enterprise security requirements |
| Vendor lock-in | Proprietary features beyond standard PostgreSQL |
| Network control | Less control over VNet integration |
| Audit logging | Enterprise audit trails may be limited |

### Azure Database for PostgreSQL Benefits
| Feature | Benefit |
|---------|---------|
| **Data sovereignty** | Full control over data residency (US regions only) |
| **Compliance** | SOC 2, HIPAA, FedRAMP, etc. certifications |
| **VNet integration** | Private endpoints, no public exposure |
| **Azure AD auth** | Enterprise SSO integration |
| **Managed backups** | Point-in-time restore, geo-redundant |
| **Flexible Server** | Right-size compute, burstable options |
| **pgvector support** | Vector search via extension |

### Recommendation

**For this use case (private data, legal requirements, US-only deployment):**

→ **Use Azure Database for PostgreSQL Flexible Server**

Reasons:
1. Data must stay within controlled US regions (SF, Austin, NYC, DC)
2. Legal/compliance requirements favor single-vendor cloud
3. Private networking (VNet) essential for sensitive patent data
4. Azure AD integration for enterprise SSO
5. pgvector extension provides vector search without additional service

**Use Supabase for:**
- Rapid prototyping / proof of concepts
- Non-sensitive data applications
- Smaller teams without dedicated DevOps

---

## 3.5 Graph Database Considerations

### Why Graph DB for Patent Data?

Patent data has inherently graph-like relationships:

```
Patent Relationships (Graph Structure):
                    ┌─────────────┐
                    │  Patent A   │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           ↓               ↓               ↓
    ┌────────────┐  ┌────────────┐  ┌────────────┐
    │ Parent B   │  │ Parent C   │  │ Sibling D  │
    │ (cited by) │  │ (cited by) │  │ (same fam) │
    └────────────┘  └────────────┘  └────────────┘
           │               │
           ↓               ↓
    ┌────────────┐  ┌────────────┐
    │ Grandparent│  │ Competitor │
    │     E      │  │  Patent F  │
    └────────────┘  └────────────┘
```

### Graph Queries That Are Hard in SQL

```gremlin
// Find all patents within 2 citation hops of a target
g.V('patent-123')
  .repeat(both('cites', 'cited_by').simplePath())
  .times(2)
  .dedup()

// Find common ancestors between two patent families
g.V('patent-A').repeat(out('cites')).emit().as('a')
  .V('patent-B').repeat(out('cites')).emit().as('b')
  .where('a', eq('b'))
  .select('a').dedup()

// Find competitor patents that cite our portfolio
g.V().hasLabel('portfolio').out('contains')
  .in('cites').has('assignee', within(competitors))
  .groupCount().by('assignee')
```

### Azure Cosmos DB (Gremlin API) vs. Neo4j

| Feature | Cosmos DB Gremlin | Neo4j |
|---------|-------------------|-------|
| Azure integration | Native | Requires VM or AKS |
| Scaling | Automatic, global | Manual sharding |
| Query language | Gremlin (TinkerPop) | Cypher |
| Cost model | RU-based (pay per query) | Instance-based |
| Visualization | Limited | Neo4j Browser (excellent) |

**Recommendation**: Start with PostgreSQL recursive CTEs for simple traversals, add Cosmos DB Gremlin when:
- Citation chains exceed 3-4 hops regularly
- Need real-time graph analytics
- Complex relationship queries become performance bottlenecks

---

## 3.6 Vector Database for Semantic Search

### Use Cases for Vector Search

1. **Claim Similarity** - Find patents with similar claim language
2. **Prior Art Search** - Semantic search across patent corpus
3. **Technology Clustering** - Group patents by technical similarity
4. **Infringement Detection** - Find patents similar to a product description

### Options

| Option | Pros | Cons |
|--------|------|------|
| **pgvector (PostgreSQL extension)** | Single database, simple ops, good for <1M vectors | Limited to single node, slower for very large datasets |
| **Azure AI Search** | Managed, hybrid search (keyword + vector), filtering | Separate service, additional cost |
| **Pinecone** | Purpose-built, fast, scalable | Another vendor, data residency concerns |
| **Qdrant** | Open source, self-hosted option | Operational overhead |

**Recommendation**:

**Phase 1**: Use pgvector in Azure PostgreSQL
- Sufficient for patent corpus <500K
- Single database simplifies architecture
- Can store embeddings alongside patent data

**Phase 2**: Add Azure AI Search if needed
- When vector queries need sub-100ms latency
- When combining vector + keyword + filters
- When corpus exceeds 1M patents

---

## 3.7 Deployment Architecture (US Multi-Region)

```
Azure Deployment (US Continental):
┌─────────────────────────────────────────────────────────────┐
│                    Azure Front Door                          │
│              (Global load balancing, WAF)                   │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ↓                     ↓                     ↓
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  West US 2    │    │  Central US   │    │  East US 2    │
│  (SF office)  │    │  (Austin)     │    │  (NYC/DC)     │
├───────────────┤    ├───────────────┤    ├───────────────┤
│ App Service   │    │ App Service   │    │ App Service   │
│ (API + Web)   │    │ (API + Web)   │    │ (API + Web)   │
└───────┬───────┘    └───────┬───────┘    └───────┬───────┘
        │                    │                    │
        └────────────────────┼────────────────────┘
                             ↓
              ┌─────────────────────────────┐
              │  Azure Database PostgreSQL   │
              │  (Primary: Central US)       │
              │  (Read replicas: West/East)  │
              └─────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ↓                    ↓                    ↓
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ Azure Cache   │    │ Azure Blob    │    │ Azure Key     │
│ for Redis     │    │ Storage       │    │ Vault         │
│ (per region)  │    │ (GRS)         │    │ (secrets)     │
└───────────────┘    └───────────────┘    └───────────────┘
```

### Security Architecture

```
Security Layers:
┌─────────────────────────────────────────────────────────────┐
│                      Azure AD B2C                            │
│                   (Identity Provider)                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    Azure API Management                      │
│        (Rate limiting, API keys, request validation)        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    Virtual Network                           │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ App Subnet  │  │ Data Subnet │  │ Integration │         │
│  │ (Frontend)  │  │ (Databases) │  │   Subnet    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                             │
│  Private Endpoints for all data services                   │
│  No public IPs on databases                                │
│  NSG rules restrict traffic                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    Azure Key Vault                           │
│          (API keys, connection strings, secrets)            │
└─────────────────────────────────────────────────────────────┘
```

---

## 3.8 Migration Path

### Phase 3A: Consolidate to PostgreSQL (2-3 weeks)
1. Add PatentEnrichment table to existing PostgreSQL
2. Create migration scripts from file cache → database
3. Update services to read from database
4. Keep file cache as fallback during transition
5. Remove file cache dependency

### Phase 3B: Add Redis Caching (1 week)
1. Deploy Azure Cache for Redis
2. Implement API response caching
3. Add job queue with BullMQ
4. Real-time cache invalidation

### Phase 3C: Multi-Region Deployment (2-3 weeks)
1. Set up Azure infrastructure (IaC with Terraform/Bicep)
2. Configure VNet peering and private endpoints
3. Deploy read replicas
4. Configure Azure Front Door
5. Implement health checks and failover

### Phase 3D: Advanced Features (As Needed)
- Graph database for citation networks
- Vector search for semantic queries
- Azure AI Search for full-text

---

## Implementation Priority

### This Week ✓
1. [x] Fix "Cache loading..." UI bug
2. [x] Create export/import scripts
3. [ ] Test migration on second laptop
4. [ ] Backup all cache files to external drive
5. [ ] Update export script for PostgreSQL (pg_dump)

### Next 2-3 Weeks
6. [ ] Design PatentEnrichment table schema
7. [ ] Create file-cache → database migration scripts
8. [ ] Update enrichment services to write to DB
9. [ ] Test with dual-write (file + DB)
10. [ ] Remove file cache dependency

### Future
11. [ ] Azure infrastructure setup
12. [ ] Redis caching layer
13. [ ] Multi-region deployment
14. [ ] Graph DB for citations (if needed)
15. [ ] Vector search (if needed)

---

## Questions for Discussion

1. **Timeline**: When do we need multi-region deployment operational?
2. **Graph DB Priority**: How important is deep citation traversal now vs. later?
3. **Vector Search**: Is semantic patent search a near-term requirement?
4. **Compliance**: Any specific certifications required (FedRAMP, ITAR, etc.)?
5. **AWS Fallback**: Should we design for cloud portability from the start?

---

## Appendix: Current Statistics

```
Cache Directory Sizes (as of 2026-01-30):
- cache/llm-scores/: 13,737 files (~200MB)
- cache/prosecution-scores/: 9,198 files (~50MB)
- cache/ipr-scores/: 8,316 files (~30MB)
- cache/patent-families/: 10,787 files (~100MB)
- Total: ~42,000 files, ~400MB

Database (PostgreSQL):
- Scoring profiles, sectors, API cache metadata
- ~5MB current size

Output:
- streaming-candidates-*.json: ~50MB each
```
