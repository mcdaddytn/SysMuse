import adsk.core, adsk.fusion, adsk.cam, traceback
import json
import math
import numbers
import io

def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui  = app.userInterface
        username = 'gmcaveney'
        #homedir = "/Users/wikiwoo/"
        #homedir = "/Users/gmcaveney/"
        homedir = "/Users/" + username + "/"
        jsonsubdir = "GrassLabel Dropbox/Grass Label Home/code/fusionscripts/glpcjson/"
        #jsoncfgfn = "lunawrench1"
        #jsoncfgfn = "lunawrench2"
        #jsoncfgfn = "lunawrench3"
        #jsoncfgfn = "lunawrenchds1"
        jsoncfgfn = "lunawrenchds2"
        jsoncfgfpath = homedir + jsonsubdir + jsoncfgfn + ".json"
        
        #ui.messageBox('Opening file: ' + jsoncfgfpath)
        #create_fusion_object(jsoncfgfpath)
        create_double_sided_object(jsoncfgfpath)
        ui.messageBox('Script completed')

    except:
        if ui:
            ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))

def create_fusion_object(json_file_path: str):
    app: adsk.core.Application = adsk.core.Application.get()
    ui: adsk.core.UserInterface = app.userInterface
    design: adsk.fusion.Design = app.activeProduct
    root_comp: adsk.fusion.Component = design.rootComponent
    sketches: adsk.fusion.Sketches = root_comp.sketches
    xy_plane: adsk.fusion.ConstructionPlane = root_comp.xYConstructionPlane
    parameters: dict = read_parameters_from_json(json_file_path)
    radius: float = parameters['radius']
    rimWidth: float = parameters['rimWidth']
    rectWidth: float = parameters['rectWidth']
    rectLength: float = parameters['rectLength']
    numRects: int = parameters['numRects']
    height: float = parameters['height']
    sketch: adsk.fusion.Sketch = sketches.add(xy_plane)
    center: adsk.core.Point3D = adsk.core.Point3D.create(0, 0, 0)
    inner_circle: adsk.fusion.SketchCircle = create_circle(sketch, center, radius)
    outer_circle: adsk.fusion.SketchCircle = create_circle(sketch, center, radius + rimWidth)
    angle_between_rects: float = 360.0 / numRects
    rectangle_lines = []
    sketchOnly: bool = parameters.get('sketchOnly', False)
    #not sure why we need to hardcode, value not coming through
    #sketchOnly = False
    sketchOnly = True
    
    for i in range(numRects):
        angle: float = i * angle_between_rects
        angle_rad: float = math.radians(angle)
        startRect = radius - rectWidth / 2
        #startRect = radius - rectWidth
        rectCentX = center.x + startRect * math.cos(angle_rad)
        rectCentY = center.y + startRect * math.sin(angle_rad)
        rectangle_center: adsk.core.Point3D = adsk.core.Point3D.create(rectCentX, rectCentY, 0)
        lines = create_rectangle(sketch, rectangle_center, rectWidth, rectLength, angle)
        rectangle_lines.extend(lines)

        for line in rectangle_lines:
            distance_from_center = 0.0
            #not sure why line might already be deleted here
            if line.isValid:
                midpoint = calculate_midpoint(line)
                distance_from_center = math.sqrt(midpoint.x**2 + midpoint.y**2)
            
            #test_line: adsk.fusion.SketchLine = line
            #test_line.isValid

            # maybe should add a little fudge factor here since midpoint should fall on circle, but this works
            if distance_from_center >= radius:
                line.deleteMe()            
            #if inner_circle.geometry.distanceTo(line_midpoint) < param_rectLength:
            #    line.deleteMe()

    #this returns count of 10
    #ui.messageBox('sketch.profiles.count: ' + str(sketch.profiles.count))

    if sketchOnly:
        return

    min_area = float('inf')
    inner_circle_profile = None
    # not finding the inner circle right now
    for prof in sketch.profiles:
        #fix up this logic, to get right shapes excluded
        area_properties = prof.areaProperties(adsk.fusion.CalculationAccuracy.VeryHighCalculationAccuracy)
        if area_properties.centroid.isEqualTo(center):
            inner_circle_profile = prof
            if area_properties.area < min_area:
                min_area = area_properties.area
                inner_circle_profile = prof

    profColl = adsk.core.ObjectCollection.create()
    profiles: list = [] 
    for prof in sketch.profiles:
        if prof != inner_circle_profile:
            profiles.append(prof)
            profColl.add(prof) 

    prof: adsk.fusion.Profile = sketch.profiles.item(0)
    extrudes: adsk.fusion.ExtrudeFeatures = root_comp.features.extrudeFeatures
    distance: adsk.core.ValueInput = adsk.core.ValueInput.createByReal(height)
    #extrude: adsk.fusion.ExtrudeFeature = extrudes.addSimple(adsk.core.ObjectCollection.create(profiles), distance, adsk.fusion.FeatureOperations.NewBodyFeatureOperation) 
    extrude: adsk.fusion.ExtrudeFeature = extrudes.addSimple(profColl, distance, adsk.fusion.FeatureOperations.NewBodyFeatureOperation) 
    #extrude: adsk.fusion.ExtrudeFeature = extrudes.addSimple(prof, distance, adsk.fusion.FeatureOperations.NewBodyFeatureOperation) 

    extruded_bodies = []
    extColl = adsk.core.ObjectCollection.create()
    profIndex: int = 0
    for profile in profiles:
        extrude: adsk.fusion.ExtrudeFeature = extrudes.addSimple(profile, distance, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
        extruded_bodies.append(extrude.bodies.item(0))
        if profIndex > 0:
            extColl.add(extrude.bodies.item(0))
        profIndex = profIndex + 1
    
    # Combine all extruded bodies into one
    combine_features: adsk.fusion.CombineFeatures = root_comp.features.combineFeatures
    combine_input: adsk.fusion.CombineFeatureInput = combine_features.createInput(extruded_bodies[0], extColl)
    combine_input.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation
    combine_features.add(combine_input)

	
def create_double_sided_object(json_file_path: str):
    app: adsk.core.Application = adsk.core.Application.get()
    ui: adsk.core.UserInterface = app.userInterface
    design: adsk.fusion.Design = app.activeProduct
    root_comp: adsk.fusion.Component = design.rootComponent
    sketches: adsk.fusion.Sketches = root_comp.sketches
    xy_plane: adsk.fusion.ConstructionPlane = root_comp.xYConstructionPlane
	
    parameters: dict = read_parameters_from_json(json_file_path)
    param_radius1: float = parameters['radius']
    param_rimWidth1: float = parameters['rimWidth']
    param_rectWidth1: float = parameters['rectWidth']
    param_rectLength1: float = parameters['rectLength']
    param_numRects1: int = parameters['numRects']
    param_radius2: float = parameters['radius2']
    param_rimWidth2: float = parameters['rimWidth2']
    param_rectWidth2: float = parameters['rectWidth2']
    param_rectLength2: float = parameters['rectLength2']
    param_numRects2: int = parameters['numRects2']
    param_handleLength: float = parameters['handleLength']
    param_handleWidth: float = parameters['handleWidth']
    param_height: float = parameters['height']	
    param_handleFilletRadius: float = parameters['handleFilletRadius']	
    
    sketchOnly: bool = parameters.get('sketchOnly')

    sketch: adsk.fusion.Sketch = sketches.add(xy_plane)
    center1: adsk.core.Point3D = adsk.core.Point3D.create(0, 0, 0)
    outerRadius1 = param_radius1 + param_rimWidth1
    outerRadius2 = param_radius2 + param_rimWidth2
    center2: adsk.core.Point3D = adsk.core.Point3D.create(param_handleLength + outerRadius1 + outerRadius2, 0, 0)
	
    # First circular object
    inner_circle1: adsk.fusion.SketchCircle = create_circle(sketch, center1, param_radius1)
    outer_circle1: adsk.fusion.SketchCircle = create_circle(sketch, center1, param_radius1 + param_rimWidth1)
    angle_between_rects1: float = 360.0 / param_numRects1
    for i in range(param_numRects1):
        angle: float = i * angle_between_rects1
        angle_rad: float = math.radians(angle)
        rectangle_center: adsk.core.Point3D = adsk.core.Point3D.create(center1.x + (param_radius1 - param_rectWidth1 / 2) * math.cos(angle_rad),
                                                                       center1.y + (param_radius1 - param_rectWidth1 / 2) * math.sin(angle_rad),
                                                                       0)
        rectLines = create_rectangle(sketch, rectangle_center, param_rectWidth1, param_rectLength1, angle)
        delete_outer_rect_line(center1, param_radius1, rectLines)
		
    # Second circular object
    inner_circle2: adsk.fusion.SketchCircle = create_circle(sketch, center2, param_radius2)
    outer_circle2: adsk.fusion.SketchCircle = create_circle(sketch, center2, param_radius2 + param_rimWidth2)
    angle_between_rects2: float = 360.0 / param_numRects2
    for i in range(param_numRects2):
        angle: float = i * angle_between_rects2
        angle_rad: float = math.radians(angle)
        rectangle_center: adsk.core.Point3D = adsk.core.Point3D.create(center2.x + (param_radius2 - param_rectWidth2 / 2) * math.cos(angle_rad),
                                                                       center2.y + (param_radius2 - param_rectWidth2 / 2) * math.sin(angle_rad),
                                                                       0)
        rectLines = create_rectangle(sketch, rectangle_center, param_rectWidth2, param_rectLength2, angle)
        delete_outer_rect_line(center2, param_radius2, rectLines)
		
    # Handle connecting the two circular objects
    handle_center: adsk.core.Point3D = adsk.core.Point3D.create((center1.x + center2.x) / 2, 0, 0)
    #handle_lines = create_rectangle(sketch, handle_center, param_handleLength, param_handleWidth, 0)
    
    # Calculate the handle extension points
    handle_width_extension = param_handleWidth / 2
    handle_length_extension = param_handleLength / 2

    handle_top_left = adsk.core.Point3D.create(handle_center.x - handle_length_extension, handle_width_extension, 0)
    handle_bottom_left = adsk.core.Point3D.create(handle_center.x - handle_length_extension, -handle_width_extension, 0)
    handle_top_right = adsk.core.Point3D.create(handle_center.x + handle_length_extension, handle_width_extension, 0)
    handle_bottom_right = adsk.core.Point3D.create(handle_center.x + handle_length_extension, -handle_width_extension, 0)
    extension_points1 = calculate_handle_connection_points(center1, outerRadius1, handle_length_extension, handle_width_extension)
    extension_points2 = calculate_handle_connection_points(center2, -outerRadius2, handle_length_extension, handle_width_extension)
    #this will draw from outside of rectangle to circle
    #sketch.sketchCurves.sketchLines.addByTwoPoints(handle_top_left, extension_points1[0])
    #sketch.sketchCurves.sketchLines.addByTwoPoints(handle_bottom_left, extension_points1[1])
    #sketch.sketchCurves.sketchLines.addByTwoPoints(handle_top_right, extension_points2[0])
    #sketch.sketchCurves.sketchLines.addByTwoPoints(handle_bottom_right, extension_points2[1])
    line_top: adsk.fusion.SketchLine = sketch.sketchCurves.sketchLines.addByTwoPoints(extension_points1[0], extension_points2[0])
    line_bottom: adsk.fusion.SketchLine = sketch.sketchCurves.sketchLines.addByTwoPoints(extension_points1[1], extension_points2[1])

# Split the outer circles into arcs and delete the inner arcs
    split_circle_and_delete_inner_arc(sketch, center1, outer_circle1, extension_points1[0], extension_points1[1])
    split_circle_and_delete_inner_arc(sketch, center2, outer_circle2, extension_points2[0], extension_points2[1])    

    #outer_circle1.isConstruction = True
    #circ1eArcs: adsk.core.ObjectCollection = outer_circle1.split(extension_points1[0])
    #logObjectCollection(circ1eArcs, app)

    if sketchOnly:
        return
	
    max_area1 = 0.0
    max_area2 = 0.0
    inner_circle_profile1 = None
    inner_circle_profile2 = None
    for prof in sketch.profiles:
        area_properties = prof.areaProperties(adsk.fusion.CalculationAccuracy.VeryHighCalculationAccuracy)
        if area_properties.centroid.isEqualTo(center1):
            if inner_circle_profile1 == None:
                inner_circle_profile1 = prof
            if area_properties.area > max_area1:
                max_area1 = area_properties.area
                inner_circle_profile1 = prof
        if area_properties.centroid.isEqualTo(center2):
            if inner_circle_profile2 == None:
                inner_circle_profile2 = prof
            if area_properties.area > max_area2:
                max_area2 = area_properties.area
                inner_circle_profile2 = prof

    profColl = adsk.core.ObjectCollection.create()
    profiles: list = [] 
    for prof in sketch.profiles:
        if prof != inner_circle_profile1 and prof != inner_circle_profile2:
            profiles.append(prof)
            profColl.add(prof) 

    prof: adsk.fusion.Profile = sketch.profiles.item(0)
    extrudes: adsk.fusion.ExtrudeFeatures = root_comp.features.extrudeFeatures
    distance: adsk.core.ValueInput = adsk.core.ValueInput.createByReal(param_height)
    extrude: adsk.fusion.ExtrudeFeature = extrudes.addSimple(profColl, distance, adsk.fusion.FeatureOperations.NewBodyFeatureOperation) 

    extruded_bodies = []
    extColl = adsk.core.ObjectCollection.create()
    profIndex: int = 0
    for profile in profiles:
        extrude: adsk.fusion.ExtrudeFeature = extrudes.addSimple(profile, distance, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
        extruded_bodies.append(extrude.bodies.item(0))
        if profIndex > 0:
            extColl.add(extrude.bodies.item(0))
        profIndex = profIndex + 1		

    #ui.messageBox("#profiles: %d" % (profiles.count))
    #ui.messageBox("#profiles: " + str(profiles.count))

    # Combine all extruded bodies into one
    body1: adsk.fusion.BRepBody = extruded_bodies[0]
    bodyColl: adsk.core.ObjectCollection
    bodyColl = adsk.core.ObjectCollection.create()
    exBodyCount = extrude.bodies.count
    # why is it 11, 5 here ?
    #for bodyIndex in range(1, 5):
    for bodyIndex in range(1, exBodyCount):
        bodyColl.add(extruded_bodies[bodyIndex])

    combine_features: adsk.fusion.CombineFeatures = root_comp.features.combineFeatures
    # error here
    combine_input: adsk.fusion.CombineFeatureInput = combine_features.createInput(body1, bodyColl)
    combine_input.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation
    #combine_features.add(combine_input)
    #combine_features.add(combine_input)
    #combined_body: adsk.fusion.BRepBody = combine_features.add(combine_input).bodies.item(0)


    combined_body: adsk.fusion.BRepBody = root_comp.bRepBodies.item(0)

    # Delete all other bodies
    #for repbody in root_comp.bRepBodies:
    #    if repbody != combined_body:
    #        repbody.deleteMe()

	# Calculate the length of the handle lines
    handle_line_length: float = line_top.length

    # Add fillets to the handle edges
    #handle_edges = [edge for edge in combined_body.edges if edge.geometryType == adsk.fusion.Curve3DTypes.Line3DCurveType]
    #handle_edges: adsk.fusion.BRepEdges = [edge for edge in combined_body.edges if edge.geometry.curveType == adsk.fusion.Curve3DTypes.Line3DCurveType]
    #handle_edges: adsk.fusion.BRepEdges = [edge for edge in combined_body.edges if edge.geometry.curveType == adsk.core.Curve3DTypes.Line3DCurveType and edge.length == handle_line_length]

    handle_edges = adsk.core.ObjectCollection.create()
    fudge_factor = 1e-3

    for edge in combined_body.edges:
        # if edge.geometry.curveType == adsk.core.Curve3DTypes.Line3DCurveType and edge.length == handle_line_length:
        if edge.geometry.curveType == adsk.core.Curve3DTypes.Line3DCurveType and abs(edge.length - handle_line_length) < fudge_factor:
            handle_edges.add(edge)

    #ui.messageBox("#edges: " + str(handle_edges.count))
    ui.messageBox("#edges: %d" % (handle_edges.count))

    fillet_features: adsk.fusion.FilletFeatures = root_comp.features.filletFeatures
    fillet_input: adsk.fusion.FilletFeatureInput = fillet_features.createInput()
    fillet_input.isRollingBallCorner = True
    fillet_input.addConstantRadiusEdgeSet(handle_edges, adsk.core.ValueInput.createByReal(param_handleFilletRadius), True)
    #fillet_features.add(fillet_input)

    return

def logObjectCollection(objColl: adsk.core.ObjectCollection, app: adsk.core.Application):
    ui  = app.userInterface
    #buffer = io.StringIO()    
    #buffer: str = ""
    buffer: str = "objColl.count: " + str(objColl.count) + "\n"
    objIndex: int = 0
    for obj in objColl:
        objIndex = objIndex + 1
        buffer = buffer + "obj[" + str(objIndex) + "]\n"
        #buffer.write("type: " + type(obj) + "\n")
        #buffer.write("type: %s \n" % (type(obj)))
        #buffer.write("type: %s , " % (type(obj)))
        #buffer = buffer + "type: %s , " % (type(obj))
        #buffer = buffer + "type: " + type(obj) + ", "
        #buffer = buffer + "type: " + ", "
        #buffer = "type: " + ", "
        #app.log("type: " + type(obj))
    #outputStr: str = buffer.getvalue()
    #outputStr: str = buffer
    #buffer = "asdf" + "," + "wer"
    ui.messageBox(buffer)
    #ui.messageBox("outputStr")
    #print(outputStr)
    #buffer.close()

def calculate_handle_connection_points(center, radius, handle_length, handle_width_extension):
    angle_to_handle_edge = math.asin(handle_width_extension / radius)
    angle_to_handle_edge_deg = math.degrees(angle_to_handle_edge)
    point_top = adsk.core.Point3D.create(center.x + radius * math.cos(angle_to_handle_edge),
                                            center.y + radius * math.sin(angle_to_handle_edge), 0)
    point_bottom = adsk.core.Point3D.create(center.x + radius * math.cos(-angle_to_handle_edge),
                                            center.y + radius * math.sin(-angle_to_handle_edge), 0)
    return point_top, point_bottom

def str2bool(v):
  return v.lower() in ("yes", "true", "t", "1")

def read_parameters_from_json(json_file_path: str):
    with open(json_file_path, 'r') as json_file:
        parameters = json.load(json_file)

    app = adsk.core.Application.get()
    design = adsk.fusion.Design.cast(app.activeProduct)
    unitsMgr = design.fusionUnitsManager
    unitsApi = "cm"
    unitsCfg = "mm"
    convparams = dict()

    noConvParams = ['numRects', 'numRects2']
    boolParams = ['sketchOnly']

    for paramKey in parameters:
        curval = parameters[paramKey]
        if paramKey in boolParams:
            convparams[paramKey] = str2bool(curval)
        else:
            if (isinstance(curval, numbers.Number)) and paramKey not in noConvParams:
                convparams[paramKey] = unitsMgr.convert(curval, unitsCfg, unitsApi)
            else:
                convparams[paramKey] = curval   

    return convparams

def calculate_midpoint(line: adsk.fusion.SketchLine):
    start_point = line.startSketchPoint.geometry
    end_point = line.endSketchPoint.geometry
    midpoint_x = (start_point.x + end_point.x) / 2
    midpoint_y = (start_point.y + end_point.y) / 2
    midpoint_z = (start_point.z + end_point.z) / 2
    return adsk.core.Point3D.create(midpoint_x, midpoint_y, midpoint_z)

def calculate_midpoint2(start_point: adsk.core.Point3D, end_point: adsk.core.Point3D):
    midpoint_x = (start_point.x + end_point.x) / 2
    midpoint_y = (start_point.y + end_point.y) / 2
    midpoint_z = (start_point.z + end_point.z) / 2
    return adsk.core.Point3D.create(midpoint_x, midpoint_y, midpoint_z)

def create_circle(sketch: adsk.fusion.Sketch, center: adsk.core.Point3D, radius: float):
    circle = sketch.sketchCurves.sketchCircles.addByCenterRadius(center, radius)
    return circle

def create_rectangle(sketch: adsk.fusion.Sketch, center: adsk.core.Point3D, width: float, length: float, angle: float):
    lines = sketch.sketchCurves.sketchLines
    center_x = center.x
    center_y = center.y
    half_width = width / 2
    half_length = length / 2
    # Calculate rectangle corners
    top_left = adsk.core.Point3D.create(center_x - half_width, center_y + half_length, 0)
    top_right = adsk.core.Point3D.create(center_x + half_width, center_y + half_length, 0)
    bottom_left = adsk.core.Point3D.create(center_x - half_width, center_y - half_length, 0)
    bottom_right = adsk.core.Point3D.create(center_x + half_width, center_y - half_length, 0)
    # Rotate corners around the center
    top_left = rotate_point(center, top_left, angle)
    top_right = rotate_point(center, top_right, angle)
    bottom_left = rotate_point(center, bottom_left, angle)
    bottom_right = rotate_point(center, bottom_right, angle)
    # Draw rectangle lines
    line1 = lines.addByTwoPoints(top_left, top_right)
    line2 = lines.addByTwoPoints(top_right, bottom_right)
    line3 = lines.addByTwoPoints(bottom_right, bottom_left)
    line4 = lines.addByTwoPoints(bottom_left, top_left)

    return [line1, line2, line3, line4]

def delete_outer_rect_line(center: adsk.core.Point3D, radius: float, rectLines):
    for line in rectLines:
        distance_from_center = 0.0
        #fudge_factor = 0.0
        fudge_factor = 1e-3
        #not sure why line might already be deleted here
        if line.isValid:
            midpoint = calculate_midpoint(line)
            #distance_from_center = math.sqrt(midpoint.x**2 + midpoint.y**2)
            distance_from_center = math.sqrt((midpoint.x - center.x)**2 + (midpoint.y - center.y)**2)            
        # maybe should add a little fudge factor here since midpoint should fall on circle, but this works
        if distance_from_center >= (radius - fudge_factor):
            line.deleteMe()            


def rotate_point(center: adsk.core.Point3D, point: adsk.core.Point3D, angle: float):
    angle_rad = math.radians(angle)
    cos_angle = math.cos(angle_rad)
    sin_angle = math.sin(angle_rad)
    translated_x = point.x - center.x
    translated_y = point.y - center.y
    rotated_x = translated_x * cos_angle - translated_y * sin_angle
    rotated_y = translated_x * sin_angle + translated_y * cos_angle
    return adsk.core.Point3D.create(center.x + rotated_x, center.y + rotated_y, point.z)


def calculate_arc_midpoint(center: adsk.core.Point3D, outer_radius: float, handle_midpoint: adsk.core.Point3D) -> adsk.core.Point3D:
    direction_vector: adsk.core.Vector3D = adsk.core.Vector3D.create(handle_midpoint.x - center.x, handle_midpoint.y - center.y, 0)
    direction_vector.normalize()
    arc_midpoint: adsk.core.Point3D = adsk.core.Point3D.create(center.x + outer_radius * direction_vector.x,
                                                               center.y + outer_radius * direction_vector.y, 0)
    return arc_midpoint

def split_circle_and_delete_inner_arc(sketch: adsk.fusion.Sketch, center: adsk.core.Point3D, circle: adsk.fusion.SketchCircle, point1: adsk.core.Point3D, point2: adsk.core.Point3D):
    app: adsk.core.Application = adsk.core.Application.get()
    ui: adsk.core.UserInterface = app.userInterface

    line: adsk.fusion.SketchLine = sketch.sketchCurves.sketchLines.addByTwoPoints(point1, point2)
    handle_midpoint: adsk.core.Point3D = calculate_midpoint2(point1, point2)
    arc_midpoint: adsk.core.Point3D = calculate_arc_midpoint(center, circle.radius, handle_midpoint)
    break_results1: adsk.core.ObjectCollection = circle.breakCurve(arc_midpoint)
    #ui.messageBox("break_results1.count %d" % (break_results1.count))
    line.deleteMe()
    if break_results1.count > 0:
        arcs = [break_results1.item(i) for i in range(break_results1.count) if isinstance(break_results1.item(i), adsk.fusion.SketchArc)]
        if len(arcs) == 2:
            arc1: adsk.fusion.SketchArc = arcs[0]
            arc2: adsk.fusion.SketchArc = arcs[1]
            #arc1_length: float = arc1.geometry.curveLength
            #arc2_length: float = arc2.geometry.curveLength
            arc1_length: float = arc1.length
            arc2_length: float = arc2.length
            if arc1_length < arc2_length:
                arc1.deleteMe()
            else:
                arc2.deleteMe()

