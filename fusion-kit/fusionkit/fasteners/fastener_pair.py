"""
fusionkit.fasteners.fastener_pair
Combines a bolt and nut into a fastener pair with automatic length calculation
based on material thickness, countersink depth, and nut well depth.
"""

import dataclasses
import typing

from fusionkit.fasteners.bolt import Bolt
from fusionkit.fasteners.nut import Nut
from fusionkit.features.hole_patterns import BoltHoleSpec
from fusionkit.core.unit_converter import UnitConverter


@dataclasses.dataclass
class FastenerPair:
    """
    A matched bolt + nut pair with calculated clearances for a specific
    material stack-up.

    The key calculation: given the total material thickness the bolt must
    pass through, determine the minimum bolt length, countersink depth,
    and nut well depth such that:
    - The bolt head is flush or recessed below the entry surface
    - The nut fits into a hex well on the exit surface
    - The bolt threads engage the nut fully
    - Tightening pulls the clamp halves together snugly
    """
    bolt: Bolt
    nut: Nut
    material_thickness_mm: float  # total thickness bolt passes through
    countersink_depth_mm: float = 0.0  # how deep the bolt head sits
    clearance_mm: float = 0.5    # extra length beyond nut for thread engagement

    @property
    def required_bolt_length_mm(self) -> float:
        """
        Minimum bolt shaft length needed.
        = material_thickness - countersink_depth + nut_thickness + clearance
        """
        effective_thickness: float = self.material_thickness_mm - self.countersink_depth_mm
        return effective_thickness + self.nut.thickness_mm + self.clearance_mm

    @classmethod
    def create_for_thickness(
        cls,
        nominal_size: str,
        material_thickness_mm: float,
        countersink: bool = True,
        nyloc: bool = False,
        clearance_mm: float = 0.5,
    ) -> 'FastenerPair':
        """
        Create a FastenerPair with auto-selected bolt length.

        Args:
            nominal_size: e.g., 'M4'
            material_thickness_mm: Total material the bolt passes through.
            countersink: Whether to countersink the bolt head.
            nyloc: Use nyloc nut.
            clearance_mm: Extra thread engagement beyond nut.

        Returns:
            FastenerPair with appropriate bolt length.
        """
        nut: Nut = Nut.from_standard(nominal_size, nyloc=nyloc)
        countersink_depth: float = 0.0

        if countersink:
            # Use the bolt's head height as countersink depth
            temp_bolt: Bolt = Bolt.from_standard(nominal_size, 10.0)  # length doesn't matter here
            countersink_depth = temp_bolt.head_height_mm

        effective_thickness: float = material_thickness_mm - countersink_depth
        min_length: float = effective_thickness + nut.thickness_mm + clearance_mm

        bolt: Bolt = Bolt.select_length(nominal_size, min_length)

        return cls(
            bolt=bolt,
            nut=nut,
            material_thickness_mm=material_thickness_mm,
            countersink_depth_mm=countersink_depth,
            clearance_mm=clearance_mm,
        )

    def to_bolt_hole_spec(self, converter: UnitConverter) -> BoltHoleSpec:
        """
        Convert this fastener pair to a BoltHoleSpec with API-unit dimensions.

        Args:
            converter: UnitConverter for mm → cm conversion.

        Returns:
            BoltHoleSpec ready for use with HolePatternDriller.
        """
        return BoltHoleSpec(
            screw_diameter=converter.length(self.bolt.clearance_hole_mm),
            screw_head_diameter=converter.length(self.bolt.head_diameter_mm),
            screw_head_depth=converter.length(self.countersink_depth_mm),
            nut_width=converter.length(self.nut.well_clearance_mm),
            nut_thickness=converter.length(self.nut.well_depth_mm),
        )

    def summary(self) -> str:
        """Human-readable summary of the fastener pair."""
        return (
            f"{self.bolt.nominal_size} × {self.bolt.length_mm}mm bolt + "
            f"{'nyloc ' if self.nut.is_nyloc else ''}hex nut "
            f"(material={self.material_thickness_mm}mm, "
            f"countersink={self.countersink_depth_mm}mm, "
            f"required_length={self.required_bolt_length_mm:.1f}mm, "
            f"selected_length={self.bolt.length_mm}mm)"
        )
