# ARCHITECTURE.md — FusionKit System Architecture

## Design Principles

1. **Fully qualified types everywhere** — every variable, parameter, and return type uses explicit Python type annotations with full module paths where helpful for debugging
2. **JSON-driven** — all part geometry is configurable via JSON; code defines behavior, JSON defines dimensions
3. **Composition over inheritance** — components compose sketches, features, and fasteners rather than deep inheritance chains
4. **Named references** — sketches, bodies, faces, and points are stored by name for cross-referencing between build steps
5. **Unit-safe** — all JSON values are in mm; conversion to Fusion's internal cm happens in one place

---

## Core Layer

### AppContext

Singleton-style wrapper around Fusion 360's application objects. Every other class receives this rather than calling `adsk.core.Application.get()` directly.

```python
class AppContext:
    app: adsk.core.Application
    ui: adsk.core.UserInterface
    design: adsk.fusion.Design
    root_comp: adsk.fusion.Component
    units_mgr: adsk.fusion.FusionUnitsManager

    # Named registries
    named_sketches: typing.Dict[str, adsk.fusion.Sketch]
    named_bodies: typing.Dict[str, adsk.fusion.BRepBody]
    named_faces: typing.Dict[str, adsk.fusion.BRepFace]
    named_points: typing.Dict[str, adsk.core.Point3D]
    named_planes: typing.Dict[str, adsk.fusion.ConstructionPlane]
```

### UnitConverter

```python
class UnitConverter:
    config_units: str  # 'mm' (from JSON)
    api_units: str     # 'cm' (Fusion internal)

    def length(self, value: float) -> float: ...
    def point(self, x: float, y: float, z: float) -> adsk.core.Point3D: ...
    def angle_rad(self, degrees: float) -> float: ...
```

### ParamLoader

Reads JSON config, merges with defaults, dispatches type conversion.

```python
class ParamLoader:
    def load(self, config_path: str, defaults_path: str = None) -> typing.Dict[str, typing.Any]: ...
    def get_float(self, params: dict, key: str) -> float: ...
    def get_int(self, params: dict, key: str) -> int: ...
    def get_bool(self, params: dict, key: str) -> bool: ...
    def get_point(self, params: dict, key: str) -> adsk.core.Point3D: ...
    def get_length(self, params: dict, key: str) -> float: ...  # auto-converts units
```

---

## Geometry Layer

### SketchManager

Creates and tracks sketches on named planes.

```python
class SketchManager:
    def create_sketch(self, name: str, plane_key: str = 'xy') -> adsk.fusion.Sketch: ...
    def get_sketch(self, name: str) -> adsk.fusion.Sketch: ...
    def create_sketch_on_face(self, name: str, face: adsk.fusion.BRepFace) -> adsk.fusion.Sketch: ...
```

### Shape Primitives

Each shape is a dataclass + a `draw()` method that writes to a sketch.

```python
@dataclasses.dataclass
class CircleShape:
    center: adsk.core.Point3D
    radius: float

    def draw(self, sketch: adsk.fusion.Sketch) -> adsk.fusion.SketchCircle: ...

@dataclasses.dataclass
class RectangleShape:
    point_one: adsk.core.Point3D
    point_two: adsk.core.Point3D
    fillet_radius: float = 0.0

    def draw(self, sketch: adsk.fusion.Sketch) -> adsk.fusion.SketchLineList: ...

@dataclasses.dataclass
class FilletedRectWithCircleCutout:
    """The core pipe-clamp cross section: rectangle minus filleted-circle slot."""
    rect_edge_x: float
    rect_edge_y: float
    circle_diameter: float
    circle_ext: float
    orient_wide: bool

    def draw(self, sketch: adsk.fusion.Sketch) -> adsk.fusion.Profile: ...
```

### ProfileSelector

Strategies for picking which sketch profile(s) to extrude.

```python
class ProfileSelector:
    @staticmethod
    def by_bounding_box(sketch: adsk.fusion.Sketch, width: float, height: float) -> adsk.fusion.Profile: ...

    @staticmethod
    def by_area_rank(sketch: adsk.fusion.Sketch, rank: int = 0, ascending: bool = True) -> adsk.fusion.Profile: ...

    @staticmethod
    def by_point_containment(sketch: adsk.fusion.Sketch, points: typing.List[adsk.core.Point3D], mode: str = 'all') -> adsk.core.ObjectCollection: ...

    @staticmethod
    def all_except(sketch: adsk.fusion.Sketch, exclude: typing.List[adsk.fusion.Profile]) -> adsk.core.ObjectCollection: ...
```

---

## Features Layer

### ExtrudeFeature

```python
class ExtrudeOp:
    @staticmethod
    def new_body(profile: adsk.fusion.Profile, distance: float, root_comp: adsk.fusion.Component) -> adsk.fusion.BRepBody: ...

    @staticmethod
    def cut(profile: adsk.fusion.Profile, distance: float, root_comp: adsk.fusion.Component) -> adsk.fusion.ExtrudeFeature: ...
```

### HolePatterns

The critical fastener drilling system.

```python
@dataclasses.dataclass
class BoltHoleSpec:
    """Complete specification for one bolt-through-hole + countersink + nut well."""
    position: adsk.core.Point3D      # center of hole on entry face
    bolt_diameter: float               # e.g., 4.2mm for M4 clearance
    bolt_length: float                 # total bolt length
    head_diameter: float               # countersink diameter
    head_depth: float                  # countersink depth
    nut_width: float                   # hex nut across-flats
    nut_thickness: float               # nut height (depth of hex well)
    through_thickness: float           # total material thickness to drill through
    drill_direction: adsk.core.Vector3D  # which way to drill

class HolePatternDriller:
    def drill_clamp_bolts(self, body: adsk.fusion.BRepBody, specs: typing.List[BoltHoleSpec], ...) -> None: ...
    def drill_through_bolts(self, body: adsk.fusion.BRepBody, specs: typing.List[BoltHoleSpec], ...) -> None: ...
    def carve_hex_nut_well(self, sketch: adsk.fusion.Sketch, center: adsk.core.Point3D, nut_width: float, nut_depth: float) -> None: ...
```

### BodySplitter

```python
class BodySplitter:
    @staticmethod
    def split_at_plane(body: adsk.fusion.BRepBody, plane: str = 'xz', offset: float = 0.0) -> typing.Tuple[adsk.fusion.BRepBody, adsk.fusion.BRepBody]: ...
```

---

## Components Layer

### ComponentBase

Abstract base for all parametric parts.

```python
class ComponentBase(abc.ABC):
    def __init__(self, ctx: AppContext, params: typing.Dict[str, typing.Any]):
        self.ctx: AppContext = ctx
        self.params: typing.Dict[str, typing.Any] = params
        self.bodies: typing.List[adsk.fusion.BRepBody] = []
        self.sketch_manager: SketchManager = SketchManager(ctx)

    @abc.abstractmethod
    def build(self) -> typing.List[adsk.fusion.BRepBody]:
        """Build the component, return created bodies."""
        ...

    def export_stl(self, output_dir: str, base_name: str) -> typing.List[str]:
        """Export each body as separate STL."""
        ...
```

### PipeClamp (migrated from GLPipeClamp11.py)

```python
class PipeClamp(ComponentBase):
    """
    Parametric pipe clamp with:
    - Rectangular or square outer shell
    - Circular or filleted-rect pipe cutout
    - Configurable clamp/inner/outer bolt holes
    - Optional notch for cable/chain routing
    - Auto-split into screw-side and nut-side halves
    """
    def build(self) -> typing.List[adsk.fusion.BRepBody]:
        # 1. Draw cross-section sketch
        # 2. Extrude to ObjectDepth
        # 3. Drill clamp bolt holes (through both halves)
        # 4. Drill inner bolt holes (perpendicular, with nut wells)
        # 5. Drill outer bolt holes (top-down, with countersinks)
        # 6. Carve notch if configured
        # 7. Split body at xz-plane
        # 8. Export halves
        ...
```

### LunaWrench (migrated from LunaWrench7.py)

```python
class LunaWrench(ComponentBase):
    """Single-sided spanner wrench with configurable spokes."""
    ...

class DoubleSidedLunaWrench(ComponentBase):
    """Double-sided wrench with handle connecting two wrench heads."""
    ...
```

---

## Assembly Layer

### KitDefinition (JSON-driven)

```json
{
    "kit_name": "camera_pvc_mount_kit",
    "components": [
        {
            "id": "clamp_base",
            "type": "PipeClamp",
            "config": "configs/components/pipe_clamp/pipeclamp_pvc125.json"
        },
        {
            "id": "top_plate",
            "type": "MountingPlate",
            "config": "configs/components/mounting_plate/camera_plate.json"
        }
    ],
    "assembly_steps": [
        {
            "action": "position",
            "component": "top_plate",
            "on_face": "clamp_base.top",
            "offset": [0, 0, 0]
        },
        {
            "action": "fasten",
            "from": "clamp_base.outer_bolt_1",
            "to": "top_plate.hole_1",
            "fastener": "configs/fasteners/m4x20.json"
        }
    ]
}
```

### KitBuilder

```python
class KitBuilder:
    def __init__(self, ctx: AppContext, kit_config_path: str): ...
    def build_all_components(self) -> typing.Dict[str, ComponentBase]: ...
    def run_assembly(self) -> None: ...
    def export_all(self, output_dir: str) -> typing.List[str]: ...
    def generate_bom(self) -> typing.List[typing.Dict[str, typing.Any]]: ...
```

---

## JSON Config Schema

### Component Config (e.g., pipe_clamp)

```json
{
    "_type": "PipeClamp",
    "_units": "mm",
    "_description": "1.25in PVC pipe clamp with 2 clamp bolts",

    "RectEdgeX": 78,
    "RectEdgeY": 78,
    "ObjectDepth": 26,
    "CircleDiameter": 42.16,
    "CircleExt": 0,
    "OrientWide": false,

    "ScrewDiameter": 4.2,
    "ScrewHeadDiameter": 7.7,
    "ScrewHeadDepth": 5,
    "NutWidth": 9,
    "NutThickness": 4,
    "InnerBoltLength": 17,

    "NumClampBolts": 2,
    "NumInnerBolts": 2,
    "NumOuterBolts": 4,
    "OuterXOffset": 22,
    "OuterYOffset": 16,

    "NotchDepth": 0,
    "NotchLength": 0,

    "SketchOnly": false
}
```

### Global Defaults Config

```json
{
    "configUnits": "mm",
    "fusionUnits": "cm",
    "logFilePath": "/tmp/fusionkit/logs",
    "objectStatePath": "/tmp/fusionkit/state",
    "exportPath": "~/Downloads",

    "defaultFastener": {
        "ScrewDiameter": 4.2,
        "ScrewHeadDiameter": 7.7,
        "ScrewHeadDepth": 5,
        "NutWidth": 9,
        "NutThickness": 4
    },

    "boolParams": ["SketchOnly", "OrientWide"],
    "intParams": ["NumClampBolts", "NumInnerBolts", "NumOuterBolts"],
    "coordinateParams": [
        "RectEdgeX", "RectEdgeY", "ObjectDepth", "CircleDiameter",
        "CircleExt", "ScrewDiameter", "ScrewHeadDiameter", "ScrewHeadDepth",
        "NutWidth", "NutThickness", "InnerBoltLength",
        "OuterXOffset", "OuterYOffset", "NotchDepth", "NotchLength"
    ]
}
```

---

## Data Flow

```
JSON Config Files
       │
       ▼
  ParamLoader ──→ typed dict (units converted)
       │
       ▼
  ComponentBase.build()
       │
       ├─→ SketchManager.create_sketch()
       │        │
       │        ▼
       │   Shape.draw() ──→ adsk.fusion.Sketch
       │
       ├─→ ProfileSelector.select() ──→ adsk.fusion.Profile
       │
       ├─→ ExtrudeOp.new_body() ──→ adsk.fusion.BRepBody
       │
       ├─→ HolePatternDriller.drill_*() ──→ modified body
       │
       ├─→ BodySplitter.split_at_plane() ──→ two halves
       │
       └─→ STLExporter.export() ──→ .stl files
```

---

## Future: Database Migration Path

The JSON config layer maps cleanly to relational tables:

| JSON Concept | Postgres Table |
|---|---|
| Component config | `components` (id, type, params jsonb) |
| Kit definition | `kits` → `kit_components` (m2m) |
| Fastener specs | `fasteners` (standard parts catalog) |
| Assembly steps | `assembly_steps` (ordered, FK to kit) |
| Build results | `build_runs` (timestamps, export paths) |

The Python engine would read from Postgres instead of JSON files, with the TypeScript/Quasar GUI writing configs to the database.
