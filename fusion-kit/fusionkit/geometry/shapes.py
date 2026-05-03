"""
fusionkit.geometry.shapes
2D sketch primitives: circles, rectangles, filleted rectangles, and pipe-clamp cross sections.
Each shape is a dataclass with a draw() method that writes geometry to a Fusion 360 sketch.
"""

import adsk.core
import adsk.fusion
import dataclasses
import math
import typing


@dataclasses.dataclass
class CircleShape:
    """A circle defined by center point and radius."""
    center: adsk.core.Point3D
    radius: float  # in API units (cm)

    def draw(self, sketch: adsk.fusion.Sketch) -> adsk.fusion.SketchCircle:
        """Draw the circle on the given sketch."""
        circles: adsk.fusion.SketchCircles = sketch.sketchCurves.sketchCircles
        circle: adsk.fusion.SketchCircle = circles.addByCenterRadius(self.center, self.radius)
        return circle


@dataclasses.dataclass
class RectangleShape:
    """A rectangle defined by two corner points, with optional corner fillets."""
    point_one: adsk.core.Point3D
    point_two: adsk.core.Point3D
    fillet_radius: float = 0.0  # in API units (cm)

    def draw(self, sketch: adsk.fusion.Sketch) -> adsk.fusion.SketchLineList:
        """Draw the rectangle on the given sketch. Returns the four lines."""
        lines: adsk.fusion.SketchLines = sketch.sketchCurves.sketchLines
        rect: adsk.fusion.SketchLineList = lines.addTwoPointRectangle(self.point_one, self.point_two)

        if self.fillet_radius > 0.0:
            arcs: adsk.fusion.SketchArcs = sketch.sketchCurves.sketchArcs
            for i in range(4):
                line1: adsk.fusion.SketchLine = rect[i]
                line2: adsk.fusion.SketchLine = rect[(i + 1) % 4]
                arcs.addFillet(
                    line1, line1.endSketchPoint.geometry,
                    line2, line2.startSketchPoint.geometry,
                    self.fillet_radius
                )

        return rect


@dataclasses.dataclass
class RotatedRectangle:
    """A rectangle that can be rotated around its center by an angle."""
    center: adsk.core.Point3D
    width: float   # in API units (cm)
    length: float  # in API units (cm)
    angle: float   # in degrees

    def draw(self, sketch: adsk.fusion.Sketch) -> typing.List[adsk.fusion.SketchLine]:
        """Draw a rotated rectangle. Returns list of 4 lines."""
        lines: adsk.fusion.SketchLines = sketch.sketchCurves.sketchLines
        cx: float = self.center.x
        cy: float = self.center.y
        hw: float = self.width / 2.0
        hl: float = self.length / 2.0

        # Calculate corners before rotation
        corners_raw: typing.List[typing.Tuple[float, float]] = [
            (cx - hw, cy + hl),  # top-left
            (cx + hw, cy + hl),  # top-right
            (cx + hw, cy - hl),  # bottom-right
            (cx - hw, cy - hl),  # bottom-left
        ]

        # Rotate each corner around center
        angle_rad: float = math.radians(self.angle)
        cos_a: float = math.cos(angle_rad)
        sin_a: float = math.sin(angle_rad)

        corners: typing.List[adsk.core.Point3D] = []
        for (px, py) in corners_raw:
            tx: float = px - cx
            ty: float = py - cy
            rx: float = tx * cos_a - ty * sin_a
            ry: float = tx * sin_a + ty * cos_a
            corners.append(adsk.core.Point3D.create(cx + rx, cy + ry, 0))

        # Draw four lines
        result: typing.List[adsk.fusion.SketchLine] = []
        for i in range(4):
            p1: adsk.core.Point3D = corners[i]
            p2: adsk.core.Point3D = corners[(i + 1) % 4]
            line: adsk.fusion.SketchLine = lines.addByTwoPoints(p1, p2)
            result.append(line)

        return result


@dataclasses.dataclass
class RectWithCircleCutout:
    """
    Simple pipe-clamp cross section: a rectangle with a circular hole.
    Used when CircleExt == 0 (circle fits inside rectangle).
    """
    rect_edge_x: float      # rectangle width in API units
    rect_edge_y: float      # rectangle height in API units
    circle_diameter: float   # pipe diameter in API units

    def draw(self, sketch: adsk.fusion.Sketch) -> None:
        """Draw the rectangle and circle on the sketch."""
        half_x: float = self.rect_edge_x / 2.0
        half_y: float = self.rect_edge_y / 2.0
        center: adsk.core.Point3D = adsk.core.Point3D.create(0, 0, 0)

        # Outer rectangle
        p0: adsk.core.Point3D = adsk.core.Point3D.create(-half_x, -half_y, 0)
        p1: adsk.core.Point3D = adsk.core.Point3D.create(half_x, half_y, 0)
        lines: adsk.fusion.SketchLines = sketch.sketchCurves.sketchLines
        lines.addTwoPointRectangle(p0, p1)

        # Inner circle
        circles: adsk.fusion.SketchCircles = sketch.sketchCurves.sketchCircles
        circles.addByCenterRadius(center, self.circle_diameter / 2.0)


@dataclasses.dataclass
class FilletedRectWithCircleCutout:
    """
    Pipe-clamp cross section with filleted inner rectangle:
    outer rectangle minus inner filleted-rectangle cutout.
    Used when CircleExt > 0 (the cutout extends beyond the circle into a stadium shape).

    The inner shape is a rectangle with corners filleted at radius = CircleDiameter/2,
    creating a stadium (oblong) shape that accommodates the pipe plus extension.
    """
    rect_edge_x: float      # outer rectangle width
    rect_edge_y: float       # outer rectangle height
    circle_diameter: float   # pipe diameter (also the fillet radius × 2)
    circle_ext: float        # extension beyond circle diameter
    orient_wide: bool        # True: extension along X; False: extension along Y

    def draw(self, sketch: adsk.fusion.Sketch) -> None:
        """Draw the outer rectangle and inner filleted rectangle on the sketch."""
        half_x: float = self.rect_edge_x / 2.0
        half_y: float = self.rect_edge_y / 2.0
        half_cd: float = self.circle_diameter / 2.0
        half_ext: float = self.circle_ext / 2.0

        lines: adsk.fusion.SketchLines = sketch.sketchCurves.sketchLines

        # Outer rectangle
        outer_p0: adsk.core.Point3D = adsk.core.Point3D.create(-half_x, -half_y, 0)
        outer_p1: adsk.core.Point3D = adsk.core.Point3D.create(half_x, half_y, 0)
        lines.addTwoPointRectangle(outer_p0, outer_p1)

        # Inner filleted rectangle
        if self.orient_wide:
            inner_p0: adsk.core.Point3D = adsk.core.Point3D.create(
                -half_cd - half_ext, -half_cd, 0)
            inner_p1: adsk.core.Point3D = adsk.core.Point3D.create(
                half_cd + half_ext, half_cd, 0)
        else:
            inner_p0 = adsk.core.Point3D.create(
                -half_cd, -half_cd - half_ext, 0)
            inner_p1 = adsk.core.Point3D.create(
                half_cd, half_cd + half_ext, 0)

        inner_rect: adsk.fusion.SketchLineList = lines.addTwoPointRectangle(inner_p0, inner_p1)

        # Fillet each corner of the inner rectangle
        fillet_radius: float = self.circle_diameter / 2.0
        arcs: adsk.fusion.SketchArcs = sketch.sketchCurves.sketchArcs

        line1: adsk.fusion.SketchLine = inner_rect[0]
        line2: adsk.fusion.SketchLine = inner_rect[1]
        line3: adsk.fusion.SketchLine = inner_rect[2]
        line4: adsk.fusion.SketchLine = inner_rect[3]

        arcs.addFillet(line1, line1.endSketchPoint.geometry,
                       line2, line2.startSketchPoint.geometry, fillet_radius)
        arcs.addFillet(line2, line2.endSketchPoint.geometry,
                       line3, line3.startSketchPoint.geometry, fillet_radius)
        arcs.addFillet(line3, line3.endSketchPoint.geometry,
                       line4, line4.startSketchPoint.geometry, fillet_radius)
        arcs.addFillet(line4, line4.endSketchPoint.geometry,
                       line1, line1.startSketchPoint.geometry, fillet_radius)


@dataclasses.dataclass
class HexagonShape:
    """A regular hexagon for nut wells."""
    center: adsk.core.Point3D
    across_flats: float  # "nut width" = distance across flats

    def draw(self, sketch: adsk.fusion.Sketch) -> adsk.fusion.SketchLineList:
        """Draw a hexagon on the sketch using addEdgePolygon."""
        hex_radius: float = self.across_flats / 2.0
        hex_angle: float = 360.0 / 6.0

        # Calculate vertex points
        points: typing.List[adsk.core.Point3D] = []
        for i in range(6):
            angle_rad: float = math.radians(i * hex_angle)
            px: float = self.center.x + hex_radius * math.cos(angle_rad)
            py: float = self.center.y + hex_radius * math.sin(angle_rad)
            point: adsk.core.Point3D = adsk.core.Point3D.create(px, py, self.center.z)
            points.append(point)

        hex_lines: adsk.fusion.SketchLineList = sketch.sketchCurves.sketchLines.addEdgePolygon(
            points[0], points[1], True, 6
        )
        return hex_lines


@dataclasses.dataclass
class SlotShape:
    """
    A rounded-end slot: rectangle with two semicircular ends.

    Centered on `center` by default. The long axis is X (overall end-to-end
    `length`); the short axis is Y (overall `width`, equal to the diameter
    of the end semicircles). Optional rotation in the sketch plane via
    `long_axis_angle_rad`.

    Used for travel slots in adjustable mounts (e.g., the slider rail's
    carriage travel slot).
    """
    center: adsk.core.Point3D
    length: float                     # total end-to-end length (API units = cm)
    width: float                      # cross-axis width = end semicircle diameter
    long_axis_angle_rad: float = 0.0  # rotation around `center` in the sketch plane

    def draw(self, sketch: adsk.fusion.Sketch) -> typing.List[typing.Any]:
        """
        Draw the slot. Returns [line_top, line_bottom, arc_right, arc_left].

        Geometry: two parallel lines of length (length - width) connected by
        two semicircular arcs of radius (width / 2).

        Raises ValueError if length <= width (would produce a degenerate slot).
        """
        if self.length <= self.width:
            raise ValueError(
                f"SlotShape: length ({self.length}) must be > width ({self.width}); "
                f"a slot must be longer than its end diameter"
            )

        radius: float = self.width / 2.0
        half_straight: float = (self.length - self.width) / 2.0

        cos_a: float = math.cos(self.long_axis_angle_rad)
        sin_a: float = math.sin(self.long_axis_angle_rad)

        def transform(local_x: float, local_y: float) -> adsk.core.Point3D:
            rx: float = local_x * cos_a - local_y * sin_a
            ry: float = local_x * sin_a + local_y * cos_a
            return adsk.core.Point3D.create(
                self.center.x + rx, self.center.y + ry, self.center.z
            )

        # Endpoint coordinates (centered on origin, then rotated and translated)
        right_top: adsk.core.Point3D = transform(half_straight, radius)
        right_bottom: adsk.core.Point3D = transform(half_straight, -radius)
        left_top: adsk.core.Point3D = transform(-half_straight, radius)
        left_bottom: adsk.core.Point3D = transform(-half_straight, -radius)

        # Arc midpoints (the rightmost and leftmost extreme points)
        right_arc_mid: adsk.core.Point3D = transform(half_straight + radius, 0.0)
        left_arc_mid: adsk.core.Point3D = transform(-half_straight - radius, 0.0)

        lines: adsk.fusion.SketchLines = sketch.sketchCurves.sketchLines
        arcs: adsk.fusion.SketchArcs = sketch.sketchCurves.sketchArcs

        # Top line connects left-top to right-top
        line_top: adsk.fusion.SketchLine = lines.addByTwoPoints(left_top, right_top)
        # Bottom line connects right-bottom to left-bottom
        line_bottom: adsk.fusion.SketchLine = lines.addByTwoPoints(right_bottom, left_bottom)

        # Right arc: right_top → right_arc_mid → right_bottom
        arc_right: adsk.fusion.SketchArc = arcs.addByThreePoints(
            right_top, right_arc_mid, right_bottom
        )
        # Left arc: left_bottom → left_arc_mid → left_top
        arc_left: adsk.fusion.SketchArc = arcs.addByThreePoints(
            left_bottom, left_arc_mid, left_top
        )

        return [line_top, line_bottom, arc_right, arc_left]

    def bounding_box_dimensions(self) -> typing.Tuple[float, float]:
        """
        Return (bbox_width, bbox_height) — the axis-aligned bounding box of the
        slot, accounting for rotation. Useful for ProfileSelector.by_bounding_box
        when picking the slot's profile to extrude-cut.

        For axis-aligned slots (long_axis_angle_rad == 0), returns (length, width).
        For arbitrary rotation, returns the rotated bounding box.
        """
        cos_a: float = abs(math.cos(self.long_axis_angle_rad))
        sin_a: float = abs(math.sin(self.long_axis_angle_rad))
        bbox_w: float = self.length * cos_a + self.width * sin_a
        bbox_h: float = self.length * sin_a + self.width * cos_a
        return (bbox_w, bbox_h)
