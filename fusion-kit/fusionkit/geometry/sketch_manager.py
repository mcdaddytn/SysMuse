"""
fusionkit.geometry.sketch_manager
Creates, names, and retrieves Fusion 360 sketches on named planes or faces.
"""

import adsk.core
import adsk.fusion
import typing

from fusionkit.core.app_context import AppContext


class SketchManager:
    """
    Manages sketch creation on construction planes and body faces.
    All created sketches are registered by name in AppContext.
    """

    def __init__(self, ctx: AppContext) -> None:
        self.ctx: AppContext = ctx

    def create_on_plane(self, name: str, plane_key: str = 'xy') -> adsk.fusion.Sketch:
        """
        Create a new sketch on a named construction plane.

        Args:
            name: Name to register the sketch under.
            plane_key: Key in ctx.named_planes (e.g., 'xy', 'xz', 'yz').

        Returns:
            The created Sketch object.
        """
        plane: adsk.fusion.ConstructionPlane = self.ctx.get_plane(plane_key)
        sketch: adsk.fusion.Sketch = self.ctx.root_comp.sketches.add(plane)
        sketch.name = name
        self.ctx.register_sketch(name, sketch)
        return sketch

    def create_on_face(self, name: str, face: adsk.fusion.BRepFace) -> adsk.fusion.Sketch:
        """
        Create a new sketch on a body face.

        Args:
            name: Name to register the sketch under.
            face: The BRepFace to sketch on.

        Returns:
            The created Sketch object.
        """
        sketch: adsk.fusion.Sketch = self.ctx.root_comp.sketches.add(face)
        sketch.name = name
        self.ctx.register_sketch(name, sketch)
        return sketch

    def create_on_offset_plane(self, name: str, base_plane_key: str,
                                offset: float) -> adsk.fusion.Sketch:
        """
        Create a sketch on a plane offset from a base construction plane.

        Args:
            name: Name to register the sketch under.
            base_plane_key: Key of the base plane.
            offset: Offset distance (in API units, i.e., cm).

        Returns:
            The created Sketch object.
        """
        base_plane: adsk.fusion.ConstructionPlane = self.ctx.get_plane(base_plane_key)
        planes: adsk.fusion.ConstructionPlanes = self.ctx.root_comp.constructionPlanes
        plane_input: adsk.fusion.ConstructionPlaneInput = planes.createInput()
        offset_value: adsk.core.ValueInput = adsk.core.ValueInput.createByReal(offset)
        plane_input.setByOffset(base_plane, offset_value)
        new_plane: adsk.fusion.ConstructionPlane = planes.add(plane_input)

        # Register the offset plane
        plane_name: str = f"{base_plane_key}_offset_{offset}"
        self.ctx.named_planes[plane_name] = new_plane

        sketch: adsk.fusion.Sketch = self.ctx.root_comp.sketches.add(new_plane)
        sketch.name = name
        self.ctx.register_sketch(name, sketch)
        return sketch

    def get_sketch(self, name: str) -> adsk.fusion.Sketch:
        """Retrieve a previously created sketch by name."""
        sketch: typing.Optional[adsk.fusion.Sketch] = self.ctx.named_sketches.get(name)
        if sketch is None:
            raise KeyError(f"No sketch registered with name '{name}'.")
        return sketch
