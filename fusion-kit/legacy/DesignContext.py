import adsk.core
from typing import Dict, Any, List, Type
# below causing circ reference
#from .ShapeHandlerBase import ShapeHandlerBase

#from .SketchEnums import CircleInitMethod, RectangleInitMethod, PolygonInitMethod, PlaneInitMethod

class DesignContext:
    # def __init__(self):
    def __init__(self, app: adsk.core.Application):
        self.defaultValues: Dict[str, Any] = {}
        self.namedParameters: Dict[str, Any] = {}
        self.namedPoints: Dict[str, adsk.core.Point3D] = {}
        self.namedPlanes: Dict[str, adsk.fusion.ConstructionPlane] = {}
        self.namedFaces: Dict[str, adsk.fusion.BRepFace] = {}
        self.namedLines: Dict[str, adsk.fusion.SketchLine] = {}
        self.namedSketches: Dict[str, adsk.fusion.Sketch] = {}
        self.namedBodies: Dict[str, adsk.fusion.BRepBody] = {}
        self.namedCircles: Dict[str, adsk.fusion.SketchCircle] = {}
        self.namedEllipses: Dict[str, adsk.fusion.SketchEllipse] = {}
        #self.namedRectangles: Dict[str, adsk.fusion.SketchLine] = {}  # Assuming rectangles are stored as a collection of lines
        #self.namedPolygons: Dict[str, adsk.fusion.SketchLine] = {}  # Assuming polygons are stored as a collection of lines
        self.namedRectangles: Dict[str, adsk.fusion.SketchLineList] = {}  # Assuming rectangles are stored as a collection of lines
        self.namedPolygons: Dict[str, adsk.fusion.SketchLineList] = {}  # Assuming polygons are stored as a collection of lines
        #self.shape_handlers: Dict[str, ShapeHandlerBase] = {}
        #self.extrude_handlers: Dict[str, ExtrudeHandlerBase] = {}
        self.active_sketch: adsk.fusion.Sketch = None
        self.parameterTypes: Dict[str, Type] = {}
        
        # Application-specific attributes
        self.app = app
        self.ui = app.userInterface
        self.design = app.activeProduct
        self.root_comp = self.design.rootComponent
        self.sketches = self.root_comp.sketches

        # gm, need to move init log here, capture datestamp for workflow
        # Initialize logger
        self.logger = None

    def initParameterTypes(self, boolParams: List[str], floatParams: List[str], intParams: List[str], coordinateParams: List[str], enumParams: Dict[str, Type]):
        for name in boolParams:
            self.parameterTypes[name] = bool
        for name in floatParams:
            self.parameterTypes[name] = float
        for name in intParams:
            self.parameterTypes[name] = int
        for name in coordinateParams:
            self.parameterTypes[name] = float  # Assuming coordinates are floats
        for name, enum_type in enumParams.items():
            self.parameterTypes[name] = enum_type

    def _convert_value(self, key: str, value: Any) -> Any:
        param_type = self.parameterTypes.get(key)
        if param_type is None:
            return value  # Return the value as-is if the type is not known

        if param_type == bool:
            return bool(value)
        elif param_type == int:
            return int(value)
        elif param_type == float:
            return float(value)
        elif param_type in self.parameterTypes.values():  # Assuming it's an enum type
            return param_type(value)
        else:
            return value

    def _get_value(self, config: Dict[str, Any], key: str) -> Any:
        if key in config:
            value = config[key]
            return self._convert_value(key, value)
        elif key in self.defaultValues:
            return self._convert_value(key, self.defaultValues[key])
        return None

    def overrideNamedParameters(self, new_params: Dict[str, Any]):
        self.namedParameters.update(new_params)

    def overrideDefaultValues(self, new_values: Dict[str, Any]):
        self.defaultValues.update(new_values)

    def overrideNamedPoints(self, new_points: Dict[str, adsk.core.Point3D]):
        self.namedPoints.update(new_points)

    def log(self, level: int, msg: str):
        if self.logger:
            self.logger.log(level, msg)

    def info(self, msg: str):
        self.log(adsk.core.LogLevel.Info, msg)

    def warning(self, msg: str):
        self.log(adsk.core.LogLevel.Warning, msg)

    def error(self, msg: str):
        self.log(adsk.core.LogLevel.Error, msg)

    def critical(self, msg: str):
        self.log(adsk.core.LogLevel.Critical, msg)

    def exception(self, msg: str):
        if self.logger:
            self.logger.exception(msg)

    #gm, left these old methods here from previous gen
    def update_named_point(self, point_name, point):
        self.namedPoints[point_name] = point

    def get_shape_collection(self, shape_type: str):
        if shape_type == 'Circle':
            return self.namedCircles
        elif shape_type == 'Ellipse':
            return self.namedEllipses
        elif shape_type == 'Rectangle':
            return self.namedRectangles
        elif shape_type == 'Polygon':
            return self.namedPolygons
        else:
            return {}

#    def store_shape(self, shape_name: str, shape_handler: ShapeHandlerBase):
#        shape_type = shape_handler.get_type()
#        shape_collection = self.get_shape_collection(shape_type)
#        shape_collection[shape_name] = shape_handler.get_shape()
