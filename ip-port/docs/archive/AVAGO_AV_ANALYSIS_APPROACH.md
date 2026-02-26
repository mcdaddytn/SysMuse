# Avago Audio/Video Patent Analysis Approach

## Overview

This document outlines an approach to leverage Avago's audio/video patent portfolio to discover niche competitors and build targeted search strategies using ElasticSearch term extraction and USPTO API queries.

## Problem Statement

The current competitor analysis focuses on large tech companies identified through citation overlap. However, domain-specific companies (like Avid in professional audio/video) may not appear in citation data but could be valuable licensing targets or litigation candidates based on technology overlap.

## Avago A/V Patent Corpus

- **Total Avago patents**: 2,910
- **Audio/Video related**: 445 patents
- **Key technology areas identified**:
  - Video codecs (H.264, HEVC, VVC)
  - Adaptive bitrate streaming
  - HDMI/DisplayPort interfaces
  - Audio processing (I2S, SPDIF)
  - Media playback systems
  - Wireless media transport

## Three-Pronged Search Strategy

### 1. Internal Portfolio Search (ElasticSearch)

**Purpose**: Find related patents across the entire Broadcom/Symantec/Avago portfolio using extracted terminology.

**Technical Approach**:
```
1. Extract significant terms from Avago A/V patent abstracts using ES term aggregations
2. Use More-Like-This (MLT) queries to find similar patents across portfolio
3. Build term vectors for key technology categories
4. Identify patent clusters by semantic similarity
```

**ElasticSearch Queries**:
```json
// Extract significant terms from Avago patents
POST /patents/_search
{
  "query": {
    "bool": {
      "filter": { "term": { "assignee.keyword": "Avago Technologies" } }
    }
  },
  "aggs": {
    "significant_terms": {
      "significant_text": {
        "field": "abstract",
        "size": 50
      }
    }
  }
}

// More-Like-This query
POST /patents/_search
{
  "query": {
    "more_like_this": {
      "fields": ["title", "abstract"],
      "like": [
        { "_index": "patents", "_id": "12289460" }  // VVC patent
      ],
      "min_term_freq": 1,
      "min_doc_freq": 2
    }
  }
}
```

### 2. USPTO API Competitor Discovery

**Purpose**: Find new potential competitors in the A/V space by searching USPTO for companies citing our A/V patents or working in the same CPC codes.

**Technical Approach**:
```
1. Extract CPC codes common to Avago A/V patents
2. Query PatentsView for other assignees in those CPC codes
3. Use extracted terminology to search patent titles/abstracts
4. Identify assignees not in current competitor list
```

**Target CPC Codes for A/V**:
- H04N (Video coding/transmission)
- H04R (Audio/acoustics)
- G10L (Speech/audio processing)
- G06T (Image processing)
- G11B (Information storage)

**Potential Niche Competitors to Investigate**:
- Avid Technology (professional media)
- Blackmagic Design (video equipment)
- Dolby Laboratories (audio/video codecs)
- DTS (audio codecs)
- Harmonic Inc (video streaming infrastructure)
- Grass Valley (broadcast equipment)
- Ross Video (broadcast systems)
- AJA Video Systems (video interfaces)
- Matrox (video cards)
- Xilinx/AMD (FPGA video processing)

### 3. Product Web Search Terms

**Purpose**: Build search queries to identify commercial products potentially practicing Avago A/V patents.

**Technical Approach**:
```
1. Extract technical noun phrases from patent claims/abstracts
2. Map patent terminology to commercial product features
3. Generate web search queries combining:
   - Technical terms + "product" + company name
   - Feature descriptions + "specification"
   - Standard names (HDMI 2.1, HEVC, etc.) + implementation
```

**Example Search Term Mappings**:
| Patent Terminology | Commercial Search Terms |
|--------------------|------------------------|
| "adaptive bitrate streaming" | "ABR streaming encoder", "HLS implementation" |
| "video codec entropy coding" | "HEVC encoder chip", "H.265 hardware" |
| "low latency media transport" | "broadcast video over IP", "NDI implementation" |
| "audio sample rate conversion" | "professional audio interface", "DAC chip" |

## Implementation Steps

### Phase 1: Term Extraction (ElasticSearch)
1. Query ES for Avago A/V patents (filter by assignee + A/V keywords)
2. Run significant_text aggregation on abstracts
3. Run term frequency analysis on titles
4. Extract technical bigrams and trigrams
5. Output: `avago-av-key-terms.json`

### Phase 2: Portfolio Clustering
1. For each key term, run ES search across full portfolio
2. Group results by assignee origin (Avago, Broadcom, Symantec)
3. Identify cross-portfolio technology connections
4. Output: `av-patent-clusters.json`

### Phase 3: Competitor Discovery
1. Query PatentsView API with extracted terms
2. Filter for non-Broadcom assignees
3. Rank by citation overlap and term relevance
4. Cross-reference with known A/V industry players
5. Output: `av-competitor-candidates.json`

### Phase 4: Product Search Preparation
1. Map technical terms to product feature descriptions
2. Generate search query templates
3. Identify target companies and product lines
4. Output: `av-product-search-queries.json`

## Expected Outputs

| Output File | Description |
|-------------|-------------|
| `avago-av-key-terms.json` | Extracted significant terms and phrases |
| `av-patent-clusters.json` | Patents grouped by technology area |
| `av-competitor-candidates.json` | New potential competitors to investigate |
| `av-product-search-queries.json` | Web search queries for product evidence |
| `av-cpc-analysis.json` | CPC code distribution and overlap |

## Technical Requirements

- ElasticSearch running (verified: 22,706 patents indexed)
- PatentsView API access (verified: working)
- Node.js scripts for orchestration

## Success Criteria

1. Identify 10+ significant technical terms unique to Avago A/V patents
2. Discover 5+ new competitor candidates not in current 61-company list
3. Generate 20+ product search queries with clear patent mapping
4. Create actionable patent clusters for licensing discussions

---

*Document created: 2026-01-17*
*Next session: Execute Phase 1-4 implementation*
