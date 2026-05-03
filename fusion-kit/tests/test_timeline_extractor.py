"""
tests/test_timeline_extractor.py
Unit tests for TimelineExtractor — covers the parts that don't require adsk.

The full TimelineExtractor module imports adsk.core / adsk.fusion at module
load time, so we cannot import it directly from outside Fusion 360. Instead,
we test the candidate-spec construction logic by replicating it here (same
strategy used by tests/test_param_loader.py for ParamLoader).

If the implementation in fusionkit/export/timeline_extractor.py drifts from
the duplicated logic below, this file will need to be updated in lockstep —
treat that as a feature: it forces the test author to think about whether
the change is intentional.

Usage: python -m unittest tests.test_timeline_extractor
       (or via discover: python -m unittest discover -s tests -v)
"""

import typing
import unittest


# ── Replicated logic under test ──────────────────────────────────────────
# Mirrors fusionkit.export.timeline_extractor.TimelineExtractor._build_candidate_spec
# and the unit-classification logic from _serialize_parameter.

LENGTH_UNITS: typing.Set[str] = {"cm", "mm", "m", "in", "ft"}


def build_candidate_spec(
    payload: typing.Dict[str, typing.Any],
) -> typing.Dict[str, typing.Any]:
    """Replica of TimelineExtractor._build_candidate_spec."""
    spec: typing.Dict[str, typing.Any] = {}
    for p in payload.get('user_parameters', []):
        name: str = p['name']
        if name.startswith('d') and name[1:].isdigit():
            continue
        spec[name] = p['value']
    return spec


def is_length_unit(unit: str) -> bool:
    """Replica of the length-unit classification used in _serialize_parameter."""
    return unit in LENGTH_UNITS


def operation_to_string_map() -> typing.Dict[str, str]:
    """
    Documents the expected mapping. The real implementation uses adsk.fusion.
    FeatureOperations enum values as keys; we use the names here since we
    can't import the enum without adsk.
    """
    return {
        'NewBodyFeatureOperation': 'NewBody',
        'JoinFeatureOperation': 'Join',
        'CutFeatureOperation': 'Cut',
        'IntersectFeatureOperation': 'Intersect',
        'NewComponentFeatureOperation': 'NewComponent',
    }


# ── Tests ────────────────────────────────────────────────────────────────


class TestBuildCandidateSpec(unittest.TestCase):
    """Test that the candidate spec correctly filters and flattens user parameters."""

    def test_empty_payload(self) -> None:
        """No user parameters → empty spec."""
        result: typing.Dict[str, typing.Any] = build_candidate_spec({})
        self.assertEqual(result, {})

    def test_empty_user_parameters_list(self) -> None:
        """Empty user_parameters list → empty spec."""
        result: typing.Dict[str, typing.Any] = build_candidate_spec({'user_parameters': []})
        self.assertEqual(result, {})

    def test_single_named_parameter(self) -> None:
        """One named user parameter is included."""
        payload: typing.Dict[str, typing.Any] = {
            'user_parameters': [
                {'name': 'slot_length', 'expression': '60 mm', 'value': 60.0,
                 'value_unit': 'mm', 'fusion_unit': 'cm', 'comment': ''},
            ]
        }
        result: typing.Dict[str, typing.Any] = build_candidate_spec(payload)
        self.assertEqual(result, {'slot_length': 60.0})

    def test_d_pattern_excluded(self) -> None:
        """Auto-generated d1, d2, d10 names are excluded even from user_parameters."""
        payload: typing.Dict[str, typing.Any] = {
            'user_parameters': [
                {'name': 'd1', 'value': 8.0},
                {'name': 'd2', 'value': 16.0},
                {'name': 'd10', 'value': 100.0},
                {'name': 'plate_width', 'value': 70.0},
            ]
        }
        result: typing.Dict[str, typing.Any] = build_candidate_spec(payload)
        self.assertEqual(result, {'plate_width': 70.0})

    def test_d_followed_by_letter_not_excluded(self) -> None:
        """A name like 'depth' or 'd_special' is NOT a d-pattern auto-name."""
        payload: typing.Dict[str, typing.Any] = {
            'user_parameters': [
                {'name': 'depth', 'value': 8.0},
                {'name': 'd_special', 'value': 16.0},
                {'name': 'damp', 'value': 5.0},
            ]
        }
        result: typing.Dict[str, typing.Any] = build_candidate_spec(payload)
        self.assertEqual(result, {'depth': 8.0, 'd_special': 16.0, 'damp': 5.0})

    def test_mixed_value_types(self) -> None:
        """Spec preserves whatever value type was in the parameter (float, int, etc.)."""
        payload: typing.Dict[str, typing.Any] = {
            'user_parameters': [
                {'name': 'length_mm', 'value': 60.5},
                {'name': 'count', 'value': 4},
                {'name': 'enabled', 'value': True},
            ]
        }
        result: typing.Dict[str, typing.Any] = build_candidate_spec(payload)
        self.assertEqual(result['length_mm'], 60.5)
        self.assertEqual(result['count'], 4)
        self.assertEqual(result['enabled'], True)

    def test_payload_with_other_keys_ignored(self) -> None:
        """Only user_parameters drives the candidate spec; auto_parameters etc. are ignored."""
        payload: typing.Dict[str, typing.Any] = {
            'user_parameters': [{'name': 'width', 'value': 70.0}],
            'auto_parameters': [{'name': 'd1', 'value': 99.0}],
            'timeline': [{'index': 0, 'type': 'Sketch'}],
            'bodies': [{'name': 'Body1'}],
        }
        result: typing.Dict[str, typing.Any] = build_candidate_spec(payload)
        self.assertEqual(result, {'width': 70.0})


class TestUnitClassification(unittest.TestCase):
    """Test the length-unit set used by _serialize_parameter."""

    def test_length_units_recognized(self) -> None:
        for unit in ('cm', 'mm', 'm', 'in', 'ft'):
            self.assertTrue(is_length_unit(unit), f"'{unit}' should be a length unit")

    def test_non_length_units(self) -> None:
        for unit in ('', 'rad', 'deg', 'kg', 'unknown'):
            self.assertFalse(is_length_unit(unit), f"'{unit}' should NOT be a length unit")


class TestOperationMapping(unittest.TestCase):
    """
    Document the expected operation-name mapping. The real implementation uses
    adsk.fusion.FeatureOperations enum values as keys; this test verifies the
    string values we expect on the output side.
    """

    def test_known_operations(self) -> None:
        mapping: typing.Dict[str, str] = operation_to_string_map()
        self.assertEqual(mapping['NewBodyFeatureOperation'], 'NewBody')
        self.assertEqual(mapping['JoinFeatureOperation'], 'Join')
        self.assertEqual(mapping['CutFeatureOperation'], 'Cut')
        self.assertEqual(mapping['IntersectFeatureOperation'], 'Intersect')
        self.assertEqual(mapping['NewComponentFeatureOperation'], 'NewComponent')


if __name__ == '__main__':
    unittest.main()
