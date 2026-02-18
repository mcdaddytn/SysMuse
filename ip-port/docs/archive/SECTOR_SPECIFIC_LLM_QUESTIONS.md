# Sector-Specific LLM Questions Design

This document proposes targeted LLM questions for different technology sectors to improve patent analysis quality and relevance. The goal is to extract sector-specific information that generic questions miss.

---

## Current Sector Overview

### Large Sectors (May Need Breakout)

| Sector | Active Patents | Potential Split | Rationale |
|--------|----------------|-----------------|-----------|
| `network-switching` | 1,064 (569 active) | Keep as-is | Coherent technology area |
| `network-signal-processing` | 834 (375 active) | **Split** | Baseband vs modulation vs equalization |
| `network-error-control` | 539 (222 active) | Keep as-is | FEC/ARQ coherent |
| `network-multiplexing` | 489 (255 active) | Keep as-is | TDM/FDM coherent |
| `network-auth-access` | 445 (360 active) | **Split** | Auth vs access control vs firewalls |
| `network-threat-protection` | 418 (312 active) | Keep as-is | EDR/SIEM/malware coherent |

### Small High-Value Sectors (May Combine or Expand)

| Sector | Active Patents | Potential Action |
|--------|----------------|------------------|
| `video-codec` | ~6 | **Expand** via term search |
| `video-drm-conditional` | ~33 | Keep - high damages |
| `rf-acoustic` | ~17 | Keep - very high damages |
| `cloud-auth` | ~43 | Keep - high strategic value |
| `ai-ml` | ~15 | **Expand** - fast growing area |

---

## Proposed Sector-Specific Questions

### 1. Security Sectors

**Sectors**: `network-threat-protection`, `network-auth-access`, `network-crypto`, `computing-os-security`, `computing-data-protection`

#### Proposed Questions

| Question ID | Question | Response Type | Rationale |
|-------------|----------|---------------|-----------|
| `sec_attack_vector` | What attack vectors does this patent address? | Multi-select: network intrusion, malware, phishing, insider threat, data exfiltration, DDoS, credential theft, other | Maps to MITRE ATT&CK framework |
| `sec_deployment_layer` | At what layer does this protection operate? | Select: endpoint, network perimeter, cloud, application, data, identity | Helps target specific vendor categories |
| `sec_compliance_relevance` | Which compliance frameworks does this relate to? | Multi-select: GDPR, HIPAA, PCI-DSS, SOX, NIST, ISO27001, none | Increases value for regulated industries |
| `sec_zero_trust_alignment` | Is this aligned with zero-trust architecture? | Select: core component, compatible, neutral, contradictory | Zero-trust is major enterprise trend |
| `sec_vendor_category` | Which security vendor category likely implements this? | Multi-select: EDR, SIEM, IAM, CASB, DLP, ZTNA, firewall, WAF | Direct vendor targeting |

#### Sector Consolidation Proposal

**Option A: Keep Separate** (Current)
- Pros: Granular targeting
- Cons: Small sectors harder to staff

**Option B: Security Super-Sector**
- Combine: `network-threat-protection`, `network-auth-access`, `network-crypto`, `computing-os-security`, `computing-data-protection`, `cloud-auth`
- Total: ~1,200 active patents
- Pros: Comprehensive security portfolio view
- Cons: Loses technology specificity

**Recommendation**: Keep separate sectors but add a `security_super_sector` flag for portfolio-level views.

---

### 2. Video/Media Sectors

**Sectors**: `video-codec`, `video-client-processing`, `video-server-cdn`, `video-drm-conditional`, `video-broadcast`

#### Proposed Questions

| Question ID | Question | Response Type | Rationale |
|-------------|----------|---------------|-----------|
| `vid_codec_standard` | Which video codec standards does this relate to? | Multi-select: H.264/AVC, H.265/HEVC, AV1, VP9, VVC/H.266, none | Standards = higher damages |
| `vid_streaming_protocol` | Which streaming protocols does this relate to? | Multi-select: HLS, DASH, RTMP, WebRTC, SRT, none | Protocol specificity aids targeting |
| `vid_pipeline_stage` | Where in the video pipeline does this operate? | Select: capture, encode, transcode, package, deliver, decrypt, decode, render | Maps to different vendor types |
| `vid_drm_system` | Which DRM systems might implement this? | Multi-select: Widevine, FairPlay, PlayReady, Nagra, none | Direct DRM vendor targeting |
| `vid_quality_feature` | What quality feature does this address? | Multi-select: ABR, bitrate efficiency, latency, error resilience, HDR, resolution scaling | Feature-based targeting |

#### Sector Expansion Proposal

**video-codec Expansion**
Current: ~6 active patents (too small)

Proposed search terms to expand:
- `macroblock`, `intra prediction`, `motion vector`, `entropy coding`
- `transform coefficient`, `quantization`, `loop filter`
- Standards: `H.264`, `HEVC`, `AV1`, `VP9`

Target size: 50-100 patents

**video-drm-conditional Expansion**
Current: ~33 active patents (good size but high value)

Consider merging with broader content protection from `network-crypto`.

---

### 3. Wireless/RF Sectors

**Sectors**: `wireless-scheduling`, `wireless-power-mgmt`, `wireless-mimo-antenna`, `wireless-transmission`, `rf-acoustic`

#### Proposed Questions

| Question ID | Question | Response Type | Rationale |
|-------------|----------|---------------|-----------|
| `rf_standard_generation` | Which wireless generation does this relate to? | Multi-select: 3G, 4G/LTE, 5G NR, WiFi 6/6E, WiFi 7, Bluetooth 5.x | Generation specificity |
| `rf_standard_body` | Which standards body governs this technology? | Multi-select: 3GPP, IEEE 802.11, Bluetooth SIG, none | SEP identification |
| `rf_implementation_target` | What type of device implements this? | Multi-select: smartphone, base station, IoT device, automotive, laptop, router | Identifies infringement targets |
| `rf_chip_component` | Which chip component type would implement this? | Select: baseband, RF front-end, antenna, power amplifier, filter, transceiver | Semiconductor targeting |
| `rf_band_frequency` | Which frequency bands does this relate to? | Multi-select: sub-6GHz, mmWave, unlicensed (2.4/5/6GHz), licensed, none specified | Band specificity |

#### RF-Acoustic Sector Deep Dive

**rf-acoustic** is small (17 patents) but very high damages due to:
- BAW/FBAR filter technology in every smartphone
- Limited number of suppliers (Murata, Skyworks, Qorvo, Avago/Broadcom)
- High revenue per unit

**Proposed additional questions for rf-acoustic**:

| Question ID | Question | Response Type |
|-------------|----------|---------------|
| `rf_filter_type` | What type of RF filter technology? | Select: BAW, FBAR, SAW, MEMS, other |
| `rf_filter_application` | What application uses this filter? | Multi-select: RF front-end, duplexer, antenna switch, multiplexer |
| `rf_piezoelectric_material` | What piezoelectric material? | Select: AlN, ScAlN, ZnO, other, not specified |

---

### 4. Network Infrastructure Sectors

**Sectors**: `network-switching`, `network-management`, `network-protocols`, `network-signal-processing`

#### Proposed Questions

| Question ID | Question | Response Type | Rationale |
|-------------|----------|---------------|-----------|
| `net_layer` | Which OSI layer does this primarily operate at? | Select: L1 physical, L2 data link, L3 network, L4 transport, L5-7 application | Layer specificity |
| `net_deployment` | What deployment context? | Multi-select: data center, enterprise, carrier, edge, home, industrial | Deployment targeting |
| `net_virtualization` | Is this related to network virtualization? | Select: SDN, NFV, overlay networks, none | Modern network architecture |
| `net_protocol_family` | Which protocol family? | Multi-select: TCP/IP, Ethernet, MPLS, BGP, OSPF, none specific | Protocol targeting |
| `net_equipment_type` | What equipment type implements this? | Multi-select: router, switch, load balancer, firewall, gateway, NIC | Equipment vendor targeting |

---

### 5. Cloud/Computing Sectors

**Sectors**: `cloud-auth`, `computing-os-security`, `computing-data-protection`, `computing-auth-boot`, `fintech-business`

#### Proposed Questions

| Question ID | Question | Response Type | Rationale |
|-------------|----------|---------------|-----------|
| `cloud_service_model` | Which cloud service model? | Multi-select: IaaS, PaaS, SaaS, none | Service model targeting |
| `cloud_deployment` | Which deployment model? | Multi-select: public cloud, private cloud, hybrid, on-premise | Deployment targeting |
| `cloud_provider_relevance` | Which cloud providers likely implement? | Multi-select: AWS, Azure, GCP, Oracle, IBM, Alibaba, none specific | Direct provider targeting |
| `compute_platform` | What compute platform? | Multi-select: server, desktop, mobile, embedded, mainframe | Platform targeting |
| `os_relevance` | Which operating systems? | Multi-select: Windows, Linux, macOS, iOS, Android, none specific | OS targeting |

---

### 6. Automotive/ADAS Sectors (NEW)

**Current status**: Patents discovered via cluster analysis but not yet in formal sector.

**Proposed Sector**: `automotive-adas`

#### Proposed Questions

| Question ID | Question | Response Type | Rationale |
|-------------|----------|---------------|-----------|
| `auto_adas_function` | What ADAS function? | Multi-select: object detection, lane keeping, adaptive cruise, parking assist, collision avoidance | Function targeting |
| `auto_sensor_type` | What sensor type? | Multi-select: camera, LiDAR, radar, ultrasonic, none | Sensor targeting |
| `auto_autonomy_level` | What autonomy level (SAE)? | Select: L1, L2, L2+, L3, L4, L5, not applicable | Level targeting |
| `auto_supply_chain_tier` | What supply chain tier? | Select: OEM, Tier 1, Tier 2, Tier 3, chip/component | Tier targeting |

---

## Implementation Approach

### Phase 1: Sector Refinement (Before LLM Questions)

1. **Run sector expansion searches**:
   - Expand `video-codec` via term search
   - Expand `ai-ml` via term search
   - Create `automotive-adas` sector

2. **Evaluate large sector splits**:
   - Analyze `network-signal-processing` CPC distribution
   - Analyze `network-auth-access` CPC distribution

3. **Update sector-damages.json** with new sectors

### Phase 2: Pilot Sector-Specific Questions

1. **Select pilot sectors** (recommend: `video-codec`, `rf-acoustic`, `network-threat-protection`)
2. **Create sector-specific prompt templates**
3. **Run pilot on 20 patents per sector**
4. **Review results for quality**

### Phase 3: Full Rollout

1. **Implement sector routing** in LLM analysis service
2. **Run sector-specific analysis** on all prioritized patents
3. **Update export scripts** to include sector-specific fields
4. **Add sector-specific columns** to Excel macros

---

## Super-Sectors: Portfolio-Level Categorization

### What Are Super-Sectors?

Super-sectors are a **grouping layer above sectors** for portfolio-level views. They consolidate related sectors into broader technology categories without changing the underlying sector assignments.

**Example Structure**:
```
Super-Sector: SECURITY
├── network-threat-protection (312 active)
├── network-auth-access (360 active)
├── network-crypto (150 active)
├── computing-os-security (100 active)
├── computing-data-protection (80 active)
└── cloud-auth (43 active)
    Total: ~1,045 active patents
```

### Purpose of Super-Sectors

| Use Case | Benefit |
|----------|---------|
| Executive summaries | "We have 1,045 security patents" vs listing 6 sectors |
| Competitor analysis | "Samsung cites 200 of our SECURITY patents" |
| Portfolio valuation | Aggregate value by technology domain |
| Licensing packages | Bundle related sectors for deals |
| Staffing/resourcing | Assign analysts to technology domains |

### Proposed Super-Sector Mapping

| Super-Sector | Included Sectors | Active Patents |
|--------------|------------------|----------------|
| **SECURITY** | network-threat-protection, network-auth-access, network-crypto, computing-os-security, computing-data-protection, cloud-auth | ~1,045 |
| **NETWORK** | network-switching, network-management, network-protocols, network-signal-processing, network-error-control, network-multiplexing | ~2,000 |
| **VIDEO/MEDIA** | video-codec, video-client-processing, video-server-cdn, video-drm-conditional, video-broadcast | ~300 |
| **WIRELESS** | wireless-scheduling, wireless-power-mgmt, wireless-mimo-antenna, wireless-transmission, rf-acoustic | ~800 |
| **CLOUD/COMPUTE** | computing-virtualization, computing-storage, computing-processors, fintech-business | ~400 |
| **AI/ML** | ai-ml (to be expanded) | ~15 (target: 100+) |
| **AUTOMOTIVE** | automotive-adas (to be created) | ~50 (new) |

### Implementation

Super-sectors would be stored as a lookup table:
```json
{
  "superSectors": {
    "SECURITY": ["network-threat-protection", "network-auth-access", ...],
    "NETWORK": ["network-switching", "network-management", ...],
    ...
  }
}
```

**No schema changes required** - super-sector is derived from sector assignment.

---

## Generic vs Sector-Specific Questions: Analysis

### Current Generic Questions (V3)

All patents currently receive these 20+ questions:
- Core: summary, prior_art_problem, technical_solution
- Legal: eligibility_score, validity_score, claim_breadth, claim_clarity_score
- Enforcement: enforcement_clarity, design_around_difficulty, evidence_accessibility_score
- Market: technology_category, product_types, market_relevance_score, trend_alignment_score
- Investigation: likely_implementers, detection_method, investigation_priority_score
- Cross-sector: implementation_type, standards_relevance, market_segment, etc.

### Proposed Sector-Specific Questions

Additional questions tailored to technology areas (5-10 per sector):
- **Security**: attack_vector, deployment_layer, compliance_relevance, zero_trust_alignment
- **Video**: codec_standard, streaming_protocol, pipeline_stage, drm_system
- **Wireless/RF**: standard_generation, standard_body, chip_component, frequency_band
- etc.

### Coupling Options Analysis

#### Option A: Coupled (Generic + Sector in Single LLM Call)

**Implementation**:
```
Single prompt with all questions (generic + sector-specific)
→ One LLM call per patent
→ All data saved together
```

**Pros**:
| Advantage | Explanation |
|-----------|-------------|
| Context efficiency | LLM sees patent once, answers all questions |
| Consistency | Sector answers informed by generic analysis |
| Simpler data model | All fields in one record |
| Lower latency | Single API call vs multiple |

**Cons**:
| Disadvantage | Explanation |
|--------------|-------------|
| Harder to update | Changing sector questions requires re-running generic |
| Sector misassignment risk | Wrong sector = wrong questions asked |
| Higher per-call cost | Longer prompts = more tokens |
| Version management | Can't selectively update sector answers |

#### Option B: Decoupled (Separate LLM Calls)

**Implementation**:
```
Step 1: Generic questions (all patents)
Step 2: Sector-specific questions (by sector, optional)
→ Two separate LLM calls
→ Data joined by patent_id
```

**Pros**:
| Advantage | Explanation |
|-----------|-------------|
| Flexible updates | Change sector questions without touching generic |
| Incremental rollout | Run sector questions on priority sectors only |
| Sector reassignment safe | Generic data preserved if sector changes |
| A/B testing | Compare different sector question sets |
| Cost control | Sector-specific is optional add-on |

**Cons**:
| Disadvantage | Explanation |
|--------------|-------------|
| Two API calls | More latency, slightly higher total cost |
| Data joins required | Must link generic + sector records |
| Context loss | Sector LLM doesn't see generic answers |
| More complex pipeline | Two scripts, two output directories |

### Recommendation: Decoupled Approach

**Rationale**:
1. **Sector questions are experimental** - we need to iterate on them without re-running expensive generic analysis
2. **Sector assignments may change** - as we refine sectors, generic data should be stable
3. **Prioritization flexibility** - run sector-specific only on high-value patents or priority sectors
4. **Easier calibration** - can compare sector answers across different question versions

**Suggested Workflow**:
```
1. Run generic LLM analysis on Top N patents → output/llm-analysis-v3/
2. Assign sectors to all patents → output/sectors/
3. Run sector-specific analysis on priority sectors → output/llm-sector-specific/
4. Join data at export time → combined fields in CSV
```

**Data Model**:
```
patent_id → generic_analysis (20+ fields)
patent_id → sector_specific_analysis (5-10 fields, nullable)
```

---

## Sector Expansion: How to Grow Small Sectors

### The Challenge

Some high-value sectors have very few patents:
- `video-codec`: 6 active patents (but very high damages)
- `ai-ml`: 15 active patents (fast-growing market)
- `rf-acoustic`: 17 active patents (very high damages)

### Expansion Strategies

#### Strategy 1: Term-Based Search (ElasticSearch)

**Method**: Search portfolio using technology-specific terms to find patents not currently assigned to the sector.

**Example: Expanding video-codec**

Current assignment is likely based on narrow criteria (CPC codes or initial term list). We expand by searching for related terms:

```bash
# Search for video codec related terms in portfolio
npm run search
> search macroblock
> search "intra prediction"
> search "motion vector"
> search "entropy coding"
> search "transform coefficient"
> search "quantization matrix"
> search "loop filter"
> search H.264 OR HEVC OR AV1 OR VP9
```

**Implementation Script**:
```typescript
// scripts/expand-sector.ts
const EXPANSION_TERMS = {
  'video-codec': [
    'macroblock', 'intra prediction', 'inter prediction',
    'motion vector', 'motion compensation', 'motion estimation',
    'entropy coding', 'CABAC', 'CAVLC',
    'transform coefficient', 'DCT', 'discrete cosine',
    'quantization', 'quantization matrix', 'QP',
    'loop filter', 'deblocking', 'SAO',
    'H.264', 'AVC', 'HEVC', 'H.265', 'AV1', 'VP9', 'VVC',
    'video encoder', 'video decoder', 'codec'
  ],
  'ai-ml': [
    'neural network', 'deep learning', 'machine learning',
    'convolutional', 'CNN', 'RNN', 'LSTM', 'transformer',
    'inference', 'training', 'backpropagation',
    'classifier', 'classification', 'regression',
    'feature extraction', 'embedding', 'attention mechanism'
  ]
};
```

#### Strategy 2: CPC Code Mining

**Method**: Find CPC codes that appear in current sector patents, then search for other patents with those codes.

**Example**:
```
Current video-codec patents have CPC codes:
- H04N19/00 (video coding)
- H04N19/10 (transform coding)
- H04N19/176 (motion estimation)

Search portfolio for patents with these CPCs that aren't in video-codec sector yet.
```

#### Strategy 3: Citation Expansion

**Method**: Find patents that are cited alongside current sector patents (co-citation analysis).

**Example**:
```
Patent A (video-codec) is cited by Samsung video processor patent
Patent B (unassigned) is also cited by the same Samsung patent
→ Patent B is likely related to video-codec
```

#### Strategy 4: MLT (More-Like-This) Search

**Method**: Use ElasticSearch MLT queries to find patents similar to existing sector members.

```typescript
// Find patents similar to known video-codec patents
const mltResults = await es.moreLikeThis({
  like: [
    { _index: 'patents', _id: 'US9876543' }, // known video-codec
    { _index: 'patents', _id: 'US8765432' }  // another known
  ],
  min_term_freq: 1,
  min_doc_freq: 1
});
```

### Video-Codec Expansion: Concrete Plan

**Goal**: Expand from 6 to 50-100 patents

**Step 1: Inventory Current**
```bash
# List current video-codec patents
cat output/sectors/all-patents-sectors-v2-*.json | jq '.assignments[] | select(.sector == "video-codec")'
```

**Step 2: Run Expansion Searches**
```bash
# Term searches
npm run search
> search macroblock
> search "motion vector"
> search "entropy coding"
> search H.264 OR HEVC
> search "video encoder"
```

**Step 3: Filter Results**
- Must have 3+ years remaining
- Prefer patents with competitor citations
- Exclude patents already strongly assigned to other sectors

**Step 4: Validate Assignments**
- Review abstracts of candidate patents
- Confirm video codec relevance
- Add to sector assignment file

**Step 5: Run Sector-Specific LLM**
- Apply video-codec specific questions
- Extract codec_standard, pipeline_stage, etc.

### Expected Results by Sector

| Sector | Current | Target | Expansion Method |
|--------|---------|--------|------------------|
| video-codec | 6 | 50-100 | Term search + CPC mining |
| ai-ml | 15 | 75-150 | Term search + MLT |
| rf-acoustic | 17 | 30-50 | CPC mining (already specialized) |
| automotive-adas | 0 | 50-100 | New sector from cluster discovery |

### When NOT to Expand

- Sector is already optimal size (400-2,000 active)
- Expansion would dilute quality (adding low-relevance patents)
- Technology is genuinely narrow (rf-acoustic may be inherently small)

---

## Questions Addressed

### 1. Super-sectors
**Clarified above**: Super-sectors are a categorization layer for portfolio-level views. They group related sectors without changing underlying assignments. Useful for executive reporting, competitor analysis, and licensing packages.

### 2. Generic vs Sector-Specific Question Coupling
**Recommendation**: Decoupled approach - run generic questions first for overall ranking, then sector-specific separately for targeted analysis. This allows iterating on sector questions without re-running expensive generic analysis.

### 3. Video-Codec Expansion
**Clarified above**: Expansion uses term-based search, CPC mining, citation expansion, and MLT queries to find portfolio patents not currently assigned to the sector. The goal is to grow from 6 to 50-100 patents by searching the full portfolio (not just Top N) for video codec related technology.

### 4. New Sectors
**Recommendation**: Create `automotive-adas` from cluster discovery results and expand `ai-ml` via term search. Both have clear market relevance and discovered competitor interest.

### 5. Damage Tier Updates
**Recommendation**: Sector expansion should trigger damage tier review only if the sector composition materially changes. Adding more patents to video-codec doesn't change its "very high" tier - it remains a high-damages technology area.

---

## Appendix: Current Sector Distribution

Based on 2026-01-19 export:

```
Top 10 Sectors by Active Patent Count:
1. network-switching: 569 active
2. network-signal-processing: 375 active
3. network-auth-access: 360 active
4. network-management: 329 active
5. network-threat-protection: 312 active
6. network-protocols: 279 active
7. network-multiplexing: 255 active
8. wireless-transmission: 244 active
9. network-error-control: 222 active
10. video-broadcast: 159 active
```

---

*Document Version: 1.0*
*Created: 2026-01-19*
*Status: DRAFT for review*
