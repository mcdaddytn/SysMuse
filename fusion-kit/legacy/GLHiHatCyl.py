import adsk.core, adsk.fusion, adsk.cam, traceback
import json

def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui  = app.userInterface

        design = adsk.fusion.Design.cast(app.activeProduct)
        unitsMgr = design.fusionUnitsManager
        #unitsMgr.distanceDisplayUnits = adsk.fusion.DistanceUnits.CentimeterDistanceUnits
        unitsMgr.distanceDisplayUnits = adsk.fusion.DistanceUnits.MillimeterDistanceUnits

        # Read parameters from JSON file
        with open('/Users/wikiwoo/Documents/dev/fusionscripts/hihatcyl/hihatcyl.json', 'r') as f:
            params = json.load(f)

        length = params['length']
        cylinder_diameter = params['cylinder_diameter']
        top_hole_diameter = params['top_hole_diameter']
        bottom_hole_diameter = params['bottom_hole_diameter']
        top_hole_depth = params['top_hole_depth']
        bottom_hole_depth = length - top_hole_depth

        ui.messageBox('Params ' + params)

        # Create a new document
        product = app.activeProduct
        design = adsk.fusion.Design.cast(product)
        rootComp = design.rootComponent

        # Create a new sketch
        sketches = rootComp.sketches
        xyPlane = rootComp.xYConstructionPlane
        sketch = sketches.add(xyPlane)

        # Draw the cylinder
        circles = sketch.sketchCurves.sketchCircles
        circle = circles.addByCenterRadius(adsk.core.Point3D.create(0, 0, 0), cylinder_diameter / 2)

        # Extrude the cylinder
        prof = sketch.profiles.item(0)
        extrudes = rootComp.features.extrudeFeatures
        extInput = extrudes.createInput(prof, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
        distance = adsk.core.ValueInput.createByReal(length)
        extInput.setDistanceExtent(False, distance)
        ext = extrudes.add(extInput)

        # Create the top hole
        sketchTop = sketches.add(rootComp.xYConstructionPlane)
        circlesTop = sketchTop.sketchCurves.sketchCircles
        circleTop = circlesTop.addByCenterRadius(adsk.core.Point3D.create(0, 0, length), top_hole_diameter / 2)

        # Extrude cut the top hole
        profTop = sketchTop.profiles.item(0)
        extInputTop = extrudes.createInput(profTop, adsk.fusion.FeatureOperations.CutFeatureOperation)
        distanceTop = adsk.core.ValueInput.createByReal(-top_hole_depth)
        extInputTop.setDistanceExtent(False, distanceTop)
        extTop = extrudes.add(extInputTop)

        # Create the bottom hole
        sketchBottom = sketches.add(rootComp.xYConstructionPlane)
        circlesBottom = sketchBottom.sketchCurves.sketchCircles
        circleBottom = circlesBottom.addByCenterRadius(adsk.core.Point3D.create(0, 0, 0), bottom_hole_diameter / 2)

        # Extrude cut the bottom hole
        profBottom = sketchBottom.profiles.item(0)
        extInputBottom = extrudes.createInput(profBottom, adsk.fusion.FeatureOperations.CutFeatureOperation)
        distanceBottom = adsk.core.ValueInput.createByReal(bottom_hole_depth)
        extInputBottom.setDistanceExtent(False, distanceBottom)
        extBottom = extrudes.add(extInputBottom)

        ui.messageBox('3D model created successfully.')

    except:
        if ui:
            ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))

