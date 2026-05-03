"""
scripts/extract_timeline.py
Fusion 360 entry-point script: dumps the active design's timeline,
user parameters, sketches, and bodies to JSON via TimelineExtractor.

Output goes to ~/Documents/dev/fusionkit/extractions/<design_name>_<timestamp>.json.

Usage:
    1. Copy the fusionkit/ package to ~/Documents/dev/fusionkit/ (same path
       convention as scripts/run_component.py).
    2. Copy this script to %AppData%\\Autodesk\\Autodesk Fusion 360\\API\\Scripts\\
       extract_timeline\\extract_timeline.py (Fusion expects script in a folder
       of the same name).
    3. In Fusion 360: Tools → Add-Ins → Scripts → select extract_timeline → Run.
    4. The active design is dumped to the path above. A message box reports
       the counts and output path.

Use this as the back half of the iterative forward/reverse engineering loop:
build a component via run_component.py, ask the Fusion 360 Connector to add
one feature with named user parameters, then run this script and diff the
result against a baseline extraction in Claude Code.
"""

import adsk.core
import adsk.fusion
import json
import os
import sys
import traceback
import typing
from datetime import datetime


def run(context: typing.Any) -> None:
    ui: typing.Optional[adsk.core.UserInterface] = None
    try:
        app: adsk.core.Application = adsk.core.Application.get()
        ui = app.userInterface

        # Ensure fusionkit is importable (same path convention as run_component.py)
        home_dir: str = os.path.expanduser('~')
        fusionkit_root: str = os.path.join(home_dir, 'Documents', 'dev', 'fusionkit')
        if fusionkit_root not in sys.path:
            sys.path.insert(0, fusionkit_root)

        from fusionkit.core.app_context import AppContext
        from fusionkit.export.timeline_extractor import TimelineExtractor

        ctx: AppContext = AppContext()
        if ctx.design is None:
            ui.messageBox('No active Fusion design.')
            return

        # Resolve output path
        out_dir: str = os.path.join(home_dir, 'Documents', 'dev', 'fusionkit', 'extractions')
        os.makedirs(out_dir, exist_ok=True)

        design_name: str = (
            ctx.design.parentDocument.name if ctx.design.parentDocument else 'untitled'
        )
        safe_name: str = ''.join(
            c if c.isalnum() or c in '-_' else '_' for c in design_name
        )
        timestamp: str = datetime.now().strftime('%Y%m%d_%H%M%S')
        out_path: str = os.path.join(out_dir, f'{safe_name}_{timestamp}.json')

        # Extract and write
        extractor: TimelineExtractor = TimelineExtractor(ctx)
        payload: typing.Dict[str, typing.Any] = extractor.extract()
        with open(out_path, 'w') as f:
            json.dump(payload, f, indent=2, default=str)

        ui.messageBox(
            'Timeline extraction complete.\n\n'
            f'Wrote {len(payload["user_parameters"])} user parameters, '
            f'{len(payload["timeline"])} timeline entries, '
            f'{len(payload["sketches"])} sketches, '
            f'{len(payload["bodies"])} bodies, '
            f'{len(payload["fusionkit_candidate_spec"])} candidate spec entries.\n\n'
            f'Output:\n{out_path}'
        )

    except Exception:
        if ui:
            ui.messageBox(f'extract_timeline failed:\n{traceback.format_exc()}')
