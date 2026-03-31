import adsk.core, adsk.fusion, adsk.cam, traceback, json, logging
import importlib
from enum import Enum
from datetime import datetime
from typing import Dict, List, Union, Type
from .SketchEnums import CircleInitMethod, RectangleInitMethod, PolygonInitMethod, PlaneInitMethod, LogLevelThreshold, PointSearchMode, DesignStepType, DesignStepResult
from .DesignContext import DesignContext
#from .ShapeHandlerBase import ShapeHandlerBase, RectangleHandler, CircleHandler, PolygonHandler, EllipseHandler
#from .ExtrudeHandlerBase import ExtrudeHandlerBase, LastProfileExtrude, PointContainExtrude, ProfileCountExtrude

class DesignBase:
    def __init__(self):
        self.app: adsk.core.Application = None
        self.ui: adsk.core.UserInterface = None
        self.design: adsk.fusion.Design = None
        self.root_comp: adsk.fusion.Component = None
        self.sketches: adsk.fusion.Sketches = None

        #gm: added this init here so can use ui right away during init
        self.app = adsk.core.Application.get()
        self.ui = self.app.userInterface
        self.design = self.app.activeProduct
        self.root_comp = self.design.rootComponent
        self.sketches = self.root_comp.sketches

        self.configUnits: str = 'mm'
        self.fusionUnits: str = 'cm'
        #self.fusionUnits: str = 'mm'
        self.designConfigPath: str = ''
        self.logFilePath: str = ''
        self.objectStatePath: str = ''
        self.componentExportPath: str = ''
        self.componentImportPath: str = ''
        self.logger = None
        self.combineSketches = True
        self.boolParams: List[str] = []
        self.floatParams: List[str] = []
        self.intParams: List[str] = []
        self.coordinateParams: List[str] = []
        self.enumClasses: Dict[str, Enum] = {}
        self.enumParams: Dict[str, str] = {}
        self.namedParameters: Dict[str, any] = {}
        self.defaultValues: Dict[str, any] = {}
        self.namedPoints: Dict[str, adsk.core.Point3D] = {}
        
        # gm new
        self.parameterTypes: Dict[str, type]

        self.planes: Dict[str, adsk.fusion.ConstructionPlane] = {}
        #self.shape_handlers: Dict[str, ShapeHandlerBase] = {}
        #self.extrude_handlers: Dict[str, ExtrudeHandlerBase] = {}
        self._initialize_enums()
        self._initialize_planes()
        #self._initialize_shape_handlers()
        #self._initialize_extrude_handlers()        
        # Logging threshold properties
        self.logFileThreshold: LogLevelThreshold = LogLevelThreshold.INFO
        self.logWindowThreshold: LogLevelThreshold = LogLevelThreshold.NONE

    # new init, reconcile with above
    def __init__new(self, app: adsk.core.Application, global_config_path: str):
        self.context = DesignContext(app)
        #self.shape_handlers: Dict[str, ShapeHandlerBase] = {}
        #self.extrude_handlers: Dict[str, ExtrudeHandlerBase] = {}
        #self.initialSteps: List[DesignStepBase] = []
        self.boolParams: List[str] = []
        self.floatParams: List[str] = []
        self.intParams: List[str] = []
        self.coordinateParams: List[str] = []
        self.enumParams: Dict[str, Type] = {}
        self.load_global_config(global_config_path)

    # gm new config method
    def load_global_config(self, config_path: str):
        with open(config_path, 'r') as f:
            config = json.load(f)
            self.context.overrideDefaultValues(config.get('defaultValues', {}))
            self.context.overrideNamedParameters(config.get('namedParameters', {}))
            self.context.overrideNamedPoints(config.get('namedPoints', {}))
            self.context.namedPlanes.update(config.get('namedPlanes', {}))
            self.context.namedFaces.update(config.get('namedFaces', {}))
            self.context.namedLines.update(config.get('namedLines', {}))
            self.context.namedSketches.update(config.get('namedSketches', {}))
            self.context.namedBodies.update(config.get('namedBodies', {}))
            self.context.namedCircles.update(config.get('namedCircles', {}))
            self.context.namedEllipses.update(config.get('namedEllipses', {}))
            self.context.namedRectangles.update(config.get('namedRectangles', {}))
            self.context.namedPolygons.update(config.get('namedPolygons', {}))
            self.shape_handlers.update(config.get('shape_handlers', {}))
            self.extrude_handlers.update(config.get('extrude_handlers', {}))
            # Initialize parameter types
            self.boolParams = config.get('boolParams', [])
            self.floatParams = config.get('floatParams', [])
            self.intParams = config.get('intParams', [])
            self.coordinateParams = config.get('coordinateParams', [])
            self.enumParams = config.get('enumParams', {})
            self.context.initParameterTypes(self.boolParams, self.floatParams, self.intParams, self.coordinateParams, self.enumParams)


    def runWorkflow(self, workflow_config_path: str):
        with open(workflow_config_path, 'r') as f:
            workflow_config = json.load(f)
        
        # Override or extend context values with the workflow configuration
        self.context.overrideDefaultValues(workflow_config.get('defaultValues', {}))
        self.context.overrideNamedParameters(workflow_config.get('namedParameters', {}))
        self.context.overrideNamedPoints(workflow_config.get('namedPoints', {}))
        
        for step_config in workflow_config.get('initialSteps', []):
            step_name = step_config['name']
            step_type = DesignStepType(step_config['stepType'])

            #gm, commenting this for now, keep back pointers out
            if step_type == DesignStepType.Sketch:
                #step = SketchBase(step_name, step_config, self.context)
                step = None
            elif step_type == DesignStepType.Component:
                #step = ComponentBase(step_name, step_config, self.context)
                step = None
            else:
                continue

            step.initialize_from_json(step_config)
            result = step.execute()
            if result != DesignStepResult.Complete:
                self.context.error(f"Error in executing step: {step_name}")
                break

    # gm old config method
    def loadDefaultsFromJson(self, configPath: str):
        with open(configPath, 'r') as f:
            config = json.load(f)

        self.designConfigPath = config.get('designConfigPath', '')
        self.logFilePath = config.get('logFilePath', '')
        self.objectStatePath = config.get('objectStatePath', '')
        self.componentExportPath = config.get('componentExportPath', '')
        self.componentImportPath = config.get('componentImportPath', '')
        self.configUnits = config.get('configUnits', 'mm')
        self.fusionUnits = config.get('fusionUnits', 'mm')

        logRootName = config.get('logRootName', 'fusionlog')
        logFormat = config.get('logFormat', '%(asctime)s - %(levelname)s - %(message)s')
        logDateSuffixFormat = config.get('logDateSuffixFormat', '%d%m%Y%H%M%S')
        logFileType = config.get('logFileType', 'log')
        curdt: datetime = datetime.now()
        logDateSuffix = curdt.strftime(logDateSuffixFormat)
        self.logFileThreshold = LogLevelThreshold[config.get('logFileThreshold', 'INFO').upper()]
        self.logWindowThreshold = LogLevelThreshold[config.get('logWindowThreshold', 'NONE').upper()]

        #logDateSuffix = adsk.core.ValueInput.createByString(adsk.core.DateTime.now().toString(logDateSuffixFormat))
        logFileName = f"{logRootName}_{logDateSuffix}.{logFileType}"
        logFilePath = f"{self.logFilePath}/{logFileName}"

        #self.ui.messageBox("logFilePath: " + logFilePath)

        #logging.basicConfig(filename=logFilePath, format=logFormat)
        #self.logger = logging.getLogger(logRootName)
        #self.logger.setLevel(logging.INFO)
        #self.logger.setLevel(logging.DEBUG)
        #self.logger.info("logger initialized with path: " + logFilePath)
        self.initLog(logFilePath, logRootName, logFormat)
        self.logger.info("logger initialized with path: " + logFilePath)
        self.logger.info("config path: " + configPath)

        self.boolParams = config.get('boolParams', [])
        self.floatParams = config.get('floatParams', [])
        self.intParams = config.get('intParams', [])
        self.coordinateParams = config.get('coordinateParams', [])
        self.enumParams = config.get('enumParams', {})
        self.namedParameters = config.get('namedParameters', {})
        self.defaultValues = config.get('defaultValues', {})
        self.combineSketches = config.get('combineSketches', True)

        self.logger.info("loadDefaultsFromJson, boolParams: " + str(self.boolParams))
        self.logger.info("loadDefaultsFromJson, floatParams: " + str(self.floatParams))
        self.logger.info("loadDefaultsFromJson, intParams: " + str(self.intParams))
        self.logger.info("loadDefaultsFromJson, coordinateParams: " + str(self.coordinateParams))
        self.logger.info("loadDefaultsFromJson, enumParams: " + str(self.enumParams))
        self.logger.info("loadDefaultsFromJson, namedParameters: " + str(self.namedParameters))
        self.logger.info("loadDefaultsFromJson, defaultValues: " + str(self.defaultValues))

        #self.combineSketches = False

    # old methods below, move this to DesignContext
    def initLog(self, logPath: str, logName: str, logFmt: str):
        #logger: logging.Logger = logging.getLogger(__name__)
        self.logger = logging.getLogger(logName)
        #self.logger.setLevel(logging.INFO)
        self.logger.setLevel(self.logFileThreshold.value)
        #logger.setLevel(logging.DEBUG)
        #formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
        formatter = logging.Formatter(logFmt)
        #formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
        #logHandler = logging.FileHandler(os.path.join(appPath, 'logTest.log'), mode='w')
        #logHandler = logging.FileHandler(os.path.join(loggingdir, 'logTest.log'), mode='w')
        logHandler = logging.FileHandler(logPath, mode='w')
        logHandler.setFormatter(formatter)
        logHandler.flush()
        self.logger.addHandler(logHandler)

    def initLog2(self, logPath: str, logName: str, logFmt: str):
        logging.basicConfig(filename=logFilePath, format=logFormat)
        self.logger = logging.getLogger(logName)
        self.logger.setLevel(logging.INFO)
        #self.logger.setLevel(logging.DEBUG)
        self.logger.info("logger initialized with path: " + logFilePath)

    def log(self, level: LogLevelThreshold, msg: str):
        if level == LogLevelThreshold.NONE:
            return
        if level.value >= self.logFileThreshold.value:
            self.logger.log(level.value, msg)
        if level.value >= self.logWindowThreshold.value:
            command_palette = self.ui.commandDefinitions.itemById('TextCommands')
            if command_palette:
                self.app.executeTextCommand(msg)
                #self.app.executeTextCommand(f'echo "{msg}"')

    def enumTest(self):
        self.logger.info("enumTest")
        enumName: str = "circleInitMethod"
        enumValText: str = "CenterRadius"
        enumVal2: object = None

        #enumModule = importlib.import_module(".SketchEnums")
        #self.logger.info("enumTest enumModule(type=%s): %s" % (type(enumModule), str(enumModule)))
        #enum_class = getattr(enumModule, enumName)
        #self.logger.info("enumTest enum_class(type=%s): %s" % (type(enum_class), str(enum_class)))
        enum_class: type = CircleInitMethod
        self.logger.info("enumTest enum_class(type=%s): %s" % (type(enum_class), str(enum_class)))

        #enum_class = self.enumParams[enumName]
        enumVal2 = enum_class[enumValText]
        self.logger.info("enumTest enumVal2(type=%s): %s" % (type(enumVal2), str(enumVal2)))

    def _str2bool(self, v):
        return v.lower() in ("yes", "true", "t", "1")

    def loadParametersFromJson(self, configPath: str) -> Dict[str, any]:
        with open(configPath, 'r') as f:
            params = json.load(f)

        convertedParams = {}
        for key, value in params.items():
            if key in self.boolParams:
                #convertedParams[key] = bool(value)
                convertedParams[key] = self._str2bool(value) if isinstance(value, str) else bool(value)
            elif key in self.floatParams:
                convertedParams[key] = float(value)
            elif key in self.intParams:
                convertedParams[key] = int(value)
            elif key in self.coordinateParams:
                self.info("_convert_value " + str(value) + ", from " + self.configUnits + " to " + self.fusionUnits)
                convertedParams[key] = self.unitsMgr.convert(value, self.configUnits, self.fusionUnits)
            elif key in self.enumParams:
                enum_class_name = self.enumParams[key]
                enum_class = self.enumClasses[enum_class_name]
                convertedParams[key] = enum_class[value]
            else:
                convertedParams[key] = value

        return convertedParams

    def run(self, context):
        self.app = adsk.core.Application.get()
        self.ui = self.app.userInterface
        self.design = self.app.activeProduct
        self.root_comp = self.design.rootComponent
        self.sketches = self.root_comp.sketches
        self.unitsMgr = self.design.fusionUnitsManager

    def _initialize_planes(self):
        self.planes['xyConstructionPlane'] = self.root_comp.xYConstructionPlane
        self.planes['xzConstructionPlane'] = self.root_comp.xZConstructionPlane
        self.planes['yzConstructionPlane'] = self.root_comp.yZConstructionPlane
        self.planes['xYConstructionPlane'] = self.root_comp.xYConstructionPlane
        self.planes['xZConstructionPlane'] = self.root_comp.xZConstructionPlane
        self.planes['yZConstructionPlane'] = self.root_comp.yZConstructionPlane

    def _initialize_enums(self):
        self.enumClasses['CircleInitMethod'] = CircleInitMethod
        self.enumClasses['RectangleInitMethod'] = RectangleInitMethod
        self.enumClasses['PolygonInitMethod'] = PolygonInitMethod
        self.enumClasses['circleInitMethod'] = CircleInitMethod
        self.enumClasses['rectangleInitMethod'] = RectangleInitMethod
        self.enumClasses['polygonInitMethod'] = PolygonInitMethod
        self.enumClasses['PlaneInitMethod'] = PlaneInitMethod
        self.enumClasses['planeInitMethod'] = PlaneInitMethod
        self.enumClasses['LogLevelThreshold'] = LogLevelThreshold
        self.enumClasses['logLevelThreshold'] = LogLevelThreshold
        self.enumClasses['PointSearchMode'] = PointSearchMode
        self.enumClasses['pointSearchMode'] = PointSearchMode

    def _point2str(self, point: adsk.core.Point3D):
        return "Point x,y,z: %f,%f,%f" % (round(point.x, 2), round(point.y, 2), round(point.z, 2))
    
    def _get_point(self, value: Union[str, List[float], None]) -> adsk.core.Point3D:
        if isinstance(value, str):
            return self.namedPoints.get(value, adsk.core.Point3D.create(0, 0, 0))
        elif isinstance(value, list):
            # want to add conversion here as well, pass in keys x, y, z
            x = self._convert_value("x", value[0]) if len(value) > 0 else 0.0
            y = self._convert_value("y", value[1]) if len(value) > 1 else 0.0
            z = self._convert_value("z", value[2]) if len(value) > 2 else 0.0
            #x = value[0] if len(value) > 0 else 0.0
            #y = value[1] if len(value) > 1 else 0.0
            #z = value[2] if len(value) > 2 else 0.0
            return adsk.core.Point3D.create(x, y, z)
        return adsk.core.Point3D.create(0, 0, 0)

    def _get_value(self, shape: dict, key: str):
        specVal = None
        convVal = None
        rawVal = None

        if key in shape:
            specVal = shape[key]
            rawVal = specVal
            if isinstance(specVal, str):
                #self.design_base.info("_get_value, key %s is string, checking namedParameters" % (key))
                if specVal in self.namedParameters:
                    self.info("_get_value, key %s is string, in namedParameters" % (key))
                    rawVal = self.namedParameters[rawVal]
            else:
                #self.design_base.info("_get_value, key %s is not string" % (key))
                rawVal = specVal
        elif key in self.defaultValues:
            self.info("_get_value, key %s in defaultValues" % (key))
            rawVal = self.defaultValues[key]
        else:
            self.warning("_get_value, key %s not in shape or defaultValues" % (key))

        if rawVal:
            convVal = self._convert_value(key, rawVal)
        else:
            self.warning("_get_value, key %s no rawVal" % (key))

        self.info("_get_value, key %s, specVal: %s rawVal: %s, convVal: %s, type: %s" % (key, str(rawVal), str(specVal), str(convVal), type(convVal)))
        return convVal
    
    def _str2bool(self, v):
        return v.lower() in ("yes", "true", "t", "1")

    #def _convert_value(self, key: str, value: object):
    #def _convert_value(self, key: str, value: Union[str, float, int, bool]) -> Union[float, int, bool]:
    def _convert_value(self, key: str, value: object):
        if key in self.floatParams:
            self.debug("_convert_value float, key: %s, value: %s, type: %s" % (key, str(value), type(value)))
            return float(value)
        elif key in self.intParams:
            self.debug("_convert_value int, key: %s, value: %s, type: %s" % (key, str(value), type(value)))
            return int(value)
        elif key in self.boolParams:
            self.debug("_convert_value bool, key: %s, value: %s, type: %s" % (key, str(value), type(value)))
            return self._str2bool(value) if isinstance(value, str) else bool(value)
        elif key in self.coordinateParams:
            self.debug("_convert_value coord, key: %s, value: %s, type: %s" % (key, str(value), type(value)))
            return self.unitsMgr.convert(float(value), self.configUnits, self.fusionUnits)
        elif key in self.enumParams:
            self.debug("_convert_value enum, key: %s, value: %s, type: %s" % (key, str(value), type(value)))
            enum_class_name = self.enumParams[key]
            enum_class = self.enumClasses[enum_class_name]
            return enum_class[value]
        else:
            self.debug("_convert_value no convert, key: %s, value: %s, type: %s" % (key, str(value), type(value)))
            return value
        
    def getApp(self) -> adsk.core.Application:
        return self.app

    def getUI(self) -> adsk.core.UserInterface:
        return self.ui

    def getDesign(self) -> adsk.fusion.Design:
        return self.design

    def getRootComponent(self) -> adsk.fusion.Component:
        return self.root_comp

    def getSketches(self) -> adsk.fusion.Sketches:
        return self.sketches
    
    # Compatibility logging methods
    def debug(self, msg: str):
        self.log(LogLevelThreshold.DEBUG, msg)

    def info(self, msg: str):
        self.log(LogLevelThreshold.INFO, msg)

    def warning(self, msg: str):
        self.log(LogLevelThreshold.WARNING, msg)

    def error(self, msg: str):
        self.log(LogLevelThreshold.ERROR, msg)

    def critical(self, msg: str):
        self.log(LogLevelThreshold.CRITICAL, msg)

    def exception(self, msg: str):
        self.log(LogLevelThreshold.ERROR, msg)
        self.logger.exception(msg)  # This logs the traceback information
