"""
fusionkit.components.luna_wrench
Parametric spanner wrench with configurable spokes.
Supports single-sided and double-sided (with handle) variants.
Migrated from LunaWrench7.py.
"""

import adsk.core
import adsk.fusion
import math
import typing

from fusionkit.core.app_context import AppContext
from fusionkit.core.logger import FusionLogger
from fusionkit.components.component_base import ComponentBase
from fusionkit.geometry.shapes import CircleShape, RotatedRectangle
from fusionkit.geometry.profile_selector import ProfileSelector
from fusionkit.features.extrude import ExtrudeOp
from fusionkit.features.combine import BodyCombiner


class LunaWrench(ComponentBase):
    """
    Single-sided spanner wrench with radial rectangular spokes.

    JSON config keys (lengths in mm):
        radius: inner circle radius
        rimWidth: width of the rim ring
        rectWidth: spoke width
        rectLength: spoke length (radial)
        numRects: number of spokes
        height: extrusion height
        sketchOnly: stop after sketch if True
    """

    def build(self) -> typing.List[adsk.fusion.BRepBody]:
        """Build a single-sided luna wrench."""
        self.log("Starting single-sided wrench build")

        radius: float = self.get_float('radius')
        rim_width: float = self.get_float('rimWidth')
        rect_width: float = self.get_float('rectWidth')
        rect_length: float = self.get_float('rectLength')
        num_rects: int = self.get_int('numRects')
        height: float = self.get_float('height')
        sketch_only: bool = self.get_bool('sketchOnly', False)

        root_comp: adsk.fusion.Component = self.ctx.root_comp
        sketch: adsk.fusion.Sketch = self.sketch_mgr.create_on_plane('wrench_head', 'xy')
        center: adsk.core.Point3D = adsk.core.Point3D.create(0, 0, 0)

        # Draw inner and outer circles
        CircleShape(center=center, radius=radius).draw(sketch)
        CircleShape(center=center, radius=radius + rim_width).draw(sketch)

        # Draw radial spokes
        angle_between: float = 360.0 / num_rects
        all_rect_lines: typing.List[adsk.fusion.SketchLine] = []

        for i in range(num_rects):
            angle: float = i * angle_between
            angle_rad: float = math.radians(angle)
            start_r: float = radius - rect_width / 2.0
            cx: float = center.x + start_r * math.cos(angle_rad)
            cy: float = center.y + start_r * math.sin(angle_rad)
            rect_center: adsk.core.Point3D = adsk.core.Point3D.create(cx, cy, 0)

            rect: RotatedRectangle = RotatedRectangle(
                center=rect_center,
                width=rect_width,
                length=rect_length,
                angle=angle,
            )
            lines: typing.List[adsk.fusion.SketchLine] = rect.draw(sketch)
            all_rect_lines.extend(lines)

        # Trim lines outside the inner circle
        self._trim_lines_outside_circle(center, radius, all_rect_lines)

        if sketch_only:
            self.log("SketchOnly mode — stopping")
            return []

        # Find the inner circle profile (smallest area at center) and exclude it
        inner_profile: typing.Optional[adsk.fusion.Profile] = self._find_inner_circle_profile(
            sketch, center
        )
        profiles_to_extrude: adsk.core.ObjectCollection = ProfileSelector.all_except(
            sketch, [inner_profile] if inner_profile else []
        )

        if profiles_to_extrude.count == 0:
            self.log_error("No profiles to extrude")
            return []

        # Extrude each profile individually, then combine
        self.log(f"Extruding {profiles_to_extrude.count} profiles")
        extruded_bodies: typing.List[adsk.fusion.BRepBody] = []
        dist_value: adsk.core.ValueInput = adsk.core.ValueInput.createByReal(height)

        for i in range(profiles_to_extrude.count):
            profile: adsk.fusion.Profile = profiles_to_extrude.item(i)
            extrude: adsk.fusion.ExtrudeFeature = root_comp.features.extrudeFeatures.addSimple(
                profile, dist_value, adsk.fusion.FeatureOperations.NewBodyFeatureOperation
            )
            extruded_bodies.append(extrude.bodies.item(0))

        # Combine all bodies into one
        if len(extruded_bodies) > 1:
            combiner: BodyCombiner = BodyCombiner(root_comp)
            combined: adsk.fusion.BRepBody = combiner.join(
                extruded_bodies[0], extruded_bodies[1:]
            )
            self.bodies = [combined]
        else:
            self.bodies = extruded_bodies

        self.log("Build complete")
        return self.bodies

    @staticmethod
    def _trim_lines_outside_circle(
        center: adsk.core.Point3D,
        radius: float,
        lines: typing.List[adsk.fusion.SketchLine],
    ) -> None:
        """Delete sketch lines whose midpoint is at or beyond the circle radius."""
        fudge: float = 1e-3
        for line in lines:
            if not line.isValid:
                continue
            sp: adsk.core.Point3D = line.startSketchPoint.geometry
            ep: adsk.core.Point3D = line.endSketchPoint.geometry
            mx: float = (sp.x + ep.x) / 2.0
            my: float = (sp.y + ep.y) / 2.0
            dist: float = math.sqrt((mx - center.x) ** 2 + (my - center.y) ** 2)
            if dist >= (radius - fudge):
                line.deleteMe()

    @staticmethod
    def _find_inner_circle_profile(
        sketch: adsk.fusion.Sketch,
        center: adsk.core.Point3D,
    ) -> typing.Optional[adsk.fusion.Profile]:
        """Find the smallest-area profile centered at the origin."""
        accuracy: int = adsk.fusion.CalculationAccuracy.VeryHighCalculationAccuracy
        min_area: float = float('inf')
        inner_profile: typing.Optional[adsk.fusion.Profile] = None

        for i in range(sketch.profiles.count):
            prof: adsk.fusion.Profile = sketch.profiles.item(i)
            area_props: adsk.fusion.AreaProperties = prof.areaProperties(accuracy)
            if area_props.centroid.isEqualTo(center):
                if area_props.area < min_area:
                    min_area = area_props.area
                    inner_profile = prof

        return inner_profile

    @classmethod
    def _default_param_types(cls) -> typing.Dict[str, typing.List[str]]:
        return {
            'bool': ['sketchOnly'],
            'int': ['numRects'],
            'float': [],
            'length': ['radius', 'rimWidth', 'rectWidth', 'rectLength', 'height'],
        }


class DoubleSidedLunaWrench(ComponentBase):
    """
    Double-sided wrench: two wrench heads connected by a handle.

    JSON config keys (lengths in mm):
        radius, rimWidth, rectWidth, rectLength, numRects: head 1 params
        radius2, rimWidth2, rectWidth2, rectLength2, numRects2: head 2 params
        handleLength: distance between heads (excluding head radii)
        handleWidth: width of connecting handle
        handleFilletRadius: fillet on handle edges
        height: extrusion height
        sketchOnly: stop after sketch if True
    """

    def build(self) -> typing.List[adsk.fusion.BRepBody]:
        """Build a double-sided luna wrench."""
        self.log("Starting double-sided wrench build")

        # Head 1 params
        r1: float = self.get_float('radius')
        rw1: float = self.get_float('rimWidth')
        rctw1: float = self.get_float('rectWidth')
        rctl1: float = self.get_float('rectLength')
        nr1: int = self.get_int('numRects')
        # Head 2 params
        r2: float = self.get_float('radius2')
        rw2: float = self.get_float('rimWidth2')
        rctw2: float = self.get_float('rectWidth2')
        rctl2: float = self.get_float('rectLength2')
        nr2: int = self.get_int('numRects2')
        # Handle/global params
        handle_len: float = self.get_float('handleLength')
        handle_width: float = self.get_float('handleWidth')
        handle_fillet: float = self.get_float('handleFilletRadius', 0.0)
        height: float = self.get_float('height')
        sketch_only: bool = self.get_bool('sketchOnly', False)

        root_comp: adsk.fusion.Component = self.ctx.root_comp
        sketch: adsk.fusion.Sketch = self.sketch_mgr.create_on_plane('double_wrench', 'xy')

        outer_r1: float = r1 + rw1
        outer_r2: float = r2 + rw2
        center1: adsk.core.Point3D = adsk.core.Point3D.create(0, 0, 0)
        center2: adsk.core.Point3D = adsk.core.Point3D.create(
            handle_len + outer_r1 + outer_r2, 0, 0
        )

        # Draw head 1
        CircleShape(center=center1, radius=r1).draw(sketch)
        outer_circle1: adsk.fusion.SketchCircle = CircleShape(center=center1, radius=outer_r1).draw(sketch)
        self._draw_spokes(sketch, center1, r1, rctw1, rctl1, nr1)

        # Draw head 2
        CircleShape(center=center2, radius=r2).draw(sketch)
        outer_circle2: adsk.fusion.SketchCircle = CircleShape(center=center2, radius=outer_r2).draw(sketch)
        self._draw_spokes(sketch, center2, r2, rctw2, rctl2, nr2)

        # Draw handle connection lines
        half_hw: float = handle_width / 2.0
        ext_pts1: typing.Tuple[adsk.core.Point3D, adsk.core.Point3D] = self._handle_connection_points(
            center1, outer_r1, half_hw
        )
        ext_pts2: typing.Tuple[adsk.core.Point3D, adsk.core.Point3D] = self._handle_connection_points(
            center2, -outer_r2, half_hw
        )

        line_top: adsk.fusion.SketchLine = sketch.sketchCurves.sketchLines.addByTwoPoints(
            ext_pts1[0], ext_pts2[0]
        )
        line_bottom: adsk.fusion.SketchLine = sketch.sketchCurves.sketchLines.addByTwoPoints(
            ext_pts1[1], ext_pts2[1]
        )

        # Trim outer circles to handle connection
        self._split_circle_delete_inner(sketch, center1, outer_circle1, ext_pts1[0], ext_pts1[1])
        self._split_circle_delete_inner(sketch, center2, outer_circle2, ext_pts2[0], ext_pts2[1])

        if sketch_only:
            self.log("SketchOnly mode — stopping")
            return []

        # Find inner circle profiles to exclude
        inner1: typing.Optional[adsk.fusion.Profile] = LunaWrench._find_inner_circle_profile(sketch, center1)
        inner2: typing.Optional[adsk.fusion.Profile] = LunaWrench._find_inner_circle_profile(sketch, center2)
        exclude: typing.List[adsk.fusion.Profile] = []
        if inner1:
            exclude.append(inner1)
        if inner2:
            exclude.append(inner2)

        profiles: adsk.core.ObjectCollection = ProfileSelector.all_except(sketch, exclude)
        self.log(f"Extruding {profiles.count} profiles")

        # Extrude and combine
        dist_val: adsk.core.ValueInput = adsk.core.ValueInput.createByReal(height)
        extruded: typing.List[adsk.fusion.BRepBody] = []
        for i in range(profiles.count):
            prof: adsk.fusion.Profile = profiles.item(i)
            ext: adsk.fusion.ExtrudeFeature = root_comp.features.extrudeFeatures.addSimple(
                prof, dist_val, adsk.fusion.FeatureOperations.NewBodyFeatureOperation
            )
            extruded.append(ext.bodies.item(0))

        if len(extruded) > 1:
            combiner: BodyCombiner = BodyCombiner(root_comp)
            combined: adsk.fusion.BRepBody = combiner.join(extruded[0], extruded[1:])
            self.bodies = [combined]
        else:
            self.bodies = extruded

        self.log("Build complete")
        return self.bodies

    @staticmethod
    def _draw_spokes(
        sketch: adsk.fusion.Sketch,
        center: adsk.core.Point3D,
        radius: float,
        rect_width: float,
        rect_length: float,
        num_rects: int,
    ) -> None:
        """Draw radial spokes and trim lines outside the circle."""
        angle_between: float = 360.0 / num_rects
        all_lines: typing.List[adsk.fusion.SketchLine] = []
        for i in range(num_rects):
            angle: float = i * angle_between
            angle_rad: float = math.radians(angle)
            start_r: float = radius - rect_width / 2.0
            cx: float = center.x + start_r * math.cos(angle_rad)
            cy: float = center.y + start_r * math.sin(angle_rad)
            rect_center: adsk.core.Point3D = adsk.core.Point3D.create(cx, cy, 0)
            rect: RotatedRectangle = RotatedRectangle(
                center=rect_center, width=rect_width, length=rect_length, angle=angle,
            )
            lines: typing.List[adsk.fusion.SketchLine] = rect.draw(sketch)
            all_lines.extend(lines)

        LunaWrench._trim_lines_outside_circle(center, radius, all_lines)

    @staticmethod
    def _handle_connection_points(
        center: adsk.core.Point3D,
        radius: float,
        half_width: float,
    ) -> typing.Tuple[adsk.core.Point3D, adsk.core.Point3D]:
        """Calculate where handle lines connect to the outer circle."""
        angle: float = math.asin(half_width / abs(radius))
        r: float = abs(radius)
        sign: float = 1.0 if radius > 0 else -1.0

        top: adsk.core.Point3D = adsk.core.Point3D.create(
            center.x + sign * r * math.cos(angle),
            center.y + r * math.sin(angle), 0
        )
        bottom: adsk.core.Point3D = adsk.core.Point3D.create(
            center.x + sign * r * math.cos(-angle),
            center.y + r * math.sin(-angle), 0
        )
        return (top, bottom)

    @staticmethod
    def _split_circle_delete_inner(
        sketch: adsk.fusion.Sketch,
        center: adsk.core.Point3D,
        circle: adsk.fusion.SketchCircle,
        point1: adsk.core.Point3D,
        point2: adsk.core.Point3D,
    ) -> None:
        """Split an outer circle at two points and delete the shorter (inner) arc."""
        # Draw temporary line to get midpoint
        temp_line: adsk.fusion.SketchLine = sketch.sketchCurves.sketchLines.addByTwoPoints(point1, point2)
        sp: adsk.core.Point3D = point1
        ep: adsk.core.Point3D = point2
        handle_mid: adsk.core.Point3D = adsk.core.Point3D.create(
            (sp.x + ep.x) / 2.0, (sp.y + ep.y) / 2.0, 0
        )

        # Calculate arc midpoint (on circle, in direction of handle)
        dx: float = handle_mid.x - center.x
        dy: float = handle_mid.y - center.y
        mag: float = math.sqrt(dx * dx + dy * dy)
        if mag < 1e-10:
            temp_line.deleteMe()
            return
        arc_mid: adsk.core.Point3D = adsk.core.Point3D.create(
            center.x + circle.radius * dx / mag,
            center.y + circle.radius * dy / mag, 0
        )

        break_results: adsk.core.ObjectCollection = circle.breakCurve(arc_mid)
        temp_line.deleteMe()

        if break_results.count > 0:
            arcs: typing.List[adsk.fusion.SketchArc] = [
                break_results.item(i) for i in range(break_results.count)
                if isinstance(break_results.item(i), adsk.fusion.SketchArc)
            ]
            if len(arcs) == 2:
                arc1: adsk.fusion.SketchArc = arcs[0]
                arc2: adsk.fusion.SketchArc = arcs[1]
                if arc1.length < arc2.length:
                    arc1.deleteMe()
                else:
                    arc2.deleteMe()

    @classmethod
    def _default_param_types(cls) -> typing.Dict[str, typing.List[str]]:
        return {
            'bool': ['sketchOnly'],
            'int': ['numRects', 'numRects2'],
            'float': [],
            'length': [
                'radius', 'rimWidth', 'rectWidth', 'rectLength', 'height',
                'radius2', 'rimWidth2', 'rectWidth2', 'rectLength2',
                'handleLength', 'handleWidth', 'handleFilletRadius',
            ],
        }
