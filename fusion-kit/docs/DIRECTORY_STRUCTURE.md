# DIRECTORY_STRUCTURE.md — Complete Claude Code Project Layout

## Full File Tree

```
fusionkit/                              ← Claude Code project root
│
├── .claude/                            ← Claude Code settings (auto-generated)
│   └── settings.json
│
├── CLAUDE.md                           ← PRIMARY Claude Code context file
│                                         (copy contents of CLAUDE_CODE_CONTEXT.md here)
│
├── README.md                           ← Project overview, quick start
├── ARCHITECTURE.md                     ← System design, class interfaces, data flow
├── INVENTORY.md                        ← Old code → new code migration map
├── IMPLEMENTATION_PLAN.md              ← Phased build plan with checkboxes
├── CLAUDE_CODE_CONTEXT.md              ← Fusion 360 API facts, conventions
│
├── docs/                               ← Documentation
│   ├── FEATURE_PROCESS.md              ← How to add features, what context to update
│   └── features/                       ← Feature enhancement specs
│       ├── FEATURE_smart_fastener_selection.md
│       └── (future feature specs)
│
├── fusionkit/                          ← Main Python package
│   ├── __init__.py                     ← Package marker
│   │
│   ├── core/                           ← Core framework (no Fusion geometry)
│   │   ├── __init__.py
│   │   ├── app_context.py              ← AppContext: wraps Fusion app/design/rootComp
│   │   │                                 + named registries (sketches, bodies, faces, points, planes)
│   │   ├── unit_converter.py           ← UnitConverter: mm→cm, point/vector creation
│   │   ├── param_loader.py             ← ParamLoader: JSON→typed dict, defaults merge, type coercion
│   │   ├── logger.py                   ← FusionLogger: file logging + optional UI messageBox
│   │   └── enums.py                    ← All enums: PlaneAxis, LogLevel, FeatureOperation,
│   │                                     CircleInitMethod, DrillDirection, etc.
│   │
│   ├── geometry/                       ← 2D sketch primitives and selection
│   │   ├── __init__.py
│   │   ├── sketch_manager.py           ← SketchManager: create/name sketches on planes/faces
│   │   ├── shapes.py                   ← CircleShape, RectangleShape, RotatedRectangle,
│   │   │                                 RectWithCircleCutout, FilletedRectWithCircleCutout,
│   │   │                                 HexagonShape (all as dataclass + draw() method)
│   │   ├── shape_transforms.py         ← rotate_point, midpoint, distance, radial_positions,
│   │   │                                 rectangular_pattern, get_face_by_direction
│   │   └── profile_selector.py         ← ProfileSelector: by_bounding_box, by_area_rank,
│   │                                     by_centroid, by_point_containment, all_except
│   │
│   ├── features/                       ← 3D feature operations
│   │   ├── __init__.py
│   │   ├── extrude.py                  ← ExtrudeOp: new_body, new_body_from_collection, cut
│   │   ├── hole_patterns.py            ← BoltHoleSpec dataclass,
│   │   │                                 HolePatternDriller: drill_clamp_bolts, drill_inner_bolts,
│   │   │                                   drill_outer_bolts (with countersink + hex nut wells),
│   │   │                                 NotchCarver: carve rectangular notches
│   │   ├── split.py                    ← BodySplitter: split_at_plane (xy/xz/yz with offset)
│   │   └── combine.py                 ← BodyCombiner: join multiple bodies into one
│   │
│   ├── fasteners/                      ← Standard hardware
│   │   ├── __init__.py
│   │   ├── bolt.py                     ← Bolt dataclass, METRIC_SOCKET_CAP_HEADS table,
│   │   │                                 STANDARD_LENGTHS_MM, from_standard(), select_length()
│   │   ├── nut.py                      ← Nut dataclass, METRIC_HEX_NUTS table, METRIC_NYLOC_NUTS,
│   │   │                                 from_standard(), well geometry properties
│   │   ├── fastener_pair.py            ← FastenerPair: bolt+nut, required_bolt_length_mm,
│   │   │                                 create_for_thickness(), to_bolt_hole_spec(), summary()
│   │   └── clamp_fastener_selector.py  ← (Phase 3) ClampFastenerSelector: geometry-aware selection
│   │
│   ├── components/                     ← Parametric component library
│   │   ├── __init__.py                 ← COMPONENT_REGISTRY dict + get_component_class()
│   │   ├── component_base.py           ← ComponentBase ABC: build(), from_json(), export_stl(),
│   │   │                                 _default_param_types(), get_float/int/bool helpers
│   │   ├── pipe_clamp.py              ← PipeClamp: full pipe clamp with all bolt types,
│   │   │                                 notch, split, export (migrated from GLPipeClamp11.py)
│   │   ├── luna_wrench.py             ← LunaWrench (single-sided) + DoubleSidedLunaWrench
│   │   │                                 (migrated from LunaWrench7.py)
│   │   ├── hi_hat_cylinder.py         ← HiHatCylinder (migrated from GLHiHatCyl.py)
│   │   ├── mounting_plate.py          ← MountingPlate: flat plate with configurable hole pattern
│   │   ├── l_bracket.py               ← (Phase 3) LBracket
│   │   ├── camera_mount.py            ← (Phase 3) CameraMount adapters
│   │   └── pipe_adapter.py            ← (Phase 5) PipeAdapter for irregular shapes
│   │
│   ├── assembly/                       ← Kit assembly and workflow
│   │   ├── __init__.py
│   │   ├── kit_builder.py             ← KitBuilder: build_all_components(), run_assembly() [stub],
│   │   │                                 export_all(), generate_bom()
│   │   ├── assembly_step.py           ← (Phase 4) AssemblyStep: position, mate, fasten
│   │   └── bom_generator.py           ← (Phase 4) BOMGenerator with McMaster part numbers
│   │
│   ├── export/                         ← Output and exchange
│   │   ├── __init__.py
│   │   ├── stl_exporter.py            ← STLExporter: per-body STL with show/hide technique
│   │   ├── step_exporter.py           ← (Phase 4) STEP assembly export
│   │   └── state_dumper.py            ← StateDumper: JSON snapshot of sketches/bodies/faces
│   │
│   └── catalog/                        ← Part catalogs and standard libraries
│       ├── __init__.py
│       ├── pipe_dimensions.py          ← PVC_SCHEDULE_40, FORMUFIT_PVC, BICYCLE_TUBES,
│       │                                 IRON_RECTANGULAR, get_pvc_od(), suggest_clamp_diameter()
│       ├── pvc_catalog.py             ← (Phase 6) Formufit fitting dimensions
│       └── camera_specs.py            ← (Phase 3) Camera/phone mount dimensions
│
├── configs/                            ← JSON configuration files
│   ├── defaults/
│   │   └── base_config.json           ← Global defaults: units, param type lists, default fastener
│   │
│   ├── components/
│   │   ├── pipe_clamp/
│   │   │   ├── pipeclamp7.json        ← Square 78, circle 35, 26mm deep
│   │   │   ├── pipeclamp8.json        ← Square 78, circle 35, 40mm deep, all bolt types
│   │   │   ├── pipeclamp9.json        ← Rect 74×78, circle 32, ext 4, offset outer bolts
│   │   │   ├── pipeclamp10.json       ← Same as 9
│   │   │   ├── pipeclamp11.json       ← Square 78, circle 36, notch, all bolts
│   │   │   ├── pipeclamp12.json       ← Rect 78×58, circle 26, ext 18, orient wide
│   │   │   ├── pipeclamp13.json       ← Square 78, circle 50, ext 4
│   │   │   ├── pipeclamp14.json       ← Rect 78×58, circle 24, ext 15, orient wide
│   │   │   └── pipeclamp15.json       ← Square 78, circle 52, ext 7
│   │   │
│   │   ├── luna_wrench/
│   │   │   ├── lunawrench3.json       ← Single-sided: R=22, 16 spokes
│   │   │   └── lunawrenchds2.json     ← Double-sided: two heads, 110mm handle
│   │   │
│   │   └── hi_hat_cylinder/
│   │       └── hihatcyl.json          ← (create from GLHiHatCyl.py defaults)
│   │
│   ├── fasteners/
│   │   ├── m4_socket_cap.json         ← M4 bolt+nut with McMaster part numbers
│   │   └── (m3, m5, m6 specs)
│   │
│   └── kits/
│       ├── camera_pvc_mount.json      ← Camera-on-PVC kit definition
│       └── (future kit definitions)
│
├── scripts/                            ← Fusion 360 entry-point scripts
│   ├── run_component.py               ← Build single component from JSON
│   └── run_kit.py                     ← Build full kit from JSON
│
├── tests/                              ← Unit tests (run outside Fusion 360)
│   ├── test_param_loader.py           ← ParamLoader: type coercion, defaults, JSON parsing
│   └── test_fasteners.py             ← Bolt/Nut/FastenerPair: catalog, length selection, geometry
│
└── legacy/                             ← Original code (read-only reference)
    ├── GLPipeClamp11.py               ← Original pipe clamp script
    ├── LunaWrench7.py                 ← Original luna wrench script
    ├── GLHiHatCyl.py                  ← Original hi-hat cylinder script
    ├── DesignBase.py                  ← Original framework attempt
    ├── SketchBase.py
    ├── ShapeHandlerBase.py
    ├── ExtrudeHandlerBase.py
    ├── ComponentBase.py
    ├── DesignContext.py
    ├── DesignContextIterator.py
    ├── DesignStepBase.py
    ├── DesignBaseTest.py
    ├── DesignBaseTest2.py
    └── SketchEnums.py
```

## Claude Code Setup

### CLAUDE.md (project instructions file)

Claude Code looks for a `CLAUDE.md` file at the project root. Copy the contents of `CLAUDE_CODE_CONTEXT.md` into this file, then append:

```markdown
## Project Structure
See ARCHITECTURE.md for class design and DIRECTORY_STRUCTURE.md for file layout.

## Current Work
See docs/features/ for active feature specs.

## Testing
Run: python -m unittest discover -s tests -v
All tests must pass before committing.

## Key Rules
1. Fully qualified Python types on every variable, parameter, return
2. All dimensions in JSON are mm; conversion happens in ParamLoader/UnitConverter
3. Do not modify files in legacy/ — they are read-only reference
4. New components must be registered in fusionkit/components/__init__.py
5. New features get a spec file in docs/features/
```

### What to load as context per task type:

| Task | Load these files |
|------|-----------------|
| Building a new component | `CLAUDE.md`, `ARCHITECTURE.md`, `component_base.py`, an existing component for reference |
| Adding fastener features | `CLAUDE.md`, `docs/features/FEATURE_smart_fastener_selection.md`, `fasteners/*.py`, `tests/test_fasteners.py` |
| Fixing a pipe clamp issue | `CLAUDE.md`, `pipe_clamp.py`, `hole_patterns.py`, relevant pipeclamp JSON |
| Planning / prioritizing | `IMPLEMENTATION_PLAN.md`, `docs/FEATURE_PROCESS.md` |
| Migrating old code | `INVENTORY.md`, the specific legacy file, the target new file |
