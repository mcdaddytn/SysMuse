# Database Strategy: PostgreSQL + ElasticSearch

## Overview

This document outlines the recommended data architecture for the IP Portfolio Analysis system, designed to support both current batch processing needs and future GUI development with human-in-the-loop curation.

---

## Architecture Recommendation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              GUI / API Layer                                 │
│  - Patent search and browse                                                  │
│  - Weight preference management                                              │
│  - Sector curation and patent assignment                                     │
│  - Search term management                                                    │
│  - Analysis results viewing                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API Service Layer                                  │
│  - Express.js / Fastify                                                      │
│  - Routes for CRUD on preferences, patents, sectors                          │
│  - Orchestrates PostgreSQL and ElasticSearch queries                         │
└─────────────────────────────────────────────────────────────────────────────┘
          │                                               │
          ▼                                               ▼
┌─────────────────────────────────┐     ┌─────────────────────────────────────┐
│         PostgreSQL              │     │           ElasticSearch              │
│    (Relational Source of Truth) │     │      (Search & Text Analytics)       │
│                                 │     │                                       │
│ • Patent metadata               │     │ • Full-text search (title, abstract) │
│ • Assignees, Inventors          │◄───►│ • Claims text search (future)        │
│ • Citations (structured)        │sync │ • Semantic similarity (MLT)          │
│ • Competitor tracking           │     │ • Term extraction (aggregations)     │
│ • User preferences              │     │ • Vector embeddings (future)         │
│ • Analysis results              │     │                                       │
│ • Sectors & assignments         │     │ Index: patents (22,706 docs)         │
│ • Search term curation          │     │                                       │
└─────────────────────────────────┘     └─────────────────────────────────────┘
```

---

## Data Storage Decisions

### PostgreSQL (Source of Truth)

**Store in PostgreSQL:**

| Data Type | Rationale | Tables |
|-----------|-----------|--------|
| **Patent Core Metadata** | Structured, relational joins needed | `patents` |
| **Assignees/Inventors** | Many-to-many relationships | `assignees`, `inventors`, junction tables |
| **Citations** | Graph-like queries, competitor counting | `citations`, `competitor_citations` |
| **Competitors** | Tracked companies, patterns | `competitors` |
| **CPC Codes** | Classification hierarchy | `cpc_codes`, `patent_cpc` |
| **Analysis Results** | Per-patent scores, LLM outputs | `patent_analysis_results` |
| **User Preferences** | Weights, notes, priorities | `user_weight_profiles`, `user_patent_notes` |
| **Sectors** | Curation, assignments | `user_sectors`, `user_sector_patents` |
| **Search Terms** | Boost/exclude terms | `search_terms` |
| **Discovery Strategies** | Provenance tracking | `discovery_strategies` |

**Why PostgreSQL for these:**
- ACID compliance for user curation data
- Relational integrity for citations and assignments
- Complex aggregation queries for scoring
- Joins across multiple dimensions
- Transaction support for batch updates

### ElasticSearch (Search & Analytics)

**Store in ElasticSearch:**

| Data Type | Rationale | Index Fields |
|-----------|-----------|--------------|
| **Patent Title** | Full-text search, fuzzy matching | `title`, `title.keyword`, `title.raw` |
| **Patent Abstract** | Full-text search, term vectors | `abstract`, term vectors enabled |
| **Patent Claims** (future) | Claim-level search | `claims[]` |
| **CPC Codes** | Faceted filtering | `cpc_codes`, `cpc_classes` |
| **Assignee Names** | Search and filtering | `assignee`, `assignee_normalized` |
| **Competitor Flags** | Quick filtering | `competitors_citing`, `competitor_citations` |
| **Tier/Scores** | Range filtering | `tier`, `enhanced_score` |
| **Vector Embeddings** (future) | Semantic search | `abstract_vector` (dense_vector) |

**Why ElasticSearch for these:**
- Superior full-text search performance
- Fuzzy matching and stemming
- Term vector extraction for "significant terms"
- More-Like-This (MLT) similarity queries
- Aggregations for analytics dashboards
- Future: kNN vector search for semantic similarity

---

## Sync Strategy

### Option A: PostgreSQL as Master (Recommended)

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   Import     │──────│  PostgreSQL  │──────│ ElasticSearch│
│   Scripts    │      │   (master)   │ sync │   (replica)  │
└──────────────┘      └──────────────┘      └──────────────┘
                             │
                             ▼
                      ┌──────────────┐
                      │   GUI/API    │
                      └──────────────┘
```

**Workflow:**
1. Import scripts write to PostgreSQL
2. Sync service pushes to ElasticSearch
3. API reads from both (PG for writes, ES for search)
4. User edits go to PostgreSQL, trigger sync

**Pros:**
- Single source of truth
- Transactional integrity
- Clear data lineage

**Cons:**
- Sync lag (acceptable for our use case)
- More complex infrastructure

### Option B: Dual-Write (Alternative)

```
┌──────────────┐
│   Import     │
│   Scripts    │
└──────────────┘
      │
      ├─────────────────┬─────────────────┐
      ▼                 ▼                 │
┌──────────────┐  ┌──────────────┐        │
│  PostgreSQL  │  │ ElasticSearch│        │
│ (structured) │  │   (search)   │        │
└──────────────┘  └──────────────┘        │
                                          │
                      ┌──────────────┐    │
                      │   GUI/API    │◄───┘
                      └──────────────┘
```

**Workflow:**
1. Import scripts write to both simultaneously
2. API queries appropriate store based on operation type
3. User edits go to PostgreSQL only (ES is for search)

---

## Data Redundancy Recommendation

### What to Store in Both (Redundantly)

| Field | PostgreSQL | ElasticSearch | Notes |
|-------|------------|---------------|-------|
| `patent_id` | ✅ Primary key | ✅ Document ID | Link between systems |
| `title` | ✅ Display/reports | ✅ Search | Redundant for convenience |
| `abstract` | ❌ Large text | ✅ Search/MLT | Only in ES to save PG space |
| `grant_date` | ✅ Filtering | ✅ Filtering | Small, keep both |
| `assignee` | ✅ Normalized | ✅ Search | Different formats |
| `cpc_codes` | ✅ Array | ✅ Array | Same format |
| `forward_citations` | ✅ Scoring | ✅ Filtering | Small integer |
| `competitor_citations` | ✅ Scoring | ✅ Filtering | Computed |
| `competitors_citing` | ✅ Array | ✅ Array | For filtering |
| `tier` | ✅ Computed | ✅ Filtering | Small integer |
| `enhanced_score` | ✅ Computed | ✅ Sorting | Float |

### What to Store Only in PostgreSQL

| Field | Rationale |
|-------|-----------|
| User notes | Relational, user-specific |
| Weight profiles | Configuration, not searchable |
| Sector assignments | Many-to-many relationship |
| Search term hits | Junction table |
| Analysis run metadata | Audit/history |
| Discovery strategy provenance | Tracking |

### What to Store Only in ElasticSearch

| Field | Rationale |
|-------|-----------|
| `abstract` (full text) | Large, only needed for search |
| `claims[]` (future) | Large, claim-level search |
| `abstract_vector` (future) | Dense vector for semantic search |
| Term vectors | ES-specific feature |

---

## GUI Integration Points

### Search & Browse (ElasticSearch Primary)

```typescript
// Example: Patent search with facets
async searchPatents(query: string, filters: SearchFilters) {
  // Use ElasticSearch for full-text search
  const esResults = await es.search({
    query: query,
    filters: {
      tier: filters.tier,
      competitors_citing: filters.competitor,
      cpc_class: filters.cpcClass,
      sector: filters.sector  // From ES field
    },
    highlight: true,
    aggregations: ['cpc_class', 'competitors_citing', 'tier']
  });

  return esResults;
}
```

### Patent Detail View (Both)

```typescript
// Example: Full patent details
async getPatentDetail(patentId: string) {
  // Get structured data from PostgreSQL
  const pgData = await prisma.patent.findUnique({
    where: { id: patentId },
    include: {
      assignees: true,
      cpcCodes: true,
      competitorCitations: { include: { competitor: true } },
      analysisResults: { orderBy: { createdAt: 'desc' } },
      searchTermHits: { include: { searchTerm: true } }
    }
  });

  // Get abstract from ElasticSearch
  const esData = await es.get(patentId);

  return {
    ...pgData,
    abstract: esData.abstract,
    highlights: esData.highlights
  };
}
```

### User Preferences (PostgreSQL Only)

```typescript
// Example: Update weight profile
async updateWeightProfile(profileId: number, weights: Record<string, number>) {
  return prisma.userWeightProfile.update({
    where: { id: profileId },
    data: { weights, updatedAt: new Date() }
  });
}
```

### Sector Curation (PostgreSQL + Sync)

```typescript
// Example: Assign patent to sector
async assignPatentToSector(patentId: string, sectorId: number) {
  // Write to PostgreSQL
  await prisma.userSectorPatent.create({
    data: { patentId, sectorId }
  });

  // Update ElasticSearch document
  await es.update(patentId, {
    sector_id: sectorId,
    sector_name: await getSectorName(sectorId)
  });
}
```

### Search Term Management (PostgreSQL + Trigger Re-score)

```typescript
// Example: Add boost term
async addSearchTerm(term: string, weight: number) {
  const created = await prisma.searchTerm.create({
    data: { term, category: 'boost', weight, source: 'manual' }
  });

  // Trigger re-computation of affected patent scores
  await queueScoreRecalculation(term);

  return created;
}
```

---

## Future Enhancements

### 1. Semantic Search (Vector Embeddings)

```typescript
// Add to ElasticSearch mapping
{
  "abstract_vector": {
    "type": "dense_vector",
    "dims": 768,  // sentence-transformers output
    "index": true,
    "similarity": "cosine"
  }
}

// Semantic search query
async semanticSearch(query: string) {
  const queryVector = await embedText(query);  // sentence-transformers

  return es.search({
    knn: {
      field: "abstract_vector",
      query_vector: queryVector,
      k: 50,
      num_candidates: 100
    }
  });
}
```

### 2. Real-time Sync (Change Data Capture)

```typescript
// PostgreSQL triggers -> message queue -> ES sync
// Consider: Debezium, pg_notify, or simple polling
```

### 3. Caching Layer

```typescript
// Redis for frequently accessed data
// - Weight profiles (rarely change)
// - Sector definitions
// - Competitor patterns
```

---

## Implementation Phases

### Phase 1: Current State (Complete)
- [x] ElasticSearch indexed with 22,706 patents
- [x] PostgreSQL schema defined
- [x] User preferences seeded from JSON

### Phase 2: PostgreSQL Population
- [ ] Import patents from JSON to PostgreSQL
- [ ] Import citations and competitor citations
- [ ] Import analysis results (LLM scores)

### Phase 3: Sync Mechanism
- [ ] Create sync service (PG -> ES)
- [ ] Add sector/strategy fields to ES documents
- [ ] Test bidirectional updates

### Phase 4: API Layer
- [ ] Express.js REST API
- [ ] Search endpoint (ES)
- [ ] Detail endpoint (PG + ES)
- [ ] Preference endpoints (PG)

### Phase 5: GUI Foundation
- [ ] Quasar/Vue.js scaffold
- [ ] Patent search interface
- [ ] Weight slider controls
- [ ] Sector management

---

## Questions for Review

1. **Abstract storage**: Store in PostgreSQL for completeness, or keep only in ES?
2. **Claims text**: Plan to import claims for search? (Large data volume)
3. **Sync frequency**: Real-time vs. batch sync acceptable?
4. **User isolation**: Multiple users with separate preferences?
5. **Export formats**: Additional export formats beyond CSV?

---

*Document created: 2026-01-17*
*For review with GUI design requirements*
