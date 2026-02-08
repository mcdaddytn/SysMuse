# Session Context - February 8, 2026 (Updated)

## Current Jobs Running

| Sector | Progress | Status |
|--------|----------|--------|
| recognition-biometrics | ~72% | IMAGING - almost complete |
| image-processing | ~29% | IMAGING - in progress |
| video-server-cdn | 1% | Rescore (duplicate job) |

## Completed Scoring

| Super-Sector | Sectors | Patents | With Claims |
|--------------|---------|---------|-------------|
| VIDEO_STREAMING | 7 | 1,857 | 100% |
| AI_ML | 1 | 69 | 100% |

## Super-Sector Analysis Status

| Super-Sector | Total Patents | Analyzed | Templates Created |
|--------------|---------------|----------|-------------------|
| COMPUTING | 7,929 | Yes | 6 sectors + 2 sub-sectors |
| IMAGING | 584 | Yes | 5 sectors |
| AI_ML | 69 | Yes | Super-sector only |
| NETWORKING | 6,200 | Not yet | - |
| SEMICONDUCTOR | 4,238 | Not yet | - |
| SECURITY | 4,382 | Previous scores (no claims) | Some sector templates |
| WIRELESS | 4,104 | Previous scores (no claims) | Some sector templates |

## New Templates Created This Session

### COMPUTING Sector Templates (`config/scoring-templates/sectors/`)
- `computing-runtime.json` - VMs, scheduling, error detection (3,868 patents)
- `computing-systems.json` - Memory, interconnect, hardware (1,784 patents)
- `data-retrieval.json` - Database, search, indexing (1,055 patents)
- `computing-ui.json` - Displays, I/O, gaming (862 patents)
- `power-management.json` - Power supply, charging (217 patents)
- `fintech-business.json` - Payments, workflow (143 patents)

### Sub-Sector Templates (`config/scoring-templates/sub-sectors/`)
- `virtualization.json` - G06F9/45* (~300 patents) - VMs, hypervisors, containers
- `error-detection.json` - G06F11* (~4,640 patents) - ECC, RAID, fault tolerance

### IMAGING Sector Templates (`config/scoring-templates/sectors/`)
- `optics.json` - Lenses, waveguides, AR/VR (355 patents)
- `3d-stereo-depth.json` - ToF, structured light, LiDAR (78 patents)
- `cameras-sensors.json` - CMOS/CCD, camera modules (70 patents)
- `image-processing.json` - Computational photography, ISP (56 patents)
- `recognition-biometrics.json` - Face/fingerprint recognition (25 patents)

## 3-Level Question Inheritance Model

```
portfolio-default (7 base questions)
    └── super-sector template (+3-4 questions)
        └── sector template (+3-5 questions)
            └── sub-sector template (+3-4 questions by CPC pattern)
```

Example for virtualization patents:
- portfolio-default: technical_novelty, claim_breadth, design_around, market_relevance, implementation_clarity, standards_relevance, unique_value
- + computing: performance_impact, resource_efficiency, virtualization_relevance
- + computing-runtime: execution_layer, cloud_infrastructure, multi_tenancy, reliability_recovery
- + virtualization: vm_hypervisor_scope, live_migration, container_relevance, cloud_vendor_impact
- **Total: ~18 questions** with increasing technology specificity

## COMPUTING Sector Analysis

### computing-runtime (3,868 patents) CPC Breakdown:
| Technology Area | CPC Pattern | Patents |
|-----------------|-------------|---------|
| Error Detection | G06F11* | 4,640 |
| I/O Systems | G06F3* | 1,493 |
| Indexes | G06F2* | 983 |
| Process Scheduling | G06F9/50* | 729 |
| Program Development | G06F8* | 732 |
| Software Arrangement | G06F9/44* | 431 |
| **VM/Virtualization** | **G06F9/45*** | **300** |
| Program Control | G06F9/48* | 284 |

Key insight: Virtualization is only ~8% of computing-runtime, but very high value due to cloud infrastructure applicability.

## Claims XML Status

- Drive online at `/Volumes/PortFat4/uspto/bulkdata/export/`
- 7,883 new XMLs copied from exports_new
- ~26,000 total XMLs available with claims

## Next Steps

1. **Complete IMAGING scoring** (~584 patents remaining)
2. **Start SEMICONDUCTOR sector** - 4,238 patents, create sector templates
3. **Start NETWORKING sector** - 6,200 patents, analyze hierarchy
4. **Overnight batch: COMPUTING** - 7,929 patents, largest sector
5. **Eventually rescore SECURITY/WIRELESS with claims** - 8,486 patents

## Commands Reference

```bash
# Check current progress
tail -20 /tmp/api-server.log

# Start remaining IMAGING sectors
curl -X POST "http://localhost:3001/api/scoring-templates/llm/score-sector/cameras-sensors?useClaims=true"
curl -X POST "http://localhost:3001/api/scoring-templates/llm/score-sector/3d-stereo-depth?useClaims=true"
curl -X POST "http://localhost:3001/api/scoring-templates/llm/score-sector/optics?useClaims=true"

# Start COMPUTING sectors
curl -X POST "http://localhost:3001/api/scoring-templates/llm/score-sector/computing-runtime?useClaims=true"
curl -X POST "http://localhost:3001/api/scoring-templates/llm/score-sector/computing-systems?useClaims=true"

# Check scoring totals
docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio -c "
SELECT template_config_id, COUNT(*), SUM(CASE WHEN with_claims THEN 1 ELSE 0 END) as with_claims
FROM patent_sub_sector_scores
WHERE template_config_id IS NOT NULL
GROUP BY template_config_id ORDER BY template_config_id;"
```

## Rate Estimates

- **Current throughput:** ~15 patents/min (3 parallel sectors @ concurrency=4)
- **IMAGING (584):** ~40 minutes
- **COMPUTING (7,929):** ~9 hours
- **All remaining (~19,000):** ~21 hours
