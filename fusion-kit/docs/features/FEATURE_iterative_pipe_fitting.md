# FEATURE: Iterative Pipe Shape Fitting with Test Rings

## Status: Planned (Phase 5)
## Priority: High — enables mounting on bicycle frames and irregular pipes
## Phase: 5 (Pipe Shape Fitting)

---

## Problem Statement

Bicycle frame tubes and other non-standard pipes are not pure cylinders. They may be elliptical, or what we call "pseudo-elliptical" — two semicircles connected by flat sides (like a rectangle with semicircular caps, also known as a stadium or discorectangle/oblong shape). The exact cross-section varies by manufacturer, frame model, and position on the frame (seat tube vs down tube vs top tube).

We cannot simply look up these dimensions. We need a workflow where:
1. The user takes physical measurements of the target tube
2. The system generates a set of thin test rings spanning a range of likely shapes
3. The user prints and physically tests the rings on the tube
4. The user reports which ring(s) fit best (or that none fit well enough)
5. The system narrows the range and generates a second round of test rings
6. This repeats until a ring fits snugly, at which point that cross-section is used for a real pipe clamp

---

## Cross-Section Shape Types

### Type 1: Pure Circle (already supported)
Standard PVC pipes, some metal tubes. Single parameter: diameter.

```
      ╭──────╮
    ╱          ╲
   │            │
   │     ●      │   ← diameter D
   │            │
    ╲          ╱
      ╰──────╯
```

### Type 2: Ellipse
Some aero bicycle tubes. Two parameters: major axis (width) and minor axis (height).

```
      ╭──────────╮
    ╱              ╲
   │                │
   │       ●        │   ← width W, height H
   │                │
    ╲              ╱
      ╰──────────╯
```

### Type 3: Pseudo-Ellipse (Stadium / Discorectangle)
Many bicycle frame tubes, especially seat tubes and down tubes. Two semicircles of radius R connected by flat sides of length L.

```
      ╭──────╮
    ╱          ╲
   │            │
   │            │   ← flat section, length L
   │            │
   │     ●      │   ← total height H = 2R + L
   │            │       total width W = 2R
   │            │
    ╲          ╱
      ╰──────╯
```

Parameters: `semi_circle_radius` (R) and `flat_length` (L), or equivalently `width` (W = 2R) and `height` (H = 2R + L).

### Type 4: Rounded Rectangle
Less common but possible — a rectangle with corner fillets. Four parameters: width, height, corner radius.

```
      ╭──────────╮
     │            │
     │            │   ← width W, height H, corner radius R
     │     ●      │
     │            │
      ╰──────────╯
```

### Type 5: Unknown / Asymmetric
Some tubes have custom profiles. Handle via 3D scan workflow (future — outside this feature's scope).

---

## Manual Measurement Instructions

### What You Need

- Flexible tape measure or tailor's tape (for circumference)
- Digital calipers or a ruler with mm markings (for width and height)
- A piece of paper and pencil (for tracing)
- Optional: a profile gauge / contour gauge (cheap tool, ~$10, very helpful)
- Optional: soft modeling clay or putty (wrap around tube, remove, measure the impression)

### Step-by-Step Measurement Process

#### Measurement 1: Circumference
Wrap the flexible tape around the tube at the exact position where you want to mount. Record the circumference in millimeters.

```
Circumference (C): _____ mm
```

**Why**: The circumference is the most reliable single measurement. It constrains the perimeter of whatever cross-section shape we generate. A circle with this circumference has diameter D = C / π. An ellipse or pseudo-ellipse with this circumference will have a specific relationship between its width and height.

#### Measurement 2: Width (widest dimension)
Using calipers or a ruler, measure across the widest point of the tube. Hold the caliper/ruler perpendicular to the tube axis.

```
Width (W): _____ mm
```

#### Measurement 3: Height (narrowest dimension)
Rotate 90° from the width measurement. Measure the narrowest dimension.

```
Height (H): _____ mm
```

#### Measurement 4: Flat Detection
This determines if the tube is elliptical or pseudo-elliptical.

Hold a straight edge (ruler, credit card) against the widest side of the tube. Look for a gap between the straight edge and the tube surface:

- **No gap / negligible gap**: The tube has flat sides → **pseudo-ellipse**
- **Visible curved gap**: The tube is continuously curved → **ellipse**

If flat sides are present, measure the length of the flat section:

```
Flat side detected: Yes / No
Flat length (if yes): _____ mm
```

#### Measurement 5: Cross-Section Tracing (Optional but Recommended)

Press the end of the tube into soft clay or putty, or hold paper against the tube end and trace the outline with a pencil. Take a photo with a ruler in frame for scale. This provides a visual reference to compare against generated test rings.

### Recording Measurements

Enter measurements into a JSON file:

```json
{
    "_description": "Bicycle seat tube at position 150mm from seat clamp",
    "_date": "2025-03-31",
    "_tube_location": "seat_tube_mid",
    
    "circumference_mm": 98.5,
    "width_mm": 34.2,
    "height_mm": 28.6,
    "shape_type": "pseudo_ellipse",
    "flat_length_mm": 8.0,

    "notes": "Slight asymmetry noticed, left side maybe 0.5mm wider"
}
```

---

## Test Ring Generation

### What is a Test Ring?

A test ring is a thin-walled (2–3mm) cross-section extruded to a short height (8–10mm). It uses minimal material and prints fast (5–15 minutes depending on printer). The inner profile matches the predicted tube shape; the outer profile is a fixed offset outward.

```
Side view of test ring on tube:

    ┌─────────────────┐  ← outer surface (flat, for labeling)
    │  ╭───────────╮  │
    │ ╱    tube     ╲ │  ← 2-3mm wall thickness
    ││               ││
    ││               ││  ← 8-10mm ring height
    ││               ││
    │ ╲             ╱ │
    │  ╰───────────╯  │
    └─────────────────┘
```

### Ring Parameters

```json
{
    "ring_height_mm": 10,
    "wall_thickness_mm": 2.5,
    "label_text": "A3",
    "inner_shape": { ... }
}
```

### First Round: Generate a Spread of Candidates

Given the measurements, the system generates **5–7 test rings** spanning a range:

1. **Center ring (C0)**: Best guess from measurements
2. **Width variants (W±)**: Center shape but ±1mm on width (2 rings)
3. **Height variants (H±)**: Center shape but ±1mm on height (2 rings)
4. **Shape blend variants (S±)**: Morph between ellipse and pseudo-ellipse (2 rings)

For a pseudo-ellipse measurement, the 7 rings would be:

| Ring ID | Width | Height | Flat Length | Shape Type | Notes |
|---------|-------|--------|-------------|------------|-------|
| C0 | 34.2 | 28.6 | 8.0 | pseudo_ellipse | Center: direct from measurements |
| W+ | 35.2 | 28.6 | 8.0 | pseudo_ellipse | Width +1mm |
| W- | 33.2 | 28.6 | 8.0 | pseudo_ellipse | Width -1mm |
| H+ | 34.2 | 29.6 | 8.0 | pseudo_ellipse | Height +1mm |
| H- | 34.2 | 27.6 | 8.0 | pseudo_ellipse | Height -1mm |
| S+ | 34.2 | 28.6 | 12.0 | pseudo_ellipse | More flat (longer flat section) |
| S- | 34.2 | 28.6 | 2.0 | pseudo_ellipse | More elliptical (shorter flat) |

Each ring is labeled (embossed or engraved text on the outer surface) with its ID so the user can identify them after printing.

### Circumference Validation

Before generating, validate that each ring's computed perimeter approximately matches the measured circumference. If a variant's perimeter deviates more than 5% from the measured circumference, flag it as unlikely and either adjust or skip it.

For a pseudo-ellipse: `perimeter ≈ π × semi_circle_radius × 2 + flat_length × 2`
More precisely: `perimeter = π × width + 2 × flat_length`

For an ellipse: `perimeter ≈ π × (3(a+b) - √((3a+b)(a+3b)))` (Ramanujan approximation, where a = W/2, b = H/2)

---

## Iteration Workflow

### After Round 1: User Feedback

The user tries each ring on the tube and reports results:

```json
{
    "round": 1,
    "results": [
        {"ring_id": "C0", "fit": "slightly_loose", "notes": "rotates freely, gap on flat side"},
        {"ring_id": "W+", "fit": "too_loose", "notes": ""},
        {"ring_id": "W-", "fit": "snug", "notes": "good on curved parts, slight gap on flat"},
        {"ring_id": "H+", "fit": "too_loose", "notes": ""},
        {"ring_id": "H-", "fit": "tight", "notes": "hard to slide on, good contact"},
        {"ring_id": "S+", "fit": "best", "notes": "flat sides match well, slight looseness on curves"},
        {"ring_id": "S-", "fit": "too_loose", "notes": "curves don't match, rocking"}
    ],
    "best_two": ["S+", "H-"]
}
```

Fit categories:
- `too_tight`: Cannot fit over tube, or requires excessive force
- `tight`: Fits but with noticeable resistance, very little play
- `snug`: Slides on with light pressure, minimal play — **this is the goal**
- `slightly_loose`: Fits but has noticeable play or gaps
- `too_loose`: Falls off or rotates freely
- `best`: Subjective best fit from the batch

### Round 2: Narrowing

The system takes the two best rings from round 1 and generates a new spread **between and around them**. If the best two are S+ and H-, the system:

1. Computes the midpoint shape between S+ and H-
2. Generates 5 variants centered on that midpoint with smaller increments (±0.5mm instead of ±1mm)

```
Round 2 generation logic:

    best_1 = rings["S+"]  # width=34.2, height=28.6, flat=12.0
    best_2 = rings["H-"]  # width=34.2, height=27.6, flat=8.0
    
    midpoint = average(best_1, best_2)
    # width=34.2, height=28.1, flat=10.0
    
    Generate 5 rings around midpoint with ±0.5mm steps:
    R2-C0: midpoint
    R2-1:  height +0.5
    R2-2:  height -0.5
    R2-3:  flat +2.0
    R2-4:  flat -2.0
```

### Round 3+ (if needed)

Same process. Each round narrows the range. Typically 2–3 rounds are enough.

### Convergence Criteria

The process is complete when:
- A ring achieves "snug" fit rating
- Two adjacent rings straddle the tube (one slightly tight, one slightly loose)
- The user declares satisfaction

The winning ring's inner profile becomes the `CircleDiameter` / shape parameters for the actual pipe clamp.

### Gasket Allowance

Once the snug shape is found, the actual pipe clamp cutout should be **slightly larger** (0.5–1.0mm per side) to accommodate an adhesive gasket strip. The gasket provides:
- Grip to prevent rotation
- Vibration dampening
- Tolerance for slight tube variations along its length

```
clamp_cutout_width = winning_ring_width + (gasket_thickness × 2)
clamp_cutout_height = winning_ring_height + (gasket_thickness × 2)
```

---

## Implementation Plan

### New files to create:

| File | Description |
|------|-------------|
| `fusionkit/components/test_ring.py` | `TestRing` component: generates a single test ring from shape params |
| `fusionkit/components/test_ring_set.py` | `TestRingSet`: generates a spread of test rings for one round |
| `fusionkit/geometry/shapes.py` | Add `EllipseShape` and `PseudoEllipseShape` (stadium) |
| `fusionkit/catalog/tube_profiles.py` | Known tube profiles (bicycle, common irregular shapes) |
| `configs/components/test_ring/` | JSON configs for test ring generation |
| `configs/fitting_sessions/` | Per-session measurement + results JSON files |
| `docs/MEASUREMENT_GUIDE.md` | Printable measurement instructions for the user |
| `tests/test_shape_perimeter.py` | Perimeter calculation validation |

### Files to modify:

| File | Change |
|------|--------|
| `fusionkit/components/__init__.py` | Register `TestRing` and `TestRingSet` |
| `fusionkit/geometry/shapes.py` | Add `EllipseShape`, `PseudoEllipseShape` |
| `fusionkit/components/pipe_clamp.py` | Accept pseudo-ellipse / ellipse cutout shapes |

### New shape classes needed:

```python
@dataclasses.dataclass
class EllipseShape:
    """Elliptical cross-section defined by major and minor axis."""
    center: adsk.core.Point3D
    semi_major: float   # half of the wider dimension
    semi_minor: float   # half of the narrower dimension
    rotation_degrees: float = 0.0  # orientation of major axis

    def draw(self, sketch: adsk.fusion.Sketch) -> adsk.fusion.SketchEllipse: ...
    def perimeter(self) -> float: ...  # Ramanujan approximation


@dataclasses.dataclass
class PseudoEllipseShape:
    """
    Stadium / discorectangle: two semicircles connected by flat sides.
    Also called an oblong or pseudo-ellipse.
    
    Defined by the semicircle radius and flat section length.
    Total width = 2 × radius
    Total height = 2 × radius + flat_length
    """
    center: adsk.core.Point3D
    semi_circle_radius: float   # radius of the semicircular ends
    flat_length: float          # length of each flat side
    rotation_degrees: float = 0.0

    def draw(self, sketch: adsk.fusion.Sketch) -> None: ...
    def perimeter(self) -> float: ...
    def width(self) -> float: ...
    def height(self) -> float: ...
```

### TestRing component:

```python
class TestRing(ComponentBase):
    """
    A thin-walled test ring for physical pipe fitting.
    Inner profile matches the predicted tube shape.
    Outer profile is offset outward by wall_thickness.
    """
    def build(self) -> typing.List[adsk.fusion.BRepBody]:
        # 1. Draw inner shape (ellipse or pseudo-ellipse)
        # 2. Draw outer shape (same type, offset by wall_thickness)
        # 3. Select the ring profile (outer minus inner)
        # 4. Extrude to ring_height
        # 5. Optionally engrave ring ID label
        ...
```

### TestRingSet component:

```python
class TestRingSet:
    """
    Generates a spread of test rings for one round of fitting.
    
    Round 1: from measurements, generate 5-7 rings spanning likely range.
    Round 2+: from previous round's best-two results, narrow the range.
    """
    def generate_round_1(
        self,
        measurements: typing.Dict[str, typing.Any],
    ) -> typing.List[typing.Dict[str, typing.Any]]: ...
    
    def generate_next_round(
        self,
        best_ring_1: typing.Dict[str, typing.Any],
        best_ring_2: typing.Dict[str, typing.Any],
        round_number: int,
    ) -> typing.List[typing.Dict[str, typing.Any]]: ...
```

---

## JSON Schemas

### Measurement input (`configs/fitting_sessions/bike_seat_tube_session1.json`):

```json
{
    "session_id": "bike_seat_tube_2025_03",
    "description": "Trek Domane seat tube, 150mm below clamp",
    
    "measurements": {
        "circumference_mm": 98.5,
        "width_mm": 34.2,
        "height_mm": 28.6,
        "shape_type": "pseudo_ellipse",
        "flat_length_mm": 8.0,
        "flat_detected": true,
        "notes": "Measured with calipers and tape"
    },
    
    "ring_params": {
        "ring_height_mm": 10,
        "wall_thickness_mm": 2.5,
        "gasket_allowance_mm": 0.0
    },

    "rounds": [
        {
            "round_number": 1,
            "rings_generated": ["C0", "W+", "W-", "H+", "H-", "S+", "S-"],
            "results": [
                {"ring_id": "C0", "fit": "slightly_loose"},
                {"ring_id": "S+", "fit": "best"},
                {"ring_id": "H-", "fit": "tight"}
            ],
            "best_two": ["S+", "H-"]
        },
        {
            "round_number": 2,
            "rings_generated": ["R2-C0", "R2-1", "R2-2", "R2-3", "R2-4"],
            "results": [
                {"ring_id": "R2-C0", "fit": "snug"}
            ],
            "best_two": ["R2-C0"],
            "winner": "R2-C0"
        }
    ],
    
    "final_shape": {
        "shape_type": "pseudo_ellipse",
        "width_mm": 34.2,
        "height_mm": 28.1,
        "semi_circle_radius_mm": 17.1,
        "flat_length_mm": 10.0,
        "gasket_allowance_mm": 1.0,
        "clamp_cutout_width_mm": 36.2,
        "clamp_cutout_height_mm": 30.1
    }
}
```

---

## Acceptance Criteria

1. User can input tube measurements via JSON and get a set of 5–7 test ring STLs
2. Each ring is labeled with its ID (embossed text or filename)
3. Ring perimeters are validated against measured circumference (warning if >5% deviation)
4. User can report results and system generates a narrowed round 2 set
5. Process converges in 2–3 rounds for typical bicycle tubes
6. Final winning shape can be used directly as pipe clamp cutout parameters
7. Gasket allowance is applied to final clamp dimensions
8. All test rings print in under 15 minutes each on a standard FDM printer

---

## Dependencies

- Phase 1 complete (core framework working)
- `EllipseShape` and `PseudoEllipseShape` added to geometry/shapes.py
- Pipe clamp component updated to accept non-circular cutouts

---

## Future Extensions

- **3D scan import**: Import a mesh from a 3D scanner, auto-fit parametric shape
- **Photo-based fitting**: Take a photo of the tube end with a reference scale, use image processing to extract the cross-section
- **Multi-position fitting**: Generate rings for multiple positions along the tube (tubes can taper or change shape along their length)
- **Asymmetric shapes**: Handle tubes that are not symmetric about either axis
