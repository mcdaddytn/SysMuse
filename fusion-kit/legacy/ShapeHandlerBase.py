import adsk.core, adsk.fusion, json
from typing import Dict
from .DesignBase import DesignBase
#from .SketchBase import SketchBase

class ShapeHandlerBase:
    def __init__(self, design_base):
        self.design_base = design_base
        #self.sketch_base = sketch_base
        self.shapeIndex = 0
        #self.design_base = sketch_base.design_base
        #self.sketch = sketch_base.activeSketch

    def _log_parameters(self, params: Dict, shape_name: str, sketch_name: str):
        # do not know why but this is not initialized here
        #shape_index = self.sketch_base.shape_index
        shape_index = self.shapeIndex
        file_name = f"{sketch_name}_{shape_name}_{shape_index}_params.json"
        file_path = f"{self.design_base.objectStatePath}/{file_name}"
        with open(file_path, 'w') as f:
            json.dump(params, f, indent=4)

    def _log_result(self, result: Dict, shape_name: str, sketch_name: str):
        shape_index = self.shapeIndex
        file_name = f"{sketch_name}_{shape_name}_{shape_index}_result.json"
        file_path = f"{self.design_base.objectStatePath}/{file_name}"
        with open(file_path, 'w') as f:
            json.dump(result, f, indent=4)

    def _point2str(self, point: adsk.core.Point3D):
        return self.sketch_base._point2str(point)

# SketchBase
    def _draw(self, shape_config: Dict, activeSketch: adsk.fusion.Sketch):
        raise NotImplementedError("Subclasses should implement this method")


class RectangleHandler(ShapeHandlerBase):
    def _draw(self, shape_config: Dict, activeSketch: adsk.fusion.Sketch):
        self.shapeIndex = self.shapeIndex + 1
        self._log_parameters(shape_config, 'Rectangle', activeSketch.name)
        point_one = self.design_base._get_point(shape_config.get('pointOne'))
        point_two = self.design_base._get_point(shape_config.get('pointTwo'))

        rectangle_init_method = shape_config.get('rectangleInitMethod', 'Auto')
        fillet_radius = self.design_base._get_value(shape_config, 'filletRadius') or 0.0

        self.sketch = activeSketch

        if rectangle_init_method == 'CenterPoint':
            center_point = self.design_base._get_point(shape_config.get('centerPoint'))
            corner_point = self.design_base._get_point(shape_config.get('cornerPoint'))
            lines = self.sketch.sketchCurves.sketchLines.addCenterPointRectangle(center_point, corner_point)
        elif rectangle_init_method == 'TwoPoint' or (rectangle_init_method == 'Auto' and point_one and point_two):
            lines = self.sketch.sketchCurves.sketchLines.addTwoPointRectangle(point_one, point_two)
        else:
            raise ValueError("Insufficient parameters for Rectangle initialization")
        
        if fillet_radius > 0.0:
            self.design_base.info("RectangleHandler._draw fillet_radius: %f" % (fillet_radius))            
            for i in range(4):
                line1: adsk.fusion.SketchLine = lines[i]
                line2: adsk.fusion.SketchLine = lines[(i + 1) % 4]
                self.sketch.sketchCurves.sketchArcs.addFillet(line1, line1.endSketchPoint.geometry, line2, line2.startSketchPoint.geometry, fillet_radius)

        #not sure what happens to lines if fillet applied, check output
        result = {'lines': []}
        for line in lines:
            line_info = {
                'length': line.length,
                'geometry': str(line.geometry),
                'startPoint': self.design_base._point2str(line.startSketchPoint.geometry),
                'endPoint': self.design_base._point2str(line.endSketchPoint.geometry)
            }
            result['lines'].append(line_info)

        self._log_result(result, 'Rectangle', activeSketch.name)


class CircleHandler(ShapeHandlerBase):
    def _draw(self, shape_config: Dict, activeSketch: adsk.fusion.Sketch):
        self.shapeIndex = self.shapeIndex + 1
        self._log_parameters(shape_config, 'Circle', activeSketch.name)
        center_point = self.design_base._get_point(shape_config.get('centerPoint'))
        radius = self.design_base._get_value(shape_config, 'radius')
        point_one = self.design_base._get_point(shape_config.get('pointOne'))
        point_two = self.design_base._get_point(shape_config.get('pointTwo'))

        circle_init_method = shape_config.get('circleInitMethod', 'Auto')
        self.sketch = activeSketch

        if circle_init_method == 'TwoPoint' or (circle_init_method == 'Auto' and point_one and point_two):
            circle = self.sketch.sketchCurves.sketchCircles.addByTwoPoints(point_one, point_two)
        elif circle_init_method == 'CenterRadius' or (circle_init_method == 'Auto' and center_point and radius):
            circle = self.sketch.sketchCurves.sketchCircles.addByCenterRadius(center_point, radius)
        else:
            raise ValueError("Insufficient parameters for Circle initialization")

        result = {
            'area': circle.area,
            'radius': circle.radius,
            'geometry': str(circle.geometry),
            'boundingBox': {
                'minPoint': self.design_base._point2str(circle.boundingBox.minPoint),
                'maxPoint': self.design_base._point2str(circle.boundingBox.maxPoint)
            }
        }

        self._log_result(result, 'Circle', activeSketch.name)


class PolygonHandler(ShapeHandlerBase):
    def _draw(self, shape_config: Dict, activeSketch: adsk.fusion.Sketch):
        self.shapeIndex = self.shapeIndex + 1
        self._log_parameters(shape_config, 'Polygon', activeSketch.name)
        point_one = self.design_base._get_point(shape_config.get('pointOne'))
        point_two = self.design_base._get_point(shape_config.get('pointTwo'))
        edge_count = self.design_base._get_value(shape_config, 'edgeCount')
        center_point = self.design_base._get_point(shape_config.get('centerPoint'))
        radius = self.design_base._get_value(shape_config, 'radius')
        angle = self.design_base._get_value(shape_config, 'angle')
        is_inscribed = self.design_base._get_value(shape_config, 'isInscribed')
        is_right = self.design_base._get_value(shape_config, 'isRight')

        polygon_init_method = shape_config.get('polygonInitMethod', 'Auto')
        self.sketch = activeSketch

        if polygon_init_method == 'Scribed' or (polygon_init_method == 'Auto' and center_point and radius):
            lines = self.sketch.sketchCurves.sketchLines.addScribedPolygon(center_point, edge_count, angle, radius, is_inscribed)
        elif polygon_init_method == 'Edge' or (polygon_init_method == 'Auto' and point_one and point_two):
            lines = self.sketch.sketchCurves.sketchLines.addEdgePolygon(point_one, point_two, is_right, edge_count)
        else:
            raise ValueError("Insufficient parameters for Polygon initialization")

        result = {'lines': []}
        for line in lines:
            line_info = {
                'length': line.length,
                'geometry': str(line.geometry),
                'startPoint': self.design_base._point2str(line.startSketchPoint.geometry),
                'endPoint': self.design_base._point2str(line.endSketchPoint.geometry)
            }
            result['lines'].append(line_info)

        self._log_result(result, 'Polygon', activeSketch.name)

class EllipseHandler(ShapeHandlerBase):
    def _draw(self, shape_config: Dict, activeSketch: adsk.fusion.Sketch):
        self.shapeIndex = self.shapeIndex + 1
        self._log_parameters(shape_config, 'Ellipse', activeSketch.name)

        center_point = self.design_base._get_point(shape_config.get('centerPoint'))
        major_axis_point = self.design_base._get_point(shape_config.get('majorAxisPoint'))
        point = self.design_base._get_point(shape_config.get('point'))

        self.sketch = activeSketch
        ellipse = self.sketch.sketchCurves.sketchEllipses.add(center_point, major_axis_point, point)

        # let's implement print methods for SketchLine
        result = {
            'geometry': str(ellipse.geometry),
            'majorAxis': str(ellipse.majorAxisLine),
            'minorAxis': str(ellipse.minorAxisLine),
            'boundingBox': {
                'minPoint': self.design_base._point2str(ellipse.boundingBox.minPoint),
                'maxPoint': self.design_base._point2str(ellipse.boundingBox.maxPoint)
            }
        }

        self._log_result(result, 'Ellipse', activeSketch.name)
