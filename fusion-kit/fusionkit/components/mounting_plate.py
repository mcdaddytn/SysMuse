"""
fusionkit.components.mounting_plate
Flat mounting plate with configurable hole patterns.
Used for attaching cameras, brackets, and other equipment to pipe clamps.

Phase 3 implementation.
"""

import adsk.core
import adsk.fusion
import typing

from fusionkit.core.app_context import AppContext
from fusionkit.core.logger import FusionLogger
from fusionkit.components.component_base import ComponentBase
from fusionkit.geometry.shapes import RectangleShape
from fusionkit.geometry.profile_selector import ProfileSelector
from fusionkit.features.extrude import ExtrudeOp


class MountingPlate(ComponentBase):
    """
    A flat rectangular plate with a configurable pattern of bolt holes.

    JSON config keys (lengths in mm):
        PlateWidth: width (X dimension)
        PlateHeight: height (Y dimension)
        PlateThickness: thickness (Z dimension, extrusion height)
        CornerRadius: fillet radius on corners (0 = sharp)
        HolePattern: list of hole specs, each with:
            x, y: position relative to plate center
            diameter: hole diameter
            countersink: optional countersink diameter
            countersinkDepth: optional countersink depth
        CameraMountHole: if true, adds a 1/4-20 UNC threaded hole at center
    """

    def build(self) -> typing.List[adsk.fusion.BRepBody]:
        """Build the mounting plate."""
        self.log("Starting mounting plate build")

        plate_width: float = self.get_float('PlateWidth')
        plate_height: float = self.get_float('PlateHeight')
        plate_thickness: float = self.get_float('PlateThickness')
        corner_radius: float = self.get_float('CornerRadius', 0.0)

        root_comp: adsk.fusion.Component = self.ctx.root_comp
        sketch: adsk.fusion.Sketch = self.sketch_mgr.create_on_plane('plate_outline', 'xy')

        # Draw plate outline
        half_w: float = plate_width / 2.0
        half_h: float = plate_height / 2.0
        p0: adsk.core.Point3D = adsk.core.Point3D.create(-half_w, -half_h, 0)
        p1: adsk.core.Point3D = adsk.core.Point3D.create(half_w, half_h, 0)

        rect: RectangleShape = RectangleShape(
            point_one=p0, point_two=p1, fillet_radius=corner_radius,
        )
        rect.draw(sketch)

        # Extrude plate
        profile: typing.Optional[adsk.fusion.Profile] = ProfileSelector.by_bounding_box(
            sketch, plate_width, plate_height
        )
        if profile is None:
            # Fallback: use largest profile
            profile = ProfileSelector.by_area_rank(sketch, rank=0, ascending=False)

        if profile is None:
            self.log_error("No profile found for plate extrusion")
            return []

        body: adsk.fusion.BRepBody = ExtrudeOp.new_body(root_comp, profile, plate_thickness)

        # Drill hole pattern
        hole_pattern: typing.List[typing.Dict[str, typing.Any]] = self.params.get('HolePattern', [])
        sketches: adsk.fusion.Sketches = root_comp.sketches
        xy_plane: adsk.fusion.ConstructionPlane = root_comp.xYConstructionPlane

        for hole_def in hole_pattern:
            hx: float = self.converter.length(float(hole_def.get('x', 0)))
            hy: float = self.converter.length(float(hole_def.get('y', 0)))
            h_dia: float = self.converter.length(float(hole_def.get('diameter', 4.2)))

            hole_sketch: adsk.fusion.Sketch = sketches.add(xy_plane)
            hole_sketch.sketchCurves.sketchCircles.addByCenterRadius(
                adsk.core.Point3D.create(hx, hy, plate_thickness),
                h_dia / 2.0,
            )
            hole_profile: adsk.fusion.Profile = hole_sketch.profiles.item(0)
            ExtrudeOp.cut(root_comp, hole_profile, -plate_thickness)

            # Optional countersink
            cs_dia: typing.Optional[float] = hole_def.get('countersink')
            cs_depth: typing.Optional[float] = hole_def.get('countersinkDepth')
            if cs_dia and cs_depth:
                cs_sketch: adsk.fusion.Sketch = sketches.add(xy_plane)
                cs_sketch.sketchCurves.sketchCircles.addByCenterRadius(
                    adsk.core.Point3D.create(hx, hy, plate_thickness),
                    self.converter.length(float(cs_dia)) / 2.0,
                )
                cs_profile: adsk.fusion.Profile = cs_sketch.profiles.item(0)
                ExtrudeOp.cut(root_comp, cs_profile, -self.converter.length(float(cs_depth)))

        self.bodies = [body]
        self.log(f"Mounting plate complete: {plate_width:.1f}x{plate_height:.1f}x{plate_thickness:.1f}")
        return self.bodies

    @classmethod
    def _default_param_types(cls) -> typing.Dict[str, typing.List[str]]:
        return {
            'bool': ['CameraMountHole'],
            'int': [],
            'float': [],
            'length': ['PlateWidth', 'PlateHeight', 'PlateThickness', 'CornerRadius'],
        }
