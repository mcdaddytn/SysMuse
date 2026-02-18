# Sector Breakout Proposals

## Analysis Summary

Based on CPC subclass distribution of **active patents** (≥3 years remaining), here are proposed sector breakouts that balance:
- Natural CPC clustering
- Meaningful technology groupings (not contrived)
- Allowing small high-value sectors (like cloud-auth with 43)
- Emergent connections across CPC classes where natural

---

## WIRELESS Domain (1,476 active patents)

### Current: Single "wireless" sector

### Proposed Breakout:

| Proposed Sector | Subclasses | Active | Description | Damages |
|-----------------|------------|--------|-------------|---------|
| **wireless-resource-mgmt** | H04W72, H04W52, H04W74, H04W56 | ~430 | Scheduling, power, random access, sync | High |
| **wireless-rf-physical** | H04B7, H04B1, H04B3, H04B5 | ~312 | MIMO, transmission, modulation | High |
| **wireless-infrastructure** | H04W88, H04W24, H04W16, H04W28 | ~208 | Base stations, monitoring, coverage | Medium |
| **wireless-services** | H04W4, H04W64 | ~137 | Location services, messaging | Medium |
| **wireless-mobility** | H04W36, H04W76, H04W8 | ~147 | Handoff, connection mgmt, roaming | High |
| **wireless-security** | H04W12 | ~68 | Auth, encryption (distinct from network security) | High |

**Emergent Connection**: `wireless-security` (H04W12) connects to `cloud-auth` and `network-security-core` through authentication/encryption concepts, but operates at the wireless layer.

---

## VIDEO-IMAGE Domain (888 active patents)

### Current: "video-image" + small term-based "video-codec" (6) and "image-depth" (3)

### Proposed Breakout:

| Proposed Sector | Subclasses | Active | Description | Damages |
|-----------------|------------|--------|-------------|---------|
| **video-streaming-drm** | H04N21 | ~290 | VOD, streaming, content protection, DRM | Very High |
| **video-codec** | H04N19 + term-based | ~202 | Compression, encoding (merge with existing) | Very High |
| **video-broadcast** | H04N7, H04N5, H04N9 | ~149 | TV systems, signal processing | Medium |
| **video-storage** | G11B20, G11B5, G11B27 | ~120 | Recording, media storage | Medium |
| **image-processing** | G06T1, G06T3, G06T5, G06T7, G06T9, G06T11 | ~60 | Enhancement, transforms, analysis | Medium |
| **3d-stereo-depth** | H04N13, G06T15 + term-based image-depth | ~47 | 3D imaging, depth (merge with existing) | High |
| **cameras-sensors** | H04N23, H04N25 | ~18 | Image capture hardware | Medium |

**Emergent Connections**:
- `video-streaming-drm` connects to `network-protocols` (H04L67) through content delivery
- `video-codec` is distinct from streaming (how it's compressed vs how it's delivered)
- `3d-stereo-depth` connects to `image-depth` term-sector and automotive ADAS applications

---

## COMPUTING Domain (818 active patents)

### Current: "computing" + term-based "cloud-auth" (43), "ai-ml" (52)

### Proposed Breakout:

| Proposed Sector | Subclasses | Active | Description | Damages |
|-----------------|------------|--------|-------------|---------|
| **computing-security** | G06F21 | ~342 | Access control, authentication, secure boot | High |
| **computing-systems** | G06F1, G06F13, G06F12 | ~148 | Power, interconnect, memory management | Medium |
| **computing-runtime** | G06F9, G06F11 | ~136 | VMs, scheduling, error detection | Medium |
| **data-retrieval** | G06F16 | ~62 | Database, search, information retrieval | Medium |
| **fintech-business** | G06Q20, G06Q10, G06Q30, G06Q40, G06Q50 | ~65 | Payments, workflow, commerce | High |
| **computing-ui** | G06F3 | ~40 | I/O, displays, interaction | Low |

**Critical Emergent Connection**:
`computing-security` (G06F21, 342 patents) overlaps conceptually with:
- `network-security-core` (H04L63, ~860 patents)
- `cloud-auth` (term-based, 43 patents)
- `wireless-security` (H04W12, 68 patents)

This suggests a **cross-domain "Security/Authentication" super-sector** that spans:
- Application layer (G06F21)
- Network layer (H04L63, H04L9)
- Wireless layer (H04W12)
- Cloud/identity (term-based)

---

## Emergent Cross-Domain Sectors

These sectors span multiple CPC classes, identified through natural technology connections:

### 1. **Security & Authentication (Cross-Domain)**

| Component | CPC | Active Patents | Layer |
|-----------|-----|----------------|-------|
| network-security-core | H04L63, H04L9 | ~860 | Network |
| computing-security | G06F21 | ~342 | Application |
| wireless-security | H04W12 | ~68 | Wireless |
| cloud-auth (term-based) | Various | ~43 | Identity |
| **TOTAL** | | **~1,313** | |

**Rationale**: Authentication, encryption, and access control span all layers. This is a natural grouping for licensing/litigation against security-focused infringers.

**Potential Sub-Sectors**:
- `auth-identity` (MFA, SSO, biometrics) - includes cloud-auth
- `crypto-encryption` (H04L9, encryption schemes)
- `access-control` (G06F21 subset, firewalls, H04L63 subset)

### 2. **Video End-to-End (Cross-Domain)**

| Component | CPC | Active Patents | Function |
|-----------|-----|----------------|----------|
| video-codec | H04N19 | ~196 | Compression |
| video-streaming-drm | H04N21 | ~290 | Delivery/Protection |
| streaming-multimedia | H04L65 | ~76 | Network transport |
| **TOTAL** | | **~562** | |

**Rationale**: The video pipeline from encoding → transport → playback is a natural grouping for targeting streaming platforms.

### 3. **Positioning & Location (Cross-Domain)**

| Component | CPC | Active Patents | Application |
|-----------|-----|----------------|-------------|
| wireless-services | H04W4, H04W64 | ~137 | Location services |
| 3d-stereo-depth | H04N13, G06T15 | ~47 | Depth sensing |
| image-depth (term) | Various | ~3 | ADAS/automotive |
| **TOTAL** | | **~187** | |

**Rationale**: Indoor positioning, automotive sensing, AR/VR all use positioning technology.

---

## Revised Sector Summary

### Very High Damages (>$200M)
| Sector | Active | Source |
|--------|--------|--------|
| rf-acoustic | 17 | CPC + term |
| video-codec | ~202 | CPC + term merged |
| video-streaming-drm | ~290 | CPC breakout |

### High Damages ($75M-$200M)
| Sector | Active | Source |
|--------|--------|--------|
| network-security-core | ~860 | CPC breakout |
| wireless-resource-mgmt | ~430 | CPC breakout |
| wireless-rf-physical | ~312 | CPC breakout |
| wireless-mobility | ~147 | CPC breakout |
| wireless-security | ~68 | CPC breakout |
| computing-security | ~342 | CPC breakout |
| fintech-business | ~65 | CPC breakout |
| 3d-stereo-depth | ~47 | CPC + term merged |
| cloud-auth | ~43 | Term-based |

### Medium Damages ($20M-$75M)
| Sector | Active | Source |
|--------|--------|--------|
| network-switching | ~654 | CPC breakout |
| network-physical | ~689 | CPC breakout |
| network-management | ~311 | CPC breakout |
| network-protocols | ~252 | CPC breakout |
| streaming-multimedia | ~76 | CPC breakout |
| wireless-infrastructure | ~208 | CPC breakout |
| wireless-services | ~137 | CPC breakout |
| video-broadcast | ~149 | CPC breakout |
| video-storage | ~120 | CPC breakout |
| image-processing | ~60 | CPC breakout |
| computing-systems | ~148 | CPC breakout |
| computing-runtime | ~136 | CPC breakout |
| data-retrieval | ~62 | CPC breakout |
| ai-ml | ~15 | Term-based |

### Low Damages (<$20M)
| Sector | Active | Source |
|--------|--------|--------|
| computing-ui | ~40 | CPC breakout |
| cameras-sensors | ~18 | CPC breakout |
| audio | ~11 | CPC |
| general | 0 | Unclassified |

---

## Implementation Notes

### Orthogonality vs. Meaning

The proposed sectors achieve **partial orthogonality** from CPC classes through:

1. **Cross-domain groupings** (Security spans G06F21 + H04L63 + H04W12)
2. **Term-based refinement** (cloud-auth is within G06F21 but semantically distinct)
3. **Functional groupings** (video-codec vs video-streaming are in same H04N but different value chains)

However, we avoid contrived orthogonality:
- CPC subclasses naturally group related technology
- We don't artificially split coherent technologies
- Small high-value sectors (43 patents) are acceptable

### Merge Opportunities

| Current Term Sector | Merge Into | Rationale |
|--------------------|------------|-----------|
| video-codec (6) | video-codec (H04N19) | Same technology |
| image-depth (3) | 3d-stereo-depth | Same technology |
| security (6) | network-security-core | Overlapping |
| pii-breach (3) | computing-security | Data protection |
| event-live (4) | video-streaming-drm | Live streaming |
| object-pose (1) | 3d-stereo-depth | Motion tracking |
| bluetooth-edr (2) | wireless-services | Wireless services |
| wireless-iot (4) | wireless-services | IoT connectivity |

---

## Next Steps

1. **Review this proposal** for any adjustments
2. **Create sector assignment script** that:
   - Uses CPC subclass mapping for broad assignment
   - Overlays term-based refinement for high-value sub-sectors
   - Handles cross-domain groupings
3. **Re-run term extraction** within new sectors for validation
4. **Update damages configuration** with new sector list

---

*Document created: 2026-01-18*
*Status: DRAFT for review*
