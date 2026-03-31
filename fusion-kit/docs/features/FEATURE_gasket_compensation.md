# FEATURE: Adhesive Gasket Compensation for Pipe Clamps

## Status: Planned (Phase 3–5, cross-cutting concern)
## Priority: High — affects every pipe clamp design
## Phase: Integrated across phases

---

## Problem Statement

Every pipe clamp uses a thin adhesive gasket strip between the inner clamp surface and the pipe. The gasket serves three purposes:

1. **Grip** — prevents the clamp from rotating or sliding along the pipe once tightened
2. **Vibration dampening** — absorbs vibration from bicycle frames, scaffolding in wind, etc.
3. **Tolerance absorption** — fills small gaps between the clamp's rigid cutout and the pipe's actual shape, meaning we don't need a geometrically perfect match

This third point is critical: the gasket lets us get away with an approximate shape match. A clamp designed for a pseudo-ellipse that's within ~1mm of the actual tube shape will work fine once the gasket fills the gap and the bolts are tightened.

But the gasket has physical thickness, and that thickness must be accounted for in the clamp design. If we don't compensate, the two clamp halves won't fully close when bolted together, leaving a gap at the bisect plane that weakens the mount.

---

## Gasket Physics

### Material properties

Typical gasket materials for this application:

| Material | Thickness (mm) | Compressibility | Adhesive | Source |
|----------|----------------|-----------------|----------|--------|
| Neoprene foam tape | 1.0–3.0 | ~50% at full bolt torque | Self-adhesive | McMaster 8694K, Amazon |
| EPDM rubber strip | 1.0–2.0 | ~20–30% | Self-adhesive or glued | McMaster 8610K |
| Silicone foam tape | 1.5–3.0 | ~40–60% | Self-adhesive | McMaster 8694K |
| Anti-slip grip tape | 0.5–1.0 | ~10% (minimal) | Self-adhesive | Hardware store |

For most pipe clamp applications, **1.0–1.5mm neoprene foam tape** is the best choice: it compresses enough to conform to slight shape variations, the adhesive holds it in place during assembly, and it provides excellent grip.

### How compression works

When the bolts are tightened, the two clamp halves squeeze the gasket between the clamp surface and the pipe:

```
Before tightening:                After tightening:

  Clamp half                       Clamp half
  ┌──────────┐                     ┌──────────┐
  │          │                     │          │
  │ ┊gasket┊ │ ← gap              │ ▓gasket▓ │ ← compressed
  │ ┊ 1.5mm┊ │                     │ ▓~0.8mm▓ │
  │          │                     │          │
  │  ╱ pipe ╲│                     │  ╱ pipe ╲│
  └──────────┘                     └──────────┘
  
  Bisect gap: 2 × (1.5 - 0) = 3mm  Bisect gap: 2 × (1.5 - 0.8) = 1.4mm
  (halves don't close)              (still have a gap!)
```

**The problem**: If the clamp cutout exactly matches the pipe diameter, the gasket thickness prevents the two halves from closing at the bisect plane. The bolts are fighting the gasket instead of clamping the halves together.

---

## The Solution: Oversized Cutout

The clamp's inner cutout must be larger than the pipe by enough to accommodate the gasket in its **compressed** state.

```
cutout_dimension = pipe_dimension + (2 × gasket_compressed_thickness)
```

Where `gasket_compressed_thickness` is the gasket thickness after the bolts are fully tightened. This depends on the material's compressibility.

### Calculation

For a 1.5mm neoprene gasket that compresses to ~50% at full torque:

```
gasket_nominal = 1.5 mm
compression_ratio = 0.50
gasket_compressed = gasket_nominal × compression_ratio = 0.75 mm
cutout_oversize = 2 × gasket_compressed = 1.5 mm total (0.75 per side)
```

For a circular pipe:
```
pipe_OD = 42.16 mm (1.25" PVC)
clamp_cutout_diameter = 42.16 + 1.5 = 43.66 mm
```

### Bisect plane behavior

When the clamp halves close fully (bolts tight):

```
Properly compensated:

  Screw side half
  ┌──────────────┐
  │              │
  │  ▓ gasket ▓  │ ← compressed to 0.75mm
  │  ╱  pipe   ╲ │
  ├══════════════┤ ← bisect plane: halves meet flush
  │  ╲  pipe   ╱ │
  │  ▓ gasket ▓  │
  │              │
  └──────────────┘
  Nut side half

  Gap at bisect: 0mm (halves fully closed)
  Gasket compressed: 0.75mm per side
  Pipe held firmly by compressed gasket
```

This is the goal: when bolts are fully tightened, the two halves meet flush at the bisect plane. The gasket is compressed between the pipe and the clamp, providing grip. Loosening the bolts slightly opens a small gap at the bisect, allowing the clamp to slide along the pipe for repositioning without removal.

---

## Gasket and Shape Tolerance Interaction

### How gasket fills shape mismatches

If the clamp cutout is a circle but the actual pipe is slightly pseudo-elliptical, the gasket fills the difference:

```
  Clamp cutout (circle)
  ┌──────────────────┐
  │    ╭──────────╮  │
  │  ╱   ▓▓▓▓▓▓    ╲│ ← gasket fills gap at corners
  │ │  ▓╱        ╲▓ ││    where circle doesn't match
  │ │ ▓│  actual  │▓││    the actual tube shape
  │ │ ▓│  tube    │▓││
  │ │  ▓╲        ╱▓ ││
  │  ╲   ▓▓▓▓▓▓    ╱│
  │    ╰──────────╯  │
  └──────────────────┘

  ▓ = gasket (thicker where gap is larger)
```

At points where the tube closely matches the cutout shape, the gasket compresses more. At points where there's a gap, the gasket compresses less. The gasket acts as a conformal interface.

### Tolerance budget

The gasket can absorb shape mismatches up to approximately:

```
max_absorbable_mismatch ≈ gasket_nominal_thickness × (1 - compression_ratio)
```

For a 1.5mm gasket at 50% compression:
```
max_mismatch = 1.5 × (1 - 0.5) = 0.75mm per side
```

This means if the clamp cutout shape differs from the actual tube shape by up to 0.75mm at any point, the gasket will fill the gap. Beyond that, the gasket can't fill the gap fully and the clamp may not grip the pipe adequately at those points.

This tolerance budget directly connects to the scan-fitting workflow: if the best-fit parametric shape has a maximum residual less than the gasket's absorbable mismatch, use the parametric shape. Otherwise, use the raw scan profile.

### Corner tolerance for pseudo-ellipse

For bicycle tubes that are pseudo-elliptical, the transition from flat side to semicircular end is often the most variable region. A clamp designed with a slightly larger corner radius than the actual tube corner will rely on the gasket to fill the corners. This is acceptable as long as the mismatch is within the tolerance budget.

```
  Designed corner (generous radius)
            ╲
             ╲   ▓▓ ← gasket fills the corner gap
              ╲▓▓╱ ← actual tube corner (tighter radius)
               ╲╱
```

**Practical rule**: design the pseudo-ellipse with a semi-circle radius that's 0.5–1.0mm larger than measured. The gasket fills the corner slack. This means you don't need to perfectly match the corner geometry.

---

## Design Parameters

### New JSON config fields for gasket compensation:

```json
{
    "GasketThickness": 1.5,
    "GasketCompression": 0.50,
    "GasketMaterial": "neoprene_foam",
    "ApplyGasketCompensation": true
}
```

### Where compensation is applied:

| Dimension | Without gasket | With gasket (1.5mm, 50%) |
|-----------|---------------|--------------------------|
| CircleDiameter (cutout) | = pipe OD | = pipe OD + 2 × compressed_thickness |
| For pseudo-ellipse width | = tube width | = tube width + 2 × compressed_thickness |
| For pseudo-ellipse height | = tube height | = tube height + 2 × compressed_thickness |
| Semi-circle radius | = tube radius | = tube radius + compressed_thickness |
| Flat length | = tube flat | = tube flat (unchanged — compression is radial) |

Note: the flat_length of a pseudo-ellipse doesn't change — the gasket adds thickness radially (perpendicular to the surface), not along the surface.

### Where compensation is NOT applied:

- `RectEdgeX`, `RectEdgeY` (outer clamp dimensions): unchanged
- `ObjectDepth` (clamp height): unchanged
- Bolt hole positions: unchanged
- Notch dimensions: unchanged

Gasket compensation only affects the inner cutout profile.

---

## Assembly Workflow with Gasket

### Materials needed:

- Printed clamp halves (screw-side and nut-side)
- Adhesive gasket strip (pre-cut or cut from roll)
- Bolts, nuts per the fastener spec
- The pipe or tube to mount on

### Steps:

1. **Cut gasket strips**: Cut strips of adhesive gasket to line the inside of each clamp half. The strip should cover the full curved inner surface but NOT extend to the bisect face (the flat face where the two halves meet).

```
   ┌──────────────┐
   │              │
   │  ▓▓▓▓▓▓▓▓▓  │ ← gasket covers curved inner surface
   │ ▓╱        ╲▓ │
   │▓│          │▓│
   ├──────────────┤ ← NO gasket on this face (bisect plane)
                      halves must meet flush here
```

2. **Apply gasket**: Peel adhesive backing, press gasket firmly into the curved inner surface of each clamp half. Ensure no gasket overhangs the bisect face.

3. **Position on pipe**: Place the nut-side half on the pipe at the desired position. The gasket prevents it from sliding.

4. **Add screw-side half**: Place the screw-side half on top, aligning the bolt holes.

5. **Insert nuts**: Push hex nuts into the nut wells (they should press-fit and stay).

6. **Thread bolts**: Insert bolts through the screw-side, thread into nuts.

7. **Tighten to reposition**: Tighten bolts until the clamp grips the pipe but can still be slid with firm pressure. Slide to final position.

8. **Tighten fully**: Once positioned, tighten bolts until the two halves meet flush at the bisect plane. The gasket is now compressed and the clamp is locked.

9. **Verify**: Try to rotate the clamp. It should not move. Try to slide it along the pipe. It should not move.

### Loosening for repositioning:

Loosen bolts 1–2 turns. The clamp halves open slightly at the bisect plane (the gasket expands back), and the clamp can be slid to a new position. Re-tighten.

---

## Trial and Error: Finding the Right Gasket Setup

### Variables to experiment with:

1. **Gasket thickness**: Start with 1.0mm. If too loose when tightened, try 1.5mm. If bolts can't close the halves, try thinner.
2. **Gasket material**: Neoprene foam is the default. If grip is insufficient, try EPDM rubber (less compressible, more grip). If vibration is the main concern, try silicone foam (more dampening).
3. **Gasket coverage**: Full coverage of the inner curve is standard. For irregular tubes, you may want gasket only on certain sections where grip matters most.

### Test protocol:

Print one clamp at the compensated dimensions. Apply gasket. Test:

| Test | Pass criteria |
|------|---------------|
| Halves close flush | No visible gap at bisect when fully tightened |
| Clamp grips pipe | Cannot rotate or slide by hand |
| Clamp repositionable | Loosening 1–2 turns allows sliding |
| No pipe damage | Gasket doesn't leave marks or compress the pipe |

If halves don't close:
- Gasket too thick → try thinner gasket, or increase cutout oversize
- Compression ratio assumption wrong → measure actual compressed thickness with calipers while bolts are tight

If clamp doesn't grip:
- Gasket too thin → try thicker gasket
- Gasket too compressible → try denser material (EPDM instead of foam)
- Cutout too oversized → reduce compensation

### Recording what works:

Once you find a gasket setup that works for a given pipe type, save it:

```json
{
    "pipe_type": "PVC_1.25in",
    "pipe_od_mm": 42.16,
    "gasket_material": "neoprene_foam",
    "gasket_brand": "McMaster 8694K42",
    "gasket_nominal_thickness_mm": 1.5,
    "gasket_compressed_thickness_mm": 0.7,
    "actual_compression_ratio": 0.47,
    "cutout_oversize_per_side_mm": 0.7,
    "clamp_cutout_diameter_mm": 43.56,
    "result": "pass",
    "notes": "Holds firm, repositionable with 1.5 turn loosening"
}
```

This becomes a tested recipe that's reused for all clamps on this pipe type.

---

## Implementation Plan

### New / modified files:

| File | Action | Description |
|------|--------|-------------|
| `fusionkit/fasteners/gasket.py` | **Create** | `GasketSpec` dataclass with material, thickness, compression ratio |
| `fusionkit/components/pipe_clamp.py` | **Modify** | Apply gasket compensation to cutout dimensions |
| `configs/gaskets/` | **Create** | JSON specs for tested gasket configurations |
| `configs/gaskets/neoprene_1.5mm.json` | **Create** | Default neoprene foam gasket spec |
| `tests/test_gasket_compensation.py` | **Create** | Validate compensation calculations |

### GasketSpec dataclass:

```python
@dataclasses.dataclass
class GasketSpec:
    material: str                    # 'neoprene_foam', 'epdm', 'silicone_foam'
    nominal_thickness_mm: float      # as-purchased thickness
    compression_ratio: float         # 0.0 to 1.0 (0.5 = compresses to half)
    mcmaster_part: str = ''          # optional part number
    
    @property
    def compressed_thickness_mm(self) -> float:
        return self.nominal_thickness_mm * self.compression_ratio
    
    @property
    def cutout_oversize_per_side_mm(self) -> float:
        return self.compressed_thickness_mm
    
    @property
    def max_absorbable_mismatch_mm(self) -> float:
        return self.nominal_thickness_mm - self.compressed_thickness_mm
    
    def compensate_diameter(self, pipe_diameter_mm: float) -> float:
        return pipe_diameter_mm + (2 * self.cutout_oversize_per_side_mm)
    
    def compensate_dimension(self, dimension_mm: float) -> float:
        return dimension_mm + (2 * self.cutout_oversize_per_side_mm)
```

### Integration with PipeClamp:

When `ApplyGasketCompensation` is true in the JSON config, the pipe clamp applies the gasket oversize to the cutout dimensions before drawing the cross-section sketch.

```python
# In PipeClamp.build():
if self.get_bool('ApplyGasketCompensation', False):
    gasket = GasketSpec.from_json(self.get_param('GasketConfig'))
    circle_diameter = gasket.compensate_diameter(circle_diameter_raw)
    # For pseudo-ellipse: compensate width and height but not flat_length
```

---

## Acceptance Criteria

1. Gasket-compensated clamps close flush at the bisect when bolts are fully tightened
2. Compensation is applied only to inner cutout dimensions, not outer clamp or bolt positions
3. `GasketSpec` correctly calculates compressed thickness, oversize, and mismatch tolerance
4. System stores tested gasket recipes for reuse across projects
5. Gasket tolerance budget integrates with the scan-fitting workflow's shape residual check
