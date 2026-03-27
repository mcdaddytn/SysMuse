# Taxonomy Coverage Analysis Results

**Generated:** 2026-03-27
**Updated:** 2026-03-27 (added high-value patent divergence analysis)
**Analysis Scripts:**
- `scripts/analyze-taxonomy-coverage.ts` - Full coverage analysis
- `scripts/analyze-taxonomy-gaps.ts` - Gap deep-dive
- `scripts/analyze-inventive-cpc-divergence.ts` - High-value patent analysis

---

## Executive Summary

The current CPC-based taxonomy provides **strong coverage of core technology areas**, but **single-classification assignment significantly under-represents high-value patents**:

**Coverage is good:**
- Core class coverage: H04L 93.5%, H04W 95%, G06F 99.9%, H04N 99.5%
- 9,785 indexing codes (Y-section, 2xxx-scheme) should be filtered

**But high-value patents span classifications:**
- **82.7%** of top patents have multiple inventive CPC codes
- **51.4%** of top patents map to **multiple sectors** via inventive CPCs
- **34.8%** of top patents map to **multiple super-sectors**
- **30.4%** diverge at section or class level (fundamentally multi-domain)

**Implication:** Single-classification assignment loses significant nuance for the patents that matter most.

---

## Dataset Statistics

| Metric | Value |
|--------|-------|
| **Total Patents** | 84,321 |
| **Patents with CPC codes** | 83,302 (98.8%) |
| **Patents without CPC codes** | 1,019 (1.2%) |
| **Unique CPC codes in dataset** | 40,790 |
| **Taxonomy sectors** | 55 |
| **Taxonomy CPC prefixes** | 138 |

---

## CPC Coverage Analysis

### Raw Coverage (including indexing codes)

| Metric | Value |
|--------|-------|
| CPC codes in taxonomy | 28,899 (70.8%) |
| CPC codes NOT in taxonomy | 11,891 (29.2%) |
| Patents fully covered | 61,537 (73.9%) |
| Patents partially covered | 20,684 (24.8%) |
| Patents not covered | 1,081 (1.3%) |

### Adjusted Coverage (excluding indexing codes)

| Metric | Value |
|--------|-------|
| **Primary CPC codes** | 31,005 |
| **Unmapped primary codes** | 7,347 (23.7%) |
| **Indexing codes (excluded)** | 9,785 |

**Key Insight:** The 29.2% "unmapped" figure includes 9,785 indexing codes that are secondary tags (Y02 climate, Y10 USPC, G06F2xxx/H04L2xxx scheme codes). These should be filtered from sector assignment logic.

---

## Indexing Code Breakdown

Indexing codes are **supplementary classification tags** that should NOT be used for primary sector assignment:

| Type | Codes | Patents | Example |
|------|-------|---------|---------|
| `indexing-scheme` (G06F2xxx, H01L2xxx) | 9,055 | 95,955 | G06F2009/45595 (VM indexing) |
| `Y02-climate` (sustainability tags) | 185 | 5,556 | Y02D30/70 (energy efficiency) |
| `Y10-uspc` (old US classification) | 519 | 2,342 | Y10T (technology classes) |
| `Y-other` | 26 | 221 | Other Y-section codes |

**Recommendation:** Filter out codes matching patterns `^Y`, `^[A-H]\d{2}[A-Z]2\d{3}` before sector assignment.

---

## Core Class Coverage

The taxonomy excels at covering the core technology classes relevant to the portfolio:

| Class | Description | Total Groups | Covered | Coverage % |
|-------|-------------|--------------|---------|------------|
| **G06F** | Computing | 2,552 | 2,550 | **99.9%** |
| **H04N** | Video | 1,573 | 1,565 | **99.5%** |
| **H04W** | Wireless | 923 | 878 | **95.1%** |
| **H04L** | Networks | 2,441 | 2,282 | **93.5%** |
| **H04B** | Transmission | 812 | 812 | **100%** |
| **G06N** | AI/ML | 127 | 127 | **100%** |
| **H01L** | Semiconductor | 1,418 | 1,418 | **100%** |
| **H03H** | RF Filters | 457 | 457 | **100%** |

### Minor Gaps in Core Classes

| Class | Gap Groups | Top Gap | Patents |
|-------|------------|---------|---------|
| H04L | H04L63/8, H04L63/27x | H04L638 | 251 |
| H04W | H04W92/18, H04W60/xx | H04W9218 | 285 |
| G06F | G06F2100, G06F21 (root) | G06F2100 | 61 |

These gaps are small and represent edge cases in the classification hierarchy.

---

## Completely Unmapped Classes

These CPC classes have 100% unmapped codes - they're **not in the taxonomy by design** as they're outside the core business focus:

| Class | Codes | Description | Relevance |
|-------|-------|-------------|-----------|
| A61B | 478 | Medical/diagnostic devices | Non-core |
| H01M | 303 | Batteries/fuel cells | Non-core |
| G05D | 180 | Vehicle control systems | Non-core |
| B32B | 167 | Layered products | Manufacturing |
| D06F | 161 | Laundry/cleaning | Non-core |
| F24F | 154 | Air conditioning | Non-core |
| B25J | 154 | Manipulators/robots | Non-core |
| B60W | 153 | Vehicle control | Non-core |
| G08G | 145 | Traffic control | Non-core |

These likely came from acquired portfolios and may warrant separate handling or exclusion.

---

## Inventive CPC Strategy Analysis

The current "first inventive CPC" strategy performs well:

| Metric | Value |
|--------|-------|
| Patents with inventive CPCs | 31,734 |
| Avg inventive codes per patent | 1.73 |
| Avg additional codes per patent | 6.30 |
| First inventive matches taxonomy | 29,722 (93.7%) |
| **Missed by first-only strategy** | **1,043 (1.25%)** |

**Note:** The 1.25% figure only measures "first inventive CPC doesn't match taxonomy" - see the **High-Value Patent Divergence** section below for the more important analysis of multi-classification needs.

---

## High-Value Patent Divergence Analysis (Critical Finding)

**Sample:** Top 1000 patents by V2 score (global + per super-sector top 100)

### Key Metrics

| Metric | Value | Implication |
|--------|-------|-------------|
| Patents with multiple inventive CPCs | **82.7%** | High-value patents are complex |
| Diverge at **section/class** level | **30.4%** | Fundamentally multi-domain inventions |
| Diverge at **subclass** level | **16.0%** | Different tech areas within domain |
| Diverge at **main group** level | **36.3%** | Different applications/approaches |
| Map to different **super-sectors** | **34.8%** | Cross-domain innovations |
| Map to different **sectors** | **51.4%** | Multi-specialty inventions |

### Divergence by Current Super-Sector

| Super-Sector | Patents | Multi-Inventive | Cross-Super-Sector | Cross-Sector |
|--------------|---------|-----------------|-------------------|--------------|
| IMAGING | 157 | 93.6% | 34.4% | 61.1% |
| WIRELESS | 261 | 85.4% | 30.7% | 62.8% |
| NETWORKING | 28 | 89.3% | 42.9% | 60.7% |
| VIDEO_STREAMING | 272 | 79.4% | 50.7% | 58.1% |
| COMPUTING | 159 | 73.0% | 29.6% | 34.0% |
| SEMICONDUCTOR | 85 | 80.0% | 4.7% | 10.6% |
| SECURITY | 23 | 87.0% | 47.8% | 60.9% |

**Observations:**
- VIDEO_STREAMING has the highest cross-super-sector rate (50.7%) - these patents span video + imaging + computing
- SEMICONDUCTOR has the lowest (4.7%) - more self-contained technology domain
- IMAGING patents have the highest multi-inventive rate (93.6%) and avg 4.7 inventive CPCs

### Example: High-Divergence Patents

**Patent 12149693** (V2 Score: 63.3) - "Binarization of dQP using SAVS in Coding"
- Inventive CPCs span: H04N19 (video codec), H03M7 (analog/coding),
- Maps to: video-codec, cameras-sensors, analog-circuits
- **3 super-sectors**: VIDEO_STREAMING, IMAGING, SEMICONDUCTOR

**Patent 12339475** (V2 Score: 61.3) - "Solid-state imaging apparatus"
- Inventive CPCs span: G02B (optics), H04N (imaging), H10F/H10K (semiconductor)
- Maps to: optics, cameras-sensors, semiconductor-modern
- Divergence at **section level** (G vs H)

### Design Implications

1. **Multi-classification is essential** for high-value patents - storing only primary classification loses 51% of sector associations and 35% of super-sector associations

2. **Weighting needed** - inventive CPCs should carry more weight than additional CPCs in multi-classification

3. **Cross-domain queries** - system should support "patents relevant to BOTH video-codec AND semiconductor"

4. **LLM question scoping** - for multi-domain patents, may need compound question templates or separate analyses per applicable classification

---

## Multiple Classification Association Analysis

Many patents could legitimately belong to multiple sectors:

| Metric | Value |
|--------|-------|
| Patents with multiple potential sectors | 53,249 |
| Avg potential sectors per patent | 2.00 |

### Distribution

| Potential Sectors | Patents |
|-------------------|---------|
| 0 sectors | 1,081 |
| 1 sector | 29,972 |
| 2 sectors | 26,847 |
| 3+ sectors | 26,402 |

**Recommendation:** Consider implementing multi-sector assignment for patents with clear multi-domain applicability.

---

## Unclassified Patents Analysis

| Category | Count |
|----------|-------|
| **Total unclassified** | 2,100 |
| Pre-CPC era (before 2013) | 134 |
| Post-CPC but no codes | 885 |
| Has CPC but unmapped | 1,081 |

### By Grant Year

Pre-CPC patents (before 2013): Only 134 patents lack CPC codes due to the CPC system not being adopted yet. These could use IPC fallback.

Post-2023 spike: 678 patents from 2024-2025 lack codes, likely due to classification backlog for recently granted patents.

---

## Recommendations

### Immediate Actions

1. **Filter indexing codes from sector assignment**
   - Exclude Y-section codes
   - Exclude 2xxx-scheme codes (G06F2xxx, H04L2xxx, H01L2xxx)
   - This will improve classification accuracy

2. **Add missing H04L/H04W prefixes** (low priority - ~500 patents affected)
   - `H04L63/8` → network security (broad group)
   - `H04W92/` → wireless arrangements
   - `H04W60/` → paging

3. **Consider multi-sector assignment** for 53K+ patents with cross-domain applicability

### Medium-Term Improvements

4. **IPC fallback** for 134 pre-CPC patents
   - Look up IPC codes from PatentsView
   - Map IPC→CPC equivalents

5. **Review non-core classes** (A61B, H01M, B60W, etc.)
   - Consider separate "non-core" sector or exclusion
   - These may be from acquisitions with different tech focus

### Design Considerations for Refactor

6. **Multiple sector assignment model**
   - Store multiple sector associations per patent
   - Weight by CPC relevance (inventive > additional)
   - Enable cross-sector querying

7. **Taxonomy versioning**
   - Track when CPC prefix rules change
   - Maintain assignment history for reproducibility

---

## Terminology Note

To avoid confusion with the current 3-level taxonomy (super-sector → sector → sub-sector):
- Use **"classification"** or **"class"** as the generic term for any taxonomic grouping
- "Sector" refers specifically to the middle tier in the current taxonomy
- Future taxonomies may use different grouping criteria (not just CPC-based)

---

## Additive Schema Considerations (Non-Destructive)

These could be implemented to support further analysis without breaking existing functionality:

### 1. CPC Association Counts

Add fields to Patent or new junction table to track:
```
inventiveCpcCount: Int       -- Count of inventive CPCs
additionalCpcCount: Int      -- Count of additional CPCs
inventiveMappedCount: Int    -- Inventive CPCs that match taxonomy
additionalMappedCount: Int   -- Additional CPCs that match taxonomy
unmappedCpcCount: Int        -- CPCs with no taxonomy match
```

**Purpose:** Enable queries like "patents with unmapped inventive CPCs" without re-computing

### 2. Multi-Classification Support

New junction table for multiple classification assignments:
```
PatentClassification {
  patentId
  classificationLevel: "super_sector" | "sector" | "sub_sector"
  classificationName
  weight: Float               -- Higher for inventive CPC source
  isPrimary: Boolean          -- Current "first" assignment
  sourceCpcCodes: String[]    -- Which CPCs led to this assignment
}
```

**Purpose:** Store all applicable classifications with provenance

### 3. Alternate Taxonomy Support

New table for experimental taxonomies:
```
Taxonomy {
  id
  name                        -- e.g., "cpc-v2", "damage-focus"
  description
  isActive: Boolean
  rules: Json                 -- Classification rules
}

TaxonomyClassification {
  taxonomyId
  patentId
  ... (similar to PatentClassification)
}
```

**Purpose:** A/B test different taxonomies without losing current assignments

### 4. CPC Co-occurrence Analysis Table

```
CpcCooccurrence {
  cpc1
  cpc2
  cooccurrenceCount           -- Patents with both codes
  asInventiveCount            -- Both appear as inventive
  correlationStrength         -- Statistical measure
}
```

**Purpose:** Data-driven basis for grouping related CPC codes

---

## Roadmap Priorities

**Analysis Phase (Current):**
- [x] Basic coverage analysis
- [x] Indexing code identification
- [x] High-value patent divergence analysis
- [ ] CPC co-occurrence patterns
- [ ] Sub-sector level divergence analysis

**Schema Expansion (Additive, Non-Breaking):**
- [ ] Add CPC count fields to Patent
- [ ] Design multi-classification junction table
- [ ] Design alternate taxonomy schema

**Implementation (After Schema):**
- [ ] Multi-classification assignment logic
- [ ] Cross-classification querying
- [ ] LLM question routing for multi-domain patents

---

## Output Files

| File | Description |
|------|-------------|
| `output/taxonomy-analysis-*.json` | Full coverage analysis |
| `output/taxonomy-gaps-*.json` | Gap deep-dive analysis |
| `output/inventive-divergence-*.json` | High-value patent divergence |

---

*This analysis was generated by automated scripts. Review specific patent samples for validation.*
