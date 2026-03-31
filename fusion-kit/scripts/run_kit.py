"""
scripts/run_kit.py
Fusion 360 entry-point script: builds all components in a kit from a JSON definition.

Usage:
    1. Set KIT_CONFIG_PATH below.
    2. Run from Fusion 360 Scripts & Add-Ins panel.
"""

import adsk.core
import adsk.fusion
import traceback
import typing
import os
import sys


# ─── Configuration ───────────────────────────────────────────────────────────
KIT_CONFIG_PATH: str = ''  # Set in run() based on OS user
EXPORT_STL: bool = True
EXPORT_DIR: str = ''


def run(context: typing.Any) -> None:
    ui: typing.Optional[adsk.core.UserInterface] = None
    try:
        app: adsk.core.Application = adsk.core.Application.get()
        ui = app.userInterface

        home_dir: str = os.path.expanduser('~')
        fusionkit_root: str = os.path.join(home_dir, 'Documents', 'dev', 'fusionkit')
        if fusionkit_root not in sys.path:
            sys.path.insert(0, fusionkit_root)

        kit_config: str = KIT_CONFIG_PATH or os.path.join(
            fusionkit_root, 'configs', 'kits', 'camera_pvc_mount.json'
        )
        export_dir: str = EXPORT_DIR or os.path.join(home_dir, 'Downloads')
        log_dir: str = os.path.join(fusionkit_root, 'logs')
        os.makedirs(log_dir, exist_ok=True)

        from fusionkit.core.app_context import AppContext
        from fusionkit.core.logger import FusionLogger
        from fusionkit.assembly.kit_builder import KitBuilder

        ctx: AppContext = AppContext()
        ctx.clear_all()
        logger: FusionLogger = FusionLogger(ctx.ui, log_dir=log_dir)

        logger.info(f"Building kit from {kit_config}")
        builder: KitBuilder = KitBuilder(ctx, kit_config, logger=logger)
        components: typing.Dict = builder.build_all_components()
        logger.info(f"Built {len(components)} components")

        if EXPORT_STL:
            exported: typing.List[str] = builder.export_all(export_dir)
            logger.info(f"Exported {len(exported)} STL files")

        # Generate BOM
        bom: typing.List[typing.Dict[str, typing.Any]] = builder.generate_bom()
        bom_summary: str = '\n'.join(
            f"  {item['component_id']}: {item['body_name']}" for item in bom
        )

        ui.messageBox(
            f"Kit build complete!\n"
            f"Components: {len(components)}\n"
            f"BOM items:\n{bom_summary}"
        )

    except Exception as e:
        if ui:
            ui.messageBox(f'Failed:\n{traceback.format_exc()}')
