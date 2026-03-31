#Author-
#Description-

import adsk.core, adsk.fusion, adsk.cam, traceback
import json
import numbers
import math
import socket
import os

def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui  = app.userInterface
        #ui.messageBox('Hello script')
# Call the runAll function.
        runAll()
        ui.messageBox('Script completed')


    except:
        if ui:
            ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))

def generateFilletedRectObject(rootComp, rectEdgeX, rectEdgeY, objectDepth, circleDiameter, circleExt, orientWide, sketchOnly):
 # Create a new sketch on the x-y plane.
        sketches: adsk.fusion.Sketches = rootComp.sketches
        xy_plane: adsk.fusion.ConstructionPlane = rootComp.xYConstructionPlane
        sketch: adsk.fusion.Sketch = sketches.add(xy_plane)
        # Step 2: Draw a rectangle centered around the origin.
        lines: adsk.fusion.SketchLines = sketch.sketchCurves.sketchLines
        
        halfEdgeX = rectEdgeX / 2
        halfEdgeY = rectEdgeY / 2

        rect_points = adsk.core.Point3D.create(-halfEdgeX, -halfEdgeY, 0)
        rectangle: adsk.fusion.SketchLineList = lines.addTwoPointRectangle(rect_points, adsk.core.Point3D.create(halfEdgeX, halfEdgeY, 0))
        # Step 3: Draw another rectangle centered around the origin with specified dimensions.
        half_circle_diameter = circleDiameter / 2
        half_circle_ext = circleExt / 2
        #inner_rect_points = adsk.core.Point3D.create(-half_circle_diameter, -half_circle_diameter - circleExt, 0)
        if orientWide:
            inner_rect_points = adsk.core.Point3D.create(-half_circle_diameter - half_circle_ext, -half_circle_diameter, 0)
        else:
            inner_rect_points = adsk.core.Point3D.create(-half_circle_diameter, -half_circle_diameter - half_circle_ext, 0)
        
        if orientWide:
            inner_rectangle: adsk.fusion.SketchLineList = lines.addTwoPointRectangle(inner_rect_points, adsk.core.Point3D.create(half_circle_diameter + half_circle_ext, half_circle_diameter, 0))
        else:
            inner_rectangle: adsk.fusion.SketchLineList = lines.addTwoPointRectangle(inner_rect_points, adsk.core.Point3D.create(half_circle_diameter, half_circle_diameter + half_circle_ext, 0))
        # Step 4: Create fillets on each corner of the inner rectangle with a radius of CircleDiameter / 2.
        fillet_radius = circleDiameter / 2
        fillet_features: adsk.fusion.FilletFeatures = rootComp.features.filletFeatures
        fillet_input: adsk.fusion.FilletFeatureInput = fillet_features.createInput()
        fillet_input.isRollingBallCorner = True

        edgeCollection1 = adsk.core.ObjectCollection.create()

        line1: adsk.fusion.SketchLine = inner_rectangle[0]
        line2: adsk.fusion.SketchLine = inner_rectangle[1]
        line3: adsk.fusion.SketchLine = inner_rectangle[2]
        line4: adsk.fusion.SketchLine = inner_rectangle[3]
        arcs: adsk.fusion.SketchArcs = sketch.sketchCurves.sketchArcs
        arc1 = arcs.addFillet(line1, line1.endSketchPoint.geometry, line2, line2.startSketchPoint.geometry, fillet_radius)
        arc2 = arcs.addFillet(line2, line2.endSketchPoint.geometry, line3, line3.startSketchPoint.geometry, fillet_radius)
        arc3 = arcs.addFillet(line3, line3.endSketchPoint.geometry, line4, line4.startSketchPoint.geometry, fillet_radius)
        arc4 = arcs.addFillet(line4, line4.endSketchPoint.geometry, line1, line1.startSketchPoint.geometry, fillet_radius)

        # Step 5: Select the outer shape with the squareEdge minus the inner shape
        outer_profile = None
        for profile in sketch.profiles:
            bounding_box = profile.boundingBox
            width = bounding_box.maxPoint.x - bounding_box.minPoint.x
            height = bounding_box.maxPoint.y - bounding_box.minPoint.y
            if abs(width - rectEdgeX) < 1e-3 and abs(height - rectEdgeY) < 1e-3:
                outer_profile = profile
                break
        if not outer_profile:
            raise Exception("Failed to find the correct profile to extrude.")
        
        #can return here to examine sketch before extrude
        if sketchOnly:
            return

        # Step 6: Extrude the shape up the z-axis with height of ObjectDepth
        extrudes: adsk.fusion.Features = rootComp.features.extrudeFeatures
        distance: adsk.core.ValueInput = adsk.core.ValueInput.createByReal(objectDepth)
        ext_input: adsk.fusion.ExtrudeFeatureInput = extrudes.createInput(outer_profile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
        ext_input.setDistanceExtent(False, distance)
        extrude: adsk.fusion.ExtrudeFeature = extrudes.add(ext_input)


def generateObject(rootComp, rectEdgeX, rectEdgeY, objectDepth, circleDiameter, sketchOnly):
    sketches = rootComp.sketches
    xyPlane = rootComp.xYConstructionPlane
    
    # Create a new sketch on the x-y plane.
    sketch = sketches.add(xyPlane)
    
 # Draw a rectangle.
    lines = sketch.sketchCurves.sketchLines
    halfEdgeX = rectEdgeX / 2
    halfEdgeY = rectEdgeY / 2

    p0 = adsk.core.Point3D.create(-halfEdgeX, -halfEdgeY, 0)
    p1 = adsk.core.Point3D.create(halfEdgeX, halfEdgeY, 0)
    lines.addTwoPointRectangle(p0, p1)

    # Draw a circle inside the square.
    circles = sketch.sketchCurves.sketchCircles
    circle = circles.addByCenterRadius(adsk.core.Point3D.create(0, 0, 0), circleDiameter/2)

    if sketchOnly:
        return
    
    # Extrude the square with the circle cut out.
    prof = sketch.profiles.item(0)  # The profile we want to extrude is the area between the square and the circle.

    extrudes = rootComp.features.extrudeFeatures
    extInput = extrudes.createInput(prof, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    distance = adsk.core.ValueInput.createByReal(objectDepth)
    extInput.setDistanceExtent(False, distance)
    extrude = extrudes.add(extInput)

    body :adsk.fusion.BRepBody = rootComp.bRepBodies[0]
    return body
    #return extrude

#this puts it on axis where we don't want it
def carveNotchAlt(rootComp, body, notchDepth, notchLength, notchHeight, circleDiameter, circleExt, orientWide):
    circleRadius = circleDiameter / 2.0
    halfCircleExt = circleExt / 2.0
    distToSolid = circleRadius
    if circleExt > 0 and not orientWide:
        distToSolid += halfCircleExt

    sketches = rootComp.sketches
    xyPlane = rootComp.xYConstructionPlane
    sketch = sketches.add(xyPlane)

    lines = sketch.sketchCurves.sketchLines
    halfLength = notchLength / 2

    p0 = adsk.core.Point3D.create(-halfLength, distToSolid, 0)
    p1 = adsk.core.Point3D.create(halfLength, distToSolid + notchDepth, 0)
    lines.addTwoPointRectangle(p0, p1)

    prof = sketch.profiles.item(0)  # The profile we want to extrude is the area between the square and the circle.

    extrudes = rootComp.features.extrudeFeatures
    extInput = extrudes.createInput(prof, adsk.fusion.FeatureOperations.CutFeatureOperation)
    distance = adsk.core.ValueInput.createByReal(notchHeight)
    extInput.setDistanceExtent(False, distance)
    extrude = extrudes.add(extInput)

    return body

def carveNotch(rootComp, body, notchDepth, notchLength, notchHeight, circleDiameter, circleExt, orientWide):
    circleRadius = circleDiameter / 2.0
    halfCircleExt = circleExt / 2.0
    distToSolid = circleRadius
    if circleExt > 0 and orientWide:
        distToSolid += halfCircleExt
    # fudge factor, carve a bit more because of curve
    # parameterize this
    #curveDelta = circleDiameter / 10.0
    curveDelta = circleDiameter / 6.0
    distToSolid -= curveDelta

    sketches = rootComp.sketches
    xyPlane = rootComp.xYConstructionPlane
    sketch = sketches.add(xyPlane)

    lines = sketch.sketchCurves.sketchLines
    halfLength = notchLength / 2

    p0 = adsk.core.Point3D.create(distToSolid, -halfLength, 0)
    p1 = adsk.core.Point3D.create(distToSolid + notchDepth, halfLength, 0)
    lines.addTwoPointRectangle(p0, p1)

    prof = sketch.profiles.item(0)  # The profile we want to extrude is the area between the square and the circle.

    extrudes = rootComp.features.extrudeFeatures
    extInput = extrudes.createInput(prof, adsk.fusion.FeatureOperations.CutFeatureOperation)
    distance = adsk.core.ValueInput.createByReal(notchHeight)
    extInput.setDistanceExtent(False, distance)
    extrude = extrudes.add(extInput)

    return body

# 
# this will just drill 4 bolts through from the xy plane at z=0, through object depth with a specfied xOffset and yOffset
# def drillBottomBoltHoles(rootComp, body, screwDiameter, screwHeadDiameter, screwHeadDepth, objectDepth, xOffset, yOffset):
def drillOuterBoltHoles(rootComp, body, screwDiameter, screwHeadDiameter, screwHeadDepth, objectDepth, xOffset, yOffset):
    app = adsk.core.Application.get()
    ui = app.userInterface

    yPos = 0.0
    xPos = 0.0

    sketches = rootComp.sketches
    xyPlane = rootComp.xYConstructionPlane

    faces :adsk.fusion.BRepFaces = body.faces
    topface :adsk.fusion.BRepFace = max(faces, key=(lambda f: f.centroid.z));

    #zPos = 0.0
    zPos = objectDepth
    x1 = xOffset
    x2 = -xOffset
    y1 = yOffset
    y2 = -yOffset

    holes = [
        (x1, y1),
        (x1, y2),
        (x2, y1),
        (x2, y2)
    ]

    #ui.messageBox("In drillBottomBoltHoles")

    for (x, y) in holes:
        headSketch = sketches.add(xyPlane)
        #headSketch = sketches.add(topface)
        holeInput = rootComp.features.holeFeatures.createSimpleInput(adsk.core.ValueInput.createByReal(screwDiameter/2))
        holePoint = adsk.core.Point3D.create(x, y, zPos)
        headCircle = headSketch.sketchCurves.sketchCircles.addByCenterRadius(adsk.core.Point3D.create(x, y, zPos), screwHeadDiameter/2)

        headProfile = headSketch.profiles.item(0)
        headExtrudeInput = rootComp.features.extrudeFeatures.createInput(headProfile, adsk.fusion.FeatureOperations.CutFeatureOperation)
        #headExtrudeInput.setDistanceExtent(False, adsk.core.ValueInput.createByReal(screwHeadDepth))
        headExtrudeInput.setDistanceExtent(False, adsk.core.ValueInput.createByReal(-screwHeadDepth))
        rootComp.features.extrudeFeatures.add(headExtrudeInput)

        # Drill the screw hole.
        holeInput = rootComp.features.holeFeatures.createSimpleInput(adsk.core.ValueInput.createByReal(screwDiameter/2))
        holePoint = adsk.core.Point3D.create(x, y, zPos)

        holeSketch = sketches.add(xyPlane)
        #holeSketch = sketches.add(topface)        
        holeCircle = holeSketch.sketchCurves.sketchCircles.addByCenterRadius(adsk.core.Point3D.create(x, y, zPos), screwDiameter/2)
        holeProfile = holeSketch.profiles.item(0)
        holeExtrudeInput = rootComp.features.extrudeFeatures.createInput(holeProfile, adsk.fusion.FeatureOperations.CutFeatureOperation)
        #holeExtrudeInput.setDistanceExtent(False, adsk.core.ValueInput.createByReal(objectDepth))
        holeExtrudeInput.setDistanceExtent(False, adsk.core.ValueInput.createByReal(-objectDepth))
        rootComp.features.extrudeFeatures.add(holeExtrudeInput)


def drillInnerBoltHoles(rootComp, body, screwDiameter, screwHeadDiameter, screwHeadDepth, nutWidth, nutThickness, rectEdgeX, rectEdgeY, objectDepth, circleDiameter, circleExt, orientWide, innerBoltLength, numBolts):
    app = adsk.core.Application.get()
    ui = app.userInterface
    zOffset = objectDepth / (numBolts + 1)
    yPos = 0.0
    xPos = 0.0

    sketches = rootComp.sketches
    xyPlane = rootComp.xYConstructionPlane
    xzPlane = rootComp.xZConstructionPlane
    halfEdgeX = rectEdgeX / 2
    halfEdgeY = rectEdgeY / 2
    circleRadius = circleDiameter / 2.0
    halfCircleExt = circleExt / 2.0

    zPos = 0.0
    holes = []
    boltIndex = 0
    while boltIndex < numBolts:
        zPos += zOffset
        coords = (xPos, zPos)
        holes.append(coords)
        boltIndex = boltIndex + 1

    for (x, z) in holes:
        headSketch = sketches.add(xzPlane)
        # Drill the screw hole.
        holeInput = rootComp.features.holeFeatures.createSimpleInput(adsk.core.ValueInput.createByReal(screwDiameter/2))
        holePoint = adsk.core.Point3D.create(x, yPos, z)

        holeSketch = sketches.add(xzPlane)
        holeCircle = holeSketch.sketchCurves.sketchCircles.addByCenterRadius(adsk.core.Point3D.create(x, z * -1, yPos), screwDiameter/2)
        holeProfile = holeSketch.profiles.item(0)
        holeExtrudeInput = rootComp.features.extrudeFeatures.createInput(holeProfile, adsk.fusion.FeatureOperations.CutFeatureOperation)
        # not sure if halfEdgeX or halfEdgeY here
        holeExtrudeInput.setDistanceExtent(False, adsk.core.ValueInput.createByReal(halfEdgeY))
        rootComp.features.extrudeFeatures.add(holeExtrudeInput)

        holeExtrudeInput2 = rootComp.features.extrudeFeatures.createInput(holeProfile, adsk.fusion.FeatureOperations.CutFeatureOperation)
        # not sure if halfEdgeX or halfEdgeY here
        holeExtrudeInput2.setDistanceExtent(False, adsk.core.ValueInput.createByReal(-halfEdgeY))
        rootComp.features.extrudeFeatures.add(holeExtrudeInput2)
        nutSketch = sketches.add(xzPlane)

        hexRadius = nutWidth / 2
        hexAngle = 360 / 6
        points = []
        for i in range(6):
            angle = adsk.core.ValueInput.createByReal(i * hexAngle)
            pointX = -1 * (x + hexRadius * math.cos(math.radians(i * hexAngle)))
            # this is one thats off, projected on z axis I think
            pointY = z + hexRadius * math.sin(math.radians(i * hexAngle))
            #this hack moves it into position
            pointY -= objectDepth
            #this must be 0.0
            pointZ = 0.0
            point :adsk.core.Point3D = adsk.core.Point3D.create(pointX, pointY, pointZ)            
            points.append(point)

        nutHexagon = nutSketch.sketchCurves.sketchLines.addEdgePolygon(points[0], points[1], True, 6)        
        distToSolid = circleRadius
        if circleExt > 0 and not orientWide:
            distToSolid += halfCircleExt

        #this is about minimum it should be to catch solid body and leave room for nut with curvature
        #nutExtrudeDepth = distToSolid + (nutThickness * 1.1)
        minNutExtrudeDepth = distToSolid + nutThickness
        nutExtrudeDepth = minNutExtrudeDepth
        # not sure if halfEdgeX or halfEdgeY here
        if (halfEdgeY - distToSolid > innerBoltLength):
            nutExtrudeDepth = (halfEdgeY - innerBoltLength) + nutThickness

        nutProfile = nutSketch.profiles.item(0)
        nutExtrudeInput = rootComp.features.extrudeFeatures.createInput(nutProfile, adsk.fusion.FeatureOperations.CutFeatureOperation)
        nutExtrudeInput.setDistanceExtent(False, adsk.core.ValueInput.createByReal(-nutExtrudeDepth))
        rootComp.features.extrudeFeatures.add(nutExtrudeInput)
        nutExtrudeInput2 = rootComp.features.extrudeFeatures.createInput(nutProfile, adsk.fusion.FeatureOperations.CutFeatureOperation)
        nutExtrudeInput2.setDistanceExtent(False, adsk.core.ValueInput.createByReal(nutExtrudeDepth))
        rootComp.features.extrudeFeatures.add(nutExtrudeInput2)

def drillBoltHoles(rootComp, body, screwDiameter, screwHeadDiameter, screwHeadDepth, nutWidth, nutThickness, rectEdgeX, rectEdgeY, objectDepth, circleDiameter, numBolts):
    app = adsk.core.Application.get()
    ui = app.userInterface

    sketches = rootComp.sketches
    xyPlane = rootComp.xYConstructionPlane
    xzPlane = rootComp.xZConstructionPlane
 
    faces :adsk.fusion.BRepFaces = body.faces
    topface :adsk.fusion.BRepFace = max(faces, key=(lambda f: f.centroid.z));
    bottomface :adsk.fusion.BRepFace = min(faces, key=(lambda f: f.centroid.z));
    leftface :adsk.fusion.BRepFace = max(faces, key=(lambda f: f.centroid.x));
    rightface :adsk.fusion.BRepFace = min(faces, key=(lambda f: f.centroid.x));
    frontface :adsk.fusion.BRepFace = min(faces, key=(lambda f: f.centroid.y));
    backface :adsk.fusion.BRepFace = max(faces, key=(lambda f: f.centroid.y));

    faceslist =[
        ['top', max(faces, key=(lambda f: f.centroid.z))],
        ['bottom', min(faces, key=(lambda f: f.centroid.z))],
        ['right', max(faces, key=(lambda f: f.centroid.x))],
        ['left', min(faces, key=(lambda f: f.centroid.x))],
        ['front', min(faces, key=(lambda f: f.centroid.y))],
        ['back', max(faces, key=(lambda f: f.centroid.y))]
    ]

    # create Sketch Text
    for name, face in faceslist:
        createText(name, face)

    # Determine positions for the holes.
    xOffset = (rectEdgeX - circleDiameter) / 4
    zOffset = objectDepth / (numBolts + 1)
    x1 = ((rectEdgeX / 2) * -1)  + xOffset
    x2 = (rectEdgeX / 2) - xOffset
    yPos = (rectEdgeY / 2) * -1

    holes = []
    boltIndex = 0
    zPos = 0.0
    while boltIndex < numBolts:
        zPos += zOffset
        coords = (x1, zPos)
        holes.append(coords)
        coords = (x2, zPos)
        holes.append(coords)
        boltIndex = boltIndex + 1
    
    for (x, z) in holes:
        headSketch = sketches.add(xzPlane)
        # Drill the screw hole.
        holeInput = rootComp.features.holeFeatures.createSimpleInput(adsk.core.ValueInput.createByReal(screwDiameter/2))
        holePoint = adsk.core.Point3D.create(x, yPos, z)

        headCircle = headSketch.sketchCurves.sketchCircles.addByCenterRadius(adsk.core.Point3D.create(x, z * -1, yPos), screwHeadDiameter/2)
        headProfile = headSketch.profiles.item(0)
        headExtrudeInput = rootComp.features.extrudeFeatures.createInput(headProfile, adsk.fusion.FeatureOperations.CutFeatureOperation)
        headExtrudeInput.setDistanceExtent(False, adsk.core.ValueInput.createByReal(screwHeadDepth))
        rootComp.features.extrudeFeatures.add(headExtrudeInput)

        holeSketch = sketches.add(xzPlane)
        holeCircle = holeSketch.sketchCurves.sketchCircles.addByCenterRadius(adsk.core.Point3D.create(x, z * -1, yPos), screwDiameter/2)
        holeProfile = holeSketch.profiles.item(0)
        holeExtrudeInput = rootComp.features.extrudeFeatures.createInput(holeProfile, adsk.fusion.FeatureOperations.CutFeatureOperation)
        holeExtrudeInput.setDistanceExtent(False, adsk.core.ValueInput.createByReal(rectEdgeY))
        rootComp.features.extrudeFeatures.add(holeExtrudeInput)
        nutSketch = sketches.add(backface)

        ffcp :adsk.core.Point3D = frontface.centroid
        bfcp :adsk.core.Point3D = backface.centroid
        
        hexPoint = adsk.core.Point3D.create(x, bfcp.y, z)
        hexRadius = nutWidth / 2
        hexAngle = 360 / 6
        points = []
        for i in range(6):
            angle = adsk.core.ValueInput.createByReal(i * hexAngle)
            pointX = -1 * (x + hexRadius * math.cos(math.radians(i * hexAngle)))
            pointY = z + hexRadius * math.sin(math.radians(i * hexAngle))
            pointZ = 0.0
            point :adsk.core.Point3D = adsk.core.Point3D.create(pointX, pointY, pointZ)
            points.append(point)
        nutHexagon = nutSketch.sketchCurves.sketchLines.addEdgePolygon(points[0], points[1], True, 6)

        nutProfile = nutSketch.profiles.item(0)
        nutExtrudeInput = rootComp.features.extrudeFeatures.createInput(nutProfile, adsk.fusion.FeatureOperations.CutFeatureOperation)
        nutExtrudeInput.setDistanceExtent(False, adsk.core.ValueInput.createByReal(nutThickness*-1))
        rootComp.features.extrudeFeatures.add(nutExtrudeInput)

def createText(
    name :str,
    face :adsk.fusion.BRepFace
    ):
    comp :adsk.fusion.Component = face.body.parentComponent
    skt :adsk.fusion.Sketch = comp.sketches.addWithoutEdges(face)
    txts :adsk.fusion.SketchTexts = skt.sketchTexts
    txts.add(txts.createInput(name, 1, skt.modelToSketchSpace(face.centroid)))

#def convertParams(params, fromUnits, toUnits, unitsMgr):
def convertParams(params, unitsMgr, defaults):
    unitsApi = "cm"
    unitsCfg = "mm"

    noConvParams = ['NumClampBolts', 'NumInnerBolts', 'NumOuterBolts']
    convparams = dict()
    #first pass, load defaults in to dict
    for paramKey in defaults:
        convparams[paramKey] = defaults[paramKey]
         
    if 'units' in params:
        unitsCfg = params['Units']
    else:
        if 'units' in defaults:
            unitsCfg = defaults['Units']

    #convert any numeric params and override any defaults from json config
    for paramKey in params:
        curval = params[paramKey]
        if (isinstance(curval, numbers.Number)) and paramKey not in noConvParams:
            convparams[paramKey] = unitsMgr.convert(curval, unitsCfg, unitsApi)
        else:
            convparams[paramKey] = curval   
    return convparams

def splitObject(rootComp, body):
    # Create a construction plane at y=0
    planes = rootComp.constructionPlanes
    planeInput = planes.createInput()
    offsetValue = adsk.core.ValueInput.createByReal(0)
    #planeInput.setByOffset(rootComp.xYConstructionPlane, offsetValue)
    planeInput.setByOffset(rootComp.xZConstructionPlane, offsetValue)
    constructionPlane = planes.add(planeInput)

    # Split the body by the construction plane
    splitBodies = rootComp.features.splitBodyFeatures
    splitBodyInput = splitBodies.createInput(body, constructionPlane, True)
    splitBodies.add(splitBodyInput)

def exportObjects(rootComp, design, exportPath, fileName1, fileName2):
    bodies = [b for b in rootComp.bRepBodies if b.isSolid]
    body1: adsk.fusion.BRepBody = bodies[0]
    body2: adsk.fusion.BRepBody = bodies[1]

    exportMgr = adsk.fusion.ExportManager.cast(design.exportManager)
    filePath1 = exportPath + fileName1 + '.stl'
    filePath2 = exportPath + fileName2 + '.stl'

    #hide body 1
    body1.isLightBulbOn = True
    #show body 1
    body2.isLightBulbOn = False
    stlOptions = exportMgr.createSTLExportOptions(rootComp)
    stlOptions.meshRefinement = adsk.fusion.MeshRefinementSettings.MeshRefinementMedium
    stlOptions.filename = filePath1
    exportMgr.execute(stlOptions)

    #hide body 1
    body1.isLightBulbOn = False
    #show body 2
    body2.isLightBulbOn = True
    stlOptions = exportMgr.createSTLExportOptions(rootComp)
    stlOptions.meshRefinement = adsk.fusion.MeshRefinementSettings.MeshRefinementMedium
    stlOptions.filename = filePath2
    exportMgr.execute(stlOptions)
    #show body 1
    body1.isLightBulbOn = True
    #show body 2
    body2.isLightBulbOn = True


def createSubComps(rootComp, body):
    # Collect the resulting bodies
    bodies = [b for b in rootComp.bRepBodies if b.isSolid]

    # Create new components for the split bodies
    newOccs = rootComp.occurrences
    screwSideOcc = newOccs.addNewComponent(adsk.core.Matrix3D.create())
    screwSideComp = screwSideOcc.component
    screwSideComp.name = "ScrewSide"

    nutSideOcc = newOccs.addNewComponent(adsk.core.Matrix3D.create())
    nutSideComp = nutSideOcc.component
    nutSideComp.name = "NutSide"

    # Move the split bodies to the new components
    moveFeatures :adsk.fusion.MoveFeatures = rootComp.features.moveFeatures
    for bodypart in bodies:
        if bodypart.boundingBox.minPoint.y < 0:
            targetComp = nutSideComp
        else:
            targetComp = screwSideComp

        bodiesToMove :adsk.core.ObjectCollection = adsk.core.ObjectCollection.create()
        bodiesToMove.add(bodypart)
        moveFeats :adsk.fusion.MoveFeatures = moveFeatures.createInput2(bodiesToMove)
        #moveFeats.bodies.add(body)
        # error here, this method does not exist
        #moveFeats.setNewComponent(targetComp)
        #moveFeatures.add(moveFeats)


def sliceAndCreateComponents(rootComp, body):
    # Create a construction plane at y=0
    planes = rootComp.constructionPlanes
    planeInput = planes.createInput()
    offsetValue = adsk.core.ValueInput.createByReal(0)
    #planeInput.setByOffset(rootComp.xYConstructionPlane, offsetValue)
    planeInput.setByOffset(rootComp.xZConstructionPlane, offsetValue)
    constructionPlane = planes.add(planeInput)
    # Split the body by the construction plane
    splitBodies = rootComp.features.splitBodyFeatures
    splitBodyInput = splitBodies.createInput(body, rootComp.xZConstructionPlane, True)
    #splitBodyInput = splitBodies.createInput(body, constructionPlane, True)
    splitBodies.add(splitBodyInput)
    # Collect the resulting bodies
    bodies = [b for b in rootComp.bRepBodies if b.isSolid]
    # Create new components for the split bodies
    newOccs = rootComp.occurrences
    screwSideOcc = newOccs.addNewComponent(adsk.core.Matrix3D.create())
    screwSideComp = screwSideOcc.component
    screwSideComp.name = "ScrewSide"
    nutSideOcc = newOccs.addNewComponent(adsk.core.Matrix3D.create())
    nutSideComp = nutSideOcc.component
    nutSideComp.name = "NutSide"
    # Move the split bodies to the new components
    moveFeatures = rootComp.features.moveFeatures
    for body in bodies:
        if body.boundingBox.minPoint.y < 0:
            targetComp = nutSideComp
        else:
            targetComp = screwSideComp
        moveFeats = moveFeatures.createInput(adsk.core.ObjectCollection.create())
        moveFeats.addBody(body)
        moveFeats.setNewComponent(targetComp)
        moveFeatures.add(moveFeats)

def getProfilesInfo(sketch):
    profiles_info = []
    for i, profile in enumerate(sketch.profiles):
        bounding_box = profile.boundingBox
        area_properties = profile.areaProperties(adsk.fusion.CalculationAccuracy.HighCalculationAccuracy)
        info = (
            f"Profile {i}:\n"
            f"Bounding Box - Min Point: ({bounding_box.minPoint.x}, {bounding_box.minPoint.y}, {bounding_box.minPoint.z}), "
            f"Max Point: ({bounding_box.maxPoint.x}, {bounding_box.maxPoint.y}, {bounding_box.maxPoint.z})\n"
            f"Area: {area_properties.area}, Perimeter: {area_properties.perimeter}\n"
        )
        profiles_info.append(info)
    return "\n".join(profiles_info)

def get_center_point(point1, point2):
    x = (point1.x + point2.x) / 2
    y = (point1.y + point2.y) / 2
    z = (point1.z + point2.z) / 2
    return adsk.core.Point3D.create(x, y, z)

def get_center_point_from_line(line):
    start_point = line.startSketchPoint.geometry
    end_point = line.endSketchPoint.geometry
    return get_center_point(start_point, end_point)

def str2bool(v):
  return v.lower() in ("yes", "true", "t", "1")

def dumpState(rootComp, json_file_path):
    state = {
        "sketches": [],
        "bodies": []
    }
    # Log the coordinates of all sketches
    sketches = rootComp.sketches
    for sketch in sketches:
        sketch_info = {
            "name": sketch.name,
            "curves": []
        }
        scs :adsk.fusion.SketchCurves = sketch.sketchCurves

        for curve in sketch.sketchCurves:
            sc :adsk.fusion.SketchCurve = curve
            intersect_result = curve.intersections(None)
            if intersect_result[0]:  # Check if the intersection is valid
                # points = intersect_result[1]
                points = intersect_result[2]
                for point in points:
                    pt :adsk.core.Point3D = point
                    sketch_info["curves"].append({
                        "point": {"x": pt.x, "y": pt.y, "z": pt.z}
                    })

        state["sketches"].append(sketch_info)
    # Log the vertices for the three-dimensional object
    bodies = rootComp.bRepBodies
    for body in bodies:
        body_info = {
            "name": body.name,
            "faces": []
        }
        for face in body.faces:
            face_info = {
                "tempId": face.tempId,
                "vertices": []
            }
            for vertex in face.vertices:
                pt = vertex.geometry
                face_info["vertices"].append({"x": pt.x, "y": pt.y, "z": pt.z})
            body_info["faces"].append(face_info)
        state["bodies"].append(body_info)
    # Print to console
    print(json.dumps(state, indent=4))
    # Write to JSON file

    with open(json_file_path, "w") as f:
        json.dump(state, f, indent=4)

def paramDefaults():
    defaults: dict = dict()
    defaults['Units'] = 'mm' 
    defaults['NumClampBolts'] = 2
    defaults['NumInnerBolts'] = 2
    defaults['NumOuterBolts'] = 0

    return defaults


def runAll():
    app = adsk.core.Application.get()
    ui = app.userInterface
    design = adsk.fusion.Design.cast(app.activeProduct)
    unitsMgr = design.fusionUnitsManager
    compname = socket.gethostname()
    #username = os.getlogin()
    username = 'gmcaveney'
    #homedir = "/Users/wikiwoo/"
    #homedir = "/Users/gmcaveney/"
    homedir = "/Users/" + username + "/"
    jsonsubdir = "Documents/dev/fusionscripts/pipeclamp/"
    #jsoncfgfn = "pipeclamp2.json"
    #jsoncfgfn = "pipeclampnew1.json"
    #jsoncfgfn = "pipeclamp7.json"
    #jsoncfgfn = "pipeclamp7"
    #jsoncfgfn = "pipeclamp8"
    #jsoncfgfn = "pipeclamp9"
    #jsoncfgfn = "pipeclamp10"
    #jsoncfgfn = "pipeclamp11"
    jsoncfgfn = "pipeclamp12"
    #jsoncfgfn = "pipeclamp13"
    jsoncfgfpath = homedir + jsonsubdir + jsoncfgfn + ".json"
    logsubdir = "Documents/dev/logs/fusion/"
    jsondumpfn = "dumpState.json"
    jsondumppath = homedir + logsubdir + jsondumpfn
    compdir = homedir + "Documents/dev/fusion"
    exportPath = homedir + "Downloads/"
    fileName1 = jsoncfgfn + "ss"
    fileName2 = jsoncfgfn + "ns"

    try:
        # Load parameters from JSON file.
        #with open('/Users/wikiwoo/Documents/dev/fusionscripts/pipeclamp/pipeclamp4.json') as json_file:
        with open(jsoncfgfpath) as json_file:
            params = json.load(json_file)
            defaults = paramDefaults()
            # add dict of defaults here
            convparams = convertParams(params, unitsMgr, defaults)
            #ui.messageBox('Params Converted:' + json.dumps(convparams))
            # add num bolts from different locations
            # numClampBolts, numInnerBolts, numOuterBolts

            squareEdge = 0.0
            rectEdgeX = 0.0
            rectEdgeY = 0.0
            if 'SquareEdge' in convparams:
                squareEdge = convparams['SquareEdge']
                rectEdgeX = squareEdge
                rectEdgeY = squareEdge
            else:
                rectEdgeX = convparams['RectEdgeX']
                rectEdgeY = convparams['RectEdgeY']
                #used for default calcs below
                squareEdge = (rectEdgeX + rectEdgeY) / 2
            
            objectDepth = convparams['ObjectDepth']
            circleDiameter = convparams['CircleDiameter']
            screwDiameter = convparams['ScrewDiameter']
            screwHeadDiameter = convparams['ScrewHeadDiameter']
            screwHeadDepth = convparams['ScrewHeadDepth']
            nutWidth = convparams['NutWidth']
            nutThickness = convparams['NutThickness']

            numClampBolts = convparams['NumClampBolts']
            numInnerBolts = convparams['NumInnerBolts']
            numOuterBolts = convparams['NumOuterBolts']
            # now can pass these params to bolt drilling functions
            # also can have displacement from calc'd bolt holes possibly

            if 'OuterXOffset' in convparams:
                outerXOffset = convparams['OuterXOffset']
            else:
                outerXOffset = squareEdge / 4
            if 'OuterYOffset' in convparams:
                outerYOffset = convparams['OuterYOffset']
            else:
                outerYOffset = squareEdge / 4    

            isInnerCicle: bool = True
            orientWide: bool = True
            sketchOnly: bool = False
            circleExt = 0
            innerBoltLength = 0
            drillInnerBolts: bool = False
            drillOuterBolts: bool = False
            drillClampBolts: bool = False
            
            if 'CircleExt' in convparams:
                circleExt = convparams['CircleExt']
                if (circleExt>0):
                    isInnerCicle = False
            if 'OrientWide' in convparams:
                orientWide = str2bool(convparams['OrientWide'])
            if 'SketchOnly' in convparams:
                sketchOnly = str2bool(convparams['SketchOnly'])
            if 'InnerBoltLength' in convparams and numInnerBolts > 0:
                drillInnerBolts = True
                innerBoltLength = convparams['InnerBoltLength']
            drillOuterBolts = numOuterBolts > 0
            drillClampBolts = numClampBolts > 0
            notchDepth = 0.0
            notchLength = 0.0
            if 'NotchDepth' in convparams:
                notchDepth = convparams['NotchDepth']
            if 'NotchLength' in convparams:
                notchLength = convparams['NotchLength']
            if 'NotchHeight' in convparams:
                notchHeight = convparams['NotchHeight']
            else:
                notchHeight = objectDepth / 2
            carveClampNotch = notchLength > 0

        #orientWide = False
        # Get the active design.
        product = app.activeProduct
        design: adsk.fusion.Design = adsk.fusion.Design.cast(product)

        # Get the root component of the active design.
        rootComp: adsk.fusion.Component = design.rootComponent

        # Clear existing objects.
        for body in rootComp.bRepBodies:
            body.deleteMe()
        for sketch in rootComp.sketches:
            sketch.deleteMe()

        if isInnerCicle:
            body = generateObject(rootComp, rectEdgeX, rectEdgeY, objectDepth, circleDiameter, sketchOnly)
        else:
            body = generateFilletedRectObject(rootComp, rectEdgeX, rectEdgeY, objectDepth, circleDiameter, circleExt, orientWide, sketchOnly)

        for body in rootComp.bRepBodies:
            body.opacity = .8;
        
        if sketchOnly:
            return
        
        dumpState(rootComp, jsondumppath)

        # Drill the bolt holes.
        if drillClampBolts:
            drillBoltHoles(rootComp, body, screwDiameter, screwHeadDiameter, screwHeadDepth, nutWidth, nutThickness, rectEdgeX, rectEdgeY, objectDepth, circleDiameter, numClampBolts)
        if drillInnerBolts:
            drillInnerBoltHoles(rootComp, body, screwDiameter, screwHeadDiameter, screwHeadDepth, nutWidth, nutThickness, rectEdgeX, rectEdgeY, objectDepth, circleDiameter, circleExt, orientWide, innerBoltLength, numInnerBolts)
        if drillOuterBolts:
            drillOuterBoltHoles(rootComp, body, screwDiameter, screwHeadDiameter, screwHeadDepth, objectDepth, outerXOffset, outerYOffset)
        if carveClampNotch:
            carveNotch(rootComp, body, notchDepth, notchLength, notchHeight, circleDiameter, circleExt, orientWide)

        splitObject(rootComp, body)
        exportObjects(rootComp, design, exportPath, fileName1, fileName2)

        #createSubComps(rootComp, body)

        # Slice the object and create components
        # sliceAndCreateComponents(rootComp, body)
    
    except Exception as e:
        if ui:
            ui.messageBox(f"Failed: {str(e)}")
            ui.messageBox(traceback.format_exc())

