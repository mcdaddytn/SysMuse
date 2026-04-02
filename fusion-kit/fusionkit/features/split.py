"""
fusionkit.features.split
Body splitting along construction planes.
"""

import adsk.core
import adsk.fusion
import typing


class BodySplitter:
    """Splits a body along a construction plane into two halves."""

    def __init__(self, root_comp: adsk.fusion.Component) -> None:
        self.root_comp: adsk.fusion.Component = root_comp

    def split_at_plane(
        self,
        body: adsk.fusion.BRepBody,
        plane_key: str = 'xz',
        offset: float = 0.0,
    ) -> typing.Tuple[adsk.fusion.BRepBody, adsk.fusion.BRepBody]:
        """
        Split a body along a construction plane.

        Args:
            body: The body to split.
            plane_key: Which standard plane to split along ('xy', 'xz', 'yz').
            offset: Offset from the plane (0 = split at origin).

        Returns:
            Tuple of (positive_side_body, negative_side_body).
        """
        plane_map: typing.Dict[str, adsk.fusion.ConstructionPlane] = {
            'xy': self.root_comp.xYConstructionPlane,
            'xz': self.root_comp.xZConstructionPlane,
            'yz': self.root_comp.yZConstructionPlane,
        }
        plane: adsk.fusion.ConstructionPlane = plane_map[plane_key]

        if offset != 0.0:
            planes: adsk.fusion.ConstructionPlanes = self.root_comp.constructionPlanes
            plane_input: adsk.fusion.ConstructionPlaneInput = planes.createInput()
            offset_value: adsk.core.ValueInput = adsk.core.ValueInput.createByReal(offset)
            plane_input.setByOffset(plane, offset_value)
            plane = planes.add(plane_input)

        split_features: adsk.fusion.SplitBodyFeatures = self.root_comp.features.splitBodyFeatures
        split_input: adsk.fusion.SplitBodyFeatureInput = split_features.createInput(
            body, plane, True
        )
        split_features.add(split_input)

        # Find the two resulting bodies
        bodies: typing.List[adsk.fusion.BRepBody] = [
            b for b in self.root_comp.bRepBodies if b.isSolid
        ]

        if len(bodies) < 2:
            raise RuntimeError("Split did not produce two bodies.")

        # Classify by position relative to split plane
        if plane_key == 'xz':
            # Split along xz → positive Y vs negative Y
            positive: adsk.fusion.BRepBody = max(bodies, key=lambda b: b.boundingBox.maxPoint.y)
            negative: adsk.fusion.BRepBody = min(bodies, key=lambda b: b.boundingBox.minPoint.y)
        elif plane_key == 'xy':
            positive = max(bodies, key=lambda b: b.boundingBox.maxPoint.z)
            negative = min(bodies, key=lambda b: b.boundingBox.minPoint.z)
        else:  # yz
            positive = max(bodies, key=lambda b: b.boundingBox.maxPoint.x)
            negative = min(bodies, key=lambda b: b.boundingBox.minPoint.x)

        return (positive, negative)
