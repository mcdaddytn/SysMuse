# FusionKit — Parametric CAD Engine for Fusion 360

## Overview

FusionKit is a JSON-driven parametric CAD framework that generates 3D-printable parts and assemblies through the Fusion 360 Python API. It supports configurable component kits (pipe clamps, camera mounts, e-bike parts, PVC scaffolding) with automated bolt/nut hole drilling, body splitting, STL export, and kit assembly.

## Directory Structure

```
fusionkit/
├── README.md
├── ARCHITECTURE.md              # System architecture & class design
├── INVENTORY.md                 # Existing code inventory & migration map
├── IMPLEMENTATION_PLAN.md       # Phased build plan
├── CLAUDE_CODE_CONTEXT.md       # Context file for Claude Code sessions
│
├── fusionkit/                   # Main Python package
│   ├── __init__.py
│   │
│   ├── core/                    # Core framework
│   │   ├── __init__.py
│   │   ├── app_context.py       # AppContext: Fusion 360 app/design/rootComp
│   │   ├── unit_converter.py    # UnitConverter: mm→cm, param type coercion
│   │   ├── param_loader.py      # ParamLoader: JSON → typed dict with defaults
│   │   ├── logger.py            # FusionLogger: file + UI logging
│   │   └── enums.py             # All enums (planes, init methods, etc.)
│   │
│   ├── geometry/                # 2D sketch primitives
│   │   ├── __init__.py
│   │   ├── sketch_manager.py    # SketchManager: create/name/retrieve sketches
│   │   ├── shapes.py            # Circle, Rectangle, Polygon, Ellipse, Arc
│   │   ├── shape_transforms.py  # Rotate, mirror, pattern, fillet
│   │   └── profile_selector.py  # Profile selection strategies
│   │
│   ├── features/                # 3D feature operations
│   │   ├── __init__.py
│   │   ├── extrude.py           # ExtrudeFeature: new body, cut, join
│   │   ├── hole_patterns.py     # BoltHole, NutWell, CountersinkHole, HolePattern
│   │   ├── split.py             # BodySplitter: split along plane
│   │   ├── fillet_chamfer.py    # FilletFeature, ChamferFeature
│   │   ├── combine.py           # BodyCombiner: join/cut/intersect
│   │   └── construction.py      # ConstructionPlane, ConstructionAxis helpers
│   │
│   ├── fasteners/               # Standard hardware
│   │   ├── __init__.py
│   │   ├── bolt.py              # Bolt: metric/imperial, length calc
│   │   ├── nut.py               # Nut: hex well geometry
│   │   ├── fastener_pair.py     # FastenerPair: bolt+nut with clearance calc
│   │   └── mcmaster_catalog.py  # McMaster part lookup (JSON catalog)
│   │
│   ├── components/              # Parametric component library
│   │   ├── __init__.py
│   │   ├── component_base.py    # ComponentBase: abstract parametric part
│   │   ├── pipe_clamp.py        # PipeClamp: cylindrical/rectangular mounts
│   │   ├── luna_wrench.py       # LunaWrench: single & double-sided
│   │   ├── hi_hat_cylinder.py   # HiHatCylinder: simple cylindrical part
│   │   ├── mounting_plate.py    # MountingPlate: flat plate with hole patterns
│   │   ├── l_bracket.py         # LBracket: angle bracket
│   │   ├── camera_mount.py      # CameraMount: adapters for DSLR/GoPro/phone
│   │   └── pipe_adapter.py      # PipeAdapter: elliptical/irregular shapes
│   │
│   ├── assembly/                # Kit assembly & workflow
│   │   ├── __init__.py
│   │   ├── kit_definition.py    # KitDefinition: list of components + relations
│   │   ├── assembly_step.py     # AssemblyStep: position, mate, fasten
│   │   ├── kit_builder.py       # KitBuilder: orchestrates full kit build
│   │   └── bom_generator.py     # BOMGenerator: bill of materials output
│   │
│   ├── export/                  # Output & exchange
│   │   ├── __init__.py
│   │   ├── stl_exporter.py      # STLExporter: per-body STL export
│   │   ├── step_exporter.py     # STEPExporter: full assembly export
│   │   └── state_dumper.py      # StateDumper: JSON state snapshot
│   │
│   └── catalog/                 # Part catalogs & standard libraries
│       ├── __init__.py
│       ├── pvc_catalog.py       # PVC pipe & fitting dims (formufit etc.)
│       ├── pipe_dimensions.py   # Standard pipe OD/ID tables
│       └── camera_specs.py      # Camera/phone mount dimensions
│
├── configs/                     # JSON configuration files
│   ├── defaults/                # Global defaults
│   │   └── base_config.json
│   ├── components/              # Per-component configs
│   │   ├── pipe_clamp/
│   │   │   ├── pipeclamp7.json
│   │   │   ├── pipeclamp8.json
│   │   │   └── ...
│   │   ├── luna_wrench/
│   │   │   ├── lunawrench3.json
│   │   │   └── lunawrenchds2.json
│   │   └── hi_hat_cylinder/
│   │       └── hihatcyl.json
│   ├── fasteners/               # Standard fastener specs
│   │   ├── m4_bolts.json
│   │   └── m4_nuts.json
│   └── kits/                    # Kit assembly configs
│       ├── camera_pvc_mount.json
│       └── ebike_battery_mount.json
│
├── scripts/                     # Entry-point scripts for Fusion 360
│   ├── run_component.py         # Build a single component
│   ├── run_kit.py               # Build a full kit
│   └── run_export.py            # Export bodies to STL/STEP
│
└── tests/                       # Unit tests (run outside Fusion)
    ├── test_param_loader.py
    ├── test_unit_converter.py
    └── test_profile_selector.py
```

## Quick Start

1. Copy `fusionkit/` to your Fusion 360 scripts directory
2. Edit a JSON config in `configs/components/`
3. Run `scripts/run_component.py` from Fusion 360's script manager
4. The part generates with all configured features

## Key Concepts

- **ComponentBase**: Every part inherits from this. Override `_build_sketches()` and `_build_features()`.
- **ParamLoader**: Reads JSON, merges with defaults, converts units, coerces types.
- **FastenerPair**: Calculates bolt length, countersink depth, hex nut well dimensions from material thickness.
- **KitBuilder**: Reads a kit JSON, instantiates components, positions them, runs assembly steps.
