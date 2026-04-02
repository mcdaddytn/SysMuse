"""
tests/test_fasteners.py
Unit tests for the fastener bolt/nut/pair system.
Can run outside Fusion 360 — no adsk dependencies.

Usage: python -m unittest tests.test_fasteners -v
"""

import typing
import unittest

from fusionkit.fasteners.bolt import Bolt, METRIC_SOCKET_CAP_HEADS, STANDARD_LENGTHS_MM
from fusionkit.fasteners.nut import Nut, METRIC_HEX_NUTS


class TestBolt(unittest.TestCase):
    """Test bolt creation and length selection."""

    def test_from_standard_m4(self) -> None:
        bolt: Bolt = Bolt.from_standard('M4', 20.0)
        self.assertEqual(bolt.nominal_size, 'M4')
        self.assertEqual(bolt.length_mm, 20.0)
        self.assertEqual(bolt.head_diameter_mm, 7.0)
        self.assertEqual(bolt.head_height_mm, 4.0)
        self.assertEqual(bolt.clearance_hole_mm, 4.5)

    def test_from_standard_unknown_size(self) -> None:
        with self.assertRaises(KeyError):
            Bolt.from_standard('M7', 10.0)

    def test_select_length_exact(self) -> None:
        bolt: Bolt = Bolt.select_length('M4', 20.0)
        self.assertEqual(bolt.length_mm, 20.0)

    def test_select_length_rounds_up(self) -> None:
        bolt: Bolt = Bolt.select_length('M4', 13.0)
        self.assertEqual(bolt.length_mm, 16.0)  # Next standard length >= 13

    def test_select_length_too_long(self) -> None:
        with self.assertRaises(ValueError):
            Bolt.select_length('M4', 999.0)

    def test_all_standard_sizes_have_heads(self) -> None:
        for size in METRIC_SOCKET_CAP_HEADS:
            bolt: Bolt = Bolt.from_standard(size, 10.0)
            self.assertGreater(bolt.head_diameter_mm, 0)
            self.assertGreater(bolt.clearance_hole_mm, 0)


class TestNut(unittest.TestCase):
    """Test nut creation and geometry calculations."""

    def test_from_standard_m4(self) -> None:
        nut: Nut = Nut.from_standard('M4')
        self.assertEqual(nut.nominal_size, 'M4')
        self.assertEqual(nut.across_flats_mm, 7.0)
        self.assertEqual(nut.thickness_mm, 3.2)
        self.assertFalse(nut.is_nyloc)

    def test_nyloc_thicker(self) -> None:
        standard: Nut = Nut.from_standard('M4', nyloc=False)
        nyloc: Nut = Nut.from_standard('M4', nyloc=True)
        self.assertGreater(nyloc.thickness_mm, standard.thickness_mm)

    def test_across_corners(self) -> None:
        nut: Nut = Nut.from_standard('M4')
        # Across corners should be larger than across flats
        self.assertGreater(nut.across_corners_mm, nut.across_flats_mm)

    def test_well_clearance(self) -> None:
        nut: Nut = Nut.from_standard('M4')
        # Well should be slightly larger than nut for easy insertion
        self.assertGreater(nut.well_clearance_mm, nut.across_flats_mm)

    def test_well_depth(self) -> None:
        nut: Nut = Nut.from_standard('M4')
        # Well should be slightly deeper than nut thickness
        self.assertGreater(nut.well_depth_mm, nut.thickness_mm)


class TestFastenerPairLogic(unittest.TestCase):
    """Test fastener pair length calculations (no API dependency)."""

    def test_required_length_simple(self) -> None:
        """Bolt through 26mm material, 4mm countersink, 3.2mm nut, 0.5mm clearance."""
        material: float = 26.0
        countersink: float = 4.0
        nut_thickness: float = 3.2
        clearance: float = 0.5

        effective: float = material - countersink
        required: float = effective + nut_thickness + clearance
        self.assertAlmostEqual(required, 25.7)

        # M4x30 should be selected (next standard length >= 25.7)
        bolt: Bolt = Bolt.select_length('M4', required)
        self.assertEqual(bolt.length_mm, 30.0)

    def test_thick_material_needs_long_bolt(self) -> None:
        """40mm material needs a longer bolt."""
        material: float = 40.0
        countersink: float = 4.0
        nut_thickness: float = 3.2
        clearance: float = 0.5

        required: float = (material - countersink) + nut_thickness + clearance
        self.assertAlmostEqual(required, 39.7)

        bolt: Bolt = Bolt.select_length('M4', required)
        self.assertEqual(bolt.length_mm, 40.0)


if __name__ == '__main__':
    unittest.main()
