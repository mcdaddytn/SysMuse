"""
fusionkit.components.pipe_clamp
Parametric pipe clamp with configurable bolt holes, notches, and auto-split.

Migrated from GLPipeClamp11.py. Supports:
- Square or rectangular outer shell
- Circular or filleted-rectangle pipe cutout (stadium shape)
- Clamp bolts (through both halves, perpendicular to pipe axis)
- Inner bolts (perpendicular to clamp bolts, with hex nut wells)
- Outer bolts (top-down 4-bolt pattern with countersink)
- Optional notch for cable/chain routing
- Auto-split into screw-side and nut-side halves
- Per-half STL export
"""

import adsk.core
import adsk.fusion
import typing

from fusionkit.core.app_context import AppContext
from fusionkit.core.logger import FusionLogger
from fusionkit.components.component_base import ComponentBase
from fusionkit.geometry.sketch_manager import SketchManager
from fusionkit.geometry.shapes import RectWithCircleCutout, FilletedRectWithCircleCutout
from fusionkit.geometry.profile_selector import ProfileSelector
from fusionkit.features.extrude import ExtrudeOp
from fusionkit.features.hole_patterns import BoltHoleSpec, HolePatternDriller, NotchCarver
from fusionkit.features.split import BodySplitter


class PipeClamp(ComponentBase):
    """
    Parametric pipe clamp component.

    JSON config keys (all lengths in mm, converted internally to cm):
        RectEdgeX / RectEdgeY or SquareEdge: outer rectangle dimensions
        ObjectDepth: extrusion height (z-axis)
        CircleDiameter: pipe cutout diameter
        CircleExt: extension beyond circle (0 = simple circle, >0 = stadium)
        OrientWide: if True, extension runs along X; if False, along Y
        ScrewDiameter, ScrewHeadDiameter, ScrewHeadDepth: bolt specs
        NutWidth, NutThickness: hex nut specs
        NumClampBolts: number of clamp bolt pairs (0 to disable)
        NumInnerBolts: number of inner bolt pairs (0 to disable)
        NumOuterBolts: 0 or 4 (outer bolts always in 4-bolt pattern)
        OuterXOffset, OuterYOffset: outer bolt offsets from center
        InnerBoltLength: how far inner bolts extend from edge
        NotchDepth, NotchLength: notch dimensions (0 to disable)
        SketchOnly: if True, stop after sketch (no extrude)
    """

    def build(self) -> typing.List[adsk.fusion.BRepBody]:
        """Build the complete pipe clamp and return the resulting bodies."""
        self.log("Starting build")

        # Extract parameters
        rect_edge_x: float = self._get_rect_edge_x()
        rect_edge_y: float = self._get_rect_edge_y()
        object_depth: float = self.get_float('ObjectDepth')
        circle_diameter: float = self.get_float('CircleDiameter')
        circle_ext: float = self.get_float('CircleExt', 0.0)
        orient_wide: bool = self.get_bool('OrientWide', False)
        sketch_only: bool = self.get_bool('SketchOnly', False)

        num_clamp_bolts: int = self.get_int('NumClampBolts', 2)
        num_inner_bolts: int = self.get_int('NumInnerBolts', 0)
        num_outer_bolts: int = self.get_int('NumOuterBolts', 0)

        self.log(f"Params: rect={rect_edge_x:.3f}x{rect_edge_y:.3f}, depth={object_depth:.3f}, "
                 f"circle={circle_diameter:.3f}, ext={circle_ext:.3f}")

        # Step 1: Draw the cross-section sketch
        is_filleted: bool = circle_ext > 0
        sketch: adsk.fusion.Sketch = self.sketch_mgr.create_on_plane('cross_section', 'xy')

        if is_filleted:
            shape: FilletedRectWithCircleCutout = FilletedRectWithCircleCutout(
                rect_edge_x=rect_edge_x,
                rect_edge_y=rect_edge_y,
                circle_diameter=circle_diameter,
                circle_ext=circle_ext,
                orient_wide=orient_wide,
            )
            shape.draw(sketch)
        else:
            simple_shape: RectWithCircleCutout = RectWithCircleCutout(
                rect_edge_x=rect_edge_x,
                rect_edge_y=rect_edge_y,
                circle_diameter=circle_diameter,
            )
            simple_shape.draw(sketch)

        if sketch_only:
            self.log("SketchOnly mode — stopping after sketch")
            return []

        # Step 2: Select the outer profile and extrude
        outer_profile: typing.Optional[adsk.fusion.Profile] = ProfileSelector.by_bounding_box(
            sketch, rect_edge_x, rect_edge_y
        )
        if outer_profile is None:
            self.log_error("Failed to find outer profile by bounding box")
            raise RuntimeError("Could not find outer profile matching rectangle dimensions")

        body: adsk.fusion.BRepBody = ExtrudeOp.new_body(
            self.ctx.root_comp, outer_profile, object_depth
        )
        body.opacity = 0.8
        self.log(f"Extruded body, depth={object_depth:.3f}")

        # Step 3: Build fastener spec
        bolt_spec: BoltHoleSpec = BoltHoleSpec(
            screw_diameter=self.get_float('ScrewDiameter'),
            screw_head_diameter=self.get_float('ScrewHeadDiameter'),
            screw_head_depth=self.get_float('ScrewHeadDepth'),
            nut_width=self.get_float('NutWidth'),
            nut_thickness=self.get_float('NutThickness'),
        )

        driller: HolePatternDriller = HolePatternDriller(self.ctx.root_comp)

        # Step 4: Drill clamp bolt holes
        if num_clamp_bolts > 0:
            self.log(f"Drilling {num_clamp_bolts} clamp bolt pair(s)")
            driller.drill_clamp_bolts(
                body=body,
                spec=bolt_spec,
                rect_edge_x=rect_edge_x,
                rect_edge_y=rect_edge_y,
                object_depth=object_depth,
                circle_diameter=circle_diameter,
                num_bolts=num_clamp_bolts,
            )

        # Step 5: Drill inner bolt holes
        if num_inner_bolts > 0:
            inner_bolt_length: float = self.get_float('InnerBoltLength', 0.0)
            self.log(f"Drilling {num_inner_bolts} inner bolt(s), length={inner_bolt_length:.3f}")
            driller.drill_inner_bolts(
                body=body,
                spec=bolt_spec,
                rect_edge_x=rect_edge_x,
                rect_edge_y=rect_edge_y,
                object_depth=object_depth,
                circle_diameter=circle_diameter,
                circle_ext=circle_ext,
                orient_wide=orient_wide,
                inner_bolt_length=inner_bolt_length,
                num_bolts=num_inner_bolts,
            )

        # Step 6: Drill outer bolt holes
        if num_outer_bolts > 0:
            outer_x_offset: float = self.get_float('OuterXOffset', rect_edge_x / 4.0)
            outer_y_offset: float = self.get_float('OuterYOffset', rect_edge_y / 4.0)
            self.log(f"Drilling {num_outer_bolts} outer bolts at offset ({outer_x_offset:.3f}, {outer_y_offset:.3f})")
            driller.drill_outer_bolts(
                body=body,
                spec=bolt_spec,
                object_depth=object_depth,
                x_offset=outer_x_offset,
                y_offset=outer_y_offset,
            )

        # Step 7: Carve notch
        notch_depth: float = self.get_float('NotchDepth', 0.0)
        notch_length: float = self.get_float('NotchLength', 0.0)
        if notch_length > 0 and notch_depth > 0:
            notch_height: float = self.get_float('NotchHeight', object_depth / 2.0)
            self.log(f"Carving notch: depth={notch_depth:.3f}, length={notch_length:.3f}")
            notch_carver: NotchCarver = NotchCarver(self.ctx.root_comp)
            notch_carver.carve(
                body=body,
                notch_depth=notch_depth,
                notch_length=notch_length,
                notch_height=notch_height,
                circle_diameter=circle_diameter,
                circle_ext=circle_ext,
                orient_wide=orient_wide,
            )

        # Step 8: Split body into two halves
        self.log("Splitting body at xz-plane")
        splitter: BodySplitter = BodySplitter(self.ctx.root_comp)
        screw_side: adsk.fusion.BRepBody
        nut_side: adsk.fusion.BRepBody
        (screw_side, nut_side) = splitter.split_at_plane(body, 'xz')

        screw_side.name = "ScrewSide"
        nut_side.name = "NutSide"
        self.ctx.register_body("ScrewSide", screw_side)
        self.ctx.register_body("NutSide", nut_side)

        self.bodies = [screw_side, nut_side]
        self.log("Build complete — 2 bodies created")
        return self.bodies

    def _get_rect_edge_x(self) -> float:
        """Get the X dimension of the outer rectangle."""
        if 'SquareEdge' in self.params:
            return self.get_float('SquareEdge')
        return self.get_float('RectEdgeX')

    def _get_rect_edge_y(self) -> float:
        """Get the Y dimension of the outer rectangle."""
        if 'SquareEdge' in self.params:
            return self.get_float('SquareEdge')
        return self.get_float('RectEdgeY')

    @classmethod
    def _default_param_types(cls) -> typing.Dict[str, typing.List[str]]:
        """Declare parameter type categories for PipeClamp."""
        return {
            'bool': ['SketchOnly', 'OrientWide'],
            'int': ['NumClampBolts', 'NumInnerBolts', 'NumOuterBolts'],
            'float': [],
            'length': [
                'SquareEdge', 'RectEdgeX', 'RectEdgeY', 'ObjectDepth',
                'CircleDiameter', 'CircleExt',
                'ScrewDiameter', 'ScrewHeadDiameter', 'ScrewHeadDepth',
                'NutWidth', 'NutThickness', 'InnerBoltLength',
                'OuterXOffset', 'OuterYOffset',
                'NotchDepth', 'NotchLength', 'NotchHeight',
            ],
        }
