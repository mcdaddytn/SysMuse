"""
fusionkit.geometry.shape_transforms
Geometric transformation utilities: point rotation, radial patterns,
midpoint calculation, and line trimming.
"""

import adsk.core
import adsk.fusion
import math
import typing


def rotate_point(
    center: adsk.core.Point3D,
    point: adsk.core.Point3D,
    angle_degrees: float,
) -> adsk.core.Point3D:
    """
    Rotate a point around a center by the given angle.

    Args:
        center: Center of rotation.
        point: Point to rotate.
        angle_degrees: Rotation angle in degrees (counterclockwise positive).

    Returns:
        New rotated Point3D.
    """
    angle_rad: float = math.radians(angle_degrees)
    cos_a: float = math.cos(angle_rad)
    sin_a: float = math.sin(angle_rad)
    tx: float = point.x - center.x
    ty: float = point.y - center.y
    rx: float = tx * cos_a - ty * sin_a
    ry: float = tx * sin_a + ty * cos_a
    return adsk.core.Point3D.create(center.x + rx, center.y + ry, point.z)


def midpoint(
    p1: adsk.core.Point3D,
    p2: adsk.core.Point3D,
) -> adsk.core.Point3D:
    """Calculate the midpoint between two points."""
    return adsk.core.Point3D.create(
        (p1.x + p2.x) / 2.0,
        (p1.y + p2.y) / 2.0,
        (p1.z + p2.z) / 2.0,
    )


def line_midpoint(line: adsk.fusion.SketchLine) -> adsk.core.Point3D:
    """Calculate the midpoint of a sketch line."""
    sp: adsk.core.Point3D = line.startSketchPoint.geometry
    ep: adsk.core.Point3D = line.endSketchPoint.geometry
    return midpoint(sp, ep)


def distance_from_origin(point: adsk.core.Point3D) -> float:
    """Calculate the distance from a point to the world origin."""
    return math.sqrt(point.x ** 2 + point.y ** 2 + point.z ** 2)


def distance_between(p1: adsk.core.Point3D, p2: adsk.core.Point3D) -> float:
    """Calculate the distance between two points."""
    return math.sqrt(
        (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2 + (p1.z - p2.z) ** 2
    )


def radial_positions(
    center: adsk.core.Point3D,
    radius: float,
    count: int,
    start_angle_degrees: float = 0.0,
) -> typing.List[adsk.core.Point3D]:
    """
    Generate evenly-spaced points around a circle.

    Args:
        center: Center of the circle.
        radius: Radius of the circle.
        count: Number of points.
        start_angle_degrees: Starting angle.

    Returns:
        List of Point3D positions.
    """
    angle_step: float = 360.0 / count
    points: typing.List[adsk.core.Point3D] = []
    for i in range(count):
        angle_rad: float = math.radians(start_angle_degrees + i * angle_step)
        px: float = center.x + radius * math.cos(angle_rad)
        py: float = center.y + radius * math.sin(angle_rad)
        points.append(adsk.core.Point3D.create(px, py, center.z))
    return points


def rectangular_pattern(
    center: adsk.core.Point3D,
    x_offset: float,
    y_offset: float,
) -> typing.List[adsk.core.Point3D]:
    """
    Generate a 4-point rectangular bolt pattern centered on a point.

    Args:
        center: Center of the pattern.
        x_offset: Half-distance in X from center to holes.
        y_offset: Half-distance in Y from center to holes.

    Returns:
        List of 4 Point3D positions.
    """
    return [
        adsk.core.Point3D.create(center.x + x_offset, center.y + y_offset, center.z),
        adsk.core.Point3D.create(center.x + x_offset, center.y - y_offset, center.z),
        adsk.core.Point3D.create(center.x - x_offset, center.y + y_offset, center.z),
        adsk.core.Point3D.create(center.x - x_offset, center.y - y_offset, center.z),
    ]


def point_to_str(point: adsk.core.Point3D) -> str:
    """Format a Point3D as a human-readable string."""
    return f"({point.x:.4f}, {point.y:.4f}, {point.z:.4f})"


def get_face_by_direction(
    body: adsk.fusion.BRepBody,
    direction: str,
) -> adsk.fusion.BRepFace:
    """
    Find a body face by its directional position.

    Args:
        body: The body to search.
        direction: One of 'top', 'bottom', 'left', 'right', 'front', 'back'.

    Returns:
        The face at the specified extremity.
    """
    faces: adsk.fusion.BRepFaces = body.faces
    direction_map: typing.Dict[str, typing.Any] = {
        'top':    lambda f: f.centroid.z,
        'bottom': lambda f: -f.centroid.z,
        'right':  lambda f: f.centroid.x,
        'left':   lambda f: -f.centroid.x,
        'back':   lambda f: f.centroid.y,
        'front':  lambda f: -f.centroid.y,
    }
    if direction not in direction_map:
        raise ValueError(f"Unknown direction '{direction}'. Use: {list(direction_map.keys())}")

    key_fn: typing.Any = direction_map[direction]
    return max(faces, key=key_fn)
