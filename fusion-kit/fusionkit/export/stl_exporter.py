"""
fusionkit.export.stl_exporter
Export individual bodies as STL files using the show/hide technique.
"""

import adsk.core
import adsk.fusion
import typing

from fusionkit.core.app_context import AppContext


class STLExporter:
    """
    Exports Fusion 360 bodies as individual STL files.

    Uses the show/hide technique: to export a single body, hide all others,
    export the component, then restore visibility.
    """

    def __init__(self, ctx: AppContext,
                 mesh_quality: int = adsk.fusion.MeshRefinementSettings.MeshRefinementMedium) -> None:
        self.ctx: AppContext = ctx
        self.mesh_quality: int = mesh_quality

    def export_bodies(
        self,
        bodies: typing.List[adsk.fusion.BRepBody],
        output_dir: str,
        base_name: str,
    ) -> typing.List[str]:
        """
        Export each body as a separate STL file.

        Args:
            bodies: List of bodies to export.
            output_dir: Directory for output files.
            base_name: Base filename (index or suffix appended).

        Returns:
            List of exported file paths.
        """
        export_mgr: adsk.fusion.ExportManager = self.ctx.design.exportManager
        exported_paths: typing.List[str] = []

        # Save original visibility states
        all_bodies: typing.List[adsk.fusion.BRepBody] = list(self.ctx.root_comp.bRepBodies)
        original_visibility: typing.Dict[adsk.fusion.BRepBody, bool] = {}
        for body in all_bodies:
            original_visibility[body] = body.isLightBulbOn

        for idx, target_body in enumerate(bodies):
            # Hide all bodies except the target
            for body in all_bodies:
                body.isLightBulbOn = (body == target_body)

            # Generate filename
            suffix: str = f"_{idx}" if len(bodies) > 1 else ""
            file_path: str = f"{output_dir}/{base_name}{suffix}.stl"

            # Export
            stl_options: adsk.fusion.STLExportOptions = export_mgr.createSTLExportOptions(
                self.ctx.root_comp
            )
            stl_options.meshRefinement = self.mesh_quality
            stl_options.filename = file_path
            export_mgr.execute(stl_options)
            exported_paths.append(file_path)

        # Restore original visibility
        for body, was_visible in original_visibility.items():
            if body.isValid:
                body.isLightBulbOn = was_visible

        return exported_paths

    def export_single_body(
        self,
        body: adsk.fusion.BRepBody,
        file_path: str,
    ) -> str:
        """
        Export a single body to an STL file.

        Args:
            body: The body to export.
            file_path: Full output path including .stl extension.

        Returns:
            The file path.
        """
        return self.export_bodies([body], "", "")[0] if False else self._export_one(body, file_path)

    def _export_one(self, body: adsk.fusion.BRepBody, file_path: str) -> str:
        """Internal: export a single body with show/hide."""
        export_mgr: adsk.fusion.ExportManager = self.ctx.design.exportManager
        all_bodies: typing.List[adsk.fusion.BRepBody] = list(self.ctx.root_comp.bRepBodies)

        # Save and set visibility
        original_visibility: typing.Dict[adsk.fusion.BRepBody, bool] = {}
        for b in all_bodies:
            original_visibility[b] = b.isLightBulbOn
            b.isLightBulbOn = (b == body)

        stl_options: adsk.fusion.STLExportOptions = export_mgr.createSTLExportOptions(
            self.ctx.root_comp
        )
        stl_options.meshRefinement = self.mesh_quality
        stl_options.filename = file_path
        export_mgr.execute(stl_options)

        # Restore visibility
        for b, was_visible in original_visibility.items():
            if b.isValid:
                b.isLightBulbOn = was_visible

        return file_path
