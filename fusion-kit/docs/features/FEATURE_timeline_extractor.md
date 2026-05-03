# FEATURE: Timeline Extractor for Reverse Engineering

## Status: Planned (Phase 4 — Tooling)
## Priority: Medium — enables the iterative forward/reverse engineering loop
## Phase: 4 (Kit Assembly + Tooling)

---

## Problem Statement

FusionKit forward-engineers parts: JSON config → Python build code → Fusion geometry. The Autodesk Fusion 360 Connector for Claude (released as part of Anthropic's Claude for Creative Work) makes the *reverse* direction possible: a designer can converse with Claude inside Fusion to draft or refine geometry directly, producing a live Fusion design that has no corresponding FusionKit spec.

We want to close the loop so that a Connector-modified design can be reverse-engineered back into a FusionKit-compatible JSON spec, with new feature kinds becoming new handlers in the engine. This is the iterative forward/reverse engineering pattern described below.

A `StateDumper` already exists (`fusionkit/export/state_dumper.py`) that captures sketch points and body face/vertex coordinates. That's good for regression-testing geometry, but it does not capture *parametric intent* — the user parameters, sketch dimensions linked to those parameters, and the ordered sequence of feature operations that built the design. Without that, a designer has to guess at the structure when translating a Connector-drafted design into a FusionKit component class.

This feature adds a `TimelineExtractor` peer to `StateDumper` that captures the parametric intent — and additionally produces a best-effort "candidate FusionKit spec" as a starting point for the human-driven translation step.

---

## The Iterative Forward/Reverse Engineering Loop

The extractor exists to support a development pattern, not as an end in itself. The loop:

1. **Forward-engineer the simplest possible spec** in FusionKit. Drop a flat JSON config into `configs/components/<name>/`, instantiate the corresponding `ComponentBase` subclass via `scripts/run_component.py`. Render once and eyeball it.
2. **Open the rendered design with the Fusion 360 Connector** (Claude Desktop, with the Fusion connector enabled and Fusion running). Ask it to add **one** feature — chamfer, fillet, hex pocket, slot, etc. Insist on **named user parameters** (`leading_chamfer`, not auto-generated `d1`/`d2`).
3. **Run `timeline_extractor`** as a Fusion Script. It dumps the post-modification design to JSON.
4. **In Claude Code** (on the dev machine), diff the new extraction against a baseline extraction taken before step 2. Identify the new feature kind, the new user parameters, and the new sketches.
5. **Add the missing capability to FusionKit:** a new feature handler (e.g., `ChamferFeature` analogous to existing `ExtrudeOp` flavors), the new parameter names registered in the relevant `_default_param_types()` classmethod, and the new shape primitive if any.
6. **Add the corresponding parameter to the JSON spec** with a sensible default. Regenerate from FusionKit.
7. **Compare the regenerated FusionKit output against the Connector-modified design.** They should agree visually and via state dump. If not, iterate the handler.
8. **Commit:** new handler + new parameter + design-doc note explaining why.

Each pass adds **one feature kind** to the engine. Multi-feature passes produce noisy diffs and lose the clean signal. After ~10 passes the engine covers the long tail of geometry the Connector might produce, and the reverse-engineering step becomes near-automatic.

The extractor is the back half of step 3–4. Without it, the loop relies on the designer manually inspecting Fusion's UI to figure out what changed — slow, error-prone, and not amenable to diff tooling.

---

## Fusion 360 API: What Can Be Extracted

Four layers of introspection, in decreasing order of how parameter-aware the source design is.

### Layer 1: User Parameters (best case)

`design.userParameters` is iterable; each entry has `.name`, `.expression`, `.value`, `.unit`, `.comment`. When the Connector (or designer) created named parameters following FusionKit conventions, this is a near-direct translation: classify each by unit (`cm`/`mm`/`m`/`in`/`ft` → length, dimensionless → float, integer-valued → int) and dump into the candidate spec.

`design.allParameters` adds the auto-generated `d1`, `d2`, `d3` etc. Usually noise but occasionally hold a value the user forgot to promote.

### Layer 2: Timeline Walk

`design.timeline` is iterable via `.count` and `.item(i)`. Each `TimelineObject` has `.entity`, `.name`, `.isSuppressed`, `.isRolledBack`. Dispatch on `type(entity).__name__` to a per-feature extractor:

| Entity type | Extracted fields |
|---|---|
| `Sketch` | name, profile_count, is_visible, reference plane |
| `ExtrudeFeature` | operation (NewBody/Join/Cut/Intersect/NewComponent), distance (mm), distance expression, taper angle, profile sketch name |
| `HoleFeature` | operation, hole diameter (mm), hole diameter expression, hole depth (mm), hole type |
| `FilletFeature` | edge count, radii (mm) per edge set |
| `ChamferFeature` | edge count |
| `RevolveFeature` | operation, angle (degrees) |
| `CombineFeature` | operation |
| `MoveFeature`, `MirrorFeature` | feature kind only |
| `RectangularPatternFeature` | quantity_one, quantity_two |
| `CircularPatternFeature` | quantity |
| `ConstructionPlane`, `ConstructionAxis`, `SplitBodyFeature` | feature kind only |

A nice trick available but not used in the v1 extractor: `timelineObject.rollTo(True)` rolls the model to that point in history. Could be used in a future v2 to capture intermediate state (bounding boxes, body counts) at every step for "what changed at each step" diff analysis.

### Layer 3: Sketch Dimensions (where intent lives)

For each `Sketch` in `root_comp.sketches`:

- `sketch.sketchDimensions` enumerates every dimension (each is a `SketchDimension` subclass — `SketchLinearDimension`, `SketchRadialDimension`, etc.).
- Each dimension has `.parameter` linking back to a `ModelParameter`. If the parameter has a meaningful name, intent is captured. If it's a `d1`/`d2` auto-name, only the value is captured.
- `sketch.geometricConstraints` enumerates constraints (coincident, parallel, perpendicular, equal, horizontal, vertical, etc.) — captured as a count-by-type dict, useful for inferring relationships when forward-engineering.

### Layer 4: B-rep Measurement (last resort)

For each body in `root_comp.bRepBodies`:

- Bounding box (min/max in mm)
- Face count, edge count, vertex count
- Volume (mm³ via `physicalProperties`)

This is what survives when the timeline is gone (STEP imports, TSpline conversions, direct-modeling edits). Captures shape but not intent — used to detect "design has untracked structure" rather than to drive forward-engineering.

---

## Output JSON Shape

```json
{
    "extractor_version": "0.1.0",
    "extracted_at": "2026-05-04T11:23:45",
    "host": "<machine name>",
    "design_name": "untitled",
    "units": "mm",

    "user_parameters": [
        {"name": "slot_length", "expression": "60 mm", "value": 60.0,
         "value_unit": "mm", "fusion_unit": "cm", "comment": ""},
        ...
    ],

    "auto_parameters": [
        {"name": "d1", "expression": "8 mm", "value": 8.0, ...},
        ...
    ],

    "timeline": [
        {"index": 0, "name": "Sketch1", "type": "Sketch",
         "is_suppressed": false, "is_rolled_back": false,
         "feature_kind": "Sketch", "sketch_name": "Sketch1",
         "profile_count": 1, "is_visible": true},
        {"index": 1, "name": "Extrude1", "type": "ExtrudeFeature",
         "feature_kind": "Extrude", "operation": "NewBody",
         "extent_one_distance_mm": 8.0,
         "extent_one_distance_expression": "plate_thickness",
         "profile_sketch": "Sketch1"},
        ...
    ],

    "sketches": [
        {"name": "Sketch1", "is_visible": true, "profile_count": 1,
         "reference_plane_type": "ConstructionPlane",
         "reference_plane_name": "xy",
         "dimensions": [
            {"type": "SketchLinearDimension", "is_driving": true,
             "parameter_name": "plate_width", "parameter_expression": "70 mm",
             "value_mm": 70.0}
         ],
         "constraint_counts": {"HorizontalConstraint": 2,
                              "VerticalConstraint": 2,
                              "CoincidentConstraint": 4}}
    ],

    "bodies": [
        {"name": "Body1", "is_solid": true,
         "face_count": 6, "edge_count": 12, "vertex_count": 8,
         "bounding_box_mm": {"min": [-35, -30, 0], "max": [35, 30, 8]},
         "volume_mm3": 33600.0}
    ],

    "fusionkit_candidate_spec": {
        "slot_length": 60.0,
        "plate_width": 70.0,
        "plate_thickness": 8.0
    }
}
```

The `fusionkit_candidate_spec` is a flat dict mapping user parameter names directly to mm values. Auto-generated `d1`/`d2` parameters are excluded. This is **not** a finished FusionKit spec — names will likely need to be PascalCased to match conventions, and parameters that have no FusionKit handler will need to be either added or dropped. It's a starting point, not a destination.

---

## Implementation Plan

### Files to create / modify:

| File | Action | Description |
|------|--------|-------------|
| `fusionkit/export/timeline_extractor.py` | **Create** | `TimelineExtractor` class, peer to `StateDumper`. `__init__(ctx: AppContext)`, `extract() -> Dict`, `dump(path: str)`, `dump_to_string() -> str`. |
| `scripts/extract_timeline.py` | **Create** | Fusion 360 Script entry point modeled on `scripts/run_component.py`. Outputs to `~/Documents/dev/fusionkit/extractions/<design_name>_<timestamp>.json`. |
| `tests/test_timeline_extractor.py` | **Create** | Unit tests for `_serialize_parameter`, `_operation_to_string`, `build_candidate_spec` — anything that doesn't require `adsk`. |
| `IMPLEMENTATION_PLAN.md` | Modify | Add new "Tooling" subsection or extend Phase 4 with a Tooling bullet. |
| `ARCHITECTURE.md` | Modify | One-paragraph mention of `TimelineExtractor` in the Export layer section. |
| `CLAUDE_CODE_CONTEXT.md` | Modify | Add iterative loop description to "Current Work" / project orientation section. |

### Class shape:

```python
class TimelineExtractor:
    def __init__(self, ctx: AppContext) -> None:
        self.ctx: AppContext = ctx

    def extract(self) -> typing.Dict[str, typing.Any]:
        """Return the full extraction dict. Does not write to disk."""
        ...

    def dump(self, output_path: str) -> None:
        """Extract and write to a JSON file. Mirrors StateDumper.dump()."""
        ...

    def dump_to_string(self) -> str:
        """Extract and return as JSON string."""
        ...

    # Internal extraction helpers (one per concern)
    def _extract_user_parameters(self) -> typing.List[typing.Dict[str, typing.Any]]: ...
    def _extract_auto_parameters(self) -> typing.List[typing.Dict[str, typing.Any]]: ...
    def _extract_timeline(self) -> typing.List[typing.Dict[str, typing.Any]]: ...
    def _extract_sketches(self) -> typing.List[typing.Dict[str, typing.Any]]: ...
    def _extract_bodies(self) -> typing.List[typing.Dict[str, typing.Any]]: ...
    def _build_candidate_spec(self, payload: typing.Dict) -> typing.Dict[str, typing.Any]: ...

    # Per-feature dispatchers
    def _extract_extrude(self, e: adsk.fusion.ExtrudeFeature) -> typing.Dict: ...
    def _extract_hole(self, h: adsk.fusion.HoleFeature) -> typing.Dict: ...
    # ... etc, one per feature kind in the dispatch table above
```

All length values are in mm at the JSON layer (consistent with FusionKit conventions). Conversion uses the same `UnitConverter` boundary that the rest of the kit uses, but in the cm→mm direction.

### Acceptance criteria:

1. Running the extractor on an empty design produces a valid JSON with empty `user_parameters`, empty `auto_parameters`, empty `timeline`, empty `sketches`, empty `bodies`, and an empty `fusionkit_candidate_spec`.
2. Running on a design with one named user parameter `slot_length = 60 mm` and one extrude using it produces a `user_parameters` entry with `value: 60.0`, a timeline entry of type `ExtrudeFeature` with `feature_kind: "Extrude"` and `extent_one_distance_expression: "slot_length"`, and a `fusionkit_candidate_spec` containing `{"slot_length": 60.0}`.
3. Running on the existing `pipeclamp15` build (already produces correct geometry per the do-not-break list) produces a JSON with the expected feature counts: 1 sketch (cross_section), N hole-related extrudes, 1 split-body, 2 bodies in the bodies array.
4. Output mm values match the JSON config mm values to within floating-point tolerance (1e-9).
5. Auto-generated `d1`/`d2`/... parameters are excluded from `fusionkit_candidate_spec` but appear in `auto_parameters`.

---

## Test Cases (run outside Fusion)

| Input | Function tested | Expected |
|-------|----------------|----------|
| Mock `Parameter` with name `slot_length`, expression `"60 mm"`, value `6.0`, unit `cm` | `_serialize_parameter` | `{name: "slot_length", expression: "60 mm", value: 60.0, value_unit: "mm", fusion_unit: "cm"}` |
| Mock `Parameter` with name `count`, value `4`, unit `""` | `_serialize_parameter` | `value: 4.0`, `value_unit: ""` (no length conversion) |
| `FeatureOperations.NewBodyFeatureOperation` (int) | `_operation_to_string` | `"NewBody"` |
| Unknown operation int | `_operation_to_string` | `"Unknown(<n>)"` |
| Payload with three user params (one named `d1`, two named `width`/`height`) | `_build_candidate_spec` | dict with `width` and `height` only; `d1` excluded |
| Payload with empty user params | `_build_candidate_spec` | `{}` |

In-Fusion tests must be run manually after each change:

| Test | Steps | Expected |
|------|-------|----------|
| Empty design | New design, run extract_timeline | JSON with all empty arrays |
| pipeclamp15 | Run `run_component` for pipeclamp15.json, then run extract_timeline | Matches feature counts above |
| Connector-added chamfer | Run `run_component` for any pipeclamp, ask Connector to add a chamfer with named user parameter, run extract_timeline | Timeline contains a `ChamferFeature` entry; `user_parameters` contains the new named param; candidate spec contains it |

---

## Dependencies

- Phase 1 must be complete (AppContext, UnitConverter, StateDumper exist) — already done per IMPLEMENTATION_PLAN.
- No new third-party dependencies. Standard library only (`json`, `os`, `socket`, `datetime`, `typing`).
- Fusion 360 Connector for Claude installed and working in Claude Desktop is required for steps 2–4 of the iterative loop. Not required to write or run the extractor itself.

---

## Future Extensions

- **v2 — timeline rollback walk:** use `timelineObject.rollTo(True)` to capture state at each timeline step for "what changed at each step" diff analysis. Useful for debugging features that produce wrong intermediate state.
- **Comparison tool:** a sibling script that diffs two extractions and reports added/removed/changed feature kinds, parameter names, and sketches in human-readable form.
- **Two-way translation:** auto-generate a FusionKit Python skeleton from the candidate spec by mapping feature kinds to `ExtrudeOp.new_body`, `HolePatternDriller.drill_clamp_bolts`, etc. Not a goal for v1 — the human review step is where domain knowledge gets injected.
- **Connector prompt library:** a docs/ collection of prompts that work well for getting the Connector to add cleanly-extractable features (the "insist on named user parameters" pattern, the "do symmetric operations on both sides" pattern, etc.).
