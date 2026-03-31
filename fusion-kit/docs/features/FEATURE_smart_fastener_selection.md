# FEATURE: Smart Fastener Selection for Pipe Clamps

## Status: Planned (Phase 3)
## Priority: High — fundamental to the mount concept

---

## Problem Statement

When building a pipe clamp, the bolt+nut fastener pair is constrained by the clamp geometry. The current system (`FastenerPair.create_for_thickness`) only does a naive "pick the shortest standard bolt ≥ minimum length." It doesn't account for:

1. **The bisect plane** — the clamp is split into two halves (screw-side and nut-side). The bolt must pass through both halves and the nut must be captured on the nut-side.
2. **Maximum depth constraint** — the bolt cannot protrude past the outer face of the clamp. The total bolt length (shaft + any protrusion) must fit within the clamp's `ObjectDepth` minus the countersink.
3. **Minimum engagement** — the bolt must extend past the bisect plane far enough to engage the nut. The nut well on the nut-side must be deep enough to capture the nut but shallow enough to leave structural material.
4. **Nut well depth minimization** — deeper nut wells weaken the clamp. We want the shallowest well that still captures the nut fully and allows the bolt to thread in.
5. **McMaster standard lengths** — bolts come in fixed increments (8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50mm for M4). We must select from these, not arbitrary lengths.

---

## Geometry Analysis

Consider a pipe clamp cross-section viewed from the side (Y-axis):

```
                    ┌─────────────────────┐ ← outer face (screw-side)
                    │  countersink well    │
                    │  (screw_head_depth)  │
                    │                     │
  screw-side half   │  ← bolt shaft →    │  half_depth = ObjectDepth / 2
                    │                     │
  ──────────────────┼─────────────────────┼── bisect plane (xz, y=0)
                    │                     │
  nut-side half     │  ← bolt shaft →    │  half_depth = ObjectDepth / 2
                    │                     │
                    │  hex nut well       │
                    │  (nut_thickness)    │
                    └─────────────────────┘ ← outer face (nut-side)
```

### Key dimensions (all in the clamp's Y-axis):

- `half_depth` = `RectEdgeY / 2` (distance from bisect plane to outer face)
- `countersink_depth` = `ScrewHeadDepth` (how deep the bolt head sits below the screw-side face)
- `available_shaft_length` = `RectEdgeY - countersink_depth` (max bolt shaft that fits)
- `nut_engagement_start` = `half_depth` (where the nut-side begins)
- `nut_well_depth` = distance from nut-side outer face inward to the bottom of the hex well
- `nut_well_inner_edge` = `half_depth - nut_well_depth` (measured from bisect plane, how far the well extends toward the pipe)

### Constraints:

1. **Bolt must not protrude**: `bolt_length ≤ available_shaft_length`
2. **Bolt must reach the nut**: `bolt_length ≥ half_depth + nut_thickness` (bolt tip must extend past the nut)
3. **Nut well must be accessible**: the hex well must be reachable from the nut-side outer face
4. **Structural integrity**: `nut_well_inner_edge` must leave enough material between the nut well and the pipe cutout. Minimum wall = some factor of `(half_depth - circle_radius - nut_thickness)`.
5. **Standard length**: `bolt_length ∈ STANDARD_LENGTHS_MM[nominal_size]`

### Selection algorithm:

```
Given:
    rect_edge_y (total clamp depth in Y)
    screw_head_depth (countersink depth)
    nut_thickness (hex nut height)
    circle_diameter (pipe cutout — determines structural minimum)
    nominal_size (e.g., 'M4')
    clearance (thread engagement past nut, default 0.5mm)
    min_wall_thickness (between nut well and pipe cutout, default 2.0mm)

Calculate:
    half_depth = rect_edge_y / 2
    max_bolt_length = rect_edge_y - screw_head_depth
    min_bolt_length = half_depth + nut_thickness + clearance

    # Check feasibility
    if min_bolt_length > max_bolt_length:
        ERROR: clamp too thin for this fastener size

    # Select from standard lengths
    candidates = [L for L in STANDARD_LENGTHS if min_bolt_length ≤ L ≤ max_bolt_length]
    if not candidates:
        ERROR: no standard bolt fits these constraints

    # Pick the shortest that fits (minimizes protrusion and nut well depth)
    selected_length = min(candidates)

    # Calculate nut well depth
    bolt_tip_from_bisect = selected_length - half_depth + screw_head_depth
    # Actually: bolt enters at (half_depth - screw_head_depth) from bisect on screw side
    # bolt tip at: selected_length - (half_depth - screw_head_depth) past bisect on nut side
    bolt_reach_past_bisect = selected_length - (half_depth - screw_head_depth)
    nut_well_depth = bolt_reach_past_bisect  # well must be at least this deep from nut-side face inward
    # But well depth is measured from nut-side outer face:
    nut_well_depth_from_face = half_depth - (bolt_reach_past_bisect - nut_thickness - clearance)
    # Simpler: nut sits at the end of the bolt. Well must position nut so bolt threads engage.
    
    # Practical: nut well starts at nut-side outer face, extends inward.
    # Nut center is at: half_depth - nut_well_depth + nut_thickness/2 from bisect
    # Bolt tip reaches: selected_length - half_depth + screw_head_depth from bisect
    # We need: bolt_tip >= nut_well_bottom + nut_thickness
    
    nut_well_depth = nut_thickness * 1.05  # minimum: just deep enough for nut
    
    # Verify structural integrity
    dist_pipe_to_nut_well = (circle_diameter / 2) - (half_depth - nut_well_depth)
    # Actually this depends on clamp bolt direction (front-to-back vs side-to-side)
    
    # For clamp bolts (front-to-back, through Y-axis):
    # The pipe cutout is centered. The nut well is near the nut-side outer face.
    # Wall between pipe and nut well = half_depth - circle_radius - nut_well_depth_from_pipe_side
    # This is usually fine because nut wells are near the outer face, far from the pipe.

Return:
    FastenerSelection {
        bolt: Bolt(nominal_size, selected_length)
        nut: Nut(nominal_size)
        countersink_depth: screw_head_depth
        nut_well_depth: nut_well_depth
        nut_well_position: half_depth - nut_well_depth  # from nut-side outer face
        structural_wall: computed minimum wall thickness
    }
```

---

## For Inner Bolts (perpendicular to clamp bolts)

Inner bolts go through the side faces (parallel to pipe axis). The geometry is different:

- The bolt passes through material that includes the pipe cutout region
- The nut well must be positioned to avoid the pipe channel
- `InnerBoltLength` in the JSON config controls how far the bolt extends from the edge before the nut engages
- The nut well depth calculation must account for the curved pipe cutout surface

```
    dist_to_solid = circle_radius + (circle_ext / 2 if not orient_wide)
    min_nut_extrude = dist_to_solid + nut_thickness
    if (half_edge_y - dist_to_solid > inner_bolt_length):
        nut_extrude_depth = (half_edge_y - inner_bolt_length) + nut_thickness
```

This existing logic (from GLPipeClamp11.py) should be preserved and integrated into the smart selection.

---

## McMaster Integration

McMaster-Carr provides:
- Standard bolt lengths in fixed increments per nominal size
- 3D CAD models (STEP) for each part number
- The part numbers can be stored in our fastener catalog JSON

Example `m4_socket_cap.json` with McMaster part numbers:

```json
{
    "nominal_size": "M4",
    "type": "socket_cap",
    "clearance_hole_mm": 4.5,
    "head_diameter_mm": 7.0,
    "head_height_mm": 4.0,
    "lengths": {
        "8":  {"mcmaster": "91290A108"},
        "10": {"mcmaster": "91290A110"},
        "12": {"mcmaster": "91290A114"},
        "16": {"mcmaster": "91290A118"},
        "20": {"mcmaster": "91290A120"},
        "25": {"mcmaster": "91290A125"},
        "30": {"mcmaster": "91290A130"},
        "35": {"mcmaster": "91290A135"},
        "40": {"mcmaster": "91290A140"}
    },
    "nut": {
        "across_flats_mm": 7.0,
        "thickness_mm": 3.2,
        "mcmaster": "90592A086"
    }
}
```

Future: import McMaster STEP models into the assembly for visualization.

---

## Implementation Plan

### Files to create/modify:

| File | Action | Description |
|------|--------|-------------|
| `fusionkit/fasteners/clamp_fastener_selector.py` | **Create** | `ClampFastenerSelector` class with the algorithm above |
| `fusionkit/fasteners/bolt.py` | Modify | Add McMaster part number field to `Bolt` dataclass |
| `fusionkit/fasteners/nut.py` | Modify | Add McMaster part number field to `Nut` dataclass |
| `fusionkit/fasteners/fastener_pair.py` | Modify | Add `create_for_clamp()` factory method |
| `fusionkit/components/pipe_clamp.py` | Modify | Use `ClampFastenerSelector` instead of manual spec creation |
| `configs/fasteners/m4_socket_cap.json` | Modify | Add McMaster part numbers and per-length entries |
| `tests/test_clamp_fastener_selector.py` | **Create** | Unit tests for selection algorithm |

### Acceptance criteria:

1. Given any pipe clamp config, the system auto-selects valid M4 bolt+nut pairs
2. If no standard length fits, a clear error message explains the constraint violation
3. Nut well depth is minimized while maintaining structural integrity
4. McMaster part numbers are included in the BOM output
5. All existing pipeclamp configs still build correctly with auto-selected fasteners

---

## Test Cases

| Config | RectEdgeY | Expected bolt | Notes |
|--------|-----------|---------------|-------|
| pipeclamp7 | 78mm | M4×30 or M4×35 | 26mm deep, plenty of room |
| pipeclamp8 | 78mm | M4×35 or M4×40 | 40mm deep |
| pipeclamp12 | 58mm | M4×25 | 13mm deep, narrow |
| pipeclamp15 | 78mm | M4×25 | 13mm deep, wide |

---

## Dependencies

- Phase 1 must be complete (PipeClamp building correctly)
- Bolt/Nut dataclasses already exist with standard catalogs
- No external API calls needed (McMaster data is static, stored in JSON)
