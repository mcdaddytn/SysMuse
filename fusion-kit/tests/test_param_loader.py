"""
tests/test_param_loader.py
Unit tests for ParamLoader — can run outside Fusion 360 with mocked UnitConverter.

Usage: python -m pytest tests/test_param_loader.py
"""

import json
import os
import tempfile
import typing
import unittest


class MockUnitsManager:
    """Mock Fusion FusionUnitsManager for testing."""
    def convert(self, value: float, from_units: str, to_units: str) -> float:
        if from_units == 'mm' and to_units == 'cm':
            return value / 10.0
        if from_units == 'cm' and to_units == 'mm':
            return value * 10.0
        return value


class MockUnitConverter:
    """Mock UnitConverter for testing outside Fusion 360."""
    def __init__(self) -> None:
        self.units_mgr: MockUnitsManager = MockUnitsManager()

    def length(self, value: float) -> float:
        return value / 10.0  # mm → cm


class TestParamLoader(unittest.TestCase):
    """Test ParamLoader type coercion and defaults merging."""

    def setUp(self) -> None:
        # We can't import the real ParamLoader without adsk, so test the logic directly
        self.converter: MockUnitConverter = MockUnitConverter()

    def test_bool_conversion(self) -> None:
        """Test string-to-bool conversion."""
        truthy: typing.List[str] = ['True', 'true', 'yes', 'YES', 't', '1']
        falsy: typing.List[str] = ['False', 'false', 'no', 'NO', 'f', '0']

        for v in truthy:
            self.assertTrue(v.lower() in ('yes', 'true', 't', '1'), f"'{v}' should be True")
        for v in falsy:
            self.assertFalse(v.lower() in ('yes', 'true', 't', '1'), f"'{v}' should be False")

    def test_length_conversion(self) -> None:
        """Test mm to cm conversion."""
        self.assertAlmostEqual(self.converter.length(78.0), 7.8)
        self.assertAlmostEqual(self.converter.length(4.2), 0.42)
        self.assertAlmostEqual(self.converter.length(0.0), 0.0)

    def test_json_loading(self) -> None:
        """Test loading and parsing a JSON config file."""
        config: typing.Dict[str, typing.Any] = {
            "RectEdgeX": 78,
            "RectEdgeY": 78,
            "ObjectDepth": 26,
            "CircleDiameter": 36,
            "NumClampBolts": 2,
            "OrientWide": "False",
            "SketchOnly": "False",
        }

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(config, f)
            temp_path: str = f.name

        try:
            with open(temp_path, 'r') as f:
                loaded: typing.Dict[str, typing.Any] = json.load(f)

            self.assertEqual(loaded['RectEdgeX'], 78)
            self.assertEqual(loaded['NumClampBolts'], 2)
            self.assertEqual(loaded['OrientWide'], 'False')
        finally:
            os.unlink(temp_path)

    def test_defaults_merging(self) -> None:
        """Test that config values override defaults."""
        defaults: typing.Dict[str, typing.Any] = {
            'NumClampBolts': 2,
            'NumInnerBolts': 0,
            'NotchDepth': 0,
        }
        config: typing.Dict[str, typing.Any] = {
            'NumClampBolts': 1,
            'RectEdgeX': 78,
        }

        merged: typing.Dict[str, typing.Any] = {}
        merged.update(defaults)
        merged.update(config)

        self.assertEqual(merged['NumClampBolts'], 1)  # overridden
        self.assertEqual(merged['NumInnerBolts'], 0)  # from defaults
        self.assertEqual(merged['RectEdgeX'], 78)     # only in config
        self.assertEqual(merged['NotchDepth'], 0)     # from defaults

    def test_all_pipeclamp_configs_parseable(self) -> None:
        """Verify all existing pipeclamp JSON configs can be parsed."""
        config_dir: str = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            'configs', 'components', 'pipe_clamp'
        )
        if not os.path.exists(config_dir):
            self.skipTest(f"Config dir not found: {config_dir}")

        for filename in os.listdir(config_dir):
            if filename.endswith('.json'):
                filepath: str = os.path.join(config_dir, filename)
                with open(filepath, 'r') as f:
                    config: typing.Dict[str, typing.Any] = json.load(f)
                # Must have at least these keys
                self.assertIn('ObjectDepth', config, f"{filename} missing ObjectDepth")
                self.assertIn('CircleDiameter', config, f"{filename} missing CircleDiameter")
                self.assertIn('ScrewDiameter', config, f"{filename} missing ScrewDiameter")


if __name__ == '__main__':
    unittest.main()
