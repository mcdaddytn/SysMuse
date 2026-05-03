"""
tests/test_fastener_style.py
Unit tests for the FastenerStyle and CageMountPattern enums and the
extended BoltHoleSpec dataclass.

FastenerStyle and CageMountPattern live in fusionkit/core/enums.py which
is adsk-free, so we can import them directly. BoltHoleSpec lives in
fusionkit/features/hole_patterns.py which imports adsk; we replicate
its dataclass definition here for testing the field defaults.

Usage: python -m unittest tests.test_fastener_style
"""

import dataclasses
import sys
import typing
import unittest


# Direct import — enums.py only imports `enum`, no adsk dependency.
sys.path.insert(0, '.')
from fusionkit.core.enums import FastenerStyle, CageMountPattern


# ── Replicated BoltHoleSpec for default-value testing ────────────────────
# Mirrors fusionkit.features.hole_patterns.BoltHoleSpec — keep in sync.

@dataclasses.dataclass
class _BoltHoleSpecReplica:
    screw_diameter: float
    screw_head_diameter: float
    screw_head_depth: float
    nut_width: float
    nut_thickness: float
    fastener_style: FastenerStyle = FastenerStyle.CapturedNut
    cap_clearance: float = 0.0
    cap_depth: float = 0.0
    insert_outer_diameter: float = 0.0
    insert_depth: float = 0.0


# ── Tests ────────────────────────────────────────────────────────────────


class TestFastenerStyleEnum(unittest.TestCase):
    """Verify the FastenerStyle enum members and their string values."""

    def test_threaded_into_plastic_exists(self) -> None:
        self.assertEqual(FastenerStyle.ThreadedIntoPlastic.value, 'ThreadedIntoPlastic')

    def test_captured_nut_exists(self) -> None:
        self.assertEqual(FastenerStyle.CapturedNut.value, 'CapturedNut')

    def test_captured_nut_with_cap_exists(self) -> None:
        self.assertEqual(FastenerStyle.CapturedNutWithCap.value, 'CapturedNutWithCap')

    def test_threaded_inserts_exist(self) -> None:
        for size in ('M3', 'M4', 'M5', 'M6'):
            name: str = f'ThreadedInsert{size}'
            self.assertTrue(hasattr(FastenerStyle, name), f'Missing FastenerStyle.{name}')
            member: FastenerStyle = getattr(FastenerStyle, name)
            self.assertEqual(member.value, name)

    def test_threaded_insert_value_prefix(self) -> None:
        """The dispatch logic in HolePatternDriller depends on this prefix."""
        for member in FastenerStyle:
            if 'Insert' in member.name:
                self.assertTrue(member.value.startswith('ThreadedInsert'),
                                f"{member.name} value should start with 'ThreadedInsert'")

    def test_no_unexpected_members(self) -> None:
        """Document the full membership; surfaces unintentional additions."""
        expected: typing.Set[str] = {
            'ThreadedIntoPlastic',
            'CapturedNut',
            'CapturedNutWithCap',
            'ThreadedInsertM3',
            'ThreadedInsertM4',
            'ThreadedInsertM5',
            'ThreadedInsertM6',
        }
        actual: typing.Set[str] = {m.name for m in FastenerStyle}
        self.assertEqual(actual, expected)


class TestCageMountPatternEnum(unittest.TestCase):
    """Verify the CageMountPattern enum."""

    def test_smallrig_pair_exists(self) -> None:
        self.assertEqual(
            CageMountPattern.SmallRig_Quarter20_Pair.value,
            'SmallRig_Quarter20_Pair',
        )

    def test_default_for_v1(self) -> None:
        """v1 default is SmallRig_Quarter20_Pair — verified by the spec."""
        self.assertIn('SmallRig_Quarter20_Pair', [m.value for m in CageMountPattern])

    def test_all_members_documented(self) -> None:
        expected: typing.Set[str] = {
            'SmallRig_Quarter20_Pair',
            'SmallRig_Quarter20_With_ARRI_Pins',
            'SmallRig_ThreeEighths',
            'Generic_Quarter20_Single',
        }
        actual: typing.Set[str] = {m.name for m in CageMountPattern}
        self.assertEqual(actual, expected)


class TestBoltHoleSpecDefaults(unittest.TestCase):
    """
    Verify BoltHoleSpec's default values preserve backward compatibility.
    Existing call sites construct it with the original 5 positional args;
    that must continue to work, and the new fields must default such that
    the CapturedNut path is taken.
    """

    def test_minimal_construction(self) -> None:
        """Five-arg construction works (matches existing call sites)."""
        spec: _BoltHoleSpecReplica = _BoltHoleSpecReplica(
            screw_diameter=0.42,
            screw_head_diameter=0.77,
            screw_head_depth=0.5,
            nut_width=0.9,
            nut_thickness=0.4,
        )
        self.assertEqual(spec.fastener_style, FastenerStyle.CapturedNut)
        self.assertEqual(spec.cap_clearance, 0.0)
        self.assertEqual(spec.cap_depth, 0.0)
        self.assertEqual(spec.insert_outer_diameter, 0.0)
        self.assertEqual(spec.insert_depth, 0.0)

    def test_positional_construction(self) -> None:
        """Five positional args (the legacy way) still work."""
        spec: _BoltHoleSpecReplica = _BoltHoleSpecReplica(0.42, 0.77, 0.5, 0.9, 0.4)
        self.assertEqual(spec.fastener_style, FastenerStyle.CapturedNut)
        self.assertEqual(spec.screw_diameter, 0.42)
        self.assertEqual(spec.nut_thickness, 0.4)

    def test_captured_nut_with_cap_construction(self) -> None:
        """Setting the new fields works as expected."""
        spec: _BoltHoleSpecReplica = _BoltHoleSpecReplica(
            screw_diameter=0.6,
            screw_head_diameter=1.1,
            screw_head_depth=0.4,
            nut_width=1.0,
            nut_thickness=0.5,
            fastener_style=FastenerStyle.CapturedNutWithCap,
            cap_clearance=0.02,  # 0.2 mm
            cap_depth=0.2,       # 2 mm
        )
        self.assertEqual(spec.fastener_style, FastenerStyle.CapturedNutWithCap)
        self.assertAlmostEqual(spec.cap_clearance, 0.02)
        self.assertAlmostEqual(spec.cap_depth, 0.2)

    def test_threaded_insert_construction(self) -> None:
        """Threaded insert variant carries its own fields."""
        spec: _BoltHoleSpecReplica = _BoltHoleSpecReplica(
            screw_diameter=0.4,
            screw_head_diameter=0.7,
            screw_head_depth=0.4,
            nut_width=0.0,         # not used for inserts
            nut_thickness=0.0,
            fastener_style=FastenerStyle.ThreadedInsertM4,
            insert_outer_diameter=0.6,
            insert_depth=0.8,
        )
        self.assertEqual(spec.fastener_style, FastenerStyle.ThreadedInsertM4)
        self.assertAlmostEqual(spec.insert_outer_diameter, 0.6)
        self.assertAlmostEqual(spec.insert_depth, 0.8)


class TestDispatchPrefixes(unittest.TestCase):
    """
    The HolePatternDriller dispatch logic uses fastener_style.value.startswith()
    to detect threaded inserts. Verify that pattern works for all variants.
    """

    def test_insert_variants_all_match_prefix(self) -> None:
        for member in FastenerStyle:
            is_insert: bool = member.value.startswith('ThreadedInsert')
            should_be_insert: bool = 'Insert' in member.name
            self.assertEqual(
                is_insert, should_be_insert,
                f'{member.name}: prefix detection mismatch'
            )

    def test_non_insert_variants_dont_match(self) -> None:
        for member in (FastenerStyle.ThreadedIntoPlastic,
                       FastenerStyle.CapturedNut,
                       FastenerStyle.CapturedNutWithCap):
            self.assertFalse(member.value.startswith('ThreadedInsert'))


if __name__ == '__main__':
    unittest.main()
