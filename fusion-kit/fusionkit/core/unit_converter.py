"""
fusionkit.core.unit_converter
Handles unit conversion between JSON config units (mm) and Fusion 360 API units (cm).
"""

import adsk.core
import adsk.fusion
import math


class UnitConverter:
    """
    Converts values between configuration units (default: mm) and
    Fusion 360's internal API units (cm).
    """

    def __init__(self, units_mgr: adsk.fusion.FusionUnitsManager,
                 config_units: str = 'mm', api_units: str = 'cm') -> None:
        self.units_mgr: adsk.fusion.FusionUnitsManager = units_mgr
        self.config_units: str = config_units
        self.api_units: str = api_units

    def length(self, value: float) -> float:
        """Convert a length value from config units to API units."""
        converted: float = self.units_mgr.convert(value, self.config_units, self.api_units)
        return converted

    def point(self, x: float, y: float, z: float = 0.0) -> adsk.core.Point3D:
        """Create a Point3D with coordinates converted from config units to API units."""
        cx: float = self.length(x)
        cy: float = self.length(y)
        cz: float = self.length(z)
        return adsk.core.Point3D.create(cx, cy, cz)

    def point_raw(self, x: float, y: float, z: float = 0.0) -> adsk.core.Point3D:
        """Create a Point3D without unit conversion (already in API units)."""
        return adsk.core.Point3D.create(x, y, z)

    def angle_rad(self, degrees: float) -> float:
        """Convert degrees to radians."""
        return math.radians(degrees)

    def vector(self, x: float, y: float, z: float = 0.0) -> adsk.core.Vector3D:
        """Create a Vector3D with converted coordinates."""
        return adsk.core.Vector3D.create(self.length(x), self.length(y), self.length(z))
