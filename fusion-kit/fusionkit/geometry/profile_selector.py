"""
fusionkit.geometry.profile_selector
Strategies for selecting sketch profiles for extrusion.
Profiles are the closed regions in a sketch that Fusion auto-detects.
"""

import adsk.core
import adsk.fusion
import typing


class ProfileSelector:
    """
    Static methods for selecting sketch profiles by various geometric criteria.
    """

    @staticmethod
    def by_bounding_box(sketch: adsk.fusion.Sketch,
                        width: float, height: float,
                        tolerance: float = 1e-3) -> typing.Optional[adsk.fusion.Profile]:
        """
        Find a profile whose bounding box matches the given width and height.
        Used to find the outer rectangle profile in pipe clamp cross sections.

        Args:
            sketch: The sketch to search.
            width: Expected bounding box width (in API units).
            height: Expected bounding box height (in API units).
            tolerance: Matching tolerance.

        Returns:
            The matching Profile, or None.
        """
        for i in range(sketch.profiles.count):
            profile: adsk.fusion.Profile = sketch.profiles.item(i)
            bb: adsk.core.BoundingBox3D = profile.boundingBox
            bb_width: float = bb.maxPoint.x - bb.minPoint.x
            bb_height: float = bb.maxPoint.y - bb.minPoint.y
            if abs(bb_width - width) < tolerance and abs(bb_height - height) < tolerance:
                return profile
        return None

    @staticmethod
    def by_area_rank(sketch: adsk.fusion.Sketch,
                     rank: int = 0,
                     ascending: bool = True) -> typing.Optional[adsk.fusion.Profile]:
        """
        Select profile by area ranking.
        rank=0, ascending=True → smallest profile.
        rank=0, ascending=False → largest profile.

        Args:
            sketch: The sketch to search.
            rank: Which profile to pick after sorting (0-indexed).
            ascending: Sort direction for area.

        Returns:
            The selected Profile, or None.
        """
        profiles_with_area: typing.List[typing.Tuple[adsk.fusion.Profile, float]] = []
        accuracy: int = adsk.fusion.CalculationAccuracy.LowCalculationAccuracy

        for i in range(sketch.profiles.count):
            profile: adsk.fusion.Profile = sketch.profiles.item(i)
            area_props: adsk.fusion.AreaProperties = profile.areaProperties(accuracy)
            profiles_with_area.append((profile, area_props.area))

        profiles_with_area.sort(key=lambda x: x[1], reverse=not ascending)

        if rank < len(profiles_with_area):
            return profiles_with_area[rank][0]
        return None

    @staticmethod
    def by_centroid(sketch: adsk.fusion.Sketch,
                    target: adsk.core.Point3D,
                    tolerance: float = 1e-3) -> typing.Optional[adsk.fusion.Profile]:
        """
        Find a profile whose centroid matches the target point.

        Args:
            sketch: The sketch to search.
            target: Target centroid point.
            tolerance: Matching tolerance.

        Returns:
            The matching Profile, or None.
        """
        accuracy: int = adsk.fusion.CalculationAccuracy.LowCalculationAccuracy

        for i in range(sketch.profiles.count):
            profile: adsk.fusion.Profile = sketch.profiles.item(i)
            area_props: adsk.fusion.AreaProperties = profile.areaProperties(accuracy)
            centroid: adsk.core.Point3D = area_props.centroid
            if centroid.isEqualTo(target):
                return profile
        return None

    @staticmethod
    def all_profiles(sketch: adsk.fusion.Sketch) -> adsk.core.ObjectCollection:
        """Return all profiles as an ObjectCollection."""
        collection: adsk.core.ObjectCollection = adsk.core.ObjectCollection.create()
        for i in range(sketch.profiles.count):
            collection.add(sketch.profiles.item(i))
        return collection

    @staticmethod
    def all_except(sketch: adsk.fusion.Sketch,
                   exclude: typing.List[adsk.fusion.Profile]) -> adsk.core.ObjectCollection:
        """Return all profiles except the ones in the exclude list."""
        collection: adsk.core.ObjectCollection = adsk.core.ObjectCollection.create()
        for i in range(sketch.profiles.count):
            profile: adsk.fusion.Profile = sketch.profiles.item(i)
            if profile not in exclude:
                collection.add(profile)
        return collection

    @staticmethod
    def by_point_containment(sketch: adsk.fusion.Sketch,
                             points: typing.List[adsk.core.Point3D],
                             require_all: bool = True) -> adsk.core.ObjectCollection:
        """
        Find profiles whose bounding box contains the given points.

        Args:
            sketch: The sketch to search.
            points: Points that must be contained.
            require_all: If True, all points must be in bounding box.
                        If False, any point match suffices.

        Returns:
            ObjectCollection of matching profiles.
        """
        collection: adsk.core.ObjectCollection = adsk.core.ObjectCollection.create()

        for i in range(sketch.profiles.count):
            profile: adsk.fusion.Profile = sketch.profiles.item(i)
            bb: adsk.core.BoundingBox3D = profile.boundingBox

            if require_all:
                if all(bb.contains(pt) for pt in points):
                    collection.add(profile)
            else:
                if any(bb.contains(pt) for pt in points):
                    collection.add(profile)

        return collection
