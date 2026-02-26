# Sector & Categorization Schema Design

## Executive Summary

This document proposes a restructured patent categorization system with:
- **Domain**: Broad USPTO-based category (reference/grouping)
- **Sector**: Actionable breakout for analysis (target: 400-2,000 active patents)
- Focus on **active patents** (3+ years remaining) for practical relevance

---

## Current State Analysis

### Portfolio Overview (as of 2026-01-18)

| Metric | Value |
|--------|-------|
| Total Patents | 22,706 |
| Active Patents (≥3 years) | 6,424 (28%) |
| Expired/Near-Expiry | 16,282 (72%) |

### Current Sector Distribution (Active Patents Only)

| Current Sector | Active | % Active | Avg Years | Assessment |
|----------------|--------|----------|-----------|------------|
| network-security | 2,929 | 59% | 4.5 | **TOO LARGE - needs breakout** |
| wireless | 1,476 | 47% | 3.3 | Good size |
| video-image | 888 | 52% | 3.7 | Good size |
| computing | 818 | 13% | 1.0 | Good size (but low % active) |
| semiconductor | 147 | 4% | 0.3 | **Mostly expired** |
| optics | 51 | 11% | 0.8 | Small, mostly expired |
| cloud-auth | 43 | 100% | 7.4 | Small, high-value |
| rf-acoustic | 17 | 5% | 0.4 | **Mostly expired** |
| (specialized) | <15 each | 100% | 7-9 | Very small, high-citation |

**Key Insight**: CPC-based sectors (semiconductor, optics, rf-acoustic) have mostly expired patents. Term-based sectors from citation analysis are 100% active but very small.

---

## Proposed Nomenclature

### Two-Level Hierarchy

| Level | Name | Purpose | Target Size |
|-------|------|---------|-------------|
| 1 | **Domain** | Broad technology grouping for reference | 2,000-10,000 total |
| 2 | **Sector** | Actionable breakout for analysis/targeting | 400-2,000 active |

### Terminology Rationale

- **Domain**: Aligns with USPTO CPC class-level groupings (H04L, G06F, etc.)
- **Sector**: Our custom breakout based on subclass + term extraction

---

## Proposed Domain/Sector Structure

### Domain 1: Network Technology (H04L)
*Current: network-security with 2,929 active patents*

| Proposed Sector | CPC Subclasses | Active Patents | Damages |
|-----------------|----------------|----------------|---------|
| **network-security-core** | H04L63, H04L9 | ~860 | High |
| **network-switching** | H04L45, H04L47, H04L49, H04L12 | ~654 | Medium |
| **network-physical** | H04L1, H04L5, H04L7, H04L25, H04L27 | ~689 | Medium |
| **network-management** | H04L41, H04L43 | ~311 | Medium |
| **network-protocols** | H04L67, H04L69 | ~252 | Medium |
| **streaming-multimedia** | H04L65 | ~76 | High |

### Domain 2: Computing (G06F, G06Q, G06N)
*Current: computing with 818 active patents*

| Proposed Sector | CPC Subclasses | Active Patents | Damages |
|-----------------|----------------|----------------|---------|
| **computing-general** | G06F (various) | ~753 | Medium |
| **fintech-business** | G06Q | ~65 | Medium |
| **ai-ml** | G06N (keep separate) | ~15 | Medium |

### Domain 3: Wireless (H04W)
*Current: wireless with 1,476 active patents - good size*

| Proposed Sector | CPC Subclasses | Active Patents | Damages |
|-----------------|----------------|----------------|---------|
| **wireless-cellular** | H04W (cellular-focused) | TBD | High |
| **wireless-local** | H04W (WiFi, BLE) | TBD | Medium |
| **bluetooth-edr** | Keep term-based | ~2 | Medium |

### Domain 4: Video/Image (H04N, G06T, G06V)
*Current: video-image with 888 active patents - good size*

| Proposed Sector | Source | Active Patents | Damages |
|-----------------|--------|----------------|---------|
| **video-image** | CPC-based | ~888 | Medium |
| **video-codec** | Term-based | ~6 | Very High |
| **image-depth** | Term-based | ~3 | High |

### Domain 5: Security/Authentication (Term-based)
*Specialized high-value sectors from citation analysis*

| Proposed Sector | Source | Active Patents | Damages |
|-----------------|--------|----------------|---------|
| **cloud-auth** | Term-based | ~43 | High |
| **security-threat** | Term-based | ~6 | High |
| **pii-breach** | Term-based | ~3 | Medium |

### Domain 6: Semiconductor/Hardware (H01L, H03)
*Mostly expired - low priority for active analysis*

| Proposed Sector | CPC Subclasses | Active Patents | Damages |
|-----------------|----------------|----------------|---------|
| **semiconductor** | H01L | ~147 | High |
| **rf-acoustic** | Term-based | ~17 | Very High |
| **audio** | H04S, G10L | ~11 | Medium |

---

## Revised Damages Scale

### Current Issue
The current Low tier (<$10M) only contains "general" - need better distribution.

### Proposed Adjustment

| Rating | Label | Old Range | New Range | Rationale |
|--------|-------|-----------|-----------|-----------|
| 1 | Low | <$10M | **<$20M** | Captures more small-market sectors |
| 2 | Medium | $10M-$75M | **$20M-$75M** | Narrows around avg jury award |
| 3 | High | $75M-$200M | $75M-$200M | No change |
| 4 | Very High | >$200M | >$200M | No change |

### Damages by Proposed Sector

| Damages Tier | Sectors |
|--------------|---------|
| **Very High** (>$200M) | rf-acoustic, video-codec |
| **High** ($75M-$200M) | network-security-core, cloud-auth, wireless-cellular, image-depth, security-threat, semiconductor, streaming-multimedia |
| **Medium** ($20M-$75M) | network-switching, network-physical, network-management, network-protocols, computing-general, video-image, bluetooth-edr, ai-ml, fintech-business |
| **Low** (<$20M) | general, pii-breach, audio, optics |

---

## Implementation Plan

### Phase 1: Schema Update (Immediate)
1. Update `config/sector-damages.json` with new damages thresholds
2. Create `config/domain-sector-mapping.json` with proposed structure
3. Update sector assignment logic to use Domain → Sector hierarchy

### Phase 2: Network-Security Breakout (Short-term)
1. Run CPC subclass analysis on H04L patents
2. Create new sector assignments based on subclass groupings
3. Re-run term extraction within each new sector

### Phase 3: Sector Expansion (Medium-term)
1. Expand small high-value sectors (video-codec, image-depth) via ES search
2. Re-categorize "general" patents into specific sectors
3. Merge very small sectors if <50 active patents

### Phase 4: Validation
1. Re-run V3 scoring with new sector structure
2. Validate damages distribution across tiers
3. Review sector sizes for 400-2,000 active patent target

---

## Open Questions

1. **Should we track both CPC-based and term-based sector assignments?**
   - Option A: Single final sector (simpler)
   - Option B: Primary + secondary sectors (more flexible)

2. **How to handle patents that span multiple domains?**
   - Option A: Primary CPC determines domain
   - Option B: Allow multi-domain assignment

3. **Should damages rating be per-sector or adjusted by active patent count?**
   - A sector with 17 active patents may have lower practical value than one with 800

4. **Frequency of sector rebalancing?**
   - As patents expire, sector distributions will shift
   - Quarterly review recommended

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `config/domain-sector-mapping.json` | CREATE | Define Domain → Sector hierarchy |
| `config/sector-damages.json` | MODIFY | Update damages thresholds |
| `scripts/assign-sectors-v2.ts` | CREATE | New sector assignment with domains |
| `docs/SECTOR_CATEGORIZATION_SCHEMA.md` | CREATE | This document |

---

*Document created: 2026-01-18*
*Status: DRAFT for review*
