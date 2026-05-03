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


class FastenerStyle(enum.Enum):
    """How a bolt is retained on the non-bolt side of a printed part.
    Drives the geometry of the nut well / threaded hole / cap recess.

    See docs/features/FEATURE_slider_camera_bracket.md for the rationale
    behind each variant.
    """
    ThreadedIntoPlastic = 'ThreadedIntoPlastic'
    """Tap directly into printed material. OK for low-cycle use, no extra hardware."""

    CapturedNut = 'CapturedNut'
    """Hex pocket sized for nut + minimal clearance. Relies on assembly orientation
    to keep nut in place. This is the existing default for all pipe clamps."""

    CapturedNutWithCap = 'CapturedNutWithCap'
    """Hex pocket plus oversized hex cap recess. Cap is printed separately and glued
    in after nut placement. Permanent retention with metal-on-metal threads.
    Preferred for adjustment fasteners that get repeatedly cycled."""

    ThreadedInsertM3 = 'ThreadedInsertM3'
    ThreadedInsertM4 = 'ThreadedInsertM4'
    ThreadedInsertM5 = 'ThreadedInsertM5'
    ThreadedInsertM6 = 'ThreadedInsertM6'
    """Heat-set or press-fit brass threaded insert. Best for high-cycle threaded
    engagement, especially in lock-screw positions where the screw is removed
    and reinstalled often."""


class CageMountPattern(enum.Enum):
    """Mount-hole pattern on a camera-cage interface plate.

    Each value identifies a specific cage type's mounting hole layout.
    See docs/features/FEATURE_slider_camera_bracket.md for SmallRig details.
    """
    SmallRig_Quarter20_Pair = 'SmallRig_Quarter20_Pair'
    """Pair of 1/4-20 UNC clearance holes. Default for v1."""

    SmallRig_Quarter20_With_ARRI_Pins = 'SmallRig_Quarter20_With_ARRI_Pins'
    """Pair of 1/4-20 holes plus 4mm ARRI pin holes for anti-rotation."""

    SmallRig_ThreeEighths = 'SmallRig_ThreeEighths'
    """3/8-16 UNC threaded hole pattern (tripod-style)."""

    Generic_Quarter20_Single = 'Generic_Quarter20_Single'
    """Single 1/4-20 hole (single-bolt cage adapter)."""
