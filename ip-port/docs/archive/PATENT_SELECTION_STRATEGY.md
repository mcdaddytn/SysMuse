# Patent Selection Strategy for Claim Analysis

## Objective

Identify high-value patents from the Broadcom portfolio (22,589 patents) most likely to:
1. Be infringed by competitors in the streaming video market
2. Have successful outcomes in licensing negotiations or litigation
3. Warrant the cost of detailed claim chart analysis by attorneys

## Available Data

| Dataset | Count | Description |
|---------|-------|-------------|
| Full Broadcom Portfolio | 22,589 | All patents across entities |
| Streaming Video Subset | 10,276 | Filtered by CPC codes (H04N, H04L, H04W, G06T, G11B) |
| PTAB Trials | 2,624 | Historical IPR/PGR challenges |

## Selection Strategies

### Strategy 1: Citation Network Analysis

**Concept:** Patents with high citation counts are foundational technologies. Multi-generational analysis reveals technology influence.

**Metrics to compute:**
- **Forward citations** - How many later patents cite this one (influence measure)
- **Backward citations** - Prior art foundation
- **Competitor citations** - Patents cited BY streaming competitors (suggests they built on this tech)
- **Citation depth** - Multi-generational influence (children, grandchildren)

**Terminology:**
- Parent = Prior art this patent cites
- Child = Patent that cites this patent
- Grandchild = Patent that cites a child
- Sibling = Patent sharing common parent
- Cousin = Patent sharing common grandparent

**Implementation:**
```
1. Get forward citation counts for all portfolio patents via PatentsView
2. Identify patents cited by major streaming vendors
3. Build citation trees for top candidates
4. Score based on citation network centrality
```

**Pros:** Quantitative, objective, identifies foundational patents
**Cons:** Older patents naturally have more citations; doesn't directly indicate infringement

---

### Strategy 2: Competitor Overlap Analysis

**Concept:** Find patents with citation relationships to major streaming vendors' patents.

**Target Competitors:**
- Netflix, Inc.
- Amazon Technologies (Prime Video)
- Google LLC / YouTube
- Apple Inc.
- Disney Enterprises / Hulu
- Roku, Inc.
- Comcast (Peacock)
- Paramount (Paramount+)
- Warner Bros Discovery (Max)

**Analysis types:**
1. **Broadcom patents cited BY competitors** - Suggests competitor tech built on Broadcom's foundation
2. **Broadcom patents citing SAME prior art as competitors** - Similar technology space
3. **CPC classification overlap** - Patents in same technology areas
4. **Inventor overlap** - Inventors who moved between companies

**Implementation:**
```
1. Download competitor patent portfolios (last 10 years)
2. Get citation data for competitor patents
3. Find Broadcom patents in competitor citation chains
4. Identify CPC overlap between portfolios
```

**Pros:** Direct indicator of technology relevance to competitors
**Cons:** Citation doesn't prove infringement; requires significant data download

---

### Strategy 3: Technology Standards Coverage

**Concept:** Patents covering industry standards are inherently valuable as they're difficult to design around.

**Relevant Standards for Streaming:**
- **Video Codecs:** H.264/AVC, H.265/HEVC, VP9, AV1
- **Streaming Protocols:** HLS, DASH, RTMP, WebRTC
- **DRM:** Widevine, FairPlay, PlayReady
- **Container Formats:** MP4, WebM, MPEG-TS
- **Network:** TCP/UDP optimizations, CDN technologies
- **Display:** HDR10, Dolby Vision, 4K/8K

**Implementation:**
```
1. Text search patent titles/abstracts for standard names
2. Identify CPC codes associated with standards
3. Cross-reference with standards body participation
4. Check for standard-essential patent (SEP) declarations
```

**Pros:** Standards patents have clear licensing paths (FRAND)
**Cons:** SEPs often have FRAND obligations limiting damages

---

### Strategy 4: Patent Quality Indicators

**Concept:** Filter for patents with characteristics associated with strength and value.

**Quality Metrics:**
| Metric | Indicator |
|--------|-----------|
| Claim count | More claims = broader coverage |
| Independent claims | Key claims that stand alone |
| Remaining term | Years until expiration |
| No IPR challenge | Hasn't been invalidated |
| Survived IPR | Battle-tested strength |
| Clean prosecution | No rejections = clearer claims |
| Continuation family | Multiple related patents |

**Implementation:**
```
1. Get claim counts from PatentsView (if available) or bulk data
2. Calculate remaining term (20 years from filing)
3. Cross-reference with PTAB data (no challenges or survived)
4. Get prosecution history via File Wrapper API
```

**Pros:** Identifies legally strong patents
**Cons:** Prosecution history analysis is labor-intensive

---

### Strategy 5: Recent Activity & Assignee Focus

**Concept:** Focus on patents from entities known for streaming technology.

**High-Value Entities in Portfolio:**
- **Broadcom Inc.** - Semiconductor, SoC for streaming devices
- **Avago** - Wireless, fiber optics
- **LSI** - Storage, media processing
- **VMware** - Virtualization, cloud streaming infrastructure

**Implementation:**
```
1. Filter by assignee entity
2. Focus on technology areas per entity expertise
3. Prioritize patents from streaming-focused acquisitions
```

---

### Strategy 6: Hybrid Scoring Model

**Concept:** Combine multiple signals into a composite score.

**Proposed Scoring Formula:**
```
Score = (W1 × Citation Score) +
        (W2 × Competitor Overlap) +
        (W3 × Standards Relevance) +
        (W4 × Patent Quality) +
        (W5 × Remaining Term)

Where weights (W1-W5) are tunable based on strategy
```

**Tiers:**
- **Tier 1 (Top 100):** Highest priority for claim charts
- **Tier 2 (Top 500):** Secondary analysis
- **Tier 3 (Top 2000):** Watching list

---

## Recommended Implementation Order

### Phase 1: Quick Wins (Low effort, high signal)
1. ✅ Already have streaming video subset (10K patents)
2. Get forward citation counts for streaming subset
3. Filter for high-citation patents (top 10%)
4. Check remaining patent term

### Phase 2: Competitor Analysis
1. Download Netflix, Google, Amazon patent portfolios
2. Extract citation relationships
3. Find Broadcom patents in competitor citation chains
4. Identify CPC overlaps

### Phase 3: Deep Analysis
1. Build full citation networks for top candidates
2. Standards coverage analysis
3. Prosecution history review for finalists
4. IPR risk assessment

---

## Data Sources

| Data | Source | API Available |
|------|--------|---------------|
| Patent metadata | PatentsView | ✅ Yes |
| Forward citations | PatentsView | ✅ Yes (counts) |
| Backward citations | PatentsView | ✅ Yes (via citations endpoint) |
| Prosecution history | File Wrapper | ✅ Yes |
| IPR data | PTAB v3 | ✅ Yes |
| Full patent text | USPTO Bulk Data | Download only |
| Competitor portfolios | PatentsView | ✅ Yes (by assignee) |

---

## Next Steps

1. [ ] Implement citation count analysis for streaming subset
2. [ ] Identify top competitors and download their portfolios
3. [ ] Build citation overlap analysis
4. [ ] Create scoring model prototype
5. [ ] Generate initial candidate list for review

---

## Notes

- Focus on streaming video subset (10K) as starting point vs full portfolio (22K)
- Consider patent expiration - prioritize patents with 5+ years remaining
- Factor in IPR history - avoid patents with prior challenges
- Document methodology for potential litigation support
