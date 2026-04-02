from enum import Enum

class CircleInitMethod(Enum):
    Auto = 'Auto'
    TwoPoint = 'TwoPoint'
    CenterRadius = 'CenterRadius'
    #Auto = 0
    #TwoPoint = 1
    #CenterRadius = 2

class RectangleInitMethod(Enum):
    Auto = 'Auto'
    TwoPoint = 'TwoPoint'
    CenterPoint = 'CenterPoint'
    #Auto = 0
    #TwoPoint = 1
    #CenterPoint = 2

class PolygonInitMethod(Enum):
    Auto = 'Auto'
    Edge = 'Edge'
    Scribed = 'Scribed'
    #Auto = 0
    #Edge = 1
    #Scribed = 2

class PointSearchMode(Enum):
    ContainsAll = 'ContainsAll'
    ContainsAny = 'ContainsAny'

class ProfileCountParameter(Enum):
    Loops = 'Loops'
    Curves = 'Curves'
    Lines = 'Lines'
    Arcs = 'Arcs'
    Circles = 'Circles'
    Ellipses = 'Ellipses'

class ProfileLoopSelector(Enum):
    All = 'All'
    OuterOnly = 'OuterOnly'
    InnerOnly = 'InnerOnly'

class NumericComparisonOperator(Enum):
    Equals = 'Equals'
    GreaterThan = 'GreaterThan'
    LessThan = 'LessThan'
    GreaterThanEquals = 'GreaterThanEquals'
    LessThanEquals = 'LessThanEquals'

class PlaneInitMethod(Enum):
    Construction = 'Construction'
    Offset = 'Offset'

class DesignStepResult(Enum):
    Complete = 'Complete'
    Pending = 'Pending'
    Error = 'Error'

class DesignStepType(Enum):
    Sketch = 'Sketch'
    Component = 'Component'

class LogLevelThreshold(Enum):
    NONE = 0
    DEBUG = 10
    INFO = 20
    WARNING = 30
    ERROR = 40
    CRITICAL = 50
