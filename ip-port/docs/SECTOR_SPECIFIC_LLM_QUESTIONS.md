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

## Questions for Review

1. **Sector consolidation**: Should we create "super-sectors" for portfolio-level views while keeping granular sectors?

2. **Question priority**: Which sectors should get sector-specific questions first?

3. **Generic vs specific**: Should all patents get generic questions + sector-specific questions, or route to sector-specific prompts only?

4. **New sectors**: Should we create `automotive-adas` and `ai-ml-inference` as new sectors?

5. **Damage tier updates**: Should sector expansion affect damage tier assignments?

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
