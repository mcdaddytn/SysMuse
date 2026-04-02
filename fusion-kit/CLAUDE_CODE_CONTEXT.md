# CLAUDE_CODE_CONTEXT.md — Context for Claude Code Development Sessions

## Project Summary

FusionKit is a Python framework that generates parametric 3D-printable parts through the Fusion 360 API. It reads JSON configs, creates sketches/extrusions/bolt holes, splits bodies, and exports STL files. The system supports component kits (pipe clamps, camera mounts, e-bike parts, PVC scaffolding).

## Critical Fusion 360 API Facts

### Units
- Fusion 360 internal API units are **centimeters**
- All JSON configs use **millimeters**
- Every dimension must be converted: `value_cm = units_mgr.convert(value_mm, 'mm', 'cm')`
- Points: `adsk.core.Point3D.create(x_cm, y_cm, z_cm)` — values in cm

### Sketch → Profile → Extrude Pipeline
1. Create sketch on a plane: `sketches.add(plane)`
2. Draw geometry (circles, rectangles, lines, arcs)
3. Fusion auto-generates `sketch.profiles` from closed regions
4. Select the correct profile (by bounding box, area, containment)
5. Extrude: `extrudes.createInput(profile, FeatureOperations.NewBodyFeatureOperation)`

### Profile Selection Gotcha
When you draw a rectangle with a circle inside, Fusion creates **two profiles**: the ring (rect minus circle) and the inner circle. Profile ordering is not guaranteed. Always select by geometric property (area, bounding box), not by index.

### Hex Nut Wells
Draw a 6-sided polygon on a face sketch, then extrude-cut into the body. The polygon is created via `sketchLines.addEdgePolygon(point1, point2, isRight, 6)` where point1 and point2 define one edge.

### Body Splitting
```python
split_features = root_comp.features.splitBodyFeatures
split_input = split_features.createInput(body, construction_plane, True)
split_features.add(split_input)
```
After splitting, iterate `root_comp.bRepBodies` to find the two halves.

### STL Export
Must hide bodies you don't want exported, then export the component:
```python
export_mgr = design.exportManager
stl_options = export_mgr.createSTLExportOptions(root_comp)
stl_options.filename = file_path
export_mgr.execute(stl_options)
```

### Common Planes
- `root_comp.xYConstructionPlane` — horizontal (floor)
- `root_comp.xZConstructionPlane` — vertical, bisects front/back
- `root_comp.yZConstructionPlane` — vertical, bisects left/right

### XZ Plane Sketch Coordinate Gotcha
When sketching on the XZ plane, the sketch's 2D coordinates map as:
- Sketch X → World X
- Sketch Y → World **-Z** (inverted!)
This affects bolt hole positioning. The existing code uses `z * -1` to compensate.

## Coding Conventions

### Fully Qualified Types
```python
# YES — explicit types everywhere
def drill_hole(
    self,
    root_comp: adsk.fusion.Component,
    sketch: adsk.fusion.Sketch,
    center: adsk.core.Point3D,
    diameter: float,
    depth: float,
) -> adsk.fusion.ExtrudeFeature:

# NO — untyped
def drill_hole(self, root_comp, sketch, center, diameter, depth):
```

### Import Style
```python
import adsk.core
import adsk.fusion
import typing
import dataclasses
import json
import math
```

### Error Handling
```python
try:
    # Fusion API calls
except Exception as e:
    self.ctx.ui.messageBox(f'Error in {self.__class__.__name__}: {str(e)}')
    raise
```

### Naming
- Classes: PascalCase (`PipeClamp`, `HolePatternDriller`)
- Methods: snake_case (`drill_clamp_bolts`, `create_sketch`)
- JSON keys: PascalCase for component params (`RectEdgeX`), camelCase for meta (`configUnits`)
- Constants: UPPER_SNAKE (`DEFAULT_SCREW_DIAMETER`)

## Key Migration Patterns

### From GLPipeClamp11.py to PipeClamp

**Before** (monolithic function):
```python
def runAll():
    # 400 lines: load JSON, convert params, draw sketch, extrude, drill holes, split, export
```

**After** (composed methods):
```python
class PipeClamp(ComponentBase):
    def build(self) -> typing.List[adsk.fusion.BRepBody]:
        sketch: adsk.fusion.Sketch = self._draw_cross_section()
        profile: adsk.fusion.Profile = self._select_outer_profile(sketch)
        body: adsk.fusion.BRepBody = self._extrude_body(profile)
        self._drill_all_holes(body)
        self._carve_notch(body)
        halves: typing.Tuple[adsk.fusion.BRepBody, adsk.fusion.BRepBody] = self._split_body(body)
        return list(halves)
```

### From hardcoded paths to config-driven
**Before**: `homedir = "/Users/" + username + "/"`
**After**: All paths from `base_config.json`, resolved relative to config directory

## What Works Today (Do Not Break)

1. All 9 pipeclamp JSON configs generate correct STLs
2. Both luna wrench configs (single + double sided) generate correct geometry
3. The hi-hat cylinder generates correctly
4. Unit conversion from mm JSON to cm API is correct
5. Hex nut well generation works (addEdgePolygon approach)
6. Body splitting at xz-plane works
7. Per-body STL export with show/hide works

## Known Bugs in Existing Code

1. `SketchBase.py` line: `shapes.count` — Python lists use `len()`, not `.count`
2. `LunaWrench7.py`: `sketchOnly` hardcoded to `True` overriding JSON value
3. `GLPipeClamp11.py`: `generateObject` returns body but `generateFilletedRectObject` returns None (no return statement after extrude)
4. `DesignContext.py`: references `adsk.fusion` types in type hints but doesn't import the module
5. Various unused/dead code paths in the DesignBase framework files

## Current File → New File Mapping

| Existing | New | Status |
|---|---|---|
| `GLPipeClamp11.py` | `fusionkit/components/pipe_clamp.py` | Phase 1 |
| `LunaWrench7.py` | `fusionkit/components/luna_wrench.py` | Phase 2 |
| `GLHiHatCyl.py` | `fusionkit/components/hi_hat_cylinder.py` | Phase 2 |
| `SketchEnums.py` | `fusionkit/core/enums.py` | Phase 1 |
| `DesignBase.py` | Split → `app_context.py`, `param_loader.py`, `unit_converter.py`, `logger.py` | Phase 1 |
| `DesignContext.py` | `fusionkit/core/app_context.py` | Phase 1 |
| `ShapeHandlerBase.py` | `fusionkit/geometry/shapes.py` | Phase 1 |
| `ExtrudeHandlerBase.py` | `fusionkit/features/extrude.py` + `geometry/profile_selector.py` | Phase 1 |
| `SketchBase.py` | `fusionkit/geometry/sketch_manager.py` | Phase 1 |
| `ComponentBase.py` | `fusionkit/components/component_base.py` | Phase 1 |
| `DesignStepBase.py` | `fusionkit/assembly/assembly_step.py` | Phase 4 |
| `DesignContextIterator.py` | Dropped | — |
| `DesignBaseTest.py` | `scripts/run_component.py` | Phase 1 |
| `DesignBaseTest2.py` | Reference only | — |
| `pipeclamp*.json` | `configs/components/pipe_clamp/` | Phase 1 |
| `lunawrench*.json` | `configs/components/luna_wrench/` | Phase 2 |
