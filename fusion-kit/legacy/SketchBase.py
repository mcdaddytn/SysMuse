import adsk.core, adsk.fusion, adsk.cam, traceback
from .DesignBase import DesignBase
from .SketchEnums import CircleInitMethod, RectangleInitMethod, PolygonInitMethod, PlaneInitMethod
from .ShapeHandlerBase import ShapeHandlerBase, RectangleHandler, CircleHandler, PolygonHandler, EllipseHandler
from .ExtrudeHandlerBase import ExtrudeHandlerBase, LastProfileExtrude, PointContainExtrude, ProfileCountExtrude
from typing import Union, Dict, List

class SketchBase:
    def __init__(self, design_base: DesignBase, sketch_name: str, plane_name: str = 'xyConstructionPlane'):
        self.design_base = design_base
        self.sketch_name = sketch_name
        self.plane_name = plane_name
        #self.namedPoints = {}
        self.shapes = []
        self.activeSketch = None
        self.sketchOnly = False
        self.sketchIndex = 0
        self.shape_index = 0
        self.extrude_index = 0
        self.planeInitMethod: PlaneInitMethod = PlaneInitMethod.Construction
        self.design_base.info("SketchBase, initialized sketch: " + self.sketch_name)
        self.shape_handlers: Dict[str, ShapeHandlerBase] = {}
        self.extrude_handlers: Dict[str, ExtrudeHandlerBase] = {}
        self._initialize_shape_handlers()
        self._initialize_extrude_handlers()        

    def drawFromConfiguration(self):
        config_file = f"{self.design_base.designConfigPath}/{self.sketch_name}.json"
        params = self.design_base.loadParametersFromJson(config_file)

        self.sketch_name = params.get('sketchName', self.sketch_name)
        self.planeInitMethod = PlaneInitMethod(params.get('planeInitMethod', 'Construction'))
        self.plane_name = params.get('plane_name', self.plane_name)
        self.sketchOnly = params.get('sketchOnly', False)

        # Initialize the sketch plane
        sketch_plane = self._initialize_sketch_plane(params)
        #sketch_plane = self.design_base.root_comp.xYConstructionPlane

        self.shape_index = 0
        self.activeSketch = self.design_base.sketches.add(sketch_plane)
        self.activeSketch.name = self.sketch_name
        self.design_base.info("drawFromConfiguration, created sketch: " + self.activeSketch.name)

        named_points = params.get('namedPoints', {})
        for point_name, coordinates in named_points.items():
            x = 0.0
            y = 0.0
            z = 0.0
            for dim, val in coordinates.items():
                if (dim == 'x'):
                    x = self.design_base._convert_value("x", val) 
                elif (dim == 'y'):
                    y = self.design_base._convert_value("y", val) 
                elif (dim == 'z'):
                    z = self.design_base._convert_value("z", val) 
            point = adsk.core.Point3D.create(x, y, z)
            self.design_base.info("drawFromConfiguration, named point %s, x: %f, y: %f, z: %f" % (point_name, x, y, z))
            self.design_base.namedPoints[point_name] = point
                    
        shapes = params.get('shapes', [])
        self.design_base.info("drawFromConfiguration, shapes.count: %s" % (str(shapes.count)))
        for shape in shapes:
            self.design_base.info("drawFromConfiguration, drawing shape: " + str(shape))
            shape_type = shape.get('shapeType', '')
            handler = self.shape_handlers.get(shape_type)
            if handler:
                handler._draw(shape, self.activeSketch)
            self.shape_index += 1
            if not self.design_base.combineSketches:
                self.activeSketch = self.design_base.sketches.add(self.design_base.planes[self.plane_name])
                self.activeSketch.name = self.sketch_name + "_" + str(self.shape_index)
                self.design_base.info("drawFromConfiguration, created sketch: " + self.activeSketch.name)

        self.logSketchPoints()

        lastProfile: adsk.fusion.Profile = None
        areaProps: adsk.fusion.AreaProperties = None
        #calcAccuracy: adsk.fusion.CalculationAccuracy = adsk.fusion.CalculationAccuracy.VeryHighCalculationAccuracy
        calcAccuracy: adsk.fusion.CalculationAccuracy = adsk.fusion.CalculationAccuracy.LowCalculationAccuracy
        numProfs = 0

        numProfs = self.activeSketch.profiles.count
        self.design_base.info("drawFromConfiguration, numProfs: %d" % (numProfs))
        for profIndex in range(numProfs):
            lastProfile = self.activeSketch.profiles.item(profIndex)
            areaProps = lastProfile.areaProperties(calcAccuracy)
            profLoops: adsk.Fusion.ProfileLoops = lastProfile.profileLoops
            profLoopsCount = profLoops.count
            self.design_base.info("drawFromConfiguration, profIndex=%d, area: %f, perimeter: %f, loops count: %d, centroid: %s" % (profIndex, areaProps.area, areaProps.perimeter, profLoopsCount, self.design_base._point2str(areaProps.centroid)))

        if self.sketchOnly:
            self.design_base.info("drawFromConfiguration, completed SketchOnly mode")
            return
        
        extrudes = params.get('extrudes', [])
        self.design_base.info("drawFromConfiguration, extrudes.count: %s" % (str(extrudes.count)))
        for extrude in extrudes:
            extrude_type = extrude.get('extrudeType', '')
            self.design_base.info("drawFromConfiguration, extruding type: %s" % (extrude_type))
            handler = self.extrude_handlers.get(extrude_type)
            if handler:
                handler._extrude(extrude, self.activeSketch)
                self.extrude_index += 1
                self.design_base.info("drawFromConfiguration, extruded type: %s, new index: %d" % (extrude_type, self.extrude_index))

        self.design_base.info("drawFromConfiguration, completed")

    # def _initialize_sketch_plane(self, params: dict) -> adsk.fusion.ConstructionPlane:
    def _initialize_sketch_plane(self, params: dict):
        #new_plane: adsk.fusion.ConstructionPlane = None 
        if self.planeInitMethod == PlaneInitMethod.Offset:
            plane_offset = params.get('planeOffset', 0.0)
            self.design_base.info("_initialize_sketch_plane, offset %f from %s" % (plane_offset, self.plane_name))
            #construction_plane = self.design_base.root_comp.constructionPlanes.itemByName(self.plane_name)
            construction_plane = self.design_base.planes[self.plane_name]
            plane_input = self.design_base.root_comp.constructionPlanes.createInput()
            offset_value = adsk.core.ValueInput.createByReal(plane_offset)
            plane_input.setByOffset(construction_plane, offset_value)
            return self.design_base.root_comp.constructionPlanes.add(plane_input)
        else:
            self.design_base.info("_initialize_sketch_plane, construction plane %s" % (self.plane_name))
            return self.design_base.planes[self.plane_name]
            #return self.design_base.root_comp.constructionPlanes.itemByName(self.plane_name)

    def logSketchPoints(self):
        for spIndex in range(self.activeSketch.sketchPoints.count):
            sketchPoint: adsk.fusion.SketchPoint = self.activeSketch.sketchPoints.item(spIndex)
            self.design_base.info("SketchPoint(index=%d): %s" % (spIndex, self.design_base._point2str(sketchPoint.geometry)))

    def _initialize_shape_handlers(self):
        self.shape_handlers['Rectangle'] = RectangleHandler(self.design_base)
        self.shape_handlers['Circle'] = CircleHandler(self.design_base)
        self.shape_handlers['Polygon'] = PolygonHandler(self.design_base)
        self.shape_handlers['Ellipse'] = EllipseHandler(self.design_base)

    def _initialize_extrude_handlers(self):
        self.extrude_handlers['LastProfileExtrude'] = LastProfileExtrude(self.design_base)
        self.extrude_handlers['ProfileCountExtrude'] = ProfileCountExtrude(self.design_base)
        self.extrude_handlers['PointContainExtrude'] = PointContainExtrude(self.design_base)

    def _initialize_handlers_old(self):
        self.shape_handlers = {
            'Rectangle': RectangleHandler(self),
            'Circle': CircleHandler(self),
            'Polygon': PolygonHandler(self),
            'Ellipse': EllipseHandler(self)
        }
        self.extrude_handlers = {
            'LastProfileExtrude': LastProfileExtrude(self),
            'ProfileCountExtrude': ProfileCountExtrude(self),
            'PointContainExtrude': PointContainExtrude(self)
        }
