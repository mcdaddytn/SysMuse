"""
fusionkit.catalog.pipe_dimensions
Standard pipe outer diameter tables for common PVC and metal pipes.
All dimensions in millimeters.
"""

import typing


# PVC Schedule 40 pipe dimensions (most common for furniture-grade PVC)
# Nominal size → (outer diameter mm, inner diameter mm, wall thickness mm)
PVC_SCHEDULE_40: typing.Dict[str, typing.Tuple[float, float, float]] = {
    '1/2"':   (21.34, 15.80, 2.77),
    '3/4"':   (26.67, 20.93, 2.87),
    '1"':     (33.40, 26.64, 3.38),
    '1-1/4"': (42.16, 35.04, 3.56),
    '1-1/2"': (48.26, 40.90, 3.68),
    '2"':     (60.33, 52.50, 3.91),
    '2-1/2"': (73.03, 62.71, 5.16),
    '3"':     (88.90, 77.93, 5.49),
    '4"':     (114.30, 102.26, 6.02),
}

# Formufit furniture-grade PVC (same OD as schedule 40, but different aesthetics)
FORMUFIT_PVC: typing.Dict[str, float] = {
    '1/2"':   21.34,
    '3/4"':   26.67,
    '1"':     33.40,
    '1-1/4"': 42.16,
    '1-1/2"': 48.26,
    '2"':     60.33,
}

# Common bicycle frame tube diameters (approximate, varies by manufacturer)
BICYCLE_TUBES: typing.Dict[str, typing.Tuple[float, float]] = {
    'seat_tube_standard': (28.6, 31.8),     # (min, max) mm OD
    'seat_tube_oversize': (30.9, 34.9),
    'down_tube':          (28.6, 44.5),
    'top_tube':           (25.4, 31.8),
    'head_tube':          (30.0, 44.0),
    'seat_post':          (27.2, 31.6),
    'handlebar_clamp':    (25.4, 31.8),
}

# Standard iron/steel pipe for gates, railings, etc.
IRON_RECTANGULAR: typing.Dict[str, typing.Tuple[float, float, float]] = {
    '1x1"':     (25.4, 25.4, 1.65),  # (width, height, wall) mm
    '1x2"':     (25.4, 50.8, 1.65),
    '1.5x1.5"': (38.1, 38.1, 1.65),
    '2x2"':     (50.8, 50.8, 2.11),
}


def get_pvc_od(nominal_size: str) -> float:
    """
    Get the outer diameter of a PVC pipe by nominal size.

    Args:
        nominal_size: e.g., '1-1/4"'

    Returns:
        Outer diameter in mm.
    """
    if nominal_size in PVC_SCHEDULE_40:
        return PVC_SCHEDULE_40[nominal_size][0]
    raise KeyError(f"Unknown PVC size '{nominal_size}'. Available: {list(PVC_SCHEDULE_40.keys())}")


def suggest_clamp_diameter(pipe_od_mm: float, gasket_thickness_mm: float = 1.0) -> float:
    """
    Suggest the CircleDiameter for a pipe clamp.

    Args:
        pipe_od_mm: Pipe outer diameter in mm.
        gasket_thickness_mm: Thickness of adhesive gasket (adds to each side).

    Returns:
        Suggested CircleDiameter in mm.
    """
    return pipe_od_mm + (gasket_thickness_mm * 2)
