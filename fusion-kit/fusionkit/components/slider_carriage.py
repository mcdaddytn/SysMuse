"""
fusionkit.components.slider_carriage
A flat plate that mounts under a SmallRig (or similar) camera cage and rides
the slot of a SliderRail. Provides the orthogonal travel axis for the
sliding camera bracket.

See docs/features/FEATURE_slider_camera_bracket.md for full design.

Geometry (cross-section in XY plane, extruded along Z by PlateThickness):

         +Y │
            │
        ┌───┴───────────────────┐  ← top face: cage mount holes
        │                        │     (Z = +PlateThickness)
        │                        │
        │         (plate)        │
        │                        │
        │         (slot bolt     │
        │          through-hole) │
        └────────────────────────┘  ← bottom face: rests on rail (Z = 0)
        ←───── PlateLength ────→

The slot bolt enters from the top (head counterbored), passes through the
plate, through the rail's slot, and threads into a nut below the rail. The
optional captured-nut-with-cap variant places the nut inside the carriage
(top-face well with cap closing it from above) — selected by setting
CapturedSlotNut: true in the JSON config.

The optional lock screw threads into a brass insert in one side face,
providing a secondary clamping point that bears against the rail's top
surface to lock the carriage's position once tuned.

v1 limitations (refine via the iterative loop):
- CageMountPattern only supports 'SmallRig_Quarter20_Pair' (two clearance
  holes spaced CageBoltSpacing apart on a single line).
- No edge fillets / chamfers (add via Connector + extractor → handler loop).
- Lock-screw insert is on +X face only (no -X variant in v1).
"""

import adsk.core
import adsk.fusion
import typing

from fusionkit.core.app_context import AppContext
from fusionkit.core.enums import FastenerStyle, CageMountPattern
from fusionkit.core.logger import FusionLogger
from fusionkit.components.component_base import ComponentBase
from fusionkit.geometry.shapes import RectangleShape
from fusionkit.geometry.profile_selector import ProfileSelector
from fusionkit.features.extrude import ExtrudeOp
from fusionkit.features.hole_patterns import BoltHoleSpec, HolePatternDriller


class SliderCarriage(ComponentBase):
    """
    Parametric slider carriage: flat plate that mounts under a camera cage
    and rides the slot of a SliderRail.

    JSON config keys (lengths in mm):
        PlateLength:   carriage X dimension (along the slot's travel axis)
        PlateWidth:    carriage Z dimension (parallel to PVC axis)
        PlateThickness: carriage Y dimension (extrusion height)

        CageMountPattern: string from CageMountPattern enum;
                          v1 only handles 'SmallRig_Quarter20_Pair'
        CageBoltDiameter:        clearance hole for cage bolt
        CageBoltSpacing:         center-to-center spacing of cage bolts
        CageBoltCounterboreDiameter: optional counterbore on top face
        CageBoltCounterboreDepth:    counterbore depth

        SlotBoltDiameter:        through-hole diameter for slot bolt
        SlotBoltHeadDiameter:    counterbore diameter for slot bolt head (top)
        SlotBoltHeadDepth:       counterbore depth on top face
        CapturedSlotNut:         bool; if true, captured-nut-with-cap on top face
        NutWidth, NutThickness:  hex nut dims (used when CapturedSlotNut is true)
        CapClearance, CapDepth:  cap recess dims

        LockScrewEnabled:        bool
        LockScrewInsertDiameter: brass insert OD
        LockScrewInsertDepth:    brass insert pocket depth

        SketchOnly:              debug; stop after sketch
    """

    def build(self) -> typing.List[adsk.fusion.BRepBody]:
        self.log("Starting SliderCarriage build")

        # ── Read parameters ──────────────────────────────────────────────
        plate_length: float = self.get_float('PlateLength')
        plate_width: float = self.get_float('PlateWidth')
        plate_thickness: float = self.get_float('PlateThickness')
        sketch_only: bool = self.get_bool('SketchOnly', False)

        cage_pattern_str: str = self.get_param('CageMountPattern', 'SmallRig_Quarter20_Pair')
        cage_bolt_dia: float = self.get_float('CageBoltDiameter')
        cage_bolt_spacing: float = self.get_float('CageBoltSpacing')
        cage_cbore_dia: float = self.get_float('CageBoltCounterboreDiameter', 0.0)
        cage_cbore_depth: float = self.get_float('CageBoltCounterboreDepth', 0.0)

        slot_bolt_dia: float = self.get_float('SlotBoltDiameter')
        slot_head_dia: float = self.get_float('SlotBoltHeadDiameter')
        slot_head_depth: float = self.get_float('SlotBoltHeadDepth')
        captured_slot_nut: bool = self.get_bool('CapturedSlotNut', False)

        lock_screw_enabled: bool = self.get_bool('LockScrewEnabled', False)
        lock_insert_dia: float = self.get_float('LockScrewInsertDiameter', 0.0)
        lock_insert_depth: float = self.get_float('LockScrewInsertDepth', 0.0)

        # ── Step 1: Cross-section sketch (rectangle) and extrude ─────────
        sketch: adsk.fusion.Sketch = self.sketch_mgr.create_on_plane(
            'carriage_outline', 'xy'
        )
        half_l: float = plate_length / 2.0
        half_w: float = plate_width / 2.0
        rect: RectangleShape = RectangleShape(
            point_one=adsk.core.Point3D.create(-half_l, -half_w, 0),
            point_two=adsk.core.Point3D.create(+half_l, +half_w, 0),
            fillet_radius=0.0,  # v1: no corner fillets
        )
        rect.draw(sketch)

        if sketch_only:
            self.log("SketchOnly mode")
            return []

        outer_profile: typing.Optional[adsk.fusion.Profile] = ProfileSelector.by_bounding_box(
            sketch, plate_length, plate_width
        )
        if outer_profile is None:
            outer_profile = ProfileSelector.by_area_rank(sketch, rank=0, ascending=False)
        if outer_profile is None:
            raise RuntimeError("SliderCarriage: could not find outer plate profile")

        body: adsk.fusion.BRepBody = ExtrudeOp.new_body(
            self.ctx.root_comp, outer_profile, plate_thickness
        )
        body.opacity = 0.85
        body.name = "SliderCarriageBody"
        self.log(f"Extruded carriage, {plate_length:.3f} × {plate_width:.3f} × {plate_thickness:.3f}")

        # ── Step 2: Cage mount holes on top face ─────────────────────────
        self._drill_cage_holes(
            body=body,
            pattern=cage_pattern_str,
            bolt_diameter=cage_bolt_dia,
            spacing=cage_bolt_spacing,
            counterbore_diameter=cage_cbore_dia,
            counterbore_depth=cage_cbore_depth,
            plate_thickness=plate_thickness,
        )

        # ── Step 3: Slot bolt through-hole + optional captured nut ───────
        self._drill_slot_bolt(
            body=body,
            slot_bolt_dia=slot_bolt_dia,
            head_dia=slot_head_dia,
            head_depth=slot_head_depth,
            plate_thickness=plate_thickness,
            captured=captured_slot_nut,
        )

        # ── Step 4: Optional lock screw on +X side face ──────────────────
        if lock_screw_enabled:
            self._drill_lock_screw_insert(
                body=body,
                insert_diameter=lock_insert_dia,
                insert_depth=lock_insert_depth,
                plate_length=plate_length,
            )

        self.bodies = [body]
        self.log("SliderCarriage build complete — 1 body created")
        return self.bodies

    # ── Internal helpers ─────────────────────────────────────────────────

    def _drill_cage_holes(self,
                          body: adsk.fusion.BRepBody,
                          pattern: str,
                          bolt_diameter: float,
                          spacing: float,
                          counterbore_diameter: float,
                          counterbore_depth: float,
                          plate_thickness: float) -> None:
        """Drill cage-mount holes from the top face according to pattern."""
        # v1: only one pattern supported
        if pattern != CageMountPattern.SmallRig_Quarter20_Pair.value:
            raise NotImplementedError(
                f"SliderCarriage v1 only supports CageMountPattern="
                f"'{CageMountPattern.SmallRig_Quarter20_Pair.value}'; got '{pattern}'. "
                f"Add other patterns via the iterative loop as needed."
            )

        # Pair of holes along X (the long axis of the carriage), centered on Z
        positions: typing.List[typing.Tuple[float, float]] = [
            (-spacing / 2.0, 0.0),
            (+spacing / 2.0, 0.0),
        ]
        sketches: adsk.fusion.Sketches = self.ctx.root_comp.sketches
        xy_plane: adsk.fusion.ConstructionPlane = self.ctx.root_comp.xYConstructionPlane
        z_top: float = plate_thickness  # top face Z

        for (x, z) in positions:
            # Counterbore on top face (if specified)
            if counterbore_diameter > 0.0 and counterbore_depth > 0.0:
                cbore_sketch: adsk.fusion.Sketch = sketches.add(xy_plane)
                cbore_sketch.sketchCurves.sketchCircles.addByCenterRadius(
                    adsk.core.Point3D.create(x, z, z_top),
                    counterbore_diameter / 2.0,
                )
                cbore_profile: adsk.fusion.Profile = cbore_sketch.profiles.item(0)
                ExtrudeOp.cut(self.ctx.root_comp, cbore_profile, -counterbore_depth)

            # Through hole
            hole_sketch: adsk.fusion.Sketch = sketches.add(xy_plane)
            hole_sketch.sketchCurves.sketchCircles.addByCenterRadius(
                adsk.core.Point3D.create(x, z, z_top),
                bolt_diameter / 2.0,
            )
            hole_profile: adsk.fusion.Profile = hole_sketch.profiles.item(0)
            ExtrudeOp.cut(self.ctx.root_comp, hole_profile, -plate_thickness)

    def _drill_slot_bolt(self,
                         body: adsk.fusion.BRepBody,
                         slot_bolt_dia: float,
                         head_dia: float,
                         head_depth: float,
                         plate_thickness: float,
                         captured: bool) -> None:
        """
        Drill the slot bolt's through-hole at the carriage center, with a
        head counterbore on the top face. Optionally adds a captured-nut-with-cap
        well on the top face (above the through-hole, opening upward) when
        `captured` is True.
        """
        sketches: adsk.fusion.Sketches = self.ctx.root_comp.sketches
        xy_plane: adsk.fusion.ConstructionPlane = self.ctx.root_comp.xYConstructionPlane
        z_top: float = plate_thickness

        center_xy: adsk.core.Point3D = adsk.core.Point3D.create(0, 0, z_top)

        # Head counterbore on top face
        if head_dia > 0.0 and head_depth > 0.0:
            head_sketch: adsk.fusion.Sketch = sketches.add(xy_plane)
            head_sketch.sketchCurves.sketchCircles.addByCenterRadius(
                center_xy, head_dia / 2.0
            )
            head_profile: adsk.fusion.Profile = head_sketch.profiles.item(0)
            ExtrudeOp.cut(self.ctx.root_comp, head_profile, -head_depth)

        # Through hole (full plate thickness)
        thru_sketch: adsk.fusion.Sketch = sketches.add(xy_plane)
        thru_sketch.sketchCurves.sketchCircles.addByCenterRadius(
            center_xy, slot_bolt_dia / 2.0
        )
        thru_profile: adsk.fusion.Profile = thru_sketch.profiles.item(0)
        ExtrudeOp.cut(self.ctx.root_comp, thru_profile, -plate_thickness)

        # Captured-nut-with-cap on the TOP face (optional)
        # When enabled, the nut is captured in a well opening upward; the cap
        # closes the well from above. This requires the user to install the
        # nut + cap before the cage is mounted on top.
        if captured:
            top_face: adsk.fusion.BRepFace = max(body.faces, key=lambda f: f.centroid.z)
            spec: BoltHoleSpec = BoltHoleSpec(
                screw_diameter=slot_bolt_dia,
                screw_head_diameter=head_dia,
                screw_head_depth=head_depth,
                nut_width=self.get_float('NutWidth'),
                nut_thickness=self.get_float('NutThickness'),
                fastener_style=FastenerStyle.CapturedNutWithCap,
                cap_clearance=self.get_float('CapClearance', 0.0),
                cap_depth=self.get_float('CapDepth', 0.0),
            )
            driller: HolePatternDriller = HolePatternDriller(self.ctx.root_comp)
            # Center is at origin in sketch-local coords for a sketch on the top face
            top_face_sketch_center: adsk.core.Point3D = sketches.add(top_face).modelToSketchSpace(
                adsk.core.Point3D.create(0, 0, z_top)
            )
            driller.carve_captured_nut_with_cap(
                top_face, top_face_sketch_center, spec, negative_direction=True,
            )

    def _drill_lock_screw_insert(self,
                                 body: adsk.fusion.BRepBody,
                                 insert_diameter: float,
                                 insert_depth: float,
                                 plate_length: float) -> None:
        """Drill a brass-insert pocket on the +X side face."""
        sketches: adsk.fusion.Sketches = self.ctx.root_comp.sketches
        # Find the +X face: planar face whose centroid X is approximately +plate_length/2
        target_x: float = plate_length / 2.0
        tolerance: float = 0.01
        side_face: typing.Optional[adsk.fusion.BRepFace] = None
        for face in body.faces:
            if abs(face.centroid.x - target_x) < tolerance:
                side_face = face
                break
        if side_face is None:
            raise RuntimeError(
                f"SliderCarriage: could not find +X side face at x={target_x:.3f}"
            )

        spec: BoltHoleSpec = BoltHoleSpec(
            screw_diameter=self.get_float('LockScrewDiameter', insert_diameter),
            screw_head_diameter=0.0,
            screw_head_depth=0.0,
            nut_width=0.0,
            nut_thickness=0.0,
            fastener_style=FastenerStyle.ThreadedInsertM4,
            insert_outer_diameter=insert_diameter,
            insert_depth=insert_depth,
        )
        driller: HolePatternDriller = HolePatternDriller(self.ctx.root_comp)

        # Center on the side face — sketch local coordinates
        side_sketch_center: adsk.core.Point3D = sketches.add(side_face).modelToSketchSpace(
            adsk.core.Point3D.create(target_x, 0, self.get_float('PlateThickness') / 2.0)
        )
        driller.drill_threaded_insert(
            side_face, side_sketch_center, spec, negative_direction=True,
        )

    @classmethod
    def _default_param_types(cls) -> typing.Dict[str, typing.List[str]]:
        return {
            'bool': ['SketchOnly', 'CapturedSlotNut', 'LockScrewEnabled'],
            'int': [],
            'float': [],
            'length': [
                'PlateLength', 'PlateWidth', 'PlateThickness',
                'CageBoltDiameter', 'CageBoltSpacing',
                'CageBoltCounterboreDiameter', 'CageBoltCounterboreDepth',
                'SlotBoltDiameter', 'SlotBoltHeadDiameter', 'SlotBoltHeadDepth',
                'NutWidth', 'NutThickness',
                'CapClearance', 'CapDepth',
                'LockScrewDiameter', 'LockScrewInsertDiameter', 'LockScrewInsertDepth',
            ],
        }
