# v2 Refined Sub-sectors for Network-Switching

## Overview

Refined sub-sector definitions based on CPC analysis. Target sizes:
- Overall: 100-1000 patents
- Per portfolio (Broadcom): <500 patents

## Proposed Structure

### ROUTING (H04L45/) → 11 sub-sectors

| Code | Name | CPC Patterns | Est. Total | Est. BC |
|------|------|--------------|------------|---------|
| `SDN/SWIT/routing-table-lookup` | Table Lookup & Filtering | H04L45/745, H04L45/7453 | 670 | 349 |
| `SDN/SWIT/routing-topology` | Topology Discovery | H04L45/02, H04L45/03 | 523 | 266 |
| `SDN/SWIT/routing-multipath` | Multipath & Alternate | H04L45/22, H04L45/24 | 377 | 193 |
| `SDN/SWIT/routing-shortest-path` | Shortest Path | H04L45/12 | 230 | 76 |
| `SDN/SWIT/routing-addr-proc` | Address Processing | H04L45/74, H04L45/70 | 224 | 125 |
| `SDN/SWIT/routing-general` | General Routing | H04L45/00, H04L45/06, H04L45/16, H04L45/28 | 169 | 75 |
| `SDN/SWIT/routing-fragmentation` | Fragmentation & Dup Detection | H04L45/64, H04L45/66 | 163 | 106 |
| `SDN/SWIT/routing-prefix-match` | Prefix Matching | H04L45/38 | 149 | 86 |
| `SDN/SWIT/routing-qos` | QoS-based Routing | H04L45/30 | 135 | 45 |
| `SDN/SWIT/routing-label-ops` | Label Operations | H04L45/54, H04L45/58 | 130 | 85 |
| `SDN/SWIT/routing-advanced` | SDN/MPLS/Interdomain | H04L45/76, H04L45/50, H04L45/04, H04L45/42, H04L45/44 | ~320 | ~150 |

### TRAFFIC-QOS (H04L47/) → 8 sub-sectors

| Code | Name | CPC Patterns | Est. Total | Est. BC |
|------|------|--------------|------------|---------|
| `SDN/SWIT/qos-scheduling-priority` | Priority Scheduling | H04L47/12, H04L47/125 | 568 | 325 |
| `SDN/SWIT/qos-scheduling-core` | Core Scheduling | H04L47/10, H04L47/11 | 513 | 366 |
| `SDN/SWIT/qos-bw-reservation` | Bandwidth Reservation | H04L47/24, H04L47/2433, H04L47/2441 | 490 | 224 |
| `SDN/SWIT/qos-admission` | Admission Control | H04L47/70, H04L47/72, H04L47/74, H04L47/76, H04L47/78 | 289 | 190 |
| `SDN/SWIT/qos-bw-allocation` | Bandwidth Allocation | H04L47/20, H04L47/2408 | 171 | 68 |
| `SDN/SWIT/qos-priority` | Priority Handling | H04L47/80, H04L47/805, H04L47/82, H04L47/822 | 128 | 60 |
| `SDN/SWIT/qos-congestion` | Congestion Control | H04L47/28, H04L47/283, H04L47/30, H04L47/32, H04L47/38 | ~195 | ~60 |
| `SDN/SWIT/qos-other` | Shaping/Marking/Other | H04L47/22, H04L47/215, H04L47/50, H04L47/52, H04L47/00, H04L47/193, H04L47/263 | ~160 | ~70 |

### PACKET-SWITCHING (H04L49/) → 8 sub-sectors

| Code | Name | CPC Patterns | Est. Total | Est. BC |
|------|------|--------------|------------|---------|
| `SDN/SWIT/pkt-ports` | Port Handling | H04L49/90, H04L49/901 | 305 | 164 |
| `SDN/SWIT/pkt-buffer-addr` | Buffer Addressing | H04L49/25, H04L49/254 | 275 | 168 |
| `SDN/SWIT/pkt-input` | Input Processing | H04L49/10, H04L49/101, H04L49/103, H04L49/109 | 250 | 145 |
| `SDN/SWIT/pkt-crossbar` | Crossbar Switches | H04L49/351, H04L49/352, H04L49/354, H04L49/357 | 239 | 171 |
| `SDN/SWIT/pkt-fabric` | Switch Fabric | H04L49/30, H04L49/3009, H04L49/3063 | ~371 | ~194 |
| `SDN/SWIT/pkt-multicast` | Multicast | H04L49/70 | 222 | 185 |
| `SDN/SWIT/pkt-buffer-mgmt` | Buffer Management | H04L49/20, H04L49/201 | 215 | 149 |
| `SDN/SWIT/pkt-other` | Output/Virtual/QoS | H04L49/15, H04L49/60, H04L49/602, H04L49/9047, H04L49/00 | ~257 | ~174 |

### EXISTING (kept as-is)

| Code | Name | CPC Patterns | Est. Total | Est. BC |
|------|------|--------------|------------|---------|
| `SDN/SWIT/ethernet-lan` | Ethernet/LAN | H04L12/28, H04L12/40 | 426 | 260 |
| `SDN/SWIT/network-interconnect` | Network Interconnection | H04L12/46 | 470 | 240 |
| `SDN/SWIT/general` | General Switching | H04L12/ (catch-all) | 489 | 266 |

## Summary

| Category | Sub-sectors | Total Patents | Broadcom Patents |
|----------|-------------|---------------|------------------|
| Routing | 11 | ~3,088 | ~1,560 |
| Traffic-QoS | 8 | ~2,515 | ~1,363 |
| Packet-Switching | 8 | ~2,134 | ~1,350 |
| Existing | 3 | ~1,385 | ~766 |
| **Total** | **30** | ~6,600* | ~3,400* |

*Note: Patents may appear in multiple sub-sectors due to multi-classification.

## Rule Priority Strategy

Higher priority (85-90) = more specific patterns, assigned first
Lower priority (50-75) = broader patterns, catch remaining

Example:
1. `H04L45/745` (priority 85) → routing-table-lookup
2. `H04L45/74` (priority 75) → routing-addr-proc (remaining patents with H04L45/74 but not /745)

## Next Steps

1. Create TaxonomyNodes for all 30 refined sub-sectors
2. Create TaxonomyRules with appropriate priorities
3. Re-run classification
4. Validate sizes and iterate if needed

---

*Created: 2026-03-28*
