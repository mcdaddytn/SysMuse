"""
fusionkit.assembly.kit_builder
Orchestrates building a complete kit from a JSON kit definition.
Phase 4 implementation — currently a stub with the planned interface.
"""

import adsk.core
import adsk.fusion
import json
import typing

from fusionkit.core.app_context import AppContext
from fusionkit.core.logger import FusionLogger
from fusionkit.components.component_base import ComponentBase
from fusionkit.components import get_component_class


class KitBuilder:
    """
    Reads a kit JSON definition, instantiates all components, builds them,
    and (in Phase 4) runs assembly steps to position and fasten them.
    """

    def __init__(self, ctx: AppContext, kit_config_path: str,
                 logger: typing.Optional[FusionLogger] = None) -> None:
        self.ctx: AppContext = ctx
        self.kit_config_path: str = kit_config_path
        self.logger: typing.Optional[FusionLogger] = logger
        self.kit_config: typing.Dict[str, typing.Any] = {}
        self.components: typing.Dict[str, ComponentBase] = {}
        self._load_config()

    def _load_config(self) -> None:
        """Load the kit configuration from JSON."""
        with open(self.kit_config_path, 'r') as f:
            self.kit_config = json.load(f)

    def build_all_components(self) -> typing.Dict[str, ComponentBase]:
        """
        Build all components defined in the kit.

        Returns:
            Dict mapping component IDs to built ComponentBase instances.
        """
        component_defs: typing.List[typing.Dict[str, typing.Any]] = self.kit_config.get('components', [])

        for comp_def in component_defs:
            comp_id: str = comp_def['id']
            comp_type: str = comp_def['type']
            config_path: str = comp_def['config']

            if self.logger:
                self.logger.info(f"Building component '{comp_id}' (type={comp_type})")

            try:
                comp_cls: typing.Type[ComponentBase] = get_component_class(comp_type)
                component: ComponentBase = comp_cls.from_json(
                    self.ctx, config_path, logger=self.logger
                )
                component.build()
                self.components[comp_id] = component
            except KeyError as e:
                if self.logger:
                    self.logger.warning(f"Skipping '{comp_id}': {str(e)}")
            except Exception as e:
                if self.logger:
                    self.logger.error(f"Failed to build '{comp_id}': {str(e)}")

        return self.components

    def run_assembly(self) -> None:
        """
        Execute assembly steps (positioning, mating, fastening).
        Phase 4 — not yet implemented.
        """
        # TODO: Phase 4 implementation
        assembly_steps: typing.List[typing.Dict[str, typing.Any]] = self.kit_config.get('assembly_steps', [])
        if self.logger:
            self.logger.info(f"Assembly steps defined: {len(assembly_steps)} (not yet implemented)")

    def export_all(self, output_dir: str) -> typing.List[str]:
        """
        Export all component bodies as STL files.

        Args:
            output_dir: Directory for output files.

        Returns:
            List of exported file paths.
        """
        all_paths: typing.List[str] = []
        for comp_id, component in self.components.items():
            paths: typing.List[str] = component.export_stl(output_dir, comp_id)
            all_paths.extend(paths)
        return all_paths

    def generate_bom(self) -> typing.List[typing.Dict[str, typing.Any]]:
        """
        Generate a bill of materials for the kit.

        Returns:
            List of BOM line items.
        """
        bom: typing.List[typing.Dict[str, typing.Any]] = []

        # 3D printed parts
        for comp_id, component in self.components.items():
            for idx, body in enumerate(component.bodies):
                bom.append({
                    'item_type': '3d_print',
                    'component_id': comp_id,
                    'body_name': body.name if body.isValid else f"{comp_id}_{idx}",
                    'quantity': 1,
                    'source': 'print',
                })

        # TODO: Add purchased parts (bolts, nuts) from assembly steps

        return bom
