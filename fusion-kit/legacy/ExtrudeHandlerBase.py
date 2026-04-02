import adsk.core, adsk.fusion, json
from typing import Dict, List, Union
from .SketchEnums import PointSearchMode, ProfileCountParameter, NumericComparisonOperator, ProfileLoopSelector
#from .SketchBase import SketchBase

class ExtrudeHandlerBase:
    def __init__(self, design_base):
        self.design_base = design_base
        self.bodyName: str = ""
        self.distance: float = 0.0
        self.shapeIndex = 0

    def _log_parameters(self, params: Dict, extrude_type: str, sketch_name: str):
        shape_index = self.shapeIndex
        file_name = f"{sketch_name}_{extrude_type}_{shape_index}_params.json"
        file_path = f"{self.design_base.objectStatePath}/{file_name}"
        with open(file_path, 'w') as f:
            json.dump(params, f, indent=4)

    def _log_result(self, result: Dict, extrude_type: str, sketch_name: str):
        shape_index = self.shapeIndex
        file_name = f"{sketch_name}_{extrude_type}_{shape_index}_result.json"
        file_path = f"{self.design_base.objectStatePath}/{file_name}"
        with open(file_path, 'w') as f:
            json.dump(result, f, indent=4)

    def selectProfiles(self, activeSketch: adsk.fusion.Sketch) -> adsk.core.ObjectCollection:
        raise NotImplementedError("Subclasses should implement this method")

    def _extrude(self, extrude_config: Dict, activeSketch: adsk.fusion.Sketch):
        self.bodyName = extrude_config.get('bodyName', 'Body')
        self.distance = self.design_base._get_value(extrude_config, 'distance')
        # need this here as activeSketch updates

        self._log_parameters(extrude_config, 'Extrude', activeSketch.name)

        profiles = self.selectProfiles(activeSketch)
        if profiles.count == 0:
            self.design_base.warning("No profiles matched criteria")
            return
        
        distance_input = adsk.core.ValueInput.createByReal(self.distance)
        extrudes = self.design_base.root_comp.features.extrudeFeatures
        extrude_feature = extrudes.addSimple(profiles, distance_input, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)

        body_index = 0
        for body in extrude_feature.bodies:
            body_name = f"{self.bodyName}_{body_index}" if len(extrude_feature.bodies) > 1 else self.bodyName
            body.name = body_name
            self.design_base.info(f"Created body: {body_name}")
            body_index += 1

        result = {'bodies': [body.name for body in extrude_feature.bodies]}
        self._log_result(result, 'Extrude', activeSketch.name)


class LastProfileExtrude(ExtrudeHandlerBase):
    def selectProfiles(self, activeSketch: adsk.fusion.Sketch) -> adsk.core.ObjectCollection:
        profiles = adsk.core.ObjectCollection.create()
        if activeSketch.profiles.count > 0:
            last_profile = activeSketch.profiles.item(activeSketch.profiles.count - 1)
            profiles.add(last_profile)
        return profiles

    def _extrude(self, extrude_config: Dict, activeSketch: adsk.fusion.Sketch):
        super()._extrude(extrude_config, activeSketch)


class PointContainExtrude(ExtrudeHandlerBase):
    def __init__(self, design_base):
        super().__init__(design_base)
        self.containedPoints: List[adsk.core.Point3D] = []
        self.pointSearchMode: PointSearchMode = PointSearchMode.ContainsAll

    def _initialize_contained_points(self, points_config: List[Union[Dict, str]]):
        for point_config in points_config:
            if isinstance(point_config, str):
                point = self.design_base._get_point(point_config)
            else:
                x = point_config.get('x', 0)
                y = point_config.get('y', 0)
                z = point_config.get('z', 0)
                point = adsk.core.Point3D.create(x, y, z)
            self.containedPoints.append(point)

    def selectProfiles(self, activeSketch: adsk.fusion.Sketch) -> adsk.core.ObjectCollection:
        profiles = adsk.core.ObjectCollection.create()
        for profile in activeSketch.profiles:
            bounding_box = profile.boundingBox
            if self.pointSearchMode == PointSearchMode.ContainsAll:
                if all(bounding_box.contains(point) for point in self.containedPoints):
                    profiles.add(profile)
            elif self.pointSearchMode == PointSearchMode.ContainsAny:
                if any(bounding_box.contains(point) for point in self.containedPoints):
                    profiles.add(profile)
        return profiles

    def _extrude(self, extrude_config: Dict, activeSketch: adsk.fusion.Sketch):
        self.pointSearchMode = PointSearchMode(extrude_config.get('pointSearchMode', 'ContainsAll'))
        contained_points_config = extrude_config.get('containedPoints', [])
        self._initialize_contained_points(contained_points_config)
        super()._extrude(extrude_config, activeSketch)

class ProfileCountExtrude(ExtrudeHandlerBase):
    def __init__(self, design_base):
        super().__init__(design_base)
        self.profileCountThreshold: int = 1
        self.profileCountParameter: ProfileCountParameter = ProfileCountParameter.Loops
        self.profileCountOperator: NumericComparisonOperator = NumericComparisonOperator.Equals
        self.profileLoopSelector: ProfileLoopSelector = ProfileLoopSelector.All

    def selectProfiles(self, activeSketch: adsk.fusion.Sketch) -> adsk.core.ObjectCollection:
        profiles = adsk.core.ObjectCollection.create()
        profIndex: int = 0

        self.design_base.info("ProfileCountExtrude(profileCountThreshold=%d, profileCountParameter=%s, profileCountOperator=%s)" % (self.profileCountThreshold, str(self.profileCountParameter), str(self.profileCountOperator)))

        for profile in activeSketch.profiles:
            profileCount = self._get_profile_count(profile)
            self.design_base.info("ProfileCountExtrude(profIndex=%d, profCount=%d)" % (profIndex, profileCount))
            profIndex = profIndex + 1

            if self._compare_profile_count(profileCount):
                profiles.add(profile)

        return profiles

    def _get_profile_count(self, profile: adsk.fusion.Profile) -> int:
        loops = self._filter_loops(profile.profileLoops)        
        if self.profileCountParameter == ProfileCountParameter.Loops:
            return len(loops)
        elif self.profileCountParameter == ProfileCountParameter.Curves:
            return sum(loop.profileCurves.count for loop in loops)
        elif self.profileCountParameter == ProfileCountParameter.Lines:
            return sum(1 for loop in loops for curve in loop.profileCurves if curve.geometryType == adsk.core.Curve3DTypes.Line3DCurveType)
        elif self.profileCountParameter == ProfileCountParameter.Arcs:
            return sum(1 for loop in loops for curve in loop.profileCurves if curve.geometryType == adsk.core.Curve3DTypes.Arc3DCurveType)
        elif self.profileCountParameter == ProfileCountParameter.Circles:
            return sum(1 for loop in loops for curve in loop.profileCurves if curve.geometryType == adsk.core.Curve3DTypes.Circle3DCurveType)
        elif self.profileCountParameter == ProfileCountParameter.Ellipses:
            return sum(1 for loop in loops for curve in loop.profileCurves if curve.geometryType == adsk.core.Curve3DTypes.Ellipse3DCurveType)
        else:
            return 0

    def _filter_loops(self, loops):
        if self.profileLoopSelector == ProfileLoopSelector.All:
            return loops
        elif self.profileLoopSelector == ProfileLoopSelector.OuterOnly:
            return [loop for loop in loops if loop.isOuter]
        elif self.profileLoopSelector == ProfileLoopSelector.InnerOnly:
            return [loop for loop in loops if not loop.isOuter]
        return loops

    def _compare_profile_count(self, profileCount: int) -> bool:
        if self.profileCountOperator == NumericComparisonOperator.Equals:
            return profileCount == self.profileCountThreshold
        elif self.profileCountOperator == NumericComparisonOperator.GreaterThan:
            return profileCount > self.profileCountThreshold
        elif self.profileCountOperator == NumericComparisonOperator.GreaterThanEquals:
            return profileCount >= self.profileCountThreshold
        elif self.profileCountOperator == NumericComparisonOperator.LessThan:
            return profileCount < self.profileCountThreshold
        elif self.profileCountOperator == NumericComparisonOperator.LessThanEquals:
            return profileCount <= self.profileCountThreshold
        else:
            return False

    def _extrude(self, extrude_config: Dict, activeSketch: adsk.fusion.Sketch):
        self.profileCountThreshold = extrude_config.get('profileCountThreshold', 1)
        self.profileCountParameter = ProfileCountParameter(extrude_config.get('profileCountParameter', 'Loops'))
        self.profileCountOperator = NumericComparisonOperator(extrude_config.get('profileCountOperator', 'Equals'))
        self.profileLoopSelector = ProfileLoopSelector(extrude_config.get('profileLoopSelector', 'All'))
        super()._extrude(extrude_config, activeSketch)
