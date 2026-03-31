"""
fusionkit.core.param_loader
Loads JSON configuration files, merges with defaults, and coerces parameter types.
"""

import json
import typing

from fusionkit.core.unit_converter import UnitConverter


class ParamLoader:
    """
    Reads JSON config files, merges with default values, and converts
    parameter types based on declared type categories.

    Type categories:
    - bool_params: converted to bool
    - int_params: converted to int
    - float_params: converted to float
    - length_params: converted to float with unit conversion (mm → cm)
    """

    def __init__(self, converter: UnitConverter) -> None:
        self.converter: UnitConverter = converter
        self.bool_params: typing.Set[str] = set()
        self.int_params: typing.Set[str] = set()
        self.float_params: typing.Set[str] = set()
        self.length_params: typing.Set[str] = set()

    def configure_types(self,
                        bool_params: typing.List[str] = None,
                        int_params: typing.List[str] = None,
                        float_params: typing.List[str] = None,
                        length_params: typing.List[str] = None) -> None:
        """Set which parameter names belong to which type category."""
        if bool_params:
            self.bool_params = set(bool_params)
        if int_params:
            self.int_params = set(int_params)
        if float_params:
            self.float_params = set(float_params)
        if length_params:
            self.length_params = set(length_params)

    def configure_types_from_dict(self, type_config: typing.Dict[str, typing.Any]) -> None:
        """Configure types from a defaults config dict."""
        self.configure_types(
            bool_params=type_config.get('boolParams', []),
            int_params=type_config.get('intParams', []),
            float_params=type_config.get('floatParams', []),
            length_params=type_config.get('coordinateParams', []),
        )

    def load(self, config_path: str,
             defaults: typing.Dict[str, typing.Any] = None) -> typing.Dict[str, typing.Any]:
        """
        Load a JSON config file, merge with defaults, and convert types.

        Args:
            config_path: Path to the JSON configuration file.
            defaults: Optional dict of default values. Config values override defaults.

        Returns:
            Dict with all values converted to appropriate types.
        """
        with open(config_path, 'r') as f:
            raw_params: typing.Dict[str, typing.Any] = json.load(f)

        # Start with defaults, override with config values
        merged: typing.Dict[str, typing.Any] = {}
        if defaults:
            merged.update(defaults)
        merged.update(raw_params)

        # Convert types
        converted: typing.Dict[str, typing.Any] = {}
        for key, value in merged.items():
            converted[key] = self._convert_value(key, value)

        return converted

    def load_raw(self, config_path: str) -> typing.Dict[str, typing.Any]:
        """Load a JSON config file without type conversion."""
        with open(config_path, 'r') as f:
            return json.load(f)

    def _convert_value(self, key: str, value: typing.Any) -> typing.Any:
        """Convert a single value based on its parameter category."""
        if key in self.bool_params:
            return self._to_bool(value)
        elif key in self.int_params:
            return int(value)
        elif key in self.float_params:
            return float(value)
        elif key in self.length_params:
            return self.converter.length(float(value))
        else:
            return value

    @staticmethod
    def _to_bool(value: typing.Any) -> bool:
        """Convert various representations to bool."""
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.lower() in ('yes', 'true', 't', '1')
        return bool(value)

    # Convenience accessors with explicit types

    def get_float(self, params: typing.Dict[str, typing.Any], key: str,
                  default: float = 0.0) -> float:
        """Get a float value from params dict."""
        value: typing.Any = params.get(key, default)
        return float(value) if value is not None else default

    def get_int(self, params: typing.Dict[str, typing.Any], key: str,
                default: int = 0) -> int:
        """Get an int value from params dict."""
        value: typing.Any = params.get(key, default)
        return int(value) if value is not None else default

    def get_bool(self, params: typing.Dict[str, typing.Any], key: str,
                 default: bool = False) -> bool:
        """Get a bool value from params dict."""
        value: typing.Any = params.get(key, default)
        return self._to_bool(value) if value is not None else default

    def get_length(self, params: typing.Dict[str, typing.Any], key: str,
                   default: float = 0.0) -> float:
        """Get a length value from params dict, converting units."""
        value: typing.Any = params.get(key, default)
        if value is not None:
            return self.converter.length(float(value))
        return default
