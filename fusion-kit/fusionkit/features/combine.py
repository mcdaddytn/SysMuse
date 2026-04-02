"""
fusionkit.features.combine
Combine multiple bodies into one via join, cut, or intersect.
"""

import adsk.core
import adsk.fusion
import typing


class BodyCombiner:
    """Combines multiple bodies into a single body."""

    def __init__(self, root_comp: adsk.fusion.Component) -> None:
        self.root_comp: adsk.fusion.Component = root_comp

    def join(
        self,
        target_body: adsk.fusion.BRepBody,
        tool_bodies: typing.List[adsk.fusion.BRepBody],
    ) -> adsk.fusion.BRepBody:
        """
        Join (union) multiple tool bodies into a target body.

        Args:
            target_body: The body to join into.
            tool_bodies: Bodies to add to the target.

        Returns:
            The combined body.
        """
        tool_collection: adsk.core.ObjectCollection = adsk.core.ObjectCollection.create()
        for body in tool_bodies:
            tool_collection.add(body)

        combine_features: adsk.fusion.CombineFeatures = self.root_comp.features.combineFeatures
        combine_input: adsk.fusion.CombineFeatureInput = combine_features.createInput(
            target_body, tool_collection
        )
        combine_input.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation
        result: adsk.fusion.CombineFeature = combine_features.add(combine_input)

        return result.bodies.item(0)
