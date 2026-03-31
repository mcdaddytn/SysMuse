"""
fusionkit.components.hi_hat_cylinder
Simple cylindrical part with holes drilled from top and bottom.
Migrated from GLHiHatCyl.py.
"""

import adsk.core
import adsk.fusion
import typing

from fusionkit.core.app_context import AppContext
from fusionkit.core.logger import FusionLogger
from fusionkit.components.component_base import ComponentBase
from fusionkit.geometry.shapes import CircleShape
from fusionkit.features.extrude import ExtrudeOp


class HiHatCylinder(ComponentBase):
    """
    A cylinder with a hole drilled from the top and another from the bottom.

    JSON config keys (all lengths in mm):
        length: total cylinder height
        cylinder_diameter: outer diameter
        top_hole_diameter: diameter of hole from top
        bottom_hole_diameter: diameter of hole from bottom
        top_hole_depth: depth of top hole (bottom gets the remainder)
    """

    def build(self) -> typing.List[adsk.fusion.BRepBody]:
        """Build the hi-hat cylinder."""
        self.log("Starting build")

        length: float = self.get_float('length')
        cyl_diameter: float = self.get_float('cylinder_diameter')
        top_hole_dia: float = self.get_float('top_hole_diameter')
        bottom_hole_dia: float = self.get_float('bottom_hole_diameter')
        top_hole_depth: float = self.get_float('top_hole_depth')
        bottom_hole_depth: float = length - top_hole_depth

        root_comp: adsk.fusion.Component = self.ctx.root_comp
        sketches: adsk.fusion.Sketches = root_comp.sketches
        xy_plane: adsk.fusion.ConstructionPlane = root_comp.xYConstructionPlane

        # Step 1: Draw and extrude the outer cylinder
        cyl_sketch: adsk.fusion.Sketch = sketches.add(xy_plane)
        cyl_shape: CircleShape = CircleShape(
            center=adsk.core.Point3D.create(0, 0, 0),
            radius=cyl_diameter / 2.0,
        )
        cyl_shape.draw(cyl_sketch)

        cyl_profile: adsk.fusion.Profile = cyl_sketch.profiles.item(0)
        body: adsk.fusion.BRepBody = ExtrudeOp.new_body(root_comp, cyl_profile, length)

        # Step 2: Cut the top hole
        top_sketch: adsk.fusion.Sketch = sketches.add(xy_plane)
        top_sketch.sketchCurves.sketchCircles.addByCenterRadius(
            adsk.core.Point3D.create(0, 0, length), top_hole_dia / 2.0
        )
        top_profile: adsk.fusion.Profile = top_sketch.profiles.item(0)
        ExtrudeOp.cut(root_comp, top_profile, -top_hole_depth)

        # Step 3: Cut the bottom hole
        bottom_sketch: adsk.fusion.Sketch = sketches.add(xy_plane)
        bottom_sketch.sketchCurves.sketchCircles.addByCenterRadius(
            adsk.core.Point3D.create(0, 0, 0), bottom_hole_dia / 2.0
        )
        bottom_profile: adsk.fusion.Profile = bottom_sketch.profiles.item(0)
        ExtrudeOp.cut(root_comp, bottom_profile, bottom_hole_depth)

        self.bodies = [body]
        self.log("Build complete")
        return self.bodies

    @classmethod
    def _default_param_types(cls) -> typing.Dict[str, typing.List[str]]:
        return {
            'bool': [],
            'int': [],
            'float': [],
            'length': [
                'length', 'cylinder_diameter',
                'top_hole_diameter', 'bottom_hole_diameter', 'top_hole_depth',
            ],
        }
