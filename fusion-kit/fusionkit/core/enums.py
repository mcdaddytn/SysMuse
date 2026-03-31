"""
fusionkit.core.enums
All enumeration types used across the FusionKit framework.
Ported from SketchEnums.py with additions for new functionality.
"""

import enum


class CircleInitMethod(enum.Enum):
    Auto = 'Auto'
    TwoPoint = 'TwoPoint'
    CenterRadius = 'CenterRadius'


class RectangleInitMethod(enum.Enum):
    Auto = 'Auto'
    TwoPoint = 'TwoPoint'
    CenterPoint = 'CenterPoint'


class PolygonInitMethod(enum.Enum):
    Auto = 'Auto'
    Edge = 'Edge'
    Scribed = 'Scribed'


class PointSearchMode(enum.Enum):
    ContainsAll = 'ContainsAll'
    ContainsAny = 'ContainsAny'


class ProfileCountParameter(enum.Enum):
    Loops = 'Loops'
    Curves = 'Curves'
    Lines = 'Lines'
    Arcs = 'Arcs'
    Circles = 'Circles'
    Ellipses = 'Ellipses'


class ProfileLoopSelector(enum.Enum):
    All = 'All'
    OuterOnly = 'OuterOnly'
    InnerOnly = 'InnerOnly'


class NumericComparisonOperator(enum.Enum):
    Equals = 'Equals'
    GreaterThan = 'GreaterThan'
    LessThan = 'LessThan'
    GreaterThanEquals = 'GreaterThanEquals'
    LessThanEquals = 'LessThanEquals'


class PlaneInitMethod(enum.Enum):
    Construction = 'Construction'
    Offset = 'Offset'


class PlaneAxis(enum.Enum):
    XY = 'xy'
    XZ = 'xz'
    YZ = 'yz'


class DesignStepResult(enum.Enum):
    Complete = 'Complete'
    Pending = 'Pending'
    Error = 'Error'


class DesignStepType(enum.Enum):
    Sketch = 'Sketch'
    Component = 'Component'
    Assembly = 'Assembly'


class LogLevel(enum.Enum):
    NONE = 0
    DEBUG = 10
    INFO = 20
    WARNING = 30
    ERROR = 40
    CRITICAL = 50


class FeatureOperation(enum.Enum):
    NewBody = 'NewBody'
    Cut = 'Cut'
    Join = 'Join'
    Intersect = 'Intersect'


class DrillDirection(enum.Enum):
    """Direction to drill holes relative to body."""
    TopDown = 'TopDown'           # Through top face (z-axis negative)
    BottomUp = 'BottomUp'         # Through bottom face (z-axis positive)
    FrontBack = 'FrontBack'       # Through front face (y-axis positive)
    BackFront = 'BackFront'       # Through back face (y-axis negative)
    LeftRight = 'LeftRight'       # Through left face (x-axis positive)
    RightLeft = 'RightLeft'       # Through right face (x-axis negative)


class OrientationMode(enum.Enum):
    """Whether the pipe cutout extends along X or Y axis."""
    Tall = 'Tall'      # Extension along Y axis (default)
    Wide = 'Wide'      # Extension along X axis
