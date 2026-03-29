# NETWORKING v2 Pilot Design

## Overview

Pilot design for v2 taxonomy sub-sectors within the SDN_NETWORK super-sector, starting with `network-switching`.

## Current v1 Structure

**Super-sector:** SDN_NETWORK (31,443 patents)

| L2 Sector | Patents | CPC Rules |
|-----------|---------|-----------|
| network-switching | 6,604 | H04L12/28, H04L12/40, H04L12/46, H04L45/, H04L47/, H04L49/ |
| network-error-control | 6,005 | H04L1/ |
| network-protocols | 5,380 | H04L67/, H04L69/ |
| network-management | 4,978 | H04L41/, H04L43/ |
| network-multiplexing | 4,556 | H04L5/, H04L7/ |
| network-signal-processing | 3,920 | H04L25/, H04L27/ |

---

## v2 Naming Convention

```
L1: sdn-network (abbrev: SDN)
L2: SDN/switching (abbrev: SWIT)
L3: SDN/SWIT/routing (abbrev: ROUT)
```

---

## v2 Sub-sector Design: network-switching

### Analysis

Current `network-switching` sector (6,604 patents) covers:
- H04L12/28 - Bus networks (Ethernet)
- H04L12/40 - Node arrangements
- H04L12/46 - Interconnection of networks
- H04L45/ - Routing selection
- H04L47/ - Traffic control (QoS)
- H04L49/ - Packet switching elements

### Proposed Sub-sectors

| L3 Code | Name | Abbrev | CPC Patterns | Est. Patents |
|---------|------|--------|--------------|--------------|
| `SDN/SWIT/ethernet-lan` | Ethernet/LAN Switching | ETHL | H04L12/28*, H04L12/40* | ~1,500 |
| `SDN/SWIT/routing` | IP Routing & Forwarding | ROUT | H04L45/* | ~2,000 |
| `SDN/SWIT/traffic-qos` | Traffic Management & QoS | TQOS | H04L47/* | ~1,500 |
| `SDN/SWIT/packet-switching` | Packet Switching Elements | PKSW | H04L49/* | ~1,200 |
| `SDN/SWIT/network-interconnect` | Network Interconnection | INTC | H04L12/46* | ~400 |

### Rule Priority

Within sub-sectors, use priority to handle overlaps:
- More specific patterns → higher priority
- General sector catch-all → lower priority

---

## v2 Sub-sector Design: network-management

### Proposed Sub-sectors

| L3 Code | Name | Abbrev | CPC Patterns | Est. Patents |
|---------|------|--------|--------------|--------------|
| `SDN/MGMT/config-provision` | Configuration & Provisioning | CFGP | H04L41/08*, H04L41/082* | ~1,200 |
| `SDN/MGMT/fault-recovery` | Fault Detection & Recovery | FLTR | H04L41/06* | ~800 |
| `SDN/MGMT/monitoring` | Network Monitoring | MNTR | H04L43/* | ~1,500 |
| `SDN/MGMT/sdn-control` | SDN Control Plane | SDNC | H04L41/0803*, H04L41/0816* | ~600 |
| `SDN/MGMT/policy-orchestration` | Policy & Orchestration | PLCY | H04L41/08* (remaining) | ~800 |

---

## v2 Sub-sector Design: network-protocols

### Proposed Sub-sectors

| L3 Code | Name | Abbrev | CPC Patterns | Est. Patents |
|---------|------|--------|--------------|--------------|
| `SDN/PROT/application-layer` | Application Layer Protocols | APPL | H04L67/* | ~2,500 |
| `SDN/PROT/transport-session` | Transport/Session Layer | TRSP | H04L69/* | ~2,000 |
| `SDN/PROT/web-http` | Web & HTTP Protocols | WEBH | H04L67/02* | ~500 |
| `SDN/PROT/streaming` | Streaming Protocols | STRM | H04L65/* | ~400 |

---

## Implementation Plan

### Phase 1: Create v2 TaxonomyType
```sql
INSERT INTO taxonomy_types (id, code, name, description, is_default, level_metadata)
VALUES (
  'tt_patent_v2',
  'patent-classification-v2',
  'Patent Classification v2',
  'Logical sub-sectors with multiple CPC patterns per node',
  false,  -- v1 remains default
  '{
    "levels": [
      {"level": 1, "name": "Super-sector", "prefixLength": 3},
      {"level": 2, "name": "Sector", "prefixLength": 4},
      {"level": 3, "name": "Sub-sector", "prefixLength": 4}
    ],
    "targetClusterSizes": {
      "level1": {"min": 5000, "max": 15000},
      "level2": {"min": 500, "max": 5000},
      "level3": {"min": 50, "max": 500}
    }
  }'
);
```

### Phase 2: Create Pilot Nodes (network-switching)

```
L1: sdn-network (SDN)
L2: SDN/switching (SWIT)
L3: SDN/SWIT/ethernet-lan (ETHL)
    SDN/SWIT/routing (ROUT)
    SDN/SWIT/traffic-qos (TQOS)
    SDN/SWIT/packet-switching (PKSW)
    SDN/SWIT/network-interconnect (INTC)
```

### Phase 3: Create Rules

For each L3 node, create TaxonomyRules:
```typescript
{
  targetNodeId: 'node_SDN_SWIT_routing',
  ruleType: 'CPC_PREFIX',
  expression: 'H04L45/',
  priority: 80,
  isExclusion: false
}
```

### Phase 4: Run Classification

1. Run multi-classification against v2 taxonomy
2. Compare results with v1
3. Analyze coverage and divergence

---

## Success Criteria

1. **Coverage**: v2 classifies same patents as v1 at L2 level
2. **Granularity**: L3 sub-sectors have 50-500 patents each
3. **Divergence**: Patents show meaningful L3 divergence (different sub-sectors)
4. **Naming**: Codes are unique and follow convention

---

## Next Steps

1. [ ] Create script to insert v2 TaxonomyType
2. [ ] Create script to insert pilot nodes (network-switching)
3. [ ] Create rules for pilot sub-sectors
4. [ ] Run pilot classification
5. [ ] Analyze results and iterate

---

*Created: 2026-03-28*
*Status: Design*
