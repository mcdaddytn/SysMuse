# FusionKit — Parametric CAD Engine for Fusion 360

## What This Is
A Python framework that generates 3D-printable parts and assemblies through the Fusion 360 API. JSON configs define part dimensions; Python code defines geometry and build logic. Supports pipe clamps, camera mounts, e-bike parts, PVC scaffolding kits.

## Critical Fusion 360 API Facts

- **Internal units are centimeters.** All JSON is millimeters. Convert via `UnitConverter.length()` or `ParamLoader`.
- **Sketch → Profile → Extrude pipeline**: draw geometry on a sketch, Fusion auto-generates profiles (closed regions), select the right profile, extrude it.
- **Profile selection is not by index** — profile ordering is nondeterministic. Always select by bounding box, area, or point containment.
- **XZ plane sketch coordinates**: sketch Y maps to world **-Z** (inverted). Existing code uses `z * -1`.
- **Hex nut wells**: `sketchLines.addEdgePolygon(point1, point2, True, 6)` on a face sketch, then extrude-cut.
- **STL export**: hide all bodies except target, export component, restore visibility.

## Coding Conventions

1. **Fully qualified Python types on every variable, parameter, and return value.** This is non-negotiable — it makes Fusion API debugging vastly easier.
2. Import style: `import adsk.core`, `import adsk.fusion`, `import typing`, `import dataclasses`
3. Classes: PascalCase. Methods: snake_case. JSON keys: PascalCase for component params.
4. New components must be registered in `fusionkit/components/__init__.py` COMPONENT_REGISTRY.
5. New features get a spec file in `docs/features/FEATURE_<name>.md`.

## Project Structure
See `ARCHITECTURE.md` for class design and `docs/DIRECTORY_STRUCTURE.md` for complete file layout.

## Testing
```bash
python -m unittest discover -s tests -v
```
All tests must pass. Tests run outside Fusion 360 (no `adsk` dependency). Integration testing happens inside Fusion via `scripts/run_component.py`.

## Current Work
See `docs/features/` for active feature specs and `IMPLEMENTATION_PLAN.md` for the phase checklist.

## Do Not Break
1. All 9 pipeclamp JSON configs must produce correct geometry
2. Both luna wrench configs (single + double sided) must work
3. Unit conversion mm→cm is correct throughout
4. Hex nut well generation (addEdgePolygon approach)
5. Body splitting at xz-plane
6. Per-body STL export with show/hide

## Files in `legacy/` are read-only reference — never modify them.
