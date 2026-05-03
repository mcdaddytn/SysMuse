# FEATURE: Sliding Camera Bracket on PVC

## Status: Planned (Phase 3)
## Priority: High — first new component family after Phase 3 catalog work
## Phase: 3 (peer to MountingPlate, planned LBracket and CameraMount)

---

## Problem Statement

We need an overhead camera mount for a SmallRig cage on furniture-grade PVC scaffolding. The initial use case is filming a piano keyboard from overhead: the PVC runs parallel to the keys, the camera hangs below it, and the framing must be adjustable in both the along-PVC direction (to center over the keyboard) and the orthogonal direction (to frame hands, instrument, performer or to keep the performer out of frame).

Existing FusionKit parts cover only *part* of the problem: `PipeClamp` clamps onto PVC, `MountingPlate` provides a flat surface with a hole pattern. Neither provides the **two independent axes of adjustment** that this use case needs:

1. **Coarse axis (X, along the PVC).** Loosen the pipe-clamp bolts, slide the entire assembly along the PVC, retighten. Used for rough positioning over the instrument.
2. **Fine axis (Y, orthogonal).** Loosen the carriage's slot bolt, slide the carriage along an integrated rail, retighten. Used for fine framing.

Two new components — **`SliderRail`** (clamp body + integral rail plate with travel slot) and **`SliderCarriage`** (cage-mountable plate that rides the slot) — together with three supporting additions (a `SlotShape` primitive, a `FastenerStyle` enum, and captured-nut-with-cap support in `HolePatternDriller`) deliver this.

---

## Use-Case Detail

### Setup

- Furniture-grade PVC pipe (default: 1" Schedule 40, 33.4 mm OD; configurable)
- Single `SliderRail` clamped to the PVC
- `SliderCarriage` bolted onto the rail through the travel slot
- SmallRig cage bolted to the top of the carriage via the cage's standard mount-hole pattern
- DSLR (or other camera) in the cage

### Adjustment workflow

| Goal | Action |
|------|--------|
| Center over keyboard | Loosen 2 clamp bolts, slide assembly along PVC, retighten |
| Frame hands vs. performer | Loosen carriage slot bolt, slide carriage along rail, retighten |
| Lock final position | Tighten lock screw on carriage (optional; provides metal-on-printed engagement that doesn't rely on slot-bolt friction alone) |
| Reposition for different shoot | Same loosen/slide/tighten cycle |

Both adjustment axes use the **captured-nut-with-glued-cap** fastener pattern (rationale below) so the user can do single-handed hex-key adjustment without losing the nut or accidentally rotating the clamp.

---

## Design Decisions Captured

### Decision 1: Single longer pipe clamp, not a pair

The original framing was "pair of pipe clamps with a rail bridging them." Revised to **one ~100 mm long clamp body with two bolts** because:

- Eliminates one source of misalignment between two independently-positioned clamps.
- Keeps the assembly square on the PVC during slide-loosen-retighten cycles.
- Easier to operate one-handed.
- The rail plate is integral with the top of the clamp body, not a separate bolted-on part — removing a fastener interface and a tolerance stack.

If field experience shows that users want to swap rails without reprinting the clamp body, split into separate parts in v0.2 and bolt them together with a third fastener pair.

### Decision 2: Captured-nut-with-glued-cap as the preferred fastener

For bolts that get repeatedly loosened and retightened in the field (clamp bolts, slider slot bolt, anything the user adjusts), the preferred fastener variant is **captured nut with glued cap**:

- Hex pocket in the printed part captures the metal nut at the right depth, sized for the nut's width across flats with minimal clearance.
- Slightly oversized hex *cap* — a small hex piece printed separately — is glued into the outer face of the pocket after the nut is inserted.
- Result: hex-key turn on the bolt loosens it without spinning the nut (because metal threads engage metal nut), and the nut cannot fall out under handling, storage, or transport.

This is a step beyond the existing `BoltHoleSpec` pattern (which only carves a hex well — relies on assembly orientation to keep the nut in). The cap is a small additional print and a 30-second glue step at assembly time.

The kit will support four fastener style variants exposed via a new `FastenerStyle` enum; see "Fastener Style Enum" below.

### Decision 3: Fastener selection happens before geometry

For new components, fastener selection happens *before* generating any geometry. Pick the bolt/nut/insert from the McMaster catalog (constrained by available standard lengths, functional needs around cycling, and accessibility for the hex key in the assembled configuration), then generate the geometry to fit.

This is the same principle the existing `ClampFastenerSelector` enforces for pipe clamps — the McMaster discrete length grid is a hard constraint, so fitting geometry to the fastener is much easier than the reverse. JSON specs for slider components include the chosen `ScrewDiameter`, `NutWidth`, `FastenerStyle` etc. as inputs, not derived outputs.

---

## Geometry / Domain Analysis

### Assembly cross-section (viewed along PVC axis, X-axis pointing into page)

```
                       ┌─────────────────────────┐
                       │    SmallRig Cage         │
                       │    (1/4-20 mount holes)  │
                       └───┬───────────────┬─────┘
                           │ M5 cage bolts │
                       ┌───┴───────────────┴─────┐
                       │  SliderCarriage          │ ← slides along Y (orthogonal to PVC)
                       │  (PlateLength × Width)   │
                       │      ╔═══════╗           │
                       │      ║captured║           │ ← slot bolt + nut
                       │      ║  nut   ║           │   in glued-cap well
                       │      ╚═══════╝           │
                       └────────┬────────────────┘
                                │ M6 slot bolt
                       ┌────────┼────────────────┐
                       │  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒    │ ← Rail plate (top of clamp)
                       │      slot ▒▒▒▒          │
                       │  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒    │
                       ├──────────────────────────┤
                       │                          │
                       │   ╭────────────╮         │ ← Clamp body (PipeClamp-like)
                       │   │            │         │
                       │   │   PVC OD   │         │
                       │   │            │         │
                       │   ╰────────────╯         │
                       │                          │
                       └──────────────────────────┘
                                ▲
                                │ 2 × clamp bolts (M5, captured-nut-with-cap)
                       Bolts run perpendicular to PVC axis
```

### Axes

- **X (along PVC):** clamp slides along this axis when clamp bolts are loosened
- **Y (orthogonal to PVC, horizontal):** carriage slides along this axis along the slot
- **Z (vertical):** down toward the camera; gravity direction in the overhead use case

### SliderRail geometry

The rail is functionally a `PipeClamp` with the top surface extended upward into a flat plate that has a travel slot cut into it. Conceptually:

1. Cross-section at the bottom = PipeClamp's cross-section (rectangle with circular pipe cutout).
2. Above that, the cross-section continues upward as a wider rectangular rail plate.
3. The slot is a `SlotShape` (rounded-end rectangle) cut through the rail plate, oriented along Y.
4. The two clamp bolts run through the front face perpendicular to the PVC axis (same as PipeClamp).
5. The body is split at the xz-plane into `ScrewSide` and `NutSide` halves (same as PipeClamp).

The rail plate is *not* a separate body bolted on top. It's part of the same cross-section sketch and the same extrude. This means the rail's structural attachment to the clamp is monolithic — no shear interface between rail and clamp.

### SliderCarriage geometry

The carriage is a flat plate (similar to `MountingPlate`) with:

- Cage-mount hole pattern on the top face (default: pair of 1/4"-20 clearance holes spaced 38 mm apart)
- Slot-bolt clearance hole on the bottom face, with a captured-nut hex well facing down (the nut hangs below the carriage and rides in the slot)
- Optional lock-screw threaded insert on the side face

The carriage's bottom face must clear the rail's top face when the slot-bolt nut is in the slot.

### Slot dimensions

```
Slot length = 60 mm  (default; configurable)
Slot width  = SlotBoltDiameter + SlotBoltClearance
            = 6.0 + 0.5 = 6.5 mm  (for M6 bolt with 0.5 mm clearance)
Slot end style = Rounded (semicircular ends)
```

The slot length is the carriage's travel range. The carriage's plate length must be greater than the slot length plus enough margin for the captured-nut well (typically 15–20 mm extra so the nut isn't visible when the carriage is at slot end).

### Bisect plane and fastener constraints

Same as existing pipe clamps:

- Body splits at xz-plane (y = 0)
- Clamp bolts run through the front face perpendicular to PVC axis
- Captured nut wells are in the nut-side half, accessed from the back face
- Bolt length must satisfy the bisect-plane constraint already enforced by `ClampFastenerSelector`

The slot bolt is a different geometry: it runs vertically (Z axis), entering the carriage from below, through the slot in the rail plate, with the captured nut in the carriage's bottom face. The "bisect" for the slot bolt is irrelevant because the carriage is one piece, not split.

---

## New Primitive: SlotShape

Slots — rectangles with semicircular ends — are not in the current `geometry/shapes.py` library. We need one for the rail's travel slot, and we'll use it again for any future component with a travel slot or adjustable mounting.

```python
@dataclasses.dataclass
class SlotShape:
    """
    A rounded-end slot: rectangle with two semicircular ends.

    The slot is centered on the origin by default. The long axis is X
    (overall length is `length`); the short axis is Y (overall width is `width`).
    """
    center: adsk.core.Point3D       # center of the slot
    length: float                    # total length end-to-end (mm at JSON layer; cm internally)
    width: float                     # total width / diameter of end semicircles
    long_axis_angle_rad: float = 0.0 # rotation in the sketch plane

    def draw(self, sketch: adsk.fusion.Sketch) -> typing.List[adsk.fusion.SketchEntity]:
        """
        Draw the slot on the sketch. Returns the created sketch entities
        (two lines + two arcs) so the caller can find the resulting profile.

        Implementation: two parallel lines of length (length - width),
        connected by two semicircular arcs of radius (width / 2).
        """
        ...
```

Profile selection for the slot uses `ProfileSelector.by_bounding_box` with the slot's overall length × width. For the slot *cut* (vs. the slot *body*), the profile is the slot's interior region.

---

## New Enum: FastenerStyle

```python
class FastenerStyle(enum.Enum):
    """
    Defines how a bolt is retained on the non-bolt side of a printed part.
    Drives the geometry of the nut well / threaded hole / cap recess.
    """
    THREADED_INTO_PLASTIC = "ThreadedIntoPlastic"
    """Tap directly into printed material. OK for low-cycle use, no extra hardware."""

    CAPTURED_NUT = "CapturedNut"
    """Hex pocket sized for nut + minimal clearance. Relies on assembly orientation
       to keep nut in place. Acceptable if the part is assembled once and not handled."""

    CAPTURED_NUT_WITH_CAP = "CapturedNutWithCap"
    """Hex pocket plus oversized hex cap recess. Cap is printed separately and glued
       in after nut placement. Permanent retention with metal-on-metal threads.
       Preferred for adjustment fasteners that get repeatedly cycled."""

    THREADED_INSERT_M3 = "ThreadedInsertM3"
    THREADED_INSERT_M4 = "ThreadedInsertM4"
    THREADED_INSERT_M5 = "ThreadedInsertM5"
    THREADED_INSERT_M6 = "ThreadedInsertM6"
    """Heat-set or press-fit brass threaded insert. Best for high-cycle threaded
       engagement, especially in lock-screw positions where the screw is removed
       and reinstalled often."""
```

Default for new components: `CAPTURED_NUT_WITH_CAP` for adjustment fasteners; `THREADED_INSERT_M4` for lock screws.

---

## Updates to `HolePatternDriller`

The existing `HolePatternDriller` in `fusionkit/features/hole_patterns.py` carves hex wells but does not support the cap recess or threaded inserts. For this feature we extend `BoltHoleSpec` and add new `HolePatternDriller` methods.

### Extended `BoltHoleSpec`:

```python
@dataclasses.dataclass
class BoltHoleSpec:
    screw_diameter: float
    screw_head_diameter: float
    screw_head_depth: float
    nut_width: float
    nut_thickness: float
    # NEW:
    fastener_style: FastenerStyle = FastenerStyle.CAPTURED_NUT
    cap_clearance_mm: float = 0.0      # extra width across flats for the cap (typically 0.2-0.3 mm in mm; converted to cm)
    cap_depth_mm: float = 0.0          # how deep the cap recess extends (typically 1.5-2.0 mm)
    insert_outer_diameter: float = 0.0 # for threaded insert variants
    insert_depth: float = 0.0          # for threaded insert variants
```

(Only the relevant fields are populated for each `FastenerStyle`.)

### New / modified `HolePatternDriller` methods:

| Method | Purpose |
|--------|---------|
| `carve_captured_nut_with_cap(sketch, center, spec)` | NEW. Carves the inner hex well at the nut's depth, then a slightly larger hex recess from the outer face down to the cap depth. Two extrude-cuts. |
| `drill_threaded_insert(body, spec, position, ...)` | NEW. Drills the insert's outer-diameter pocket; no nut well. |
| Existing `drill_clamp_bolts` etc. | Modified to dispatch on `spec.fastener_style` to the right carve method. Default behavior (CAPTURED_NUT) preserved unchanged. |

Existing pipe-clamp configs use the implicit default (CAPTURED_NUT) and must continue to produce identical geometry. The "do not break" list in CLAUDE.md applies.

---

## Cage Mount Hole Pattern

The slider carriage's top face must mount to a SmallRig cage. SmallRig cages typically expose:

- Multiple 1/4"-20 UNC threaded holes
- Some 3/8"-16 threaded holes (for tripod mounts)
- ARRI-style locating pin holes (4 mm diameter, 19 mm offset from each 3/8"-16) for anti-rotation

For v1, the carriage default is **a pair of 1/4"-20 clearance holes spaced 38 mm apart on a single line.** This needs to be verified against the user's specific cage model before printing — different SmallRig cages have different hole spacings.

If anti-rotation pins are wanted, future enhancement adds `CagePinDiameter` and `CagePinOffset` parameters and updates the cage hole-pattern handler to drill the pin holes too.

The carriage JSON exposes a `CageMountPattern` field (string identifier) so future cage variants can be added by name without changing the carriage code:

```python
class CageMountPattern(enum.Enum):
    SMALLRIG_QUARTER20_PAIR = "SmallRig_Quarter20_Pair"  # default for v1
    SMALLRIG_QUARTER20_WITH_ARRI_PINS = "SmallRig_Quarter20_With_ARRI_Pins"
    SMALLRIG_THREEEIGHTS = "SmallRig_ThreeEighths"
    GENERIC_QUARTER20_SINGLE = "Generic_Quarter20_Single"
```

A small lookup table maps each pattern to its hole positions and diameters. v1 implements the first option only.

---

## Implementation Plan

### Files to create / modify:

| File | Action | Description |
|------|--------|-------------|
| `fusionkit/core/enums.py` | Modify | Add `FastenerStyle` and `CageMountPattern` enums |
| `fusionkit/geometry/shapes.py` | Modify | Add `SlotShape` dataclass with `draw()` method |
| `fusionkit/features/hole_patterns.py` | Modify | Extend `BoltHoleSpec` with cap and insert fields; add `carve_captured_nut_with_cap()` and `drill_threaded_insert()`; dispatch existing drill methods on `fastener_style` |
| `fusionkit/components/slider_rail.py` | **Create** | `SliderRail(ComponentBase)` — clamp body + integral rail plate + slot |
| `fusionkit/components/slider_carriage.py` | **Create** | `SliderCarriage(ComponentBase)` — flat plate + cage-mount holes + slot-bolt well + lock-screw insert |
| `fusionkit/components/__init__.py` | Modify | Register `SliderRail` and `SliderCarriage` in `COMPONENT_REGISTRY` |
| `configs/components/slider_rail/slider_rail_pvc1in_v1.json` | **Create** | First spec: 1" PVC, 100 mm clamp body, 60 mm slot, M5 clamp bolts, captured-nut-with-cap |
| `configs/components/slider_carriage/smallrig_carriage_v1.json` | **Create** | First spec: SmallRig 1/4-20 pair, M6 slot bolt, M4 brass insert lock screw |
| `configs/kits/camera_slider_pvc_mount.json` | **Create** | New kit referencing SliderRail + SliderCarriage. Does NOT replace the existing `camera_pvc_mount.json` — that stays as the Phase 4 assembly_steps reference. |
| `tests/test_slot_shape.py` | **Create** | `SlotShape` dimension calculations |
| `tests/test_fastener_style.py` | **Create** | `BoltHoleSpec` dispatch and field validation |
| `tests/test_slider_components.py` | **Create** | ParamLoader-level validation for both new component configs |
| `IMPLEMENTATION_PLAN.md` | Modify | Check off MountingPlate-adjacent items; add SliderRail/SliderCarriage line items under Phase 3 |
| `ARCHITECTURE.md` | Modify | Add the two new components to the Components Layer listing; add `SlotShape` to Geometry Layer |
| `INVENTORY.md` | Modify | No legacy-code mapping — these are net-new components |

### Acceptance criteria:

1. `SliderRail` builds successfully from `slider_rail_pvc1in_v1.json` and produces two split bodies (ScrewSide and NutSide) similar to PipeClamp output, with the rail plate and slot visible above the clamp portion.
2. `SliderCarriage` builds from `smallrig_carriage_v1.json` and produces a single body with cage-mount holes on top, slot-bolt clearance hole + captured-nut-with-cap well on bottom, and lock-screw insert pocket on the side.
3. Captured-nut-with-cap geometry: the inner hex well is sized for the nominal nut (width across flats matches `NutWidth`); the cap recess is `CapClearance` mm wider on each side and `CapDepth` mm deep, opening to the outer face.
4. The `FastenerStyle` enum dispatches correctly: existing pipe clamp configs (which don't specify `FastenerStyle`) default to `CAPTURED_NUT` and produce **identical geometry** to before this feature lands. This is on the do-not-break list.
5. The new kit `camera_slider_pvc_mount.json` builds both components successfully when run via `scripts/run_kit.py` (or its KitBuilder equivalent).
6. The slider carriage's slot-bolt position aligns with the rail's slot center over the slot's full travel range. (Verified visually in Fusion; a unit test verifies the dimensions allow alignment.)

---

## Test Cases

### Outside Fusion (unit tests):

| Input | Function tested | Expected |
|-------|----------------|----------|
| `SlotShape(center=(0,0,0), length=60, width=6.5)` | `SlotShape` dimensions | overall bounding box 60 × 6.5; two end semicircles of radius 3.25 |
| `SlotShape` with `long_axis_angle_rad=π/2` | Rotation | bounding box 6.5 × 60 |
| `BoltHoleSpec` with `fastener_style=CAPTURED_NUT_WITH_CAP`, `cap_depth_mm=2.0`, `cap_clearance_mm=0.2` | Field validation | All fields populated, accessible via dataclass |
| `BoltHoleSpec` default construction | Backward compatibility | `fastener_style=CAPTURED_NUT`, all cap/insert fields zero |
| `slider_rail_pvc1in_v1.json` loaded via ParamLoader | Parameter type coercion | All length params converted to cm, int params are int, bool params are bool |
| `smallrig_carriage_v1.json` loaded via ParamLoader | Same | Same |

### Inside Fusion (manual integration tests):

| Test | Steps | Pass criteria |
|------|-------|---------------|
| Build SliderRail v1 | Run `run_component.py` with COMPONENT_TYPE=SliderRail and `slider_rail_pvc1in_v1.json` | 2 bodies created (ScrewSide, NutSide); slot visible on rail plate; bolt holes drilled |
| Build SliderCarriage v1 | Same with SliderCarriage and `smallrig_carriage_v1.json` | 1 body; cage holes on top; slot-bolt well on bottom with cap recess |
| Build full kit | Run `run_kit.py` with `camera_slider_pvc_mount.json` | Both components built; visually positionable in the Fusion document |
| Captured-nut-with-cap geometry | Inspect the SliderCarriage's bottom face | Hex well visible; slightly wider hex cap recess opening to outer face; depths match JSON config |
| Backward compatibility | Re-run `run_component.py` for any existing pipeclamp config | Geometry unchanged from pre-feature baseline (verify via state_dumper diff) |
| Reverse-engineering loop dry run | After building SliderCarriage, ask Connector to add a leading chamfer with named user parameter; run `extract_timeline` | Extraction shows the new ChamferFeature and the new user parameter |

---

## Dependencies

- Phase 1 (core, geometry, features, PipeClamp) — done.
- Phase 3 fastener catalog (`Bolt`, `Nut`, `FastenerPair`) — done. Reused unchanged.
- `MountingPlate` (Phase 3) — done. SliderCarriage uses similar patterns (flat plate + hole pattern) but is its own class because the captured-nut-with-cap geometry isn't in `MountingPlate`.
- `FEATURE_timeline_extractor.md` — recommended (not required) so the iterative loop is available for refining the slider geometry after the v1 spec lands.
- Smart fastener selection (`FEATURE_smart_fastener_selection.md`) — useful but not required for v1. The slider components can use manually-specified fastener dimensions in the JSON. Future enhancement integrates with the selector.

---

## Open Questions to Resolve Before First Print

These are flagged in the JSON specs as the values most likely to need adjustment based on the user's actual hardware:

1. **Confirm SmallRig cage mount-hole pattern.** Default is 1/4"-20 pair at 38 mm spacing. Verify against the specific cage model. Different SmallRig cages have different patterns.
2. **Confirm PVC OD for actual stock.** 1" Schedule 40 furniture-grade is 33.4 mm; other vendors and other sizes differ. The parameter must drive the clamp inner geometry, not be a constant.
3. **Slot-bolt head clearance.** With an 11 mm head counterbore at 4 mm depth and the carriage plate at 8 mm thickness, the bolt head sits 4 mm below the top surface. Verify the SmallRig cage doesn't foul on the head before printing.
4. **Lock-screw approach.** Default is M4 brass threaded insert pressed/heat-set into the carriage side. Alternative: thumbscrew with captured M4 nut for tool-free adjustment. Decide based on whether the user wants tools-required (better for "set and forget") or tool-free (better for show-day repositioning).

---

## Future Enhancements (out of scope for v1)

- **Dimensional locks**: mechanical detents in the slot at named positions (e.g., every 5 mm) so the camera can return to known framings.
- **Quick-release thumbscrew variant** for show-day repositioning.
- **Cross-slide carriage**: a second axis of orthogonal travel at the carriage level instead of relying on the PVC slide for one axis.
- **Integrated cable management groove** on the rail plate.
- **Camera-mount adapters as separate components** (Phase 3 also lists `camera_mount.py`): GoPro, phone mounts that bolt to the SliderCarriage instead of a SmallRig cage.
- **Multi-camera rail**: one longer rail plate with two carriages for stereo or A/B camera setups.
