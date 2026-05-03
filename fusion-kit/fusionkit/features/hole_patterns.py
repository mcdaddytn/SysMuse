"""
fusionkit.features.hole_patterns
Bolt hole drilling, hex nut well carving, countersink generation, and notch cutting.
This is the core fastener integration module for pipe clamp assembly.
"""

import adsk.core
import adsk.fusion
import dataclasses
import math
import typing

from fusionkit.core.enums import FastenerStyle


@dataclasses.dataclass
class BoltHoleSpec:
    """
    Complete specification for one bolt hole with optional countersink and nut well.
    All dimensions in API units (cm).

    Backward compatibility: the first five fields preserve the original API.
    New fields (fastener_style, cap_*, insert_*) have defaults that match
    the prior behavior — existing call sites continue to work unchanged.
    """
    screw_diameter: float         # Clearance hole diameter (e.g., 0.42 for M4)
    screw_head_diameter: float    # Countersink diameter (e.g., 0.77 for M4 socket cap)
    screw_head_depth: float       # Countersink depth (e.g., 0.5)
    nut_width: float              # Hex nut across-flats (e.g., 0.9 for M4)
    nut_thickness: float          # Hex nut height / well depth (e.g., 0.4)

    # ── Extended fields for FastenerStyle dispatch ───────────────────────
    # Default = CapturedNut, which preserves pre-extension behavior.
    fastener_style: FastenerStyle = FastenerStyle.CapturedNut

    # CapturedNutWithCap parameters (ignored for other styles)
    cap_clearance: float = 0.0     # extra width-across-flats on the cap (cm)
    cap_depth: float = 0.0         # depth of the cap recess from outer face (cm)

    # ThreadedInsert parameters (ignored for other styles)
    insert_outer_diameter: float = 0.0  # OD of the brass insert pocket (cm)
    insert_depth: float = 0.0           # how deep the insert pocket extends (cm)


class HolePatternDriller:
    """
    Drills various patterns of bolt holes into bodies.
    Handles clamp bolts (through-bolt with nut well), inner bolts (perpendicular),
    and outer bolts (top-down pattern with countersink).
    """

    def __init__(self, root_comp: adsk.fusion.Component) -> None:
        self.root_comp: adsk.fusion.Component = root_comp

    def drill_clamp_bolts(
        self,
        body: adsk.fusion.BRepBody,
        spec: BoltHoleSpec,
        rect_edge_x: float,
        rect_edge_y: float,
        object_depth: float,
        circle_diameter: float,
        num_bolts: int,
    ) -> None:
        """
        Drill clamp bolt holes through the front face, perpendicular to the pipe axis.
        These are the bolts that clamp the two halves together.

        Positions: Two columns flanking the pipe cutout, evenly spaced along Z.
        Each hole gets a countersink on the front face and a hex nut well on the back face.

        Migrated from GLPipeClamp11.py::drillBoltHoles()
        """
        sketches: adsk.fusion.Sketches = self.root_comp.sketches
        xz_plane: adsk.fusion.ConstructionPlane = self.root_comp.xZConstructionPlane

        # Find faces for nut placement
        faces: adsk.fusion.BRepFaces = body.faces
        back_face: adsk.fusion.BRepFace = max(faces, key=lambda f: f.centroid.y)

        # Calculate bolt positions
        x_offset: float = (rect_edge_x - circle_diameter) / 4.0
        z_offset: float = object_depth / (num_bolts + 1)
        x1: float = (-rect_edge_x / 2.0) + x_offset
        x2: float = (rect_edge_x / 2.0) - x_offset
        y_pos: float = (-rect_edge_y / 2.0)

        holes: typing.List[typing.Tuple[float, float]] = []
        z_pos: float = 0.0
        for bolt_idx in range(num_bolts):
            z_pos += z_offset
            holes.append((x1, z_pos))
            holes.append((x2, z_pos))

        for (x, z) in holes:
            # Countersink on front face
            head_sketch: adsk.fusion.Sketch = sketches.add(xz_plane)
            head_circle: adsk.fusion.SketchCircle = head_sketch.sketchCurves.sketchCircles.addByCenterRadius(
                adsk.core.Point3D.create(x, z * -1, y_pos), spec.screw_head_diameter / 2.0
            )
            head_profile: adsk.fusion.Profile = head_sketch.profiles.item(0)
            head_ext_input: adsk.fusion.ExtrudeFeatureInput = self.root_comp.features.extrudeFeatures.createInput(
                head_profile, adsk.fusion.FeatureOperations.CutFeatureOperation
            )
            head_ext_input.setDistanceExtent(False, adsk.core.ValueInput.createByReal(spec.screw_head_depth))
            self.root_comp.features.extrudeFeatures.add(head_ext_input)

            # Through hole
            hole_sketch: adsk.fusion.Sketch = sketches.add(xz_plane)
            hole_circle: adsk.fusion.SketchCircle = hole_sketch.sketchCurves.sketchCircles.addByCenterRadius(
                adsk.core.Point3D.create(x, z * -1, y_pos), spec.screw_diameter / 2.0
            )
            hole_profile: adsk.fusion.Profile = hole_sketch.profiles.item(0)
            hole_ext_input: adsk.fusion.ExtrudeFeatureInput = self.root_comp.features.extrudeFeatures.createInput(
                hole_profile, adsk.fusion.FeatureOperations.CutFeatureOperation
            )
            hole_ext_input.setDistanceExtent(False, adsk.core.ValueInput.createByReal(rect_edge_y))
            self.root_comp.features.extrudeFeatures.add(hole_ext_input)

            # Nut / cap / insert retention on back face — dispatch on fastener_style.
            # Default (CapturedNut) preserves the original geometry exactly.
            back_face_center: adsk.core.Point3D = adsk.core.Point3D.create(x * -1, z, 0)
            self._dispatch_retention(
                back_face,
                back_face_center,
                spec,
                negative_direction=True,
            )

    def drill_inner_bolts(
        self,
        body: adsk.fusion.BRepBody,
        spec: BoltHoleSpec,
        rect_edge_x: float,
        rect_edge_y: float,
        object_depth: float,
        circle_diameter: float,
        circle_ext: float,
        orient_wide: bool,
        inner_bolt_length: float,
        num_bolts: int,
    ) -> None:
        """
        Drill inner bolt holes perpendicular to the clamp bolts.
        These go through the side faces, with hex nut wells on both sides.

        Migrated from GLPipeClamp11.py::drillInnerBoltHoles()
        """
        sketches: adsk.fusion.Sketches = self.root_comp.sketches
        xz_plane: adsk.fusion.ConstructionPlane = self.root_comp.xZConstructionPlane
        half_edge_y: float = rect_edge_y / 2.0
        circle_radius: float = circle_diameter / 2.0
        half_circle_ext: float = circle_ext / 2.0

        z_offset: float = object_depth / (num_bolts + 1)
        x_pos: float = 0.0

        holes: typing.List[typing.Tuple[float, float]] = []
        z_pos: float = 0.0
        for bolt_idx in range(num_bolts):
            z_pos += z_offset
            holes.append((x_pos, z_pos))

        for (x, z) in holes:
            # Through hole in both directions
            hole_sketch: adsk.fusion.Sketch = sketches.add(xz_plane)
            hole_circle: adsk.fusion.SketchCircle = hole_sketch.sketchCurves.sketchCircles.addByCenterRadius(
                adsk.core.Point3D.create(x, z * -1, 0), spec.screw_diameter / 2.0
            )
            hole_profile: adsk.fusion.Profile = hole_sketch.profiles.item(0)

            # Drill positive Y direction
            ext_input_pos: adsk.fusion.ExtrudeFeatureInput = self.root_comp.features.extrudeFeatures.createInput(
                hole_profile, adsk.fusion.FeatureOperations.CutFeatureOperation
            )
            ext_input_pos.setDistanceExtent(False, adsk.core.ValueInput.createByReal(half_edge_y))
            self.root_comp.features.extrudeFeatures.add(ext_input_pos)

            # Drill negative Y direction
            ext_input_neg: adsk.fusion.ExtrudeFeatureInput = self.root_comp.features.extrudeFeatures.createInput(
                hole_profile, adsk.fusion.FeatureOperations.CutFeatureOperation
            )
            ext_input_neg.setDistanceExtent(False, adsk.core.ValueInput.createByReal(-half_edge_y))
            self.root_comp.features.extrudeFeatures.add(ext_input_neg)

            # Hex nut wells on both sides
            dist_to_solid: float = circle_radius
            if circle_ext > 0 and not orient_wide:
                dist_to_solid += half_circle_ext

            min_nut_extrude: float = dist_to_solid + spec.nut_thickness
            nut_extrude_depth: float = min_nut_extrude
            if (half_edge_y - dist_to_solid) > inner_bolt_length:
                nut_extrude_depth = (half_edge_y - inner_bolt_length) + spec.nut_thickness

            # Nut well sketch on xz plane (projected onto both sides)
            nut_sketch: adsk.fusion.Sketch = sketches.add(xz_plane)
            hex_radius: float = spec.nut_width / 2.0
            hex_angle: float = 360.0 / 6.0
            points: typing.List[adsk.core.Point3D] = []
            for i in range(6):
                px: float = -1 * (x + hex_radius * math.cos(math.radians(i * hex_angle)))
                py: float = z + hex_radius * math.sin(math.radians(i * hex_angle))
                py -= object_depth  # Coordinate transform hack for xz plane
                point: adsk.core.Point3D = adsk.core.Point3D.create(px, py, 0)
                points.append(point)

            hex_lines: adsk.fusion.SketchLineList = nut_sketch.sketchCurves.sketchLines.addEdgePolygon(
                points[0], points[1], True, 6
            )
            nut_profile: adsk.fusion.Profile = nut_sketch.profiles.item(0)

            # Cut nut well in negative direction
            nut_ext_neg: adsk.fusion.ExtrudeFeatureInput = self.root_comp.features.extrudeFeatures.createInput(
                nut_profile, adsk.fusion.FeatureOperations.CutFeatureOperation
            )
            nut_ext_neg.setDistanceExtent(False, adsk.core.ValueInput.createByReal(-nut_extrude_depth))
            self.root_comp.features.extrudeFeatures.add(nut_ext_neg)

            # Cut nut well in positive direction
            nut_ext_pos: adsk.fusion.ExtrudeFeatureInput = self.root_comp.features.extrudeFeatures.createInput(
                nut_profile, adsk.fusion.FeatureOperations.CutFeatureOperation
            )
            nut_ext_pos.setDistanceExtent(False, adsk.core.ValueInput.createByReal(nut_extrude_depth))
            self.root_comp.features.extrudeFeatures.add(nut_ext_pos)

    def drill_outer_bolts(
        self,
        body: adsk.fusion.BRepBody,
        spec: BoltHoleSpec,
        object_depth: float,
        x_offset: float,
        y_offset: float,
    ) -> None:
        """
        Drill 4 bolt holes through the top face in a rectangular pattern.
        Each gets a countersink for the bolt head on top.

        Migrated from GLPipeClamp11.py::drillOuterBoltHoles()
        """
        sketches: adsk.fusion.Sketches = self.root_comp.sketches
        xy_plane: adsk.fusion.ConstructionPlane = self.root_comp.xYConstructionPlane
        z_pos: float = object_depth

        hole_positions: typing.List[typing.Tuple[float, float]] = [
            (x_offset, y_offset),
            (x_offset, -y_offset),
            (-x_offset, y_offset),
            (-x_offset, -y_offset),
        ]

        for (x, y) in hole_positions:
            # Countersink
            head_sketch: adsk.fusion.Sketch = sketches.add(xy_plane)
            head_sketch.sketchCurves.sketchCircles.addByCenterRadius(
                adsk.core.Point3D.create(x, y, z_pos), spec.screw_head_diameter / 2.0
            )
            head_profile: adsk.fusion.Profile = head_sketch.profiles.item(0)
            head_ext: adsk.fusion.ExtrudeFeatureInput = self.root_comp.features.extrudeFeatures.createInput(
                head_profile, adsk.fusion.FeatureOperations.CutFeatureOperation
            )
            head_ext.setDistanceExtent(False, adsk.core.ValueInput.createByReal(-spec.screw_head_depth))
            self.root_comp.features.extrudeFeatures.add(head_ext)

            # Through hole
            hole_sketch: adsk.fusion.Sketch = sketches.add(xy_plane)
            hole_sketch.sketchCurves.sketchCircles.addByCenterRadius(
                adsk.core.Point3D.create(x, y, z_pos), spec.screw_diameter / 2.0
            )
            hole_profile: adsk.fusion.Profile = hole_sketch.profiles.item(0)
            hole_ext: adsk.fusion.ExtrudeFeatureInput = self.root_comp.features.extrudeFeatures.createInput(
                hole_profile, adsk.fusion.FeatureOperations.CutFeatureOperation
            )
            hole_ext.setDistanceExtent(False, adsk.core.ValueInput.createByReal(-object_depth))
            self.root_comp.features.extrudeFeatures.add(hole_ext)

    # ── Internal: hex point computation (shared by all retention styles) ──

    @staticmethod
    def _hex_points(
        center: adsk.core.Point3D,
        across_flats: float,
    ) -> typing.List[adsk.core.Point3D]:
        """Return six points around a regular hexagon centered at `center`.
        `across_flats` is the nut width (distance across flats); the radius
        passed to addEdgePolygon is half of that. The polygon is drawn in
        the sketch's local 2D coordinates; the caller must ensure `center`
        is in those coordinates."""
        hex_radius: float = across_flats / 2.0
        hex_angle: float = 360.0 / 6.0
        points: typing.List[adsk.core.Point3D] = []
        for i in range(6):
            angle_rad: float = math.radians(i * hex_angle)
            px: float = center.x + hex_radius * math.cos(angle_rad)
            py: float = center.y + hex_radius * math.sin(angle_rad)
            point: adsk.core.Point3D = adsk.core.Point3D.create(px, py, center.z)
            points.append(point)
        return points

    # ── Retention dispatch ───────────────────────────────────────────────

    def _dispatch_retention(
        self,
        face: adsk.fusion.BRepFace,
        center: adsk.core.Point3D,
        spec: BoltHoleSpec,
        negative_direction: bool,
    ) -> None:
        """
        Carve the bolt-side retention feature (nut well / cap recess /
        insert pocket / nothing) on the given face according to
        spec.fastener_style. Each branch creates its own sketch on the face.
        """
        sketches: adsk.fusion.Sketches = self.root_comp.sketches

        if spec.fastener_style == FastenerStyle.CapturedNut:
            sketch: adsk.fusion.Sketch = sketches.add(face)
            self._draw_hex_nut_well(
                sketch, center, spec.nut_width, spec.nut_thickness,
                negative_direction=negative_direction,
            )
        elif spec.fastener_style == FastenerStyle.CapturedNutWithCap:
            self.carve_captured_nut_with_cap(
                face, center, spec, negative_direction=negative_direction,
            )
        elif spec.fastener_style == FastenerStyle.ThreadedIntoPlastic:
            # No retention feature — bolt threads tap directly into plastic.
            pass
        elif spec.fastener_style.value.startswith('ThreadedInsert'):
            self.drill_threaded_insert(
                face, center, spec, negative_direction=negative_direction,
            )

    # ── Public retention helpers (callable directly by components) ───────

    def carve_captured_nut_with_cap(
        self,
        face: adsk.fusion.BRepFace,
        center: adsk.core.Point3D,
        spec: BoltHoleSpec,
        negative_direction: bool = False,
    ) -> None:
        """
        Two-stage hex pocket: an inner nut well at depth (cap_depth + nut_thickness)
        from the outer face, plus a slightly larger hex cap recess at depth cap_depth.
        The captured nut sits in the inner well; the printed hex cap is glued into
        the outer recess after assembly to permanently retain the nut.

        Geometry from the outer face inward:
            outer face → cap recess (depth = spec.cap_depth,
                                     width across flats = spec.nut_width + 2 * spec.cap_clearance)
                      → inner nut well (depth = spec.nut_thickness,
                                        width across flats = spec.nut_width)

        Implementation: two separate sketches and two extrude-cuts. Cap recess is
        cut to spec.cap_depth, inner well is cut to (cap_depth + nut_thickness),
        producing a stepped hex pocket. The cap recess overlap with the inner well
        in the cap_depth region is harmless (extrude-cut is idempotent there).
        """
        sketches: adsk.fusion.Sketches = self.root_comp.sketches
        extrudes: adsk.fusion.ExtrudeFeatures = self.root_comp.features.extrudeFeatures

        # ── Inner hex well: full depth (cap_depth + nut_thickness) ───────
        inner_sketch: adsk.fusion.Sketch = sketches.add(face)
        inner_points: typing.List[adsk.core.Point3D] = self._hex_points(center, spec.nut_width)
        inner_sketch.sketchCurves.sketchLines.addEdgePolygon(
            inner_points[0], inner_points[1], True, 6
        )
        inner_profile: adsk.fusion.Profile = inner_sketch.profiles.item(0)
        inner_total_depth: float = spec.cap_depth + spec.nut_thickness
        inner_signed: float = -inner_total_depth if negative_direction else inner_total_depth
        inner_input: adsk.fusion.ExtrudeFeatureInput = extrudes.createInput(
            inner_profile, adsk.fusion.FeatureOperations.CutFeatureOperation
        )
        inner_input.setDistanceExtent(False, adsk.core.ValueInput.createByReal(inner_signed))
        extrudes.add(inner_input)

        # ── Outer cap recess: depth = cap_depth, width = nut_width + 2*cap_clearance ──
        cap_sketch: adsk.fusion.Sketch = sketches.add(face)
        cap_across_flats: float = spec.nut_width + 2.0 * spec.cap_clearance
        cap_points: typing.List[adsk.core.Point3D] = self._hex_points(center, cap_across_flats)
        cap_sketch.sketchCurves.sketchLines.addEdgePolygon(
            cap_points[0], cap_points[1], True, 6
        )
        cap_profile: adsk.fusion.Profile = cap_sketch.profiles.item(0)
        cap_signed: float = -spec.cap_depth if negative_direction else spec.cap_depth
        cap_input: adsk.fusion.ExtrudeFeatureInput = extrudes.createInput(
            cap_profile, adsk.fusion.FeatureOperations.CutFeatureOperation
        )
        cap_input.setDistanceExtent(False, adsk.core.ValueInput.createByReal(cap_signed))
        extrudes.add(cap_input)

    def drill_threaded_insert(
        self,
        face: adsk.fusion.BRepFace,
        center: adsk.core.Point3D,
        spec: BoltHoleSpec,
        negative_direction: bool = False,
    ) -> None:
        """
        Drill a circular pocket sized for a threaded brass insert (heat-set or
        press-fit). No nut well — the insert provides the threads. The pocket
        OD is spec.insert_outer_diameter and depth is spec.insert_depth.
        """
        sketches: adsk.fusion.Sketches = self.root_comp.sketches
        insert_sketch: adsk.fusion.Sketch = sketches.add(face)
        insert_sketch.sketchCurves.sketchCircles.addByCenterRadius(
            center, spec.insert_outer_diameter / 2.0
        )
        insert_profile: adsk.fusion.Profile = insert_sketch.profiles.item(0)
        depth_signed: float = -spec.insert_depth if negative_direction else spec.insert_depth
        insert_input: adsk.fusion.ExtrudeFeatureInput = self.root_comp.features.extrudeFeatures.createInput(
            insert_profile, adsk.fusion.FeatureOperations.CutFeatureOperation
        )
        insert_input.setDistanceExtent(False, adsk.core.ValueInput.createByReal(depth_signed))
        self.root_comp.features.extrudeFeatures.add(insert_input)

    # ── Internal: original CapturedNut implementation (preserved) ────────

    def _draw_hex_nut_well(
        self,
        sketch: adsk.fusion.Sketch,
        center: adsk.core.Point3D,
        nut_width: float,
        nut_depth: float,
        negative_direction: bool = False,
    ) -> None:
        """
        Draw and cut a hexagonal nut well. The default CapturedNut behavior;
        used for backward compatibility with existing pipe clamp configs.

        Args:
            sketch: Sketch on the face where the nut well goes.
            center: Center of the hexagon.
            nut_width: Across-flats dimension.
            nut_depth: How deep to cut.
            negative_direction: Whether to cut in negative normal direction.
        """
        points: typing.List[adsk.core.Point3D] = self._hex_points(center, nut_width)
        sketch.sketchCurves.sketchLines.addEdgePolygon(
            points[0], points[1], True, 6
        )
        profile: adsk.fusion.Profile = sketch.profiles.item(0)

        depth: float = -nut_depth if negative_direction else nut_depth
        ext_input: adsk.fusion.ExtrudeFeatureInput = self.root_comp.features.extrudeFeatures.createInput(
            profile, adsk.fusion.FeatureOperations.CutFeatureOperation
        )
        ext_input.setDistanceExtent(False, adsk.core.ValueInput.createByReal(depth))
        self.root_comp.features.extrudeFeatures.add(ext_input)


class NotchCarver:
    """Carves rectangular notches into bodies for cable/chain routing."""

    def __init__(self, root_comp: adsk.fusion.Component) -> None:
        self.root_comp: adsk.fusion.Component = root_comp

    def carve(
        self,
        body: adsk.fusion.BRepBody,
        notch_depth: float,
        notch_length: float,
        notch_height: float,
        circle_diameter: float,
        circle_ext: float,
        orient_wide: bool,
    ) -> None:
        """
        Carve a rectangular notch on the side of the body.

        Migrated from GLPipeClamp11.py::carveNotch()
        """
        circle_radius: float = circle_diameter / 2.0
        half_circle_ext: float = circle_ext / 2.0
        dist_to_solid: float = circle_radius
        if circle_ext > 0 and orient_wide:
            dist_to_solid += half_circle_ext

        # Fudge factor to compensate for curvature
        curve_delta: float = circle_diameter / 6.0
        dist_to_solid -= curve_delta

        sketches: adsk.fusion.Sketches = self.root_comp.sketches
        xy_plane: adsk.fusion.ConstructionPlane = self.root_comp.xYConstructionPlane
        sketch: adsk.fusion.Sketch = sketches.add(xy_plane)

        half_length: float = notch_length / 2.0
        p0: adsk.core.Point3D = adsk.core.Point3D.create(dist_to_solid, -half_length, 0)
        p1: adsk.core.Point3D = adsk.core.Point3D.create(dist_to_solid + notch_depth, half_length, 0)
        sketch.sketchCurves.sketchLines.addTwoPointRectangle(p0, p1)

        profile: adsk.fusion.Profile = sketch.profiles.item(0)
        ext_input: adsk.fusion.ExtrudeFeatureInput = self.root_comp.features.extrudeFeatures.createInput(
            profile, adsk.fusion.FeatureOperations.CutFeatureOperation
        )
        ext_input.setDistanceExtent(False, adsk.core.ValueInput.createByReal(notch_height))
        self.root_comp.features.extrudeFeatures.add(ext_input)
