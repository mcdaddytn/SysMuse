# Session Context — March 27, 2026

## Current Focus: Taxonomy Analysis & Refactor Planning

We are in the **analysis phase** of a major refactor, gathering data to inform taxonomy and multi-classification schema design.

### Pre-Refactor State Tagged

```
git tag: v1.0-pre-refactor
commit:  f87042f
```

Safe rollback point. Database state has been exported and verified on separate machine.

---

## Taxonomy Analysis Completed

### Key Findings

| Metric | Value | Implication |
|--------|-------|-------------|
| **82.7%** of top patents | have multiple inventive CPCs | High-value patents are complex |
| **51.4%** of top patents | map to multiple sectors | Single-classification loses nuance |
| **34.8%** of top patents | span multiple super-sectors | Cross-domain innovations |
| **N=3 associations** | captures 92.7% of sector coverage | Sweet spot for privileged associations |

### Optimal Association Count

| N | Sector Coverage | Marginal Gain |
|---|-----------------|---------------|
| 1 (current) | 49.6% | - |
| 2 | 79.6% | +30.0% |
| **3 (optimal)** | **92.7%** | +13.0% |
| 4 | 97.3% | +4.6% (diminishing) |

**Decision:** Target 3 privileged associations (primary, secondary, tertiary) with configurable expansion for high-value patents.

### Open Questions (Noted for Future)

1. **Sparse associations:** Some patents won't fill 3 slots. Options: null, duplicate primary, lower-confidence from additional CPCs
2. **High-value exceptions:** 8% need 4+ associations. Consider special handling / expanded LLM questions
3. **Weighting:** Inventive vs additional CPCs, reinforcement when multiple CPCs map to same sector

### Analysis Scripts Created

| Script | Purpose |
|--------|---------|
| `scripts/analyze-taxonomy-coverage.ts` | Overall CPC coverage, indexing codes |
| `scripts/analyze-taxonomy-gaps.ts` | Unmapped CPC analysis, core class gaps |
| `scripts/analyze-inventive-cpc-divergence.ts` | High-value patent divergence patterns |
| `scripts/analyze-association-coverage.ts` | Coverage curves, optimal N determination |
| `scripts/analyze-taxonomy-clustering.ts` | Sector co-occurrence, natural clusters |

### Analysis Output Files

Located in `output/`:
- `taxonomy-analysis-*.json` - Full coverage analysis
- `taxonomy-gaps-*.json` - Gap deep-dive
- `inventive-divergence-*.json` - High-value patent CPC divergence
- `association-coverage-*.json` - Coverage curves
- `taxonomy-clustering-*.json` - Co-occurrence clusters

**Note for machine transfer:** Include `output/` directory in transfers to preserve analysis results.

---

## Natural Sector Clusters Identified

7 clusters based on co-occurrence (Jaccard similarity > 0.25):

| Cluster | Overlap | Note |
|---------|---------|------|
| cameras-sensors + video-codec | **42%** | Cross-domain (IMAGING↔VIDEO_STREAMING) |
| image-processing + recognition-biometrics | 31% | Within IMAGING |
| wireless-scheduling + mobility + infrastructure | 24-31% | Within WIRELESS |
| video-client-processing + video-server-cdn | 31% | Within VIDEO_STREAMING |

If clustered: N=3 coverage improves from 92.7% to 95.7%.

---

## Design Documentation

Primary design document: `docs/design/TAXONOMY_ANALYSIS_RESULTS.md`

Contains:
- Coverage curves with data
- Distribution analysis
- Cluster recommendations
- Schema proposals (additive, non-breaking)
- Open questions for future exploration

---

## Refactor Roadmap (Not Scheduled)

### Analysis Phase (Current) ✓
- [x] Basic CPC coverage analysis
- [x] Indexing code identification
- [x] High-value patent divergence
- [x] Association coverage curves
- [x] Sector clustering analysis

### Schema Design Phase (Next)
- [ ] Multi-classification junction table design
- [ ] CPC association count fields on Patent
- [ ] Alternate taxonomy framework schema
- [ ] CPC co-occurrence table for data-driven refinement

### Implementation Phase (Future)
- [ ] Multi-classification assignment algorithm
- [ ] Populate privileged associations for existing patents
- [ ] Cross-classification query support
- [ ] GUI updates for secondary/tertiary classification filters

---

## Previous Session Context (February 25)

The previous session focused on vendor package generation (VIDEO, WIRELESS, SEMICONDUCTOR). Key artifacts:

- Vendor exports in `output/vendor-exports/`
- Focus area prompts in `cache/focus-area-prompts/`
- Known issue: WIRELESS collective template missing `{{focusArea.patentData}}`

That work is preserved but paused while we focus on taxonomy/schema analysis.

---

## Git State

```
Branch: main
Behind origin: 6 commits (can fast-forward when ready)
Local commits since v1.0-pre-refactor:
  - f87042f Added sys overview and data arch docs
  - 8e66e5a Add comprehensive taxonomy coverage analysis scripts
  - 5643639 Add high-value patent CPC divergence analysis
  - 1bfddf5 Add association coverage and clustering analysis
```

Phase 3C work archived in branch: `phase-3c-archive`

---

## Infrastructure

| Component | Status | Port |
|-----------|--------|------|
| API Server | `npm run dev` | 3001 |
| Frontend | `npm run dev` (frontend/) | 3000 |
| PostgreSQL | Docker | 5432 |
| Elasticsearch | Docker | 9200 |

---

## Key Data Locations

| Data | Path |
|------|------|
| Analysis output | `output/*.json` |
| Design docs | `docs/design/` |
| Analysis scripts | `scripts/analyze-*.ts` |
| Taxonomy config | `config/sector-taxonomy-cpc-only.json` |
| LLM cache | `cache/llm-scores/` |
| Patent XMLs | `$USPTO_PATENT_GRANT_XML_DIR` |

---

*Last Updated: 2026-03-27*
