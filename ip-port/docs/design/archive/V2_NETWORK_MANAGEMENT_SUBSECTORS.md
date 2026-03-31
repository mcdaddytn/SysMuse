# v2 Sub-sectors for Network-Management

## Overview

Sub-sector definitions for `network-management` based on CPC analysis.
- **Sector patents (v1 primary):** 1,672 | **Total classified (incl. multi):** 4,978
- **Portfolios:** Broadcom: 755 | Cisco: 423 | Ericsson: 158
- **Target sizes:** <500 per portfolio (Broadcom)
- **CPC prefixes:** H04L41/ (config mgmt), H04L43/ (monitoring), H04L61/ (addressing)

## Important: CPC Code Format

H04L41 has **two parallel numbering schemes** in the database:
- `H04L41/08xx` (4-digit after slash): Configuration management subgroups
- `H04L41/8xx` (3-digit after slash): SDN/VM/ML management subgroups

These are **different CPC codes** — e.g., `H04L41/0806` ≠ `H04L41/806`. Rules must cover both series.

Same applies to H04L43: `H04L43/08xx` and `H04L43/8xx` are separate.

## Final Classification Results

| Code | Name | Primary | Broadcom | Status |
|------|------|---------|----------|--------|
| `SDN/MGMT/mon-metrics-qos` | Metrics & QoS Monitoring | 998 | 128 | ✓ |
| `SDN/MGMT/config-sdn-nfv` | SDN/NFV Configuration | 567 | 101 | ✓ |
| `SDN/MGMT/mon-reporting` | Monitoring Reports & Analysis | 484 | 71 | ✓ |
| `SDN/MGMT/fault-alarm` | Fault & Alarm Management | 355 | 60 | ✓ |
| `SDN/MGMT/config-provision` | Config & Provisioning | 299 | 23 | ✓ |
| `SDN/MGMT/config-automation` | Config Automation & Ops | 299 | 9 | ✓ |
| `SDN/MGMT/nfv-orchestration` | NFV & Orchestration | 258 | 28 | ✓ |
| `SDN/MGMT/topology-discovery` | Topology & Discovery | 258 | 88 | ✓ |
| `SDN/MGMT/ml-ai-mgmt` | ML/AI for Management | 223 | 34 | ✓ |
| `SDN/MGMT/nfv-vnf-sfc` | VNF & Service Function Chaining | 214 | 59 | ✓ |
| `SDN/MGMT/mgmt-general` | General Management | 197 | 42 | ✓ |
| `SDN/MGMT/mon-capture-flow` | Traffic Capture & Flow | 169 | 19 | ✓ |
| `SDN/MGMT/mon-active-probe` | Active Monitoring & Probes | 166 | 19 | ✓ |
| `SDN/MGMT/addr-mapping-dns` | Address Mapping & DNS | 158 | 9 | ✓ |
| `SDN/MGMT/network-analysis` | Network Analysis & Prediction | 137 | 17 | ✓ |
| `SDN/MGMT/config-policy` | Policy & Access Control | 108 | 33 | ✓ |
| `SDN/MGMT/service-sla` | Service Level & SLA Mgmt | 72 | 12 | ✓ |
| `SDN/MGMT/addr-allocation` | Address Allocation & DHCP | 16 | 3 | ✓ |

**All Broadcom sub-sectors under 130 patents — well within <500 target.**

## Classification Stats

| Metric | Value |
|--------|-------|
| Total sub-sectors | 18 |
| Total rules | 190 |
| Patents classified | 4,978 |
| Total classifications | 11,691 |
| Multi-classification rate | 79.0% |
| Avg classifications/patent | 2.35 |
| No-match (catch-all) | 0 |

## CPC Coverage

### H04L41/ (Network Management Config) — 3 CPC series

**4-digit series (H04L41/08xx):**
- Config provisioning: H04L41/0806, 082, 083, 084, 085
- SDN/NFV config: H04L41/0803, 0813, 0816, 0823
- Config automation: H04L41/0893-0897
- Config policy: H04L41/0853, 0866, 0873, 0886

**3-digit series (H04L41/8xx) — SDN/VM/ML management:**
- SDN management: H04L41/803, 806, 809, 813, 816 → config-sdn-nfv
- VM/VNF management: H04L41/82x, 83x, 85x → nfv-vnf-sfc
- Predictive: H04L41/84x → network-analysis
- Policy/security: H04L41/86x-88x → config-policy
- ML/AI: H04L41/893-897 → ml-ai-mgmt

**Other H04L41:**
- Fault/alarm: H04L41/06xx + H04L41/6xx (event processing)
- Topology: H04L41/12, 122, 22
- Analysis: H04L41/14x
- Service/SLA: H04L41/40, 42, 44, 46, 48
- ML: H04L41/16
- NFV: H04L41/50xx
- General: H04L41/02, 04, 20, 24, 28, 30, 32, 34

### H04L43/ (Network Monitoring)
- Metrics (08xx + 8xx): mon-metrics-qos
- Active probing: H04L43/10, 12, 14 → mon-active-probe
- Traffic capture: H04L43/02x, 04x → mon-capture-flow
- Reporting: H04L43/06x, 16, 20, 50 → mon-reporting

### H04L61/ (Network Addressing)
- Allocation: H04L61/50x → addr-allocation
- Mapping/DNS: H04L61/10, 25, 45 → addr-mapping-dns

## Rule Priority Strategy

| Priority | Scope | Example |
|----------|-------|---------|
| 85 | Specific subgroup patterns | H04L41/0806, H04L41/893, H04L43/817 |
| 80 | Mid-specific patterns | H04L43/08, H04L61/50xx |
| 75 | Group-level patterns | H04L41/06, H04L41/12, H04L41/80 |
| 70 | Broad category catch | H04L41/50, H04L43/8 |
| 60 | General patterns | H04L41/02, H04L41/04 |
| 50 | Config catch-all | H04L41/08 |
| 45 | Series catch-all | H04L41/8, H04L41/6 |
| 40 | Ultimate catch-all | H04L41/, H04L43/, H04L61/ |

## Files

| File | Purpose |
|------|---------|
| `scripts/setup-v2-network-mgmt.ts` | Creates 19 nodes and 190 rules |
| `scripts/run-v2-mgmt-classification.ts` | Priority-based classification |
| `scripts/analyze-network-mgmt-cpc.cjs` | CPC distribution analysis |

---

*Created: 2026-03-28*
*Refined: 2026-03-28 (added H04L41/8xx and H04L43/8xx 3-digit series rules)*
