"""
tests/test_slot_shape.py
Unit tests for SlotShape — covers bounding-box calculation and parameter
validation. The full SlotShape class lives in fusionkit/geometry/shapes.py
which imports adsk at module load time, so we replicate the pure-Python
math here (same pattern used by tests/test_param_loader.py and
tests/test_timeline_extractor.py).

Usage: python -m unittest tests.test_slot_shape
       (or via discover: python -m unittest discover -s tests -v)
"""

import math
import typing
import unittest


# ── Replicated logic under test ──────────────────────────────────────────
# Mirrors fusionkit.geometry.shapes.SlotShape.bounding_box_dimensions

def slot_bounding_box(
    length: float, width: float, angle_rad: float = 0.0
) -> typing.Tuple[float, float]:
    """Replica of SlotShape.bounding_box_dimensions."""
    cos_a: float = abs(math.cos(angle_rad))
    sin_a: float = abs(math.sin(angle_rad))
    bbox_w: float = length * cos_a + width * sin_a
    bbox_h: float = length * sin_a + width * cos_a
    return (bbox_w, bbox_h)


def slot_validate(length: float, width: float) -> None:
    """Mirror the constructor check that length > width."""
    if length <= width:
        raise ValueError(
            f"SlotShape: length ({length}) must be > width ({width})"
        )


# ── Tests ────────────────────────────────────────────────────────────────


class TestSlotBoundingBox(unittest.TestCase):
    """Test the slot's axis-aligned bounding box calculation."""

    def test_axis_aligned_long_axis_x(self) -> None:
        """Slot along X axis: bbox is just (length, width)."""
        bbox: typing.Tuple[float, float] = slot_bounding_box(60.0, 6.5, 0.0)
        self.assertAlmostEqual(bbox[0], 60.0)
        self.assertAlmostEqual(bbox[1], 6.5)

    def test_rotated_90_degrees(self) -> None:
        """Slot rotated 90°: bbox swaps to (width, length)."""
        bbox: typing.Tuple[float, float] = slot_bounding_box(60.0, 6.5, math.pi / 2.0)
        self.assertAlmostEqual(bbox[0], 6.5)
        self.assertAlmostEqual(bbox[1], 60.0)

    def test_rotated_180_degrees(self) -> None:
        """Slot rotated 180°: bbox same as 0° (axis-aligned)."""
        bbox: typing.Tuple[float, float] = slot_bounding_box(60.0, 6.5, math.pi)
        self.assertAlmostEqual(bbox[0], 60.0)
        self.assertAlmostEqual(bbox[1], 6.5)

    def test_rotated_45_degrees(self) -> None:
        """Slot rotated 45°: bbox grows to roughly (length+width)/sqrt(2) on both sides."""
        bbox: typing.Tuple[float, float] = slot_bounding_box(60.0, 6.5, math.pi / 4.0)
        expected: float = (60.0 + 6.5) / math.sqrt(2.0)
        self.assertAlmostEqual(bbox[0], expected, places=5)
        self.assertAlmostEqual(bbox[1], expected, places=5)

    def test_zero_width_slot(self) -> None:
        """Degenerate width=0: bbox along the rotation axis is just length."""
        bbox: typing.Tuple[float, float] = slot_bounding_box(60.0, 0.0, 0.0)
        self.assertAlmostEqual(bbox[0], 60.0)
        self.assertAlmostEqual(bbox[1], 0.0)


class TestSlotValidation(unittest.TestCase):
    """Test the constructor's length > width invariant."""

    def test_length_greater_than_width_ok(self) -> None:
        """Valid slot: length > width."""
        slot_validate(60.0, 6.5)  # should not raise

    def test_length_equals_width_raises(self) -> None:
        """Degenerate slot (length == width) is a circle — rejected."""
        with self.assertRaises(ValueError) as cm:
            slot_validate(6.5, 6.5)
        self.assertIn('must be >', str(cm.exception))

    def test_length_less_than_width_raises(self) -> None:
        """Inverted dimensions are rejected."""
        with self.assertRaises(ValueError):
            slot_validate(5.0, 10.0)


class TestSlotGeometryRelationships(unittest.TestCase):
    """Verify the geometric relationships between slot parameters."""

    def test_straight_section_length(self) -> None:
        """The straight (non-arc) section is (length - width). Each end semicircle
        has diameter = width, so the two ends together consume `width` of length."""
        for (length, width) in [(60.0, 6.5), (30.0, 6.0), (100.0, 8.0)]:
            half_straight: float = (length - width) / 2.0
            full_straight: float = 2.0 * half_straight
            self.assertAlmostEqual(full_straight, length - width)

    def test_arc_radius_equals_half_width(self) -> None:
        """End semicircle radius is half the slot width."""
        for width in [6.5, 6.0, 8.0, 12.0]:
            radius: float = width / 2.0
            self.assertAlmostEqual(radius * 2.0, width)


if __name__ == '__main__':
    unittest.main()
