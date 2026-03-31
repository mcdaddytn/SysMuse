import adsk.core, adsk.fusion, adsk.cam, traceback
from .DesignBase import DesignBase
from .SketchBase import SketchBase

def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui  = app.userInterface
        #ui.messageBox('Hello script')

        username = 'gmcaveney'
        #homedir = "/Users/wikiwoo/"
        #homedir = "/Users/gmcaveney/"
        homedir = "/Users/" + username + "/"
        jsonsubdir = "GrassLabel Dropbox/Grass Label Home/code/fusionscripts/glpcjson/"
        jsoncfgfpath = homedir + jsonsubdir 


        # Initialize the DesignBase
        design_base = DesignBase()

        #design_base.loadDefaultsFromJson(jsoncfgfpath + "baseconfig.json")
        design_base.loadDefaultsFromJson(jsoncfgfpath + "baseconfig1.json")
        design_base.run(context)

        #design_base.enumTest()
        
        # Create SketchBase and draw shapes from configuration
        #sketch_base = SketchBase(design_base, "Sample1")
        #sketch_base = SketchBase(design_base, "Sample2")
        #sketch_base = SketchBase(design_base, "Sample3")
        #sketch_base = SketchBase(design_base, "Sample4")
        #sketch_base = SketchBase(design_base, "Sample5")
        #sketch_base = SketchBase(design_base, "Sample6")
        #sketch_base = SketchBase(design_base, "Sample7")
        #sketch_base = SketchBase(design_base, "Sample8")
        sketch_base = SketchBase(design_base, "Sample9")
        sketch_base.drawFromConfiguration()

        design_base.info("Sketch created successfully.")
        #ui.messageBox('Script completed')

    except:
        if ui:
            ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))


# Fusion 360 standard event handlers
def stop(context):
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface
        #ui.messageBox('Stop add-in')
    except:
        ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))
