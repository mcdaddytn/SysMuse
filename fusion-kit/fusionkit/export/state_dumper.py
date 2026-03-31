"""
fusionkit.export.state_dumper
Dumps the current design state (sketches, bodies, faces, vertices) to JSON.
Useful for debugging and regression testing.
"""

import adsk.core
import adsk.fusion
import json
import typing

from fusionkit.core.app_context import AppContext


class StateDumper:
    """Captures a JSON snapshot of all sketches and bodies in the design."""

    def __init__(self, ctx: AppContext) -> None:
        self.ctx: AppContext = ctx

    def dump(self, output_path: str) -> None:
        """
        Write the full design state to a JSON file.

        Args:
            output_path: Path to write the JSON file.
        """
        state: typing.Dict[str, typing.Any] = self._capture_state()
        with open(output_path, 'w') as f:
            json.dump(state, f, indent=4)

    def dump_to_string(self) -> str:
        """Capture state and return as JSON string."""
        state: typing.Dict[str, typing.Any] = self._capture_state()
        return json.dumps(state, indent=4)

    def _capture_state(self) -> typing.Dict[str, typing.Any]:
        """Capture the full design state."""
        state: typing.Dict[str, typing.Any] = {
            'sketches': [],
            'bodies': [],
        }

        # Capture sketch data
        root_comp: adsk.fusion.Component = self.ctx.root_comp
        for sketch in root_comp.sketches:
            sketch_info: typing.Dict[str, typing.Any] = {
                'name': sketch.name,
                'points': [],
            }
            for i in range(sketch.sketchPoints.count):
                sp: adsk.fusion.SketchPoint = sketch.sketchPoints.item(i)
                pt: adsk.core.Point3D = sp.geometry
                sketch_info['points'].append({
                    'x': round(pt.x, 6),
                    'y': round(pt.y, 6),
                    'z': round(pt.z, 6),
                })
            state['sketches'].append(sketch_info)

        # Capture body data
        for body in root_comp.bRepBodies:
            body_info: typing.Dict[str, typing.Any] = {
                'name': body.name,
                'is_solid': body.isSolid,
                'faces': [],
            }
            for face in body.faces:
                face_info: typing.Dict[str, typing.Any] = {
                    'temp_id': face.tempId,
                    'centroid': {
                        'x': round(face.centroid.x, 6),
                        'y': round(face.centroid.y, 6),
                        'z': round(face.centroid.z, 6),
                    },
                    'vertices': [],
                }
                for vertex in face.vertices:
                    vpt: adsk.core.Point3D = vertex.geometry
                    face_info['vertices'].append({
                        'x': round(vpt.x, 6),
                        'y': round(vpt.y, 6),
                        'z': round(vpt.z, 6),
                    })
                body_info['faces'].append(face_info)
            state['bodies'].append(body_info)

        return state
