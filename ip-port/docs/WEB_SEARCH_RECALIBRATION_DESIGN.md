# Web Search Integration & Recalibration Pipeline Design

## Overview

This document outlines the architecture for integrating web search capabilities into our patent analysis pipeline for:
1. **Product Discovery** - Find current products implementing patented technology
2. **Market Validation** - Validate sector damages ratings with real market data
3. **Competitor Discovery** - Surface competitors not in citation data
4. **Recalibration** - Feed findings back to adjust scoring weights and damages tiers

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     WEB SEARCH INTEGRATION PIPELINE                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────────────┐    │
│  │ Patent Data   │───▶│ Sector-Specific│───▶│ Web Search Queries   │    │
│  │ (V3 LLM)      │    │ Prompt         │    │ (Claude WebSearch)   │    │
│  │               │    │                │    │                       │    │
│  │ - tech_category│    │ - product_types│    │ - Product searches   │    │
│  │ - product_types│    │ - market_segment│   │ - Company searches   │    │
│  │ - implementers │    │ - search_queries│   │ - Market research    │    │
│  └───────────────┘    └───────────────┘    └───────────────────────┘    │
│                                                     │                    │
│                    ┌────────────────────────────────┘                    │
│                    ▼                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    SYNTHESIS & STORAGE                           │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │    │
│  │  │ Products DB  │  │ Market Data  │  │ Competitor Updates   │   │    │
│  │  │              │  │              │  │                      │   │    │
│  │  │ - Name       │  │ - Market size│  │ - New companies      │   │    │
│  │  │ - Company    │  │ - Revenue    │  │ - Patent counts      │   │    │
│  │  │ - Price      │  │ - Growth rate│  │ - Citation potential │   │    │
│  │  │ - Category   │  │ - Players    │  │                      │   │    │
│  │  └──────────────┘  └──────────────┘  └──────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                   │                                      │
│                    ┌──────────────┴──────────────┐                       │
│                    ▼                             ▼                       │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────┐   │
│  │     RECALIBRATION           │  │     VENDOR HANDOFF              │   │
│  │                             │  │                                 │   │
│  │ - Adjust sector damages     │  │ - Patlytics product list        │   │
│  │ - Update scoring weights    │  │ - Claim chart priorities        │   │
│  │ - Refine sector definitions │  │ - Evidence documentation        │   │
│  └─────────────────────────────┘  └─────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Product Discovery Pipeline

**Input:** Top patents per sector with V3 LLM analysis
**Output:** Structured product data for vendor handoff

```typescript
interface ProductDiscovery {
  patent_id: string;
  sector: string;
  search_queries: string[];     // Generated from V3 LLM
  products_found: Product[];
  market_data: MarketData;
  confidence: number;
}

interface Product {
  name: string;
  company: string;
  category: string;
  price_range?: string;
  evidence_url: string;
  relevance_score: number;      // LLM-assessed match to patent
}
```

**Process:**
1. For each sector, take top 20 patents by unified score
2. Generate search queries from `product_types`, `likely_implementers`
3. Execute web searches (3-5 per patent)
4. LLM synthesizes results into structured product list
5. Store in PostgreSQL for GUI display and vendor export

### Phase 2: Market Validation & Damages Recalibration

**Current Damages Tiers:**
| Tier | Rating | Sectors |
|------|--------|---------|
| Very High | 4 | video-codec, rf-acoustic, video-drm |
| High | 3 | semiconductor, network-switching |
| Medium | 2 | computing-runtime, wireless |
| Low | 1 | general, computing-ui |

**Recalibration Process:**
1. Web search for market size per sector
2. Compare against tier assignment
3. Flag discrepancies for review
4. Generate recalibration recommendations

```json
// Example recalibration output
{
  "sector": "cloud-auth",
  "current_tier": "high",
  "market_data": {
    "market_size": "$15.2B",
    "growth_rate": "14.2%",
    "source": "https://...",
    "key_players": ["Okta", "Microsoft", "Auth0"]
  },
  "recommendation": "UPGRADE to very_high",
  "rationale": "Market size and growth exceeds video-codec"
}
```

### Phase 3: Competitor Discovery via Web Search

**Beyond Citation Data:**
- Citation overlap finds who CITES our patents
- Web search finds who IMPLEMENTS similar technology

**Process:**
1. For each sector, search for market leaders
2. Compare against `config/competitors.json`
3. Flag missing competitors
4. Generate competitor addition recommendations

```typescript
interface CompetitorDiscovery {
  sector: string;
  web_search_companies: string[];
  currently_tracked: string[];
  missing_companies: CompetitorCandidate[];
}

interface CompetitorCandidate {
  name: string;
  reason: string;           // "market leader", "web search", "product evidence"
  estimated_patent_count?: number;
  products: string[];
}
```

### Phase 4: Sector-Specific Facets

**New Facets for Scoring Models:**

Each sector can have custom scoring adjustments based on:

```json
{
  "sector_facets": {
    "video-codec": {
      "licensing_friction": 0.8,       // 61% cite fees as barrier
      "standards_relevance_weight": 1.5, // HEVC/AVC standards important
      "hardware_implementation_boost": 1.2,
      "key_products": ["streaming platforms", "video conferencing", "broadcasters"]
    },
    "rf-acoustic": {
      "standards_relevance_weight": 2.0, // 3GPP/IEEE critical
      "design_around_difficulty_boost": 1.3, // Physics constraints
      "hardware_implementation_boost": 1.5,
      "key_products": ["smartphones", "5G infrastructure", "IoT devices"]
    },
    "cloud-auth": {
      "market_growth_boost": 1.4,       // High growth sector
      "enterprise_focus_weight": 1.2,
      "key_products": ["identity platforms", "SSO providers", "MFA solutions"]
    }
  }
}
```

**Formula Integration:**
```
SectorScore = BaseScore × SectorDamagesTier × SectorFacetMultiplier
```

Where `SectorFacetMultiplier` is computed from relevant facets.

---

## Data Storage Schema

### PostgreSQL Tables (New)

```sql
-- Web search results for patents
CREATE TABLE patent_product_discoveries (
    id SERIAL PRIMARY KEY,
    patent_id VARCHAR(20) REFERENCES patents(patent_id),
    sector VARCHAR(100),
    search_query TEXT,
    search_date TIMESTAMP DEFAULT NOW(),
    products JSONB,           -- Array of Product objects
    market_data JSONB,
    confidence DECIMAL(3,2)
);

-- Market data per sector
CREATE TABLE sector_market_data (
    sector VARCHAR(100) PRIMARY KEY,
    market_size_usd BIGINT,
    growth_rate DECIMAL(5,2),
    key_players TEXT[],
    last_updated TIMESTAMP DEFAULT NOW(),
    sources TEXT[],
    raw_search_data JSONB
);

-- Competitor discovery queue
CREATE TABLE competitor_candidates (
    id SERIAL PRIMARY KEY,
    company_name VARCHAR(255),
    sector VARCHAR(100),
    discovery_source VARCHAR(50),  -- 'web_search', 'market_research', 'citation'
    products TEXT[],
    rationale TEXT,
    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
    created_at TIMESTAMP DEFAULT NOW()
);

-- Sector facets configuration
CREATE TABLE sector_facets (
    sector VARCHAR(100) PRIMARY KEY,
    facets JSONB,
    last_updated TIMESTAMP DEFAULT NOW(),
    updated_by VARCHAR(100)
);

-- Recalibration audit trail
CREATE TABLE recalibration_log (
    id SERIAL PRIMARY KEY,
    recalibration_type VARCHAR(50), -- 'sector_damages', 'competitor', 'facet'
    target_entity VARCHAR(255),
    old_value JSONB,
    new_value JSONB,
    rationale TEXT,
    approved_by VARCHAR(100),
    applied_at TIMESTAMP DEFAULT NOW()
);
```

---

## API Endpoints (Future GUI Integration)

```typescript
// Product discovery
POST /api/patents/:id/discover-products
GET  /api/patents/:id/products
GET  /api/sectors/:sector/products

// Market data
GET  /api/sectors/:sector/market-data
POST /api/sectors/:sector/refresh-market-data

// Competitor management
GET  /api/competitors/candidates
POST /api/competitors/candidates/:id/approve
POST /api/competitors/candidates/:id/reject
GET  /api/competitors/discovery-queue

// Recalibration
GET  /api/recalibration/pending
POST /api/recalibration/:id/apply
GET  /api/recalibration/history

// Sector facets
GET  /api/sectors/:sector/facets
PUT  /api/sectors/:sector/facets
```

---

## GUI Integration Points

From `docs/GUI_DESIGN_SPEC.md`:

1. **Patent Detail View**
   - Products tab showing discovered products
   - Market data card with sector context
   - Evidence links for vendor handoff

2. **Sector Dashboard**
   - Market size and growth visualization
   - Key players list
   - Recalibration recommendations

3. **Configuration Panel**
   - Sector facet editing
   - Competitor approval workflow
   - Recalibration history

4. **Vendor Export**
   - Product list for Patlytics (20 products/patent)
   - Evidence documentation
   - Market context for negotiations

---

## Cost Considerations

### Web Search Costs
- Claude WebSearch: Included in API calls
- Estimate: 3-5 searches per patent
- Top 250 patents × 5 searches = 1,250 searches

### LLM Synthesis Costs
- Product synthesis: ~$0.01/patent (Sonnet)
- Market analysis: ~$0.05/sector (Opus)
- Total for top 250 + 50 sectors: ~$5-10

### Time Estimates
- Product discovery (250 patents): ~2-3 hours
- Market data refresh (50 sectors): ~1 hour
- Recalibration recommendations: Immediate

---

## Implementation Priority

| Priority | Task | Effort | Dependencies |
|----------|------|--------|--------------|
| 1 | Product discovery script | 1 day | WebSearch tool |
| 2 | Market data collection | 1 day | WebSearch tool |
| 3 | PostgreSQL schema | 0.5 day | None |
| 4 | Sector facets config | 0.5 day | Market data |
| 5 | Recalibration workflow | 1 day | Schema + data |
| 6 | API endpoints | 2 days | Schema |
| 7 | GUI integration | 3 days | API endpoints |

---

## Next Steps

1. **Create `scripts/discover-sector-products.ts`**
   - Input: Sector name, top N patents
   - Output: Product discoveries + market data

2. **Create `config/sector-facets.json`**
   - Initial facets based on current knowledge
   - Web search validation

3. **Test on video-codec sector**
   - 18 patents in top 250
   - Known market ($2.5B, 15% CAGR)
   - Clear product landscape

4. **Expand to all priority sectors**
   - cloud-auth (35 patents)
   - network-switching (22 patents)
   - rf-acoustic (317 patents, 1 in top 250)

---

*Document created: 2026-01-18*
*Status: Design complete, ready for implementation*
