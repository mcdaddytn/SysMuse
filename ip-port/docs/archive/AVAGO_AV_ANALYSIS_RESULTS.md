# Avago A/V Analysis Results

## Executive Summary

Analysis of Avago's Audio/Video patent portfolio revealed a significant concentration in **acoustic resonator technology (BAW/FBAR)** rather than traditional A/V streaming technology. This technology is critical for RF filters in smartphones, 5G devices, and MEMS microphones - a multi-billion dollar market.

**Date:** 2026-01-17

---

## Phase 1: Term Extraction Results

### Portfolio Statistics
| Metric | Value |
|--------|-------|
| Total Avago Patents in ES | 2,918 |
| A/V Related Patents | 923 |
| Significant Terms Extracted | 116 |
| CPC Codes Identified | 100 |

### Technology Categories Discovered
| Category | Patent Count | Key Technologies |
|----------|--------------|------------------|
| Audio Processing | 167 | BAW resonators, MEMS microphones |
| Video Codecs & Compression | 154 | LDPC decoding, error correction |
| Storage & Recording | 136 | Flash memory, read channels |
| Wireless Media Transport | 126 | Multi-level coding, signal processing |
| Streaming & Adaptive Bitrate | 107 | Data buffering, processing |
| Display Interfaces (HDMI/DP) | 36 | Signal conversion, interfaces |
| DRM & Content Protection | 3 | Network controllers |
| Other A/V Technologies | 194 | Various |

### Top Significant Terms
| Rank | Term | Doc Count | Score | Technology Area |
|------|------|-----------|-------|-----------------|
| 1 | acoustic | 132 | 8.71 | BAW/FBAR filters |
| 2 | resonator | 121 | 6.38 | RF filters |
| 3 | piezoelectric | 105 | 5.27 | MEMS/sensors |
| 4 | bulk | 54 | 2.57 | BAW technology |
| 5 | electrode | 101 | 2.07 | Device structures |
| 6 | baw | 44 | 2.04 | Bulk acoustic wave |
| 7 | wave | 58 | 1.18 | SAW/BAW |
| 8 | encoder | 143 | 0.69 | Video/signal |
| 9 | fbar | 9 | 0.52 | Film bulk acoustic |
| 10 | loudspeaker | 7 | 0.47 | Audio transducers |

### Key CPC Codes
| CPC Code | Patents | Description |
|----------|---------|-------------|
| H03H9/173 | 74 | BAW resonator structures |
| H03H9/175 | 50 | Piezoelectric materials |
| H03H9/132 | 49 | Electrode configurations |
| H03H9/02118 | 43 | Resonator manufacturing |
| G11B20/10009 | 37 | Signal processing |
| G11B20/10046 | 36 | Error correction |

---

## Phase 2: Portfolio Clustering Results

### Cross-Portfolio Connections
| Portfolio | Similar Patents Found |
|-----------|----------------------|
| Avago | 432 |
| Broadcom | 273 |
| LSI | 62 |
| Symantec | 13 |
| CA Technologies | 3 |

### Top Seeds by Cross-Portfolio Connections
| Patent ID | Cross-Portfolio | Technology |
|-----------|-----------------|------------|
| 10855684 | 30 | Network/communication |
| 9184841 | 27 | Multi-level decoder |
| 9281841 | 25 | LDPC decoding |
| 7183900 | 25 | Power line communication |
| 7092641 | 24 | Optical transmission |

**Key Insight:** Strong technology overlap between Avago and Broadcom portfolios, particularly in signal processing and decoding technologies.

---

## Phase 3: Competitor Discovery Results

### New Competitors Identified
| Company | Patents | Primary Technology |
|---------|---------|-------------------|
| **MURATA Manufacturing** | 73 | BAW/FBAR filters - MAJOR competitor |
| Skyworks Solutions | 21 | RF filters, BAW duplexers |
| Qorvo US | 17 | BAW filters, RF switches |
| QXONIX Inc | 10 | BAW resonator structures |
| Texas Instruments | 9 | Audio/display drivers |
| RF360 Singapore | 8 | RF modules |
| Qualcomm (tracked) | 8 | RF front end |
| Akoustis | 7 | BAW filters |

### Known A/V Companies Not Currently Tracked
- Texas Instruments (9 patents)
- MediaTek (1 patent)
- NXP (2 patents)
- Knowles (1 patent)
- Harmonic Drive Systems (1 patent)

### Recommendations for Competitor List Update
**Priority additions for config/competitors.json:**

```json
{
  "category": "rf_semiconductors",
  "companies": [
    {"name": "Murata", "patterns": ["Murata", "MURATA"]},
    {"name": "Skyworks", "patterns": ["Skyworks"]},
    {"name": "Qorvo", "patterns": ["Qorvo"]},
    {"name": "Akoustis", "patterns": ["Akoustis"]},
    {"name": "QXONIX", "patterns": ["QXONIX", "Qxonix"]},
    {"name": "RF360", "patterns": ["RF360"]}
  ]
}
```

---

## Phase 4: Product Search Queries

### Generated Query Statistics
| Category | Query Count |
|----------|-------------|
| Product Specification | 15 |
| Teardown Analysis | 10 |
| Technical Analysis | 5 |
| Competitive Intelligence | 4 |
| Market Intelligence | 4 |
| Technical Comparison | 4 |
| **Total** | **42** |

### Priority Product Research Targets

**High-Value Targets (BAW/RF Filter Market):**
1. Murata BAW filter modules
2. Skyworks RF filter portfolio
3. Qorvo BAW duplexers
4. Akoustis XBAW technology

**Sample Product Specification Queries:**
- "Murata" "BAW filter" specification datasheet
- "Skyworks" "RF filter" specification datasheet
- "Qorvo" "BAW filter" specification datasheet
- "Akoustis" "XBAW" specification datasheet

**Sample Teardown Queries:**
- "bulk acoustic wave" teardown analysis chip identification
- "BAW duplexer" teardown analysis chip identification
- smartphone RF filter teardown

---

## Key Findings & Strategic Implications

### Major Discovery: Acoustic Resonator Portfolio
The analysis revealed that Avago's "A/V" technology is primarily **acoustic resonators (BAW/FBAR)** rather than traditional video streaming technology. This technology is used in:

1. **RF Filters for Smartphones** - Every 4G/5G smartphone uses BAW filters
2. **MEMS Microphones** - Voice-enabled devices
3. **RF Duplexers** - Simultaneous transmit/receive
4. **5G Antenna Modules** - High-frequency filtering

### Market Opportunity
The BAW filter market is estimated at $10+ billion annually, driven by:
- 5G smartphone proliferation
- WiFi 6/6E adoption
- IoT device growth
- Voice assistant integration

### Potential Licensing Targets (by Priority)
| Priority | Company | Rationale |
|----------|---------|-----------|
| 1 | **Murata** | Largest BAW filter manufacturer, 73 patents in space |
| 2 | **Skyworks** | Major RF filter supplier to Apple, 21 patents |
| 3 | **Qorvo** | Major supplier to Samsung/others, 17 patents |
| 4 | **Akoustis** | Emerging BAW player, 7 patents |
| 5 | **Qualcomm** | RF front end integrator, already tracked |

### Next Steps
1. **Run citation overlap analysis** on 923 Avago A/V patents against new competitor list
2. **Add new competitors** to config/competitors.json
3. **Deep-dive patent review** of top acoustic resonator patents for claim mapping
4. **Market research** using generated product search queries
5. **Identify specific infringing products** via teardown reports

---

## Output Files Generated

| File | Description |
|------|-------------|
| `avago-av-key-terms-2026-01-17.json` | Extracted significant terms |
| `avago-av-patents-2026-01-17.json` | Full Avago A/V patent list |
| `avago-av-categories-2026-01-17.json` | Patents grouped by technology |
| `av-search-queries-2026-01-17.json` | USPTO search queries |
| `av-patent-clusters-2026-01-17.json` | MLT clustering results |
| `av-cluster-analysis-2026-01-17.json` | Clustering insights |
| `av-competitor-candidates-2026-01-17.json` | Discovered competitors |
| `av-competitor-recommendations-2026-01-17.json` | Recommended additions |
| `av-product-search-queries-2026-01-17.json` | Product research queries |
| `av-priority-searches-2026-01-17.json` | High-priority searches |

---

*Analysis completed: 2026-01-17*
*Scripts: `scripts/extract-av-terms.ts`, `scripts/cluster-av-patents.ts`, `scripts/discover-av-competitors.ts`, `scripts/generate-product-searches.ts`*
