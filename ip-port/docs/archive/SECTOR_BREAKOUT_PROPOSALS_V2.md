# Sector Breakout Proposals V2

## Additional Breakouts for Sectors >250 Active Patents

Based on CPC subgroup analysis, here are refined breakouts targeting sectors with meaningful technology clustering.

---

## NETWORK-SECURITY-CORE (894 → 4 sectors)

### Analysis
Clear functional clusters within H04L63 and H04L9:

| Subgroup | Count | Function |
|----------|-------|----------|
| H04L63/14 | 286 | Malware/virus protection |
| H04L63/08 | 152 | Authentication protocols |
| H04L63/10 | 107 | Access control policies |
| H04L9/32 | 70 | Digital signatures |
| H04L63/20 | 66 | Multiparty computation |
| H04L63/12,16 | 26 | Intrusion detection, countermeasures |

### Proposed Breakout

| Sector | Subgroups | Active | Description | Damages |
|--------|-----------|--------|-------------|---------|
| **network-threat-protection** | H04L63/14, 63/12, 63/16 | ~312 | Malware, intrusion detection, countermeasures | High |
| **network-auth-access** | H04L63/08, 63/10, 63/04, 63/02 | ~364 | Auth protocols, access control, firewalls | High |
| **network-crypto** | H04L9/* | ~122 | Cryptographic schemes, signatures, PKI | High |
| **network-secure-compute** | H04L63/20, 63/06 | ~84 | Multiparty computation, crypto mechanisms | Medium |

**Emergent Value**: `network-threat-protection` (312) is a distinct, high-value sector targeting EDR/SIEM vendors (CrowdStrike, SentinelOne, Palo Alto).

---

## NETWORK-PHYSICAL (689 → 3 sectors)

### Analysis
Natural signal processing clusters:

| Subgroup | Count | Function |
|----------|-------|----------|
| H04L25/* | ~133 | Baseband, equalization |
| H04L27/* | ~120 | Modulation schemes |
| H04L5/* | ~131 | Multiplexing |
| H04L1/* | ~135 | Error detection/correction |
| H04L7/* | ~65 | Synchronization |

### Proposed Breakout

| Sector | Subgroups | Active | Description | Damages |
|--------|-----------|--------|-------------|---------|
| **network-signal-processing** | H04L25/*, H04L27/* | ~253 | Baseband, modulation, equalization | Medium |
| **network-multiplexing** | H04L5/*, H04L7/* | ~196 | Frequency/time multiplexing, sync | Medium |
| **network-error-control** | H04L1/* | ~135 | Error detection, FEC, ARQ | Medium |

---

## NETWORK-SWITCHING (654) - Keep as Single Sector

### Analysis
Highly fragmented - no single cluster >15%:
- H04L12/28: 64 (10%)
- H04L12/40: 54 (8%)
- Remaining distributed across H04L45/*, H04L47/*, H04L49/*

**Recommendation**: Keep as single sector. The switching/routing/QoS technologies are interrelated and splitting would be artificial.

---

## WIRELESS-RESOURCE-MGMT (431 → 2 sectors)

### Analysis
Clear split between power and scheduling:

| Subgroup | Count | Function |
|----------|-------|----------|
| H04W72/* | ~181 | Scheduling, resource allocation |
| H04W52/* | ~127 | Power management, DRX |
| H04W74/* | ~35 | Random access |
| H04W56/* | ~39 | Synchronization |

### Proposed Breakout

| Sector | Subgroups | Active | Description | Damages |
|--------|-----------|--------|-------------|---------|
| **wireless-scheduling** | H04W72/*, H04W74/*, H04W56/* | ~255 | Resource scheduling, RACH, sync | High |
| **wireless-power-mgmt** | H04W52/* | ~127 | Power control, DRX, battery optimization | High |

**Rationale**: Power management is a distinct concern with different infringement targets (device makers) vs. scheduling (infrastructure/chipset).

---

## WIRELESS-RF-PHYSICAL (312 → 2 sectors)

### Analysis

| Subgroup | Count | Function |
|----------|-------|----------|
| H04B7/* | ~111 | MIMO, antenna diversity |
| H04B1/* | ~73 | Transmission fundamentals |
| H04B3/* | ~40 | Line transmission |
| H04B5/* | ~28 | Near-field, RFID |
| H04B10/* | ~26 | Optical transmission |

### Proposed Breakout

| Sector | Subgroups | Active | Description | Damages |
|--------|-----------|--------|-------------|---------|
| **wireless-mimo-antenna** | H04B7/* | ~111 | MIMO, beamforming, antenna arrays | High |
| **wireless-transmission** | H04B1/*, H04B3/*, H04B5/*, H04B10/* | ~167 | TX fundamentals, near-field, optical | Medium |

---

## COMPUTING-SECURITY (353 → 3 sectors)

### Analysis
Clear layers within G06F21:

| Subgroup | Count | Function |
|----------|-------|----------|
| G06F21/5* | ~139 | OS/kernel protection |
| G06F21/6* | ~89 | Data protection (storage, DLP) |
| G06F21/1* | ~37 | Boot security (secure boot) |
| G06F21/3* | ~29 | User authentication |
| G06F21/4* | ~17 | Program/process authentication |

### Proposed Breakout

| Sector | Subgroups | Active | Description | Damages |
|--------|-----------|--------|-------------|---------|
| **computing-os-security** | G06F21/5* | ~139 | Kernel, OS protection, sandboxing | High |
| **computing-data-protection** | G06F21/6* | ~89 | Data at rest, DLP, storage encryption | High |
| **computing-auth-boot** | G06F21/1*, 21/3*, 21/4* | ~83 | Secure boot, user auth, process auth | High |

**Emergent Connection**: `computing-auth-boot` overlaps with `cloud-auth` conceptually - both deal with identity/authentication.

---

## VIDEO-STREAMING-DRM (292 → 3 sectors)

### Analysis

| Subgroup | Count | Function |
|----------|-------|----------|
| H04N21/4* | ~174 | Client processing |
| H04N21/2* | ~56 | Server/CDN |
| H04N21/6* | ~33 | Conditional access, DRM |
| H04N21/8* | ~11 | End-user equipment |

### Proposed Breakout

| Sector | Subgroups | Active | Description | Damages |
|--------|-----------|--------|-------------|---------|
| **video-client-processing** | H04N21/4* | ~174 | Playback, buffering, adaptive bitrate | High |
| **video-server-cdn** | H04N21/2*, H04N21/8* | ~67 | Server, CDN, delivery infrastructure | Medium |
| **video-drm-conditional** | H04N21/6* | ~33 | DRM, conditional access, encryption | Very High |

**Emergent Value**: `video-drm-conditional` (33 patents) is small but extremely high-value - targets Netflix, Disney+, streaming DRM providers.

---

## Revised Complete Sector List

### Very High Damages (>$200M) - 8 sectors
| Sector | Active | Source |
|--------|--------|--------|
| rf-acoustic | 17 | Term |
| video-codec | ~202 | CPC+Term |
| video-drm-conditional | ~33 | CPC breakout |

### High Damages ($75M-$200M) - 20 sectors
| Sector | Active | Source |
|--------|--------|--------|
| network-threat-protection | ~312 | CPC breakout |
| network-auth-access | ~364 | CPC breakout |
| network-crypto | ~122 | CPC breakout |
| network-switching | ~654 | CPC |
| wireless-scheduling | ~255 | CPC breakout |
| wireless-power-mgmt | ~127 | CPC breakout |
| wireless-mimo-antenna | ~111 | CPC breakout |
| wireless-mobility | ~147 | CPC |
| wireless-security | ~68 | CPC |
| computing-os-security | ~139 | CPC breakout |
| computing-data-protection | ~89 | CPC breakout |
| computing-auth-boot | ~83 | CPC breakout |
| video-client-processing | ~174 | CPC breakout |
| fintech-business | ~65 | CPC |
| 3d-stereo-depth | ~47 | CPC+Term |
| cloud-auth | ~43 | Term |

### Medium Damages ($20M-$75M) - 15 sectors
| Sector | Active | Source |
|--------|--------|--------|
| network-signal-processing | ~253 | CPC breakout |
| network-multiplexing | ~196 | CPC breakout |
| network-error-control | ~135 | CPC breakout |
| network-management | ~311 | CPC |
| network-protocols | ~252 | CPC |
| streaming-multimedia | ~76 | CPC |
| wireless-infrastructure | ~208 | CPC |
| wireless-services | ~137 | CPC |
| wireless-transmission | ~167 | CPC breakout |
| video-server-cdn | ~67 | CPC breakout |
| video-broadcast | ~149 | CPC |
| video-storage | ~120 | CPC |
| image-processing | ~60 | CPC |
| computing-systems | ~148 | CPC |
| computing-runtime | ~136 | CPC |
| data-retrieval | ~62 | CPC |
| network-secure-compute | ~84 | CPC breakout |
| ai-ml | ~15 | Term |

### Low Damages (<$20M) - 4 sectors
| Sector | Active | Source |
|--------|--------|--------|
| computing-ui | ~40 | CPC |
| cameras-sensors | ~18 | CPC |
| audio | ~11 | CPC |
| general | 0 | Unclassified |

---

## Summary Statistics

| Metric | Before | After |
|--------|--------|-------|
| Total Sectors | ~20 | **~47** |
| Sectors >250 | 8 | **7** |
| Sectors 100-250 | 3 | **15** |
| Sectors 50-100 | 2 | **10** |
| Sectors <50 | 7 | **15** |

### Size Distribution (Active Patents)
```
>500:    2 sectors  (network-switching 654, network-auth-access 364)
250-500: 5 sectors
100-250: 15 sectors
50-100:  10 sectors
<50:     15 sectors (including high-value term-based)
```

---

## Cross-Domain Security Super-Sector (Updated)

The security patents now span even more precisely:

| Layer | Sector | Active | Focus |
|-------|--------|--------|-------|
| Network - Threat | network-threat-protection | ~312 | Malware, IDS |
| Network - Auth | network-auth-access | ~364 | Auth, access control |
| Network - Crypto | network-crypto | ~122 | Encryption schemes |
| Compute - OS | computing-os-security | ~139 | Kernel, OS |
| Compute - Data | computing-data-protection | ~89 | DLP, storage |
| Compute - Auth | computing-auth-boot | ~83 | Secure boot, auth |
| Wireless | wireless-security | ~68 | Wireless auth |
| Identity | cloud-auth | ~43 | Cloud identity |
| **TOTAL** | | **~1,220** | |

This cross-domain grouping could be useful for targeting security vendors comprehensively.

---

*Document created: 2026-01-18*
*Status: V2 DRAFT for review*
