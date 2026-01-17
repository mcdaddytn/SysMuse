# Promising Sectors for Mining Expansion

## Summary

Based on cluster analysis, citation overlap results, and portfolio categorization, this document identifies sectors with high potential for expanded competitor discovery and patent mining efforts.

---

## Sector Rankings by Priority

### Tier 1: High Priority (Strong Signals, Specialized Competitors)

#### 1. RF/Acoustic Resonators (BAW/FBAR)

**Status:** Actively mining via Avago A/V citation overlap

| Metric | Value |
|--------|-------|
| Patents in Portfolio | ~100+ (within A/V subset) |
| Hit Rate | 33% with competitor citations |
| Specialized Competitors Found | 6 |

**Key Competitors Discovered:**
- Skyworks: 14 citations (BAW filters, RF modules)
- Samsung: 11 citations (mobile RF)
- Murata: 6 citations (piezoelectric, MEMS)
- Akoustis: 3 citations (pure-play BAW)
- Qorvo: 2 citations (RF front-end)
- RF360: 1 citation (Qualcomm JV)

**Why High Priority:**
- Highly concentrated competitor landscape
- Premium IP space (5G filters, smartphone RF)
- Clear product correlation (every smartphone uses BAW/FBAR)
- Specialized companies = focused infringement targets

**Recommended Action:**
- Continue Avago A/V batches to completion (923 total)
- Create dedicated BAW/FBAR search using ES term extraction
- Add Resonant Inc. (now Murata), TDK to competitor tracking

---

#### 2. Cloud Authentication (Cluster 1)

**Status:** Cluster competitor discovery complete

| Metric | Value |
|--------|-------|
| Cluster Patents | 43 |
| Competitor Citations | 349 (highest) |
| New Potential Competitors | 15+ |

**Key Terms:** user, cloud, authent, comput, access, encrypt, credenti

**Established Competitors:** Qualcomm (42), Google, Amazon, Microsoft

**New Competitors Found:**
- Dell Products: 27 patents (enterprise cloud)
- Bank of America: 22 patents (fintech auth)
- Capital One: 16 patents (mobile banking)
- LG Electronics: 14 patents (device auth)
- ZTE: 8 patents (telecom auth)
- Canon: 8 patents (enterprise printing)
- USAA: 6 patents (financial services)

**Why High Priority:**
- Highest competitor citation count
- Cross-industry applicability (fintech, enterprise, consumer)
- Clear product touchpoints (login, MFA, SSO)
- Financial services = well-funded defendants

**Recommended Action:**
- Run dedicated citation overlap on cluster 1 patents
- Deep-dive on financial sector (BofA, Capital One, USAA)
- Add SaaS providers: Okta, Auth0, Ping Identity

---

### Tier 2: Medium Priority (Good Signals, Broader Landscape)

#### 3. Video Codec / Compression

**Status:** Partially covered in clusters + Avago A/V

| Metric | Value |
|--------|-------|
| Avago A/V Category | 154 patents |
| Cluster 2 Patents | 5 (high citation density) |
| Competitor Citations | 60 (cluster 2) |

**Key Terms:** video, codec, transcod, macroblock, transform, h264, hevc

**Known Competitors:** ByteDance (39), Tencent (13K+ portfolio), Dolby, Kuaishou

**Why Medium Priority:**
- Large patent landscape (MPEG LA, HEVC pools)
- Strong Chinese tech presence (ByteDance, Tencent)
- Streaming services = high revenue targets
- Complex licensing landscape

**Recommended Action:**
- Create dedicated video codec term extraction
- Focus on next-gen codecs: AV1, VVC
- Track Chinese streaming platforms: Bilibili, iQIYI

---

#### 4. Image Depth Mapping / ADAS

**Status:** Cluster 3 analysis complete

| Metric | Value |
|--------|-------|
| Cluster Patents | 3 |
| Competitor Citations | 47 |
| Citation/Patent Ratio | 15.7 (highest ratio) |

**Key Terms:** imag, depth, map, focus, captur, lidar, 3d

**Key Competitors:**
- Automotive: Toyota, Hyundai, Honda, Kia
- Tech: Intel (Mobileye), NVIDIA, Qualcomm

**Why Medium Priority:**
- Automotive = large ticket litigation
- ADAS/autonomous driving = premium IP
- Limited patent count in cluster (needs expansion)
- Clear product correlation (cameras, LIDAR)

**Recommended Action:**
- Expand seed patents for depth mapping
- Run USPTO term search for "depth estimation", "stereo vision", "LIDAR"
- Add: Velodyne, Luminar, Waymo, Cruise

---

#### 5. Security/Threat Detection (Cluster 5)

**Status:** Cluster analysis complete

| Metric | Value |
|--------|-------|
| Cluster Patents | 6 |
| Competitor Citations | 28 |
| Key CPC | H04L (network security) |

**Key Terms:** threat, attack, secur, alert, campaign, malware, intrusion

**Potential Competitors:** CrowdStrike, Palo Alto, Fortinet, SentinelOne

**Why Medium Priority:**
- High-growth cybersecurity market
- Enterprise buyers = legal budgets
- Clear product mapping (EDR, SIEM, firewalls)
- Limited patent depth currently

**Recommended Action:**
- Expand cluster with security-focused ES search
- Add EDR vendors: CrowdStrike, Carbon Black, Cybereason
- Consider Symantec overlap (acquired by Broadcom)

---

### Tier 3: Lower Priority (Nascent, Needs More Data)

#### 6. Audio Processing (Avago A/V Category)

| Metric | Value |
|--------|-------|
| Category Patents | 167 |
| Citation Analysis | Not yet run |

**Potential Competitors:** Harman (Samsung), Bose, Sonos, Bang & Olufsen, Qualcomm (Aptx)

**Recommended Action:** Run citation overlap on audio processing subset

---

#### 7. Bluetooth/BLE (Cluster 8)

| Metric | Value |
|--------|-------|
| Cluster Patents | 2 |
| Competitor Citations | 20 |

**Key Terms:** scan, edr, ble, bluetooth, advertis

**Potential Competitors:** Nordic Semiconductor, Silicon Labs, Dialog (Renesas)

**Recommended Action:** Expand cluster, focus on BLE audio (LE Audio standard)

---

#### 8. AI/ML (Cluster 9)

| Metric | Value |
|--------|-------|
| Cluster Patents | 4 |
| Competitor Citations | 9 |

**Key Terms:** learn, confid, machin, classifi, train, neural

**Why Lower Priority:**
- Crowded landscape (Google, Meta, Microsoft)
- 101 eligibility concerns
- Limited patent depth

---

## Mining Strategy Summary

### Immediate Actions

1. **Complete Avago A/V mining** (batches running)
   - 325-425, 425-525, 525-625 in progress
   - Queue 625-725, 725-825, 825-923

2. **Create focused BAW/FBAR search**
   - Extract terms from high-citation Avago A/V patents
   - Query USPTO for adjacent assignees

3. **Deep-dive Cloud Auth cluster**
   - Run citation overlap on 43 cluster patents
   - Add financial sector competitors

### Short-term Actions

4. **Expand Video Codec mining**
   - Separate analysis from general A/V
   - Focus on streaming-specific patents

5. **Depth Mapping expansion**
   - Find more seed patents
   - Add automotive and LIDAR companies

### Medium-term Actions

6. **Security/Threat portfolio development**
7. **Audio Processing analysis**
8. **Bluetooth/BLE expansion**

---

## New Competitors to Add

Based on this analysis, recommend adding to `config/competitors.json`:

```json
{
  "rfAcoustic": [
    { "name": "Resonant", "patterns": ["Resonant"] },
    { "name": "TDK", "patterns": ["TDK"] }
  ],
  "financial": [
    { "name": "USAA", "patterns": ["USAA", "United Services Automobile"] },
    { "name": "Wells Fargo", "patterns": ["Wells Fargo"] },
    { "name": "JPMorgan", "patterns": ["JPMorgan", "JP Morgan"] }
  ],
  "identity": [
    { "name": "Okta", "patterns": ["Okta"] },
    { "name": "Ping Identity", "patterns": ["Ping Identity"] }
  ],
  "automotive": [
    { "name": "Velodyne", "patterns": ["Velodyne"] },
    { "name": "Luminar", "patterns": ["Luminar"] },
    { "name": "Waymo", "patterns": ["Waymo"] },
    { "name": "Cruise", "patterns": ["Cruise"] }
  ],
  "security": [
    { "name": "CrowdStrike", "patterns": ["CrowdStrike"] },
    { "name": "SentinelOne", "patterns": ["SentinelOne"] },
    { "name": "Cybereason", "patterns": ["Cybereason"] }
  ],
  "audio": [
    { "name": "Harman", "patterns": ["Harman"] },
    { "name": "Bose", "patterns": ["Bose"] },
    { "name": "Sonos", "patterns": ["Sonos"] }
  ]
}
```

---

*Document created: 2026-01-17*
*Based on cluster analysis, citation overlap results, and Avago A/V categorization*
