# Hybrid Clustering Strategy for Competitor Discovery

## Overview

This strategy combines the **citation overlap approach** with **term extraction** to create targeted competitor discovery clusters. By analyzing the top-scoring patents from citation overlap and clustering them by technology affinity, we can run focused competitor discovery on each cluster with technology-specific search terms.

## Strategy Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     Strategy 1 Results                           │
│        (Top N patents from citation overlap analysis)            │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│              Extract Terms from Abstracts/Titles                 │
│         (ElasticSearch significant_text aggregation)             │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│          Cluster Patents by Term Affinity                        │
│     (Create N/3 to N/10 subgroups with high intra-similarity)   │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Cluster 1     │     │   Cluster 2     │     │   Cluster N     │
│ (e.g., DRM/     │     │ (e.g., Video    │     │ (e.g., Network  │
│  Encryption)    │     │  Codec)         │     │  Security)      │
│                 │     │                 │     │                 │
│ Terms: encrypt, │     │ Terms: codec,   │     │ Terms: network, │
│ decrypt, key,   │     │ decode, frame,  │     │ firewall, auth, │
│ certificate     │     │ compression     │     │ packet          │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│      Run Strategy 2 (Term Extraction) on Each Cluster           │
│        (USPTO API competitor discovery with cluster terms)       │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Steps

### Step 1: Load Top Patents from Strategy 1

Load the top 50-100 actionable patents from citation overlap results:
- Use `output/tier-litigation-*.json` for highest-value targets
- Filter for `isActionable: true`
- Sort by `litigationScore` or `overallActionableScore`

### Step 2: Extract Terms per Patent

For each patent:
1. Query ElasticSearch for the patent document
2. Extract significant terms from abstract using `significant_text` aggregation
3. Build a term vector: `{ patent_id, terms: [{ term, score }] }`

### Step 3: Build Similarity Matrix

Calculate term-based similarity between all patent pairs:
- Use Jaccard similarity or cosine similarity on term vectors
- Higher overlap = higher similarity

### Step 4: Cluster Patents

Use agglomerative clustering or k-means:
- Target: N/3 to N/10 clusters (e.g., 50 patents → 5-17 clusters)
- Optimize for intra-cluster similarity
- Each cluster should have coherent technology theme

### Step 5: Generate Cluster Profiles

For each cluster:
1. Extract the union of significant terms
2. Identify the dominant CPC codes
3. Name the cluster by technology theme
4. Calculate cluster "strength" (avg similarity within cluster)

### Step 6: Register as New Strategies

Add each cluster to `discoveryStrategies` in competitors.json:
```json
{
  "cluster-hybrid-drm-security": {
    "name": "Hybrid Cluster - DRM & Security",
    "type": "term-extraction",
    "dateAdded": "2026-01-17",
    "parameters": {
      "sourceStrategy": "citation-overlap-broadcom-streaming",
      "clusterMethod": "term-affinity",
      "patentCount": 12,
      "extractedTerms": ["encrypt", "decrypt", "key", "certificate", "drm"],
      "clusterStrength": 0.73,
      "script": "scripts/cluster-competitor-discovery.ts"
    }
  }
}
```

### Step 7: Run Competitor Discovery

Execute Strategy 2 (term extraction competitor discovery) on each cluster:
1. Start with highest-strength cluster
2. Use cluster-specific terms for USPTO API queries
3. Tag discovered competitors with cluster strategy ID

## Clustering Algorithm

### Term Vector Construction

For each patent, build weighted term vector:
```typescript
interface TermVector {
  patent_id: string;
  terms: Map<string, number>;  // term -> weight
}
```

Weight calculation:
- Base: term frequency in abstract
- Boost: +50% if term appears in title
- Normalize: divide by document length

### Similarity Calculation

Cosine similarity between term vectors:
```
similarity(A, B) = (A · B) / (||A|| × ||B||)
```

### Agglomerative Clustering

1. Start with each patent as its own cluster
2. Iteratively merge two most similar clusters
3. Stop when:
   - Reached target cluster count (N/3 to N/10)
   - OR minimum inter-cluster similarity threshold met

### Cluster Quality Metrics

- **Intra-cluster similarity**: Average pairwise similarity within cluster
- **Inter-cluster separation**: Average distance between cluster centroids
- **Silhouette score**: Balance of cohesion vs separation

## Expected Outputs

| Output File | Description |
|-------------|-------------|
| `cluster-definitions-{date}.json` | Cluster assignments and profiles |
| `cluster-terms-{date}.json` | Extracted terms per cluster |
| `cluster-strategies-{date}.json` | Strategy definitions for competitors.json |
| `cluster-competitor-results-{cluster}-{date}.json` | Competitor discovery per cluster |

## Configuration Parameters

```typescript
interface ClusteringConfig {
  // Input
  sourceFile: string;           // tier-litigation-*.json
  maxPatents: number;           // 50-100

  // Clustering
  minClusters: number;          // N/10
  maxClusters: number;          // N/3
  minClusterSize: number;       // 3
  minSimilarityThreshold: number; // 0.3

  // Term extraction
  maxTermsPerPatent: number;    // 20
  minTermScore: number;         // 0.1
}
```

## Success Criteria

1. **Cluster Coherence**: Each cluster has clear technology theme
2. **Term Quality**: Extracted terms are technically meaningful (not stopwords)
3. **Competitor Discovery**: Each cluster surfaces 3+ new competitors not in current list
4. **Provenance Tracking**: All new competitors tagged with correct cluster strategy

## Example Clusters

Based on the existing top patents, expected clusters might include:

| Cluster | Theme | Example Terms | Likely Competitors |
|---------|-------|---------------|-------------------|
| 1 | DRM/Encryption | encrypt, decrypt, key, certificate | DRM vendors, security companies |
| 2 | Video Codec | codec, decode, frame, entropy | Codec chip makers, streaming tech |
| 3 | Biometric Auth | biometric, fingerprint, authentication | Identity/auth vendors |
| 4 | Network Security | firewall, packet, intrusion, vpn | Network security vendors |
| 5 | Content Delivery | stream, buffer, adaptive, bitrate | CDN providers, streaming platforms |

---

*Strategy documented: 2026-01-17*
*Implementation: scripts/hybrid-cluster-analysis.ts*
