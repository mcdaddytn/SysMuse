"""
fusionkit.components.component_base
Abstract base class for all parametric CAD components.
Every part type (PipeClamp, LunaWrench, etc.) inherits from this.
"""

import abc
import adsk.core
import adsk.fusion
import typing

from fusionkit.core.app_context import AppContext
from fusionkit.core.unit_converter import UnitConverter
from fusionkit.core.param_loader import ParamLoader
from fusionkit.core.logger import FusionLogger
from fusionkit.geometry.sketch_manager import SketchManager
from fusionkit.export.stl_exporter import STLExporter


class ComponentBase(abc.ABC):
    """
    Abstract base for all parametric components.

    Subclasses must implement:
        - build() -> List[BRepBody]: create the component geometry
        - _default_param_types() -> dict: declare parameter type categories

    Provides:
        - ctx: AppContext for Fusion 360 API access
        - params: typed parameter dict (loaded from JSON, units converted)
        - converter: UnitConverter for on-the-fly conversions
        - sketch_mgr: SketchManager for creating named sketches
        - logger: FusionLogger for debug output
    """

    def __init__(self, ctx: AppContext, params: typing.Dict[str, typing.Any],
                 logger: typing.Optional[FusionLogger] = None) -> None:
        self.ctx: AppContext = ctx
        self.params: typing.Dict[str, typing.Any] = params
        self.converter: UnitConverter = UnitConverter(ctx.units_mgr)
        self.sketch_mgr: SketchManager = SketchManager(ctx)
        self.logger: typing.Optional[FusionLogger] = logger
        self.bodies: typing.List[adsk.fusion.BRepBody] = []

    @abc.abstractmethod
    def build(self) -> typing.List[adsk.fusion.BRepBody]:
        """
        Build the component geometry in Fusion 360.

        Returns:
            List of created BRepBody objects.
        """
        ...

    def get_param(self, key: str, default: typing.Any = None) -> typing.Any:
        """Get a parameter value with optional default."""
        return self.params.get(key, default)

    def get_float(self, key: str, default: float = 0.0) -> float:
        """Get a float parameter."""
        value: typing.Any = self.params.get(key, default)
        return float(value) if value is not None else default

    def get_int(self, key: str, default: int = 0) -> int:
        """Get an int parameter."""
        value: typing.Any = self.params.get(key, default)
        return int(value) if value is not None else default

    def get_bool(self, key: str, default: bool = False) -> bool:
        """Get a bool parameter."""
        value: typing.Any = self.params.get(key, default)
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.lower() in ('yes', 'true', 't', '1')
        return bool(value) if value is not None else default

    def export_stl(self, output_dir: str, base_name: str) -> typing.List[str]:
        """
        Export each body created by this component as a separate STL file.

        Args:
            output_dir: Directory to write STL files.
            base_name: Base filename (body index appended).

        Returns:
            List of exported file paths.
        """
        exporter: STLExporter = STLExporter(self.ctx)
        return exporter.export_bodies(self.bodies, output_dir, base_name)

    def log(self, msg: str) -> None:
        """Log an info message if logger is available."""
        if self.logger:
            self.logger.info(f"[{self.__class__.__name__}] {msg}")

    def log_debug(self, msg: str) -> None:
        """Log a debug message if logger is available."""
        if self.logger:
            self.logger.debug(f"[{self.__class__.__name__}] {msg}")

    def log_error(self, msg: str) -> None:
        """Log an error message if logger is available."""
        if self.logger:
            self.logger.error(f"[{self.__class__.__name__}] {msg}")

    @classmethod
    def from_json(cls, ctx: AppContext, config_path: str,
                  defaults: typing.Dict[str, typing.Any] = None,
                  logger: typing.Optional[FusionLogger] = None) -> 'ComponentBase':
        """
        Factory method: load params from JSON and create a component instance.

        Args:
            ctx: Application context.
            config_path: Path to JSON config file.
            defaults: Optional default values.
            logger: Optional logger.

        Returns:
            A configured component instance (not yet built).
        """
        converter: UnitConverter = UnitConverter(ctx.units_mgr)
        loader: ParamLoader = ParamLoader(converter)

        # Configure parameter types from subclass declaration
        type_config: typing.Dict[str, typing.List[str]] = cls._default_param_types()
        loader.configure_types(
            bool_params=type_config.get('bool', []),
            int_params=type_config.get('int', []),
            float_params=type_config.get('float', []),
            length_params=type_config.get('length', []),
        )

        params: typing.Dict[str, typing.Any] = loader.load(config_path, defaults)
        return cls(ctx, params, logger)

    @classmethod
    def _default_param_types(cls) -> typing.Dict[str, typing.List[str]]:
        """
        Declare which parameter names are bool, int, float, or length (unit-converted).
        Subclasses should override this.

        Returns:
            Dict with keys 'bool', 'int', 'float', 'length' mapping to lists of param names.
        """
        return {
            'bool': [],
            'int': [],
            'float': [],
            'length': [],
        }
