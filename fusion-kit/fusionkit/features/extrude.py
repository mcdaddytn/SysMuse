"""
fusionkit.features.extrude
Extrusion operations: new body, cut, and join.
"""

import adsk.core
import adsk.fusion
import typing


class ExtrudeOp:
    """Static methods for common extrusion operations."""

    @staticmethod
    def new_body(root_comp: adsk.fusion.Component,
                 profile: adsk.fusion.Profile,
                 distance: float) -> adsk.fusion.BRepBody:
        """
        Extrude a profile to create a new solid body.

        Args:
            root_comp: The root component.
            profile: The sketch profile to extrude.
            distance: Extrusion distance in API units (cm). Positive = +Z.

        Returns:
            The created BRepBody.
        """
        extrudes: adsk.fusion.ExtrudeFeatures = root_comp.features.extrudeFeatures
        ext_input: adsk.fusion.ExtrudeFeatureInput = extrudes.createInput(
            profile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation
        )
        dist_value: adsk.core.ValueInput = adsk.core.ValueInput.createByReal(distance)
        ext_input.setDistanceExtent(False, dist_value)
        extrude: adsk.fusion.ExtrudeFeature = extrudes.add(ext_input)
        body: adsk.fusion.BRepBody = extrude.bodies.item(0)
        return body

    @staticmethod
    def new_body_from_collection(root_comp: adsk.fusion.Component,
                                 profiles: adsk.core.ObjectCollection,
                                 distance: float) -> adsk.fusion.ExtrudeFeature:
        """
        Extrude multiple profiles to create new bodies.

        Args:
            root_comp: The root component.
            profiles: ObjectCollection of profiles.
            distance: Extrusion distance.

        Returns:
            The ExtrudeFeature (access .bodies for created bodies).
        """
        extrudes: adsk.fusion.ExtrudeFeatures = root_comp.features.extrudeFeatures
        dist_value: adsk.core.ValueInput = adsk.core.ValueInput.createByReal(distance)
        extrude: adsk.fusion.ExtrudeFeature = extrudes.addSimple(
            profiles, dist_value, adsk.fusion.FeatureOperations.NewBodyFeatureOperation
        )
        return extrude

    @staticmethod
    def cut(root_comp: adsk.fusion.Component,
            profile: adsk.fusion.Profile,
            distance: float) -> adsk.fusion.ExtrudeFeature:
        """
        Extrude-cut a profile into existing bodies.

        Args:
            root_comp: The root component.
            profile: The sketch profile to cut with.
            distance: Cut depth (positive or negative for direction).

        Returns:
            The ExtrudeFeature.
        """
        extrudes: adsk.fusion.ExtrudeFeatures = root_comp.features.extrudeFeatures
        ext_input: adsk.fusion.ExtrudeFeatureInput = extrudes.createInput(
            profile, adsk.fusion.FeatureOperations.CutFeatureOperation
        )
        dist_value: adsk.core.ValueInput = adsk.core.ValueInput.createByReal(distance)
        ext_input.setDistanceExtent(False, dist_value)
        extrude: adsk.fusion.ExtrudeFeature = extrudes.add(ext_input)
        return extrude

    @staticmethod
    def join(root_comp: adsk.fusion.Component,
             profile: adsk.fusion.Profile,
             distance: float) -> adsk.fusion.ExtrudeFeature:
        """
        Extrude a profile and join it to existing bodies (boolean union).
        Useful for adding monolithic features (rail plates, mounting bosses)
        to an already-extruded body.

        Args:
            root_comp: The root component.
            profile: The sketch profile to extrude and join.
            distance: Extrusion distance (positive or negative for direction).

        Returns:
            The ExtrudeFeature.
        """
        extrudes: adsk.fusion.ExtrudeFeatures = root_comp.features.extrudeFeatures
        ext_input: adsk.fusion.ExtrudeFeatureInput = extrudes.createInput(
            profile, adsk.fusion.FeatureOperations.JoinFeatureOperation
        )
        dist_value: adsk.core.ValueInput = adsk.core.ValueInput.createByReal(distance)
        ext_input.setDistanceExtent(False, dist_value)
        extrude: adsk.fusion.ExtrudeFeature = extrudes.add(ext_input)
        return extrude
