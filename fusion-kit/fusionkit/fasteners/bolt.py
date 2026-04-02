"""
fusionkit.fasteners.bolt
Bolt specification dataclass with standard metric bolt dimensions
and automatic length calculation based on material thickness.
"""

import dataclasses
import typing


# Standard metric socket cap bolt head dimensions (ISO 4762)
# key: nominal diameter string, value: (head_diameter_mm, head_height_mm, clearance_hole_mm)
METRIC_SOCKET_CAP_HEADS: typing.Dict[str, typing.Tuple[float, float, float]] = {
    'M3':  (5.5,  3.0,  3.4),
    'M4':  (7.0,  4.0,  4.5),
    'M5':  (8.5,  5.0,  5.5),
    'M6':  (10.0, 6.0,  6.6),
    'M8':  (13.0, 8.0,  9.0),
    'M10': (16.0, 10.0, 11.0),
}

# Standard available bolt lengths (mm) per nominal size
STANDARD_LENGTHS_MM: typing.Dict[str, typing.List[int]] = {
    'M3':  [6, 8, 10, 12, 16, 20, 25, 30],
    'M4':  [8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50],
    'M5':  [8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 60],
    'M6':  [10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80],
    'M8':  [12, 16, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80],
    'M10': [16, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 100],
}


@dataclasses.dataclass
class Bolt:
    """
    Specification for a single bolt.
    All dimensions in millimeters (converted to API units at point of use).
    """
    nominal_size: str          # e.g., 'M4'
    length_mm: float           # shaft length (excluding head)
    head_diameter_mm: float    # head outer diameter
    head_height_mm: float      # head height (countersink depth)
    clearance_hole_mm: float   # drill diameter for clearance fit
    thread_pitch_mm: float = 0.0  # optional, for thread modeling

    @classmethod
    def from_standard(cls, nominal_size: str, length_mm: float) -> 'Bolt':
        """
        Create a bolt from standard metric dimensions.

        Args:
            nominal_size: e.g., 'M4'
            length_mm: Shaft length in mm.

        Returns:
            Bolt instance with standard head dimensions.
        """
        if nominal_size not in METRIC_SOCKET_CAP_HEADS:
            available: str = ', '.join(METRIC_SOCKET_CAP_HEADS.keys())
            raise KeyError(f"Unknown bolt size '{nominal_size}'. Available: {available}")

        head_dia: float
        head_ht: float
        clearance: float
        (head_dia, head_ht, clearance) = METRIC_SOCKET_CAP_HEADS[nominal_size]

        return cls(
            nominal_size=nominal_size,
            length_mm=length_mm,
            head_diameter_mm=head_dia,
            head_height_mm=head_ht,
            clearance_hole_mm=clearance,
        )

    @classmethod
    def select_length(cls, nominal_size: str, min_length_mm: float) -> 'Bolt':
        """
        Select the shortest standard bolt that meets the minimum length.

        Args:
            nominal_size: e.g., 'M4'
            min_length_mm: Minimum required shaft length.

        Returns:
            Bolt with the shortest standard length >= min_length_mm.

        Raises:
            ValueError: If no standard length is long enough.
        """
        if nominal_size not in STANDARD_LENGTHS_MM:
            raise KeyError(f"No standard lengths for '{nominal_size}'")

        lengths: typing.List[int] = STANDARD_LENGTHS_MM[nominal_size]
        for length in sorted(lengths):
            if length >= min_length_mm:
                return cls.from_standard(nominal_size, float(length))

        raise ValueError(
            f"No standard {nominal_size} bolt >= {min_length_mm}mm. "
            f"Max available: {max(lengths)}mm"
        )
