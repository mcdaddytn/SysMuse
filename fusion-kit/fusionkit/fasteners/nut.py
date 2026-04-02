"""
fusionkit.fasteners.nut
Nut specification dataclass with standard metric hex nut dimensions.
"""

import dataclasses
import math
import typing


# Standard metric hex nut dimensions (ISO 4032)
# key: nominal size, value: (across_flats_mm, thickness_mm)
METRIC_HEX_NUTS: typing.Dict[str, typing.Tuple[float, float]] = {
    'M3':  (5.5,  2.4),
    'M4':  (7.0,  3.2),
    'M5':  (8.0,  4.7),
    'M6':  (10.0, 5.2),
    'M8':  (13.0, 6.8),
    'M10': (16.0, 8.4),
}

# Nyloc (prevailing torque) hex nut — thicker
METRIC_NYLOC_NUTS: typing.Dict[str, typing.Tuple[float, float]] = {
    'M3':  (5.5,  4.0),
    'M4':  (7.0,  5.0),
    'M5':  (8.0,  5.0),
    'M6':  (10.0, 6.0),
    'M8':  (13.0, 8.0),
    'M10': (16.0, 10.0),
}


@dataclasses.dataclass
class Nut:
    """
    Specification for a hex nut.
    All dimensions in millimeters.
    """
    nominal_size: str          # e.g., 'M4'
    across_flats_mm: float     # distance between parallel flat sides
    thickness_mm: float        # nut height
    is_nyloc: bool = False     # nyloc (prevailing torque) variant

    @property
    def across_corners_mm(self) -> float:
        """Distance across corners (point-to-point) of the hexagon."""
        return self.across_flats_mm / math.cos(math.radians(30))

    @property
    def well_depth_mm(self) -> float:
        """
        Recommended well depth for press-fit nut retention.
        Slightly deeper than nut thickness for easy insertion.
        """
        return self.thickness_mm * 1.05

    @property
    def well_clearance_mm(self) -> float:
        """
        Recommended across-flats dimension for the hex well.
        Slightly larger than nut for easy push-in fit.
        """
        return self.across_flats_mm * 1.02

    @classmethod
    def from_standard(cls, nominal_size: str, nyloc: bool = False) -> 'Nut':
        """
        Create a nut from standard metric dimensions.

        Args:
            nominal_size: e.g., 'M4'
            nyloc: If True, use nyloc dimensions.

        Returns:
            Nut instance with standard dimensions.
        """
        table: typing.Dict[str, typing.Tuple[float, float]] = (
            METRIC_NYLOC_NUTS if nyloc else METRIC_HEX_NUTS
        )
        if nominal_size not in table:
            available: str = ', '.join(table.keys())
            raise KeyError(f"Unknown nut size '{nominal_size}'. Available: {available}")

        across_flats: float
        thickness: float
        (across_flats, thickness) = table[nominal_size]

        return cls(
            nominal_size=nominal_size,
            across_flats_mm=across_flats,
            thickness_mm=thickness,
            is_nyloc=nyloc,
        )
