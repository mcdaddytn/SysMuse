"""
fusionkit.core.app_context
Central application context wrapping Fusion 360 API objects and named registries.
"""

import adsk.core
import adsk.fusion
import typing


class AppContext:
    """
    Wraps the Fusion 360 application state and provides named registries
    for sketches, bodies, faces, points, and planes.

    Every other FusionKit class receives an AppContext rather than calling
    adsk.core.Application.get() directly.
    """

    def __init__(self) -> None:
        self.app: adsk.core.Application = adsk.core.Application.get()
        self.ui: adsk.core.UserInterface = self.app.userInterface
        self.design: adsk.fusion.Design = adsk.fusion.Design.cast(self.app.activeProduct)
        self.root_comp: adsk.fusion.Component = self.design.rootComponent
        self.units_mgr: adsk.fusion.FusionUnitsManager = self.design.fusionUnitsManager

        # Named registries for cross-referencing between build steps
        self.named_sketches: typing.Dict[str, adsk.fusion.Sketch] = {}
        self.named_bodies: typing.Dict[str, adsk.fusion.BRepBody] = {}
        self.named_faces: typing.Dict[str, adsk.fusion.BRepFace] = {}
        self.named_points: typing.Dict[str, adsk.core.Point3D] = {}
        self.named_planes: typing.Dict[str, adsk.fusion.ConstructionPlane] = {}
        self.named_lines: typing.Dict[str, adsk.fusion.SketchLine] = {}
        self.named_circles: typing.Dict[str, adsk.fusion.SketchCircle] = {}

        self._initialize_standard_planes()

    def _initialize_standard_planes(self) -> None:
        """Register the three standard construction planes."""
        self.named_planes['xy'] = self.root_comp.xYConstructionPlane
        self.named_planes['xz'] = self.root_comp.xZConstructionPlane
        self.named_planes['yz'] = self.root_comp.yZConstructionPlane
        # Aliases with full names
        self.named_planes['xYConstructionPlane'] = self.root_comp.xYConstructionPlane
        self.named_planes['xZConstructionPlane'] = self.root_comp.xZConstructionPlane
        self.named_planes['yZConstructionPlane'] = self.root_comp.yZConstructionPlane

    def get_plane(self, name: str) -> adsk.fusion.ConstructionPlane:
        """Retrieve a named construction plane."""
        plane: typing.Optional[adsk.fusion.ConstructionPlane] = self.named_planes.get(name)
        if plane is None:
            raise KeyError(f"No plane registered with name '{name}'. Available: {list(self.named_planes.keys())}")
        return plane

    def register_body(self, name: str, body: adsk.fusion.BRepBody) -> None:
        """Register a body by name for later reference."""
        self.named_bodies[name] = body

    def register_sketch(self, name: str, sketch: adsk.fusion.Sketch) -> None:
        """Register a sketch by name."""
        self.named_sketches[name] = sketch

    def register_point(self, name: str, point: adsk.core.Point3D) -> None:
        """Register a named point."""
        self.named_points[name] = point

    def register_face(self, name: str, face: adsk.fusion.BRepFace) -> None:
        """Register a named face."""
        self.named_faces[name] = face

    def get_body(self, name: str) -> adsk.fusion.BRepBody:
        """Retrieve a named body."""
        body: typing.Optional[adsk.fusion.BRepBody] = self.named_bodies.get(name)
        if body is None:
            raise KeyError(f"No body registered with name '{name}'.")
        return body

    def get_point(self, name: str) -> adsk.core.Point3D:
        """Retrieve a named point."""
        point: typing.Optional[adsk.core.Point3D] = self.named_points.get(name)
        if point is None:
            raise KeyError(f"No point registered with name '{name}'.")
        return point

    def clear_all(self) -> None:
        """Clear all existing bodies and sketches from the root component."""
        bodies_to_delete: typing.List[adsk.fusion.BRepBody] = []
        for body in self.root_comp.bRepBodies:
            bodies_to_delete.append(body)
        for body in bodies_to_delete:
            body.deleteMe()

        sketches_to_delete: typing.List[adsk.fusion.Sketch] = []
        for sketch in self.root_comp.sketches:
            sketches_to_delete.append(sketch)
        for sketch in sketches_to_delete:
            sketch.deleteMe()

        self.named_sketches.clear()
        self.named_bodies.clear()
        self.named_faces.clear()
        self.named_points.clear()
        # Keep standard planes, clear custom ones
        standard_keys: typing.List[str] = ['xy', 'xz', 'yz', 'xYConstructionPlane', 'xZConstructionPlane', 'yZConstructionPlane']
        custom_keys: typing.List[str] = [k for k in self.named_planes if k not in standard_keys]
        for k in custom_keys:
            del self.named_planes[k]

    def message(self, msg: str) -> None:
        """Show a message box in the Fusion 360 UI."""
        self.ui.messageBox(msg)
