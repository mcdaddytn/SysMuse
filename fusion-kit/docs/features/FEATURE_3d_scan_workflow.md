# FEATURE: 3D Scan Workflow for Pipe Shape Capture

## Status: Planned (Phase 5)
## Priority: Medium — enhances pipe fitting for complex/asymmetric tubes
## Phase: 5 (Pipe Shape Fitting)

---

## Problem Statement

Manual measurements (circumference, width, height, flat detection) work well when the tube cross-section is a known geometric shape — circle, ellipse, or pseudo-ellipse. But some tubes have:

- Asymmetric profiles (one side more curved than the other)
- Complex transitions (the shape changes along the tube's length)
- Internal reinforcement ridges or weld seams
- Subtle compound curves that are neither elliptical nor pseudo-elliptical

For these cases, we want to capture the actual cross-section geometry and either confirm it matches one of our parametric shapes (close enough with gasket compensation) or import the raw profile as a custom cutout.

---

## Scanning Tools — Ranked by Accessibility

### Tool 1: Plastic Contour Gauge (Manual, No Tech)

**What it is**: A row of thin plastic pins held in a frame. Press against a surface and the pins conform to the shape. Trace or photograph the result.

**Cost**: $8–15  
**Accuracy**: ±0.5–1.0mm depending on pin spacing and user technique  
**Availability**: Amazon, any hardware store  

**How to use for tube cross-sections**:

1. Position the contour gauge perpendicular to the tube axis at the mounting position
2. Press firmly so all pins contact the tube surface — do not press so hard that you bend the pins past the tube
3. Lock the gauge if it has a lock mechanism
4. Carefully remove without disturbing the pins
5. Place on a piece of paper and trace the profile with a fine pen
6. Photograph the traced profile with a ruler in frame for scale
7. Repeat on the perpendicular axis (rotate 90°) to capture both halves

**Capturing a full cross-section**:

The contour gauge only captures one side at a time. For a full cross-section:

```
Capture 1: Top half          Capture 2: Bottom half
    ▼ press down                 ▲ press up
  ┌─┬┬┬┬┬┬┬┬┬┐              ┌─┬┬┬┬┬┬┬┬┬┐
  │ ╲        ╱│              │ pins flat  │
  │   ╲    ╱  │              │ ╱        ╲ │
  └───────────┘              └───────────┘
     tube top                   tube bottom
```

You need four captures for a complete profile: top, bottom, left, right. The overlapping corners help align them into a single outline.

**Digitizing the trace**:

- Photograph the tracing with a ruler for scale
- Use an image-to-vector tool (Inkscape trace, or even manually plot key points)
- Extract coordinates at ~1mm intervals around the perimeter
- Feed into the system as a point cloud

**Strengths**: Cheap, no batteries, works anywhere, fast  
**Weaknesses**: Only one side at a time, limited accuracy, requires manual digitization, user error in pressing/tracing

---

### Tool 2: Phone-Based 3D Scanning Apps

**What it is**: Apps that use the phone camera (and LiDAR on newer iPhones/iPads) to capture 3D geometry of objects.

**Cost**: Free to ~$20 for the app; requires a phone with decent camera (LiDAR strongly preferred)  
**Accuracy**: Varies widely — 1–5mm for photogrammetry-only apps, 0.5–2mm for LiDAR-equipped devices  
**Availability**: Already in your pocket

**Recommended apps** (as of early 2025 — search for current reviews):

| App | Platform | Method | LiDAR Required | Notes |
|-----|----------|--------|----------------|-------|
| Polycam | iOS, Android | LiDAR + photo | Optional (better with) | Good for objects, exports many formats |
| Scaniverse | iOS | LiDAR | Yes | Clean meshes, free |
| 3d Scanner App | iOS | LiDAR | Yes | Direct USDZ/OBJ export |
| Kiri Engine | iOS, Android | Photogrammetry | No | Works without LiDAR, cloud processing |
| RealityScan | iOS, Android | Photogrammetry | No | By Epic Games / Capturing Reality |

**How to scan a tube cross-section**:

The challenge is that we care about the cross-section at one specific point, but 3D scanners capture the whole tube surface. Two approaches:

**Approach A — Scan the tube end (if accessible)**:

If you can see the tube end (e.g., frame disassembled, or seat tube with seat post removed):

1. Clean the tube end — remove dirt, grease
2. Place contrasting tape around the tube end to help the scanner find edges
3. Add reference markers: stick two small pieces of tape exactly at the mounting position to mark the scan region
4. Slowly orbit the phone around the tube end, capturing from multiple angles
5. Export as OBJ or STL mesh

**Approach B — Scan the tube surface and extract a cross-section**:

If you cannot access the tube end:

1. Mark the mounting position with tape
2. Place reference stickers (small pieces of contrasting tape, ~10mm apart) around the circumference at the mounting position — these help the scanner track the surface
3. Scan a ~50mm section of the tube centered on the mounting position
4. Export as OBJ or STL mesh
5. In software (Fusion 360, MeshLab, or a script), slice the mesh at the mounting plane to extract a 2D cross-section curve

**Tips for better scans**:

- Matte surfaces scan better than shiny ones — lightly dust with talcum powder or spray with dry shampoo if the tube is reflective
- Consistent lighting, avoid harsh shadows
- Move slowly and overlap coverage
- Scan in a well-lit area (outdoors on an overcast day is ideal)
- Include a ruler or known-size object in the scan for scale calibration

**Strengths**: Convenient, captures full geometry, digital output  
**Weaknesses**: Accuracy varies with app/hardware, shiny tubes are difficult, need software to extract cross-section from surface scan, LiDAR phones not universal

---

### Tool 3: Dedicated 3D Scanner at a Maker Space

**What it is**: Structured-light or laser-based 3D scanners (e.g., Creality Scan, Revopoint, EinScan, Artec) that produce high-resolution meshes.

**Cost**: Free if available at a community maker space (membership may be required)  
**Accuracy**: 0.05–0.3mm depending on scanner model  
**Availability**: Many public libraries, maker spaces, university labs have these

**How to use**:

1. Bring the bicycle (or the specific tube if removable) to the maker space
2. Mount the tube on a turntable if available
3. Spray with scanning spray if the surface is reflective (maker spaces usually have this)
4. Scan the mounting region — typically a 60–100mm section of tube
5. Export the mesh as STL or OBJ
6. Slice the mesh at the exact mounting position to extract the 2D cross-section

**Logistics note**: Bringing a full bicycle to a maker space is feasible but inconvenient. Consider:
- Remove the tube if possible (e.g., seat post, or a tube from a donor frame for sizing)
- Use the contour gauge or phone scan at home first, then bring the bike to the maker space only if the shape proves too complex for those methods

**Strengths**: Highest accuracy by far, professional output, often free  
**Weaknesses**: Must transport the bike, depends on maker space availability and hours, slight learning curve

---

## Processing the Scan Data

### From 3D mesh to 2D cross-section

Regardless of scanning method, the output is a 3D mesh (STL/OBJ). We need a 2D cross-section at the mounting position.

**Method 1: Fusion 360 (manual)**

1. Import the mesh into Fusion 360 (Insert → Mesh)
2. Create a construction plane at the mounting position
3. Use Mesh → Section Analysis or Inspect → Section Analysis
4. The intersection produces a 2D curve
5. Create a sketch, project the section curve onto it
6. The sketch now contains the cross-section as splines/lines

**Method 2: Python script (automated)**

```python
# Pseudocode for mesh slicing
# Input: STL mesh, slice_z position
# Output: 2D polyline (list of (x, y) points)

import trimesh  # pip install trimesh

mesh = trimesh.load('tube_scan.stl')
# Slice at z = mounting_position (or whatever axis the tube runs along)
slice_2d = mesh.section(plane_origin=[0, 0, slice_z], 
                         plane_normal=[0, 0, 1])
# Extract the path as a polygon
path_2d = slice_2d.to_planar()[0]
# Get vertices as (x, y) coordinates
vertices = path_2d.vertices
```

We would integrate this into a utility module: `fusionkit/scan/mesh_slicer.py`

### From 2D cross-section to parametric shape

Once we have the 2D polyline, we can:

1. **Fit a parametric shape** — try to match the cross-section to one of our known types:
   - Fit a circle (least-squares circle fit) — if residual < threshold, it's a circle
   - Fit an ellipse (least-squares ellipse fit) — if residual < threshold, it's an ellipse
   - Fit a pseudo-ellipse (try semicircle + flat + semicircle fits) — if residual < threshold, it's a pseudo-ellipse
   - Fit a rounded rectangle — corner radius detection

2. **Calculate the residual** — how far is the actual cross-section from the best-fit parametric shape? This is the maximum distance between any point on the actual outline and the fitted shape.

3. **Compare residual to gasket tolerance** — if `max_residual < gasket_thickness`, then the gasket will fill the gap and a parametric shape is good enough. If `max_residual > gasket_thickness`, we need a custom cutout.

```
Fit decision tree:

    Scan cross-section
         │
         ▼
    Fit circle ─── residual < gasket? ──→ Use circle
         │                                    
         │ no
         ▼
    Fit ellipse ── residual < gasket? ──→ Use ellipse
         │
         │ no
         ▼
    Fit pseudo-ellipse ─ residual < gasket? ──→ Use pseudo-ellipse
         │
         │ no
         ▼
    Use raw scan profile as custom cutout
    (import the spline directly into the clamp sketch)
```

### Custom cutout from scan (fallback)

If no parametric shape fits within gasket tolerance:

1. Simplify the polyline — reduce point count while preserving shape (Douglas-Peucker algorithm)
2. Smooth the curve — apply a small smoothing filter to remove scan noise
3. Add uniform gasket offset — offset the curve outward by gasket_thickness
4. Import into Fusion 360 sketch as a spline through the simplified points
5. Use this custom profile instead of a circle/ellipse in the pipe clamp component

This means `PipeClamp` needs a new cutout mode: `shape_type: "custom"` with a reference to a point-cloud JSON file.

---

## Integration with Test Ring Workflow

The 3D scan enhances but does not replace the test ring workflow:

```
┌─────────────────────────────────────────────────┐
│                WORKFLOW OPTIONS                  │
├─────────────────────────────────────────────────┤
│                                                  │
│  Option A: Measurements only (no scan)           │
│  ├─ Take manual measurements                    │
│  ├─ Generate test rings (Round 1)                │
│  ├─ Iterate until snug                           │
│  └─ Use winning shape for clamp                  │
│                                                  │
│  Option B: Scan-assisted (recommended)           │
│  ├─ Take manual measurements (coarse guide)      │
│  ├─ Scan tube cross-section                      │
│  ├─ Fit parametric shape to scan                 │
│  ├─ If good fit → generate 3 test rings          │
│  │     (center, tight, loose variants only)      │
│  │     instead of 7                              │
│  ├─ If poor fit → use raw scan as custom cutout  │
│  │     generate 1 test ring from scan profile    │
│  ├─ Print and test                               │
│  └─ Usually only 1 round needed                  │
│                                                  │
│  Option C: Scan only (highest confidence)        │
│  ├─ High-res scan at maker space                 │
│  ├─ Fit parametric shape                         │
│  ├─ Generate 1 test ring at best-fit             │
│  ├─ If it fits → go straight to clamp            │
│  └─ If not → fall back to Option A iteration     │
│                                                  │
└─────────────────────────────────────────────────┘
```

The scan reduces the number of test ring rounds needed. With a good scan (maker-space quality), you may only need a single confirmation ring instead of 2–3 rounds of iteration.

---

## Implementation Plan

### New files:

| File | Description |
|------|-------------|
| `fusionkit/scan/__init__.py` | Scan processing package |
| `fusionkit/scan/mesh_slicer.py` | Slice STL/OBJ mesh at a plane, extract 2D polyline |
| `fusionkit/scan/shape_fitter.py` | Fit circle/ellipse/pseudo-ellipse to a polyline, report residuals |
| `fusionkit/scan/profile_importer.py` | Import a raw polyline as a custom Fusion 360 sketch spline |
| `fusionkit/scan/contour_digitizer.py` | Process a photograph of a contour gauge tracing into coordinates |
| `configs/scan_profiles/` | Saved scan-derived cross-section point clouds |
| `tests/test_shape_fitter.py` | Validate circle/ellipse/pseudo-ellipse fitting |

### Dependencies:

- `trimesh` library for mesh slicing (`pip install trimesh`) — used outside Fusion, in preprocessing
- `numpy` and `scipy` for least-squares shape fitting — also preprocessing
- These are preprocessing steps that run on a workstation, not inside Fusion 360
- The output (a JSON of fitted parameters or a point cloud) is what gets loaded by Fusion

### Modified files:

| File | Change |
|------|--------|
| `fusionkit/geometry/shapes.py` | Add `CustomProfileShape` that draws a spline from point data |
| `fusionkit/components/pipe_clamp.py` | Accept `shape_type: "custom"` with point-cloud reference |
| `fusionkit/components/test_ring.py` | Accept custom profile for inner ring shape |

---

## Scan Data JSON Schema

```json
{
    "source": "polycam_lidar",
    "scanner": "iPhone 15 Pro",
    "date": "2025-03-31",
    "tube_description": "Trek Domane seat tube",
    "slice_position_mm": 150,
    
    "raw_points": [
        [17.1, 0.0],
        [16.8, 2.1],
        [15.9, 4.1],
        ...
    ],
    
    "best_fit": {
        "shape_type": "pseudo_ellipse",
        "width_mm": 34.2,
        "height_mm": 28.3,
        "semi_circle_radius_mm": 17.1,
        "flat_length_mm": 9.8,
        "max_residual_mm": 0.4,
        "mean_residual_mm": 0.15,
        "fit_quality": "good"
    },
    
    "gasket_assessment": {
        "gasket_thickness_mm": 1.0,
        "max_residual_mm": 0.4,
        "within_gasket_tolerance": true,
        "recommendation": "Use parametric pseudo-ellipse — gasket will cover 0.4mm max gap"
    }
}
```

---

## Accuracy Comparison

| Method | Accuracy | Time | Cost | Rounds Needed |
|--------|----------|------|------|---------------|
| Manual measurements only | ±1–2mm | 5 min | Free | 2–3 |
| Contour gauge + trace | ±0.5–1mm | 15 min | $10 | 1–2 |
| Phone scan (no LiDAR) | ±2–5mm | 10 min | Free | 2–3 |
| Phone scan (LiDAR) | ±0.5–2mm | 10 min | Free | 1–2 |
| Maker space 3D scanner | ±0.1–0.3mm | 30 min + travel | Free–$20 | 0–1 |

The sweet spot for most users is **contour gauge + manual measurements** — cheap, fast, and accurate enough for gasket-compensated clamps. The phone LiDAR scan is a close second if you have the hardware.

---

## Acceptance Criteria

1. System can import a scan mesh (STL/OBJ) and extract a cross-section at a specified position
2. System fits parametric shapes and reports residuals
3. If residual < gasket thickness, system recommends parametric shape with confidence
4. If residual > gasket thickness, system imports raw profile as custom cutout
5. Custom cutout works end-to-end through test ring generation and pipe clamp construction
6. Contour gauge photographs can be digitized into usable point data
