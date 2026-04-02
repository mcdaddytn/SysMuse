# INVENTORY.md — Existing Code Inventory & Migration Map

## Working Component Scripts

### GLPipeClamp11.py → `fusionkit/components/pipe_clamp.py`

**Status**: Working, generates real parts, has been 3D printed successfully.

**What it does**:
- Reads JSON config for rectangular pipe clamp dimensions
- Creates outer rectangular sketch with inner filleted-rectangle or circle cutout
- Extrudes to ObjectDepth
- Drills three types of bolt holes:
  - **Clamp bolts**: Through the front face, perpendicular to pipe axis, with hex nut wells on back face
  - **Inner bolts**: Perpendicular to clamp bolts, through the pipe opening area, with hex nut wells
  - **Outer bolts**: Through top face, 4-bolt pattern at configurable offsets, with countersink
- Carves optional notch for cable/chain routing
- Splits body at xz-plane into screw-side and nut-side
- Exports each half as separate STL

**Key functions to migrate**:
| Original Function | New Location | Notes |
|---|---|---|
| `generateFilletedRectObject()` | `geometry/shapes.py::FilletedRectWithCircleCutout.draw()` | Handles both square/rect edge, circle vs filleted-rect cutout |
| `generateObject()` | `geometry/shapes.py::RectangleWithCircleCutout.draw()` | Simpler: just rect + circle |
| `drillBoltHoles()` | `features/hole_patterns.py::HolePatternDriller.drill_clamp_bolts()` | Clamp bolt pattern with hex nut wells |
| `drillInnerBoltHoles()` | `features/hole_patterns.py::HolePatternDriller.drill_inner_bolts()` | Perpendicular inner bolts |
| `drillOuterBoltHoles()` | `features/hole_patterns.py::HolePatternDriller.drill_outer_bolts()` | Top-down 4-bolt pattern |
| `carveNotch()` | `features/hole_patterns.py::NotchCarver.carve()` | Rectangular notch cut |
| `splitObject()` | `features/split.py::BodySplitter.split_at_plane()` | Split at xz-plane |
| `exportObjects()` | `export/stl_exporter.py::STLExporter.export_bodies()` | Per-body STL export |
| `convertParams()` | `core/param_loader.py::ParamLoader.load()` | Unit conversion + type coercion |
| `dumpState()` | `export/state_dumper.py::StateDumper.dump()` | JSON state snapshot |
| `createText()` | Utility: label faces for debugging | Keep as debug helper |

**JSON configs** (all working):
- `pipeclamp7.json` — Square 78mm, 35mm circle, 26mm deep, basic clamp
- `pipeclamp8.json` — Square 78mm, 35mm circle, 40mm deep, all bolt types
- `pipeclamp9.json` — Rect 74×78, 32mm circle, 4mm ext, offset outer bolts
- `pipeclamp10.json` — Same as 9 (duplicate)
- `pipeclamp11.json` — Square 78mm, 36mm flush circle, notch, all bolts
- `pipeclamp12.json` — Rect 78×58, 26mm circle, 18mm ext, orient wide, simple
- `pipeclamp13.json` — Square 78mm, 50mm circle, 4mm ext, simple
- `pipeclamp14.json` — Rect 78×58, 24mm circle, 15mm ext, orient wide
- `pipeclamp15.json` — Square 78mm, 52mm circle, 7mm ext, simple

---

### LunaWrench7.py → `fusionkit/components/luna_wrench.py`

**Status**: Working, generates real parts.

**What it does**:
- Single-sided wrench: circle rim with radial rectangular spokes
- Double-sided wrench: two wrench heads connected by a handle
- Spokes are drawn as rectangles radiating from center, trimmed at inner circle
- Handle connects tangent to outer circles of both heads
- Outer circle arcs trimmed between handle connection points
- All profiles extruded and combined into single body

**Key functions to migrate**:
| Original Function | New Location | Notes |
|---|---|---|
| `create_fusion_object()` | `components/luna_wrench.py::LunaWrench.build()` | Single-sided wrench |
| `create_double_sided_object()` | `components/luna_wrench.py::DoubleSidedLunaWrench.build()` | Double-sided with handle |
| `create_circle()` | `geometry/shapes.py::CircleShape.draw()` | Simple circle |
| `create_rectangle()` | `geometry/shapes.py::RotatedRectangle.draw()` | Rectangle with angle rotation |
| `delete_outer_rect_line()` | Part of spoke trimming logic | Trim lines outside circle |
| `split_circle_and_delete_inner_arc()` | Handle connection geometry | Break circle, delete inner arc |
| `calculate_handle_connection_points()` | Handle geometry calculation | Tangent points on circle |
| `read_parameters_from_json()` | `core/param_loader.py::ParamLoader.load()` | Merged into generic loader |

**JSON configs**:
- `lunawrench3.json` — Single-sided: R=22, 16 spokes, 5mm height
- `lunawrenchds2.json` — Double-sided: two different heads, 110mm handle

---

### GLHiHatCyl.py → `fusionkit/components/hi_hat_cylinder.py`

**Status**: Working, simple cylindrical part.

**What it does**:
- Creates a cylinder
- Drills hole from top (top_hole_diameter × top_hole_depth)
- Drills hole from bottom (bottom_hole_diameter × remaining depth)

**Migration**: Straightforward, wraps basic extrude + cut operations.

---

## Non-Working Framework Attempt

### DesignBase.py + related files

**Status**: Partially implemented, never fully working. Good ideas for abstraction.

**What to keep**:
- Enum definitions (`SketchEnums.py`) → `core/enums.py` — all enum classes preserved
- Parameter type registry concept (boolParams, floatParams, etc.) → `core/param_loader.py`
- Named points/planes/bodies registries → `core/app_context.py`
- Shape handler pattern (draw dispatch by type) → `geometry/shapes.py`
- Extrude handler pattern (profile selection strategies) → `geometry/profile_selector.py`
- Logging with file + threshold → `core/logger.py`
- Unit conversion with configUnits/fusionUnits → `core/unit_converter.py`

**What to redesign**:
- `DesignBase` tried to be everything (config loader + logger + shape drawer + parameter converter) → split into focused classes
- `SketchBase.drawFromConfiguration()` used `shapes.count` (Python list has no `.count` property — this was a bug) → use `len(shapes)`
- `ComponentBase` referenced circular imports with SketchBase → composition instead
- `DesignContext` mixed Fusion objects with config data → separate AppContext (Fusion state) from ParamLoader (config)
- `DesignContextIterator` was overengineered for point iteration → use simple list comprehensions
- `ExtrudeHandlerBase` had good profile selection strategies but coupled to DesignBase → make standalone

**Files and disposition**:
| File | Disposition |
|---|---|
| `SketchEnums.py` | **Keep** → `core/enums.py` (all enums transfer directly) |
| `DesignBase.py` | **Decompose** → `AppContext`, `ParamLoader`, `UnitConverter`, `FusionLogger` |
| `DesignContext.py` | **Decompose** → `AppContext` (named registries) |
| `DesignStepBase.py` | **Redesign** → `assembly/assembly_step.py` (simpler) |
| `ComponentBase.py` | **Redesign** → `components/component_base.py` (cleaner interface) |
| `SketchBase.py` | **Decompose** → `geometry/sketch_manager.py` + shape handlers |
| `ShapeHandlerBase.py` | **Keep pattern** → `geometry/shapes.py` (dataclass + draw method) |
| `ExtrudeHandlerBase.py` | **Keep pattern** → `geometry/profile_selector.py` + `features/extrude.py` |
| `DesignBaseTest.py` | **Reference only** — shows intended usage pattern |
| `DesignBaseTest2.py` | **Reference only** — shows config-driven workflow |
| `DesignContextIterator.py` | **Drop** — unnecessary abstraction |

---

## Parameter Type Inventory

Across all JSON configs, these parameter types are used:

### Boolean parameters
`SketchOnly`, `OrientWide`

### Integer parameters
`NumClampBolts`, `NumInnerBolts`, `NumOuterBolts`, `numRects`, `numRects2`

### Length parameters (require mm→cm conversion)
`RectEdgeX`, `RectEdgeY`, `SquareEdge`, `ObjectDepth`, `CircleDiameter`, `CircleExt`,
`ScrewDiameter`, `ScrewHeadDiameter`, `ScrewHeadDepth`, `NutWidth`, `NutThickness`,
`InnerBoltLength`, `OuterXOffset`, `OuterYOffset`, `NotchDepth`, `NotchLength`,
`radius`, `rimWidth`, `rectWidth`, `rectLength`, `height`,
`radius2`, `rimWidth2`, `rectWidth2`, `rectLength2`,
`handleLength`, `handleWidth`, `handleFilletRadius`,
`length`, `cylinder_diameter`, `top_hole_diameter`, `bottom_hole_diameter`, `top_hole_depth`

---

## Standard Hardware Used

All existing configs use the same fastener:
- **Bolt**: M4 × various lengths, 4.2mm clearance hole
- **Bolt head**: 7.7mm diameter, 5mm countersink depth
- **Nut**: M4 hex, 9mm across-flats, 4–10mm thickness (varies by config)

This should be extracted into a reusable fastener spec in `configs/fasteners/m4_socket_cap.json`.
