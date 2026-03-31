"""
scripts/run_component.py
Fusion 360 entry-point script: builds a single component from a JSON config file.

Usage:
    1. Set COMPONENT_TYPE and CONFIG_PATH below (or modify to accept args).
    2. Run from Fusion 360 Scripts & Add-Ins panel.
"""

import adsk.core
import adsk.fusion
import traceback
import typing
import os

# ─── Configuration ───────────────────────────────────────────────────────────
# Edit these to point at your desired component and config file.

COMPONENT_TYPE: str = 'PipeClamp'
CONFIG_PATH: str = ''  # Set below in run() based on OS user

# Set to True to export STL files after building.
EXPORT_STL: bool = True
EXPORT_DIR: str = ''  # Defaults to ~/Downloads

# ─── Script Entry Point ─────────────────────────────────────────────────────

def run(context: typing.Any) -> None:
    ui: typing.Optional[adsk.core.UserInterface] = None
    try:
        app: adsk.core.Application = adsk.core.Application.get()
        ui = app.userInterface

        # Resolve paths
        username: str = os.getenv('USER', os.getenv('USERNAME', 'user'))
        home_dir: str = os.path.expanduser('~')
        config_dir: str = os.path.join(home_dir, 'Documents', 'dev', 'fusionkit', 'configs')
        export_dir: str = EXPORT_DIR or os.path.join(home_dir, 'Downloads')

        # ── Choose your component and config here ──
        component_type: str = COMPONENT_TYPE
        config_path: str = CONFIG_PATH or os.path.join(
            config_dir, 'components', 'pipe_clamp', 'pipeclamp12.json'
        )

        # Import fusionkit (ensure it's on sys.path)
        import sys
        fusionkit_root: str = os.path.join(home_dir, 'Documents', 'dev', 'fusionkit')
        if fusionkit_root not in sys.path:
            sys.path.insert(0, fusionkit_root)

        from fusionkit.core.app_context import AppContext
        from fusionkit.core.logger import FusionLogger
        from fusionkit.components import get_component_class
        from fusionkit.components.component_base import ComponentBase

        # Initialize context
        ctx: AppContext = AppContext()
        ctx.clear_all()

        # Initialize logger
        log_dir: str = os.path.join(home_dir, 'Documents', 'dev', 'fusionkit', 'logs')
        os.makedirs(log_dir, exist_ok=True)
        logger: FusionLogger = FusionLogger(ctx.ui, log_dir=log_dir)

        # Look up component class and build
        component_cls: typing.Type[ComponentBase] = get_component_class(component_type)
        component: ComponentBase = component_cls.from_json(ctx, config_path, logger=logger)

        logger.info(f"Building {component_type} from {config_path}")
        bodies: typing.List[adsk.fusion.BRepBody] = component.build()
        logger.info(f"Build complete: {len(bodies)} bodies created")

        # Export STL if requested
        if EXPORT_STL and len(bodies) > 0:
            config_name: str = os.path.splitext(os.path.basename(config_path))[0]
            exported: typing.List[str] = component.export_stl(export_dir, config_name)
            logger.info(f"Exported {len(exported)} STL files to {export_dir}")
            for path in exported:
                logger.info(f"  → {path}")

        ui.messageBox(f'Build complete: {len(bodies)} bodies.\n'
                       f'Component: {component_type}\n'
                       f'Config: {os.path.basename(config_path)}')

    except Exception as e:
        if ui:
            ui.messageBox(f'Failed:\n{traceback.format_exc()}')
