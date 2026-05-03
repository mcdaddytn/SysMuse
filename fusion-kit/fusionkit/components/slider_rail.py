"""
fusionkit.components.slider_rail
A pipe clamp body with an integral rail plate and travel slot. Mounts on
furniture-grade PVC pipe; the rail plate hosts a SliderCarriage that travels
orthogonally to the PVC axis.

See docs/features/FEATURE_slider_camera_bracket.md for full design.

Cross-section (XY plane), with the PVC axis along Z:

           ┌─────────────────────────┐  ← rail plate top (Y = +CH/2 + RT)
           │   (slot cuts through)   │
       ┌───┴───────────────────┴────┐  ← rail plate bottom / clamp body top
       │           shoulder shoulder │     (Y = +CH/2)
       │       ╭────────────╮        │
       │       │  PVC bore  │        │  ← clamp body
       │       ╰────────────╯        │
       │                             │
       └─────────────────────────────┘  ← clamp body bottom (Y = -CH/2)
                       ↑
                   bisect plane (xz, y=0) — body splits here

Bore is centered at origin so existing PipeClamp coordinate conventions
apply for clamp-bolt positioning. Rail plate is intentionally narrower than
the clamp body (RailPlateWidth < ClampBodyWidth) so the captured-nut wells
on the clamp body's back face remain accessible (not covered by the rail).

v1 limitations (deliberately simple — refine via the iterative loop):
- FastenerStyle is fixed to CapturedNutWithCap for clamp bolts.
- No edge fillets / chamfers (add via Fusion Connector + extractor → handler loop).
- Slot is straight-cut through the rail plate (no countersink for slot bolt head).
- RailPlateWidth must be < ClampBodyWidth (the T cross-section requires it).
"""

import adsk.core
import adsk.fusion
import math
import typing

from fusionkit.core.app_context import AppContext
from fusionkit.core.enums import FastenerStyle
from fusionkit.core.logger import FusionLogger
from fusionkit.components.component_base import ComponentBase
from fusionkit.geometry.shapes import SlotShape
from fusionkit.geometry.profile_selector import ProfileSelector
from fusionkit.features.extrude import ExtrudeOp
from fusionkit.features.hole_patterns import BoltHoleSpec, HolePatternDriller
from fusionkit.features.split import BodySplitter


class SliderRail(ComponentBase):
    """
    Parametric slider rail: clamp body wrapping PVC + integral rail plate
    with a travel slot. Body splits at xz-plane into ScrewSide (clamp lower
    half) and NutSide_WithRail (clamp upper half + entire rail plate).

    JSON config keys (all lengths in mm, converted to cm internally):
        PvcOuterDiameter:       PVC OD (drives clamp bore)
        ClampBodyLength:        extrusion length along PVC axis (Z)
        ClampBodyWidth:         clamp cross-section X dimension
        ClampBodyHeight:        clamp cross-section Y dimension (full Y, both halves)
        RailPlateWidth:         rail plate X dimension (must be < ClampBodyWidth)
        RailPlateThickness:     rail plate Y thickness above clamp body's top edge
        SlotLength:             slot's long-axis (X) extent
        SlotWidth:              slot's cross-axis (Z) extent = bolt + clearance

        ScrewDiameter, ScrewHeadDiameter, ScrewHeadDepth: clamp bolt dims
        NutWidth, NutThickness:                          captured nut dims
        CapClearance, CapDepth:                          glued cap recess dims
        NumClampBolts:                                   typically 2

        SketchOnly:             debug; stop after sketch
    """

    def build(self) -> typing.List[adsk.fusion.BRepBody]:
        self.log("Starting SliderRail build")

        # ── Read parameters (all in API units = cm after ParamLoader) ────
        pvc_od: float = self.get_float('PvcOuterDiameter')
        clamp_length: float = self.get_float('ClampBodyLength')
        clamp_width: float = self.get_float('ClampBodyWidth')
        clamp_height: float = self.get_float('ClampBodyHeight')
        rail_width: float = self.get_float('RailPlateWidth')
        rail_thickness: float = self.get_float('RailPlateThickness')
        slot_length: float = self.get_float('SlotLength')
        slot_width: float = self.get_float('SlotWidth')
        sketch_only: bool = self.get_bool('SketchOnly', False)
        num_clamp_bolts: int = self.get_int('NumClampBolts', 2)

        # Validate v1 invariant: rail must be narrower than clamp
        if rail_width >= clamp_width:
            raise ValueError(
                f"SliderRail v1 requires RailPlateWidth ({rail_width}) < "
                f"ClampBodyWidth ({clamp_width}); the T cross-section relies on "
                f"the clamp shoulders being exposed for nut-well access."
            )

        # ── Step 1: Cross-section sketch (T outline + bore) ──────────────
        sketch: adsk.fusion.Sketch = self.sketch_mgr.create_on_plane('rail_cross_section', 'xy')
        self._draw_t_outline(sketch, clamp_width, clamp_height, rail_width, rail_thickness)
        self._draw_bore(sketch, pvc_od)

        if sketch_only:
            self.log("SketchOnly mode — stopping after sketch")
            return []

        # ── Step 2: Pick the outer profile and extrude ───────────────────
        # The largest profile is the T outline minus the bore.
        outer_profile: typing.Optional[adsk.fusion.Profile] = ProfileSelector.by_area_rank(
            sketch, rank=0, ascending=False
        )
        if outer_profile is None:
            raise RuntimeError("Could not find outer T profile in SliderRail cross-section")

        body: adsk.fusion.BRepBody = ExtrudeOp.new_body(
            self.ctx.root_comp, outer_profile, clamp_length
        )
        body.opacity = 0.8
        body.name = "SliderRailBody"
        self.log(f"Extruded body, length={clamp_length:.3f}")

        # ── Step 3: Drill clamp bolts (through clamp body, captured-nut-with-cap) ──
        bolt_spec: BoltHoleSpec = BoltHoleSpec(
            screw_diameter=self.get_float('ScrewDiameter'),
            screw_head_diameter=self.get_float('ScrewHeadDiameter'),
            screw_head_depth=self.get_float('ScrewHeadDepth'),
            nut_width=self.get_float('NutWidth'),
            nut_thickness=self.get_float('NutThickness'),
            fastener_style=FastenerStyle.CapturedNutWithCap,
            cap_clearance=self.get_float('CapClearance', 0.0),
            cap_depth=self.get_float('CapDepth', 0.0),
        )
        self._drill_clamp_bolts(
            body=body,
            spec=bolt_spec,
            clamp_width=clamp_width,
            clamp_height=clamp_height,
            clamp_length=clamp_length,
            pvc_od=pvc_od,
            num_bolts=num_clamp_bolts,
        )

        # ── Step 4: Cut the travel slot through the rail plate ───────────
        self._cut_slot(
            body=body,
            slot_length=slot_length,
            slot_width=slot_width,
            rail_thickness=rail_thickness,
            clamp_height=clamp_height,
            clamp_length=clamp_length,
        )

        # ── Step 5: Split at xz-plane ────────────────────────────────────
        self.log("Splitting body at xz-plane")
        splitter: BodySplitter = BodySplitter(self.ctx.root_comp)
        screw_side: adsk.fusion.BRepBody
        nut_side: adsk.fusion.BRepBody
        (nut_side, screw_side) = splitter.split_at_plane(body, 'xz')
        # split_at_plane returns (positive_y, negative_y); rail plate is on +Y side.
        screw_side.name = "ScrewSide"
        nut_side.name = "NutSide_WithRail"
        self.ctx.register_body("ScrewSide", screw_side)
        self.ctx.register_body("NutSide_WithRail", nut_side)

        self.bodies = [screw_side, nut_side]
        self.log("SliderRail build complete — 2 bodies created")
        return self.bodies

    # ── Internal helpers ─────────────────────────────────────────────────

    def _draw_t_outline(self,
                        sketch: adsk.fusion.Sketch,
                        clamp_width: float,
                        clamp_height: float,
                        rail_width: float,
                        rail_thickness: float) -> None:
        """Draw the T cross-section as 8 explicit lines, clockwise from bottom-left."""
        half_cw: float = clamp_width / 2.0
        half_ch: float = clamp_height / 2.0
        half_rw: float = rail_width / 2.0
        rail_top: float = half_ch + rail_thickness

        # Vertices of the T outline
        p1: adsk.core.Point3D = adsk.core.Point3D.create(-half_cw, -half_ch, 0)  # bottom-left clamp
        p2: adsk.core.Point3D = adsk.core.Point3D.create(+half_cw, -half_ch, 0)  # bottom-right clamp
        p3: adsk.core.Point3D = adsk.core.Point3D.create(+half_cw, +half_ch, 0)  # top-right clamp
        p4: adsk.core.Point3D = adsk.core.Point3D.create(+half_rw, +half_ch, 0)  # right shoulder inner
        p5: adsk.core.Point3D = adsk.core.Point3D.create(+half_rw, rail_top, 0)  # top-right rail
        p6: adsk.core.Point3D = adsk.core.Point3D.create(-half_rw, rail_top, 0)  # top-left rail
        p7: adsk.core.Point3D = adsk.core.Point3D.create(-half_rw, +half_ch, 0)  # left shoulder inner
        p8: adsk.core.Point3D = adsk.core.Point3D.create(-half_cw, +half_ch, 0)  # top-left clamp

        lines: adsk.fusion.SketchLines = sketch.sketchCurves.sketchLines
        lines.addByTwoPoints(p1, p2)
        lines.addByTwoPoints(p2, p3)
        lines.addByTwoPoints(p3, p4)
        lines.addByTwoPoints(p4, p5)
        lines.addByTwoPoints(p5, p6)
        lines.addByTwoPoints(p6, p7)
        lines.addByTwoPoints(p7, p8)
        lines.addByTwoPoints(p8, p1)

    def _draw_bore(self, sketch: adsk.fusion.Sketch, pvc_od: float) -> None:
        """Draw the PVC bore circle centered at origin."""
        circles: adsk.fusion.SketchCircles = sketch.sketchCurves.sketchCircles
        circles.addByCenterRadius(adsk.core.Point3D.create(0, 0, 0), pvc_od / 2.0)

    def _drill_clamp_bolts(self,
                           body: adsk.fusion.BRepBody,
                           spec: BoltHoleSpec,
                           clamp_width: float,
                           clamp_height: float,
                           clamp_length: float,
                           pvc_od: float,
                           num_bolts: int) -> None:
        """
        Drill clamp bolts through the clamp body's front face (-Y side),
        with captured-nut-with-cap retention on the clamp body's back face.

        The clamp body's back face (Y = +clamp_height/2) is the "shoulder"
        that's exposed because rail_width < clamp_width — the rail plate
        sits on the central portion only, leaving the shoulders accessible.

        Bolts positioned the same way as PipeClamp's drill_clamp_bolts:
        two columns flanking the bore at x ≈ ±(clamp_width - pvc_od)/4 from center.
        """
        sketches: adsk.fusion.Sketches = self.ctx.root_comp.sketches
        extrudes: adsk.fusion.ExtrudeFeatures = self.ctx.root_comp.features.extrudeFeatures
        xz_plane: adsk.fusion.ConstructionPlane = self.ctx.root_comp.xZConstructionPlane

        # Find the clamp body's back face: planar face whose centroid Y is
        # approximately +clamp_height/2. (The rail plate's top face has a
        # higher centroid Y; we want the lower one that matches the clamp body.)
        target_y: float = clamp_height / 2.0
        tolerance: float = 0.01  # cm
        clamp_back_face: typing.Optional[adsk.fusion.BRepFace] = None
        for face in body.faces:
            if abs(face.centroid.y - target_y) < tolerance:
                clamp_back_face = face
                break
        if clamp_back_face is None:
            raise RuntimeError(
                f"SliderRail: could not find clamp body back face at y={target_y:.3f}"
            )

        # Bolt position calculation (mirrors PipeClamp's drill_clamp_bolts)
        half_cw: float = clamp_width / 2.0
        half_ch: float = clamp_height / 2.0
        x_offset: float = (clamp_width - pvc_od) / 4.0
        z_offset: float = clamp_length / float(num_bolts + 1)
        x1: float = -half_cw + x_offset
        x2: float = +half_cw - x_offset
        y_pos: float = -half_ch  # front face (entry side)

        holes: typing.List[typing.Tuple[float, float]] = []
        z_pos: float = 0.0
        for _ in range(num_bolts):
            z_pos += z_offset
            holes.append((x1, z_pos))
            holes.append((x2, z_pos))

        driller: HolePatternDriller = HolePatternDriller(self.ctx.root_comp)

        for (x, z) in holes:
            # Countersink for bolt head on the front face
            head_sketch: adsk.fusion.Sketch = sketches.add(xz_plane)
            head_sketch.sketchCurves.sketchCircles.addByCenterRadius(
                adsk.core.Point3D.create(x, z * -1, y_pos),
                spec.screw_head_diameter / 2.0,
            )
            head_profile: adsk.fusion.Profile = head_sketch.profiles.item(0)
            head_input: adsk.fusion.ExtrudeFeatureInput = extrudes.createInput(
                head_profile, adsk.fusion.FeatureOperations.CutFeatureOperation
            )
            head_input.setDistanceExtent(
                False, adsk.core.ValueInput.createByReal(spec.screw_head_depth)
            )
            extrudes.add(head_input)

            # Through hole
            hole_sketch: adsk.fusion.Sketch = sketches.add(xz_plane)
            hole_sketch.sketchCurves.sketchCircles.addByCenterRadius(
                adsk.core.Point3D.create(x, z * -1, y_pos),
                spec.screw_diameter / 2.0,
            )
            hole_profile: adsk.fusion.Profile = hole_sketch.profiles.item(0)
            hole_input: adsk.fusion.ExtrudeFeatureInput = extrudes.createInput(
                hole_profile, adsk.fusion.FeatureOperations.CutFeatureOperation
            )
            hole_input.setDistanceExtent(
                False, adsk.core.ValueInput.createByReal(clamp_height)
            )
            extrudes.add(hole_input)

            # Captured-nut-with-cap on the back face (clamp shoulder)
            back_face_center: adsk.core.Point3D = adsk.core.Point3D.create(x * -1, z, 0)
            driller.carve_captured_nut_with_cap(
                clamp_back_face, back_face_center, spec, negative_direction=True,
            )

    def _cut_slot(self,
                  body: adsk.fusion.BRepBody,
                  slot_length: float,
                  slot_width: float,
                  rail_thickness: float,
                  clamp_height: float,
                  clamp_length: float) -> None:
        """Cut the travel slot through the rail plate from its top face downward."""
        sketches: adsk.fusion.Sketches = self.ctx.root_comp.sketches

        # Find the rail plate's top face: max Y centroid
        rail_top_face: adsk.fusion.BRepFace = max(
            body.faces, key=lambda f: f.centroid.y
        )

        # Sketch on the rail's top face. The slot is centered on the face;
        # the face is in the XZ world plane (centroid at world (0, +CH/2 + RT, CL/2)).
        # In sketch-local coordinates, modelToSketchSpace handles the conversion.
        slot_sketch: adsk.fusion.Sketch = sketches.add(rail_top_face)

        world_center: adsk.core.Point3D = adsk.core.Point3D.create(
            0, clamp_height / 2.0 + rail_thickness, clamp_length / 2.0
        )
        sketch_center: adsk.core.Point3D = slot_sketch.modelToSketchSpace(world_center)

        slot: SlotShape = SlotShape(
            center=sketch_center,
            length=slot_length,
            width=slot_width,
            long_axis_angle_rad=0.0,
        )
        slot.draw(slot_sketch)

        # Profile selection: smallest profile (slot interior)
        slot_profile: typing.Optional[adsk.fusion.Profile] = ProfileSelector.by_area_rank(
            slot_sketch, rank=0, ascending=True
        )
        if slot_profile is None:
            raise RuntimeError("SliderRail: could not find slot profile to cut")

        # Cut downward by rail thickness with a small overshoot for clean break-through
        cut_depth: float = rail_thickness * 1.1
        ExtrudeOp.cut(self.ctx.root_comp, slot_profile, -cut_depth)

    @classmethod
    def _default_param_types(cls) -> typing.Dict[str, typing.List[str]]:
        return {
            'bool': ['SketchOnly'],
            'int': ['NumClampBolts'],
            'float': [],
            'length': [
                'PvcOuterDiameter',
                'ClampBodyLength', 'ClampBodyWidth', 'ClampBodyHeight',
                'RailPlateWidth', 'RailPlateThickness',
                'SlotLength', 'SlotWidth',
                'ScrewDiameter', 'ScrewHeadDiameter', 'ScrewHeadDepth',
                'NutWidth', 'NutThickness',
                'CapClearance', 'CapDepth',
            ],
        }
