"""
fusionkit.export.timeline_extractor
Walks design.timeline and dumps user parameters, sketch dimensions,
and feature operations to JSON. Output is mm at the JSON layer, ready
to be hand-merged into a FusionKit component spec.

Peer to StateDumper — StateDumper captures sketch points and body
vertices (geometric snapshot for regression testing); TimelineExtractor
captures parametric intent (named user parameters, ordered feature
operations, sketch dimensions linked to their driving parameters).

Used as the back half of the iterative forward/reverse engineering loop:
    forward-engineer simple spec  →  Fusion Connector adds one feature
    →  TimelineExtractor          →  diff against baseline in Claude Code
    →  add handler to engine      →  regenerate, compare, commit

See docs/features/FEATURE_timeline_extractor.md for the full spec.
"""

import adsk.core
import adsk.fusion
import json
import socket
import typing
from datetime import datetime

from fusionkit.core.app_context import AppContext


EXTRACTOR_VERSION: str = "0.1.0"
CONFIG_UNITS: str = "mm"
FUSION_INTERNAL_UNITS: str = "cm"
LENGTH_UNITS: typing.Set[str] = {"cm", "mm", "m", "in", "ft"}


class TimelineExtractor:
    """
    Captures the active design's parametric structure: user parameters,
    auto parameters, ordered timeline of feature operations, sketches with
    their dimensions, and bodies with bounding boxes.

    Also produces a best-effort fusionkit_candidate_spec — a flat dict of
    user parameter names to mm values, ready to hand-merge into a FusionKit
    component spec. Auto-generated d1/d2/... parameters are excluded.

    Usage:
        extractor: TimelineExtractor = TimelineExtractor(ctx)
        extractor.dump('/path/to/output.json')

    Or, to get the dict without writing:
        payload: typing.Dict[str, typing.Any] = extractor.extract()
    """

    def __init__(self, ctx: AppContext) -> None:
        self.ctx: AppContext = ctx

    # ── Public API ───────────────────────────────────────────────────────

    def extract(self) -> typing.Dict[str, typing.Any]:
        """Return the full extraction dict. Does not write to disk."""
        design: adsk.fusion.Design = self.ctx.design
        design_name: str = design.parentDocument.name if design.parentDocument else 'untitled'
        payload: typing.Dict[str, typing.Any] = {
            'extractor_version': EXTRACTOR_VERSION,
            'extracted_at': datetime.now().isoformat(timespec='seconds'),
            'host': socket.gethostname(),
            'design_name': design_name,
            'units': CONFIG_UNITS,
            'user_parameters': self._extract_user_parameters(),
            'auto_parameters': self._extract_auto_parameters(),
            'timeline': self._extract_timeline(),
            'sketches': self._extract_sketches(),
            'bodies': self._extract_bodies(),
        }
        payload['fusionkit_candidate_spec'] = self._build_candidate_spec(payload)
        return payload

    def dump(self, output_path: str) -> None:
        """Extract and write to a JSON file. Mirrors StateDumper.dump()."""
        payload: typing.Dict[str, typing.Any] = self.extract()
        with open(output_path, 'w') as f:
            json.dump(payload, f, indent=2, default=self._json_default)

    def dump_to_string(self) -> str:
        """Extract and return as JSON string."""
        payload: typing.Dict[str, typing.Any] = self.extract()
        return json.dumps(payload, indent=2, default=self._json_default)

    # ── Unit handling ────────────────────────────────────────────────────

    def _to_mm(self, value_cm: float) -> float:
        """Convert from Fusion's internal cm to FusionKit's mm at the boundary."""
        converted: float = self.ctx.units_mgr.convert(
            float(value_cm), FUSION_INTERNAL_UNITS, CONFIG_UNITS
        )
        return converted

    @staticmethod
    def _json_default(o: typing.Any) -> typing.Any:
        """Fallback serializer for objects we don't explicitly handle."""
        return str(o)

    # ── Parameter extraction ─────────────────────────────────────────────

    def _serialize_parameter(self, p: adsk.fusion.Parameter) -> typing.Dict[str, typing.Any]:
        """Common serialization for both user and auto parameters."""
        unit: str = p.unit or ''
        is_length: bool = unit in LENGTH_UNITS
        value_out: float = self._to_mm(p.value) if is_length else float(p.value)
        return {
            'name': p.name,
            'expression': p.expression,
            'value': value_out,
            'value_unit': CONFIG_UNITS if is_length else unit,
            'fusion_unit': unit,
            'comment': p.comment or '',
        }

    def _extract_user_parameters(self) -> typing.List[typing.Dict[str, typing.Any]]:
        """Dump named user parameters — primary translation target for FusionKit specs."""
        out: typing.List[typing.Dict[str, typing.Any]] = []
        user_params: adsk.fusion.UserParameters = self.ctx.design.userParameters
        for i in range(user_params.count):
            p: adsk.fusion.UserParameter = user_params.item(i)
            out.append(self._serialize_parameter(p))
        return out

    def _extract_auto_parameters(self) -> typing.List[typing.Dict[str, typing.Any]]:
        """Dump auto-generated d1/d2/... parameters separately. Usually noise."""
        user_names: typing.Set[str] = {
            self.ctx.design.userParameters.item(i).name
            for i in range(self.ctx.design.userParameters.count)
        }
        out: typing.List[typing.Dict[str, typing.Any]] = []
        all_params: adsk.fusion.Parameters = self.ctx.design.allParameters
        for i in range(all_params.count):
            p: adsk.fusion.Parameter = all_params.item(i)
            if p.name in user_names:
                continue
            out.append(self._serialize_parameter(p))
        return out

    # ── Timeline extraction ──────────────────────────────────────────────

    def _extract_timeline(self) -> typing.List[typing.Dict[str, typing.Any]]:
        """Walk the timeline in order, dispatching on entity type."""
        out: typing.List[typing.Dict[str, typing.Any]] = []
        timeline: adsk.fusion.Timeline = self.ctx.design.timeline
        for i in range(timeline.count):
            tobj: adsk.fusion.TimelineObject = timeline.item(i)
            entry: typing.Dict[str, typing.Any] = self._extract_timeline_entry(tobj, i)
            out.append(entry)
        return out

    def _extract_timeline_entry(self, tobj: adsk.fusion.TimelineObject,
                                index: int) -> typing.Dict[str, typing.Any]:
        base: typing.Dict[str, typing.Any] = {
            'index': index,
            'name': tobj.name,
            'is_suppressed': tobj.isSuppressed,
            'is_rolled_back': tobj.isRolledBack,
            'type': 'Unknown',
        }
        try:
            entity: typing.Any = tobj.entity
        except Exception:
            base['type'] = 'EntityUnavailable'
            return base
        if entity is None:
            base['type'] = 'EntityNone'
            return base
        base['type'] = type(entity).__name__
        try:
            self._dispatch_entity(entity, base)
        except Exception as e:
            base['extract_error'] = repr(e)
        return base

    def _dispatch_entity(self, entity: typing.Any,
                         base: typing.Dict[str, typing.Any]) -> None:
        """Dispatch on entity type and merge per-feature fields into base."""
        if isinstance(entity, adsk.fusion.Sketch):
            base.update(self._extract_sketch_summary(entity))
        elif isinstance(entity, adsk.fusion.ExtrudeFeature):
            base.update(self._extract_extrude(entity))
        elif isinstance(entity, adsk.fusion.HoleFeature):
            base.update(self._extract_hole(entity))
        elif isinstance(entity, adsk.fusion.FilletFeature):
            base.update(self._extract_fillet(entity))
        elif isinstance(entity, adsk.fusion.ChamferFeature):
            base.update(self._extract_chamfer(entity))
        elif isinstance(entity, adsk.fusion.RevolveFeature):
            base.update(self._extract_revolve(entity))
        elif isinstance(entity, adsk.fusion.CombineFeature):
            base.update({
                'feature_kind': 'Combine',
                'operation': self._operation_to_string(entity.operation),
            })
        elif isinstance(entity, adsk.fusion.MoveFeature):
            base.update({'feature_kind': 'Move'})
        elif isinstance(entity, adsk.fusion.MirrorFeature):
            base.update({'feature_kind': 'Mirror'})
        elif isinstance(entity, adsk.fusion.RectangularPatternFeature):
            base.update({
                'feature_kind': 'RectangularPattern',
                'quantity_one': int(entity.quantityOne.value),
                'quantity_two': int(entity.quantityTwo.value),
            })
        elif isinstance(entity, adsk.fusion.CircularPatternFeature):
            base.update({
                'feature_kind': 'CircularPattern',
                'quantity': int(entity.quantity.value),
            })
        elif isinstance(entity, adsk.fusion.ConstructionPlane):
            base.update({'feature_kind': 'ConstructionPlane'})
        elif isinstance(entity, adsk.fusion.ConstructionAxis):
            base.update({'feature_kind': 'ConstructionAxis'})
        elif isinstance(entity, adsk.fusion.SplitBodyFeature):
            base.update({'feature_kind': 'SplitBody'})

    # ── Per-feature extractors ───────────────────────────────────────────

    def _extract_sketch_summary(self, sketch: adsk.fusion.Sketch) -> typing.Dict[str, typing.Any]:
        return {
            'feature_kind': 'Sketch',
            'sketch_name': sketch.name,
            'profile_count': sketch.profiles.count,
            'is_visible': sketch.isVisible,
        }

    @staticmethod
    def _operation_to_string(op: int) -> str:
        mapping: typing.Dict[int, str] = {
            adsk.fusion.FeatureOperations.NewBodyFeatureOperation: 'NewBody',
            adsk.fusion.FeatureOperations.JoinFeatureOperation: 'Join',
            adsk.fusion.FeatureOperations.CutFeatureOperation: 'Cut',
            adsk.fusion.FeatureOperations.IntersectFeatureOperation: 'Intersect',
            adsk.fusion.FeatureOperations.NewComponentFeatureOperation: 'NewComponent',
        }
        return mapping.get(op, f'Unknown({op})')

    def _extract_extrude(self, extrude: adsk.fusion.ExtrudeFeature) -> typing.Dict[str, typing.Any]:
        info: typing.Dict[str, typing.Any] = {
            'feature_kind': 'Extrude',
            'operation': self._operation_to_string(extrude.operation),
        }
        try:
            ext_one: typing.Any = extrude.extentOne
            if isinstance(ext_one, adsk.fusion.DistanceExtentDefinition):
                info['extent_one_distance_mm'] = self._to_mm(ext_one.distance.value)
                info['extent_one_distance_expression'] = ext_one.distance.expression
        except Exception as e:
            info['extent_one_error'] = repr(e)
        try:
            taper: typing.Optional[adsk.fusion.ModelParameter] = extrude.taperAngleOne
            if taper is not None:
                info['taper_angle_deg'] = float(taper.value)
        except Exception:
            pass
        try:
            prof: typing.Any = extrude.profile
            if hasattr(prof, 'parentSketch'):
                info['profile_sketch'] = prof.parentSketch.name
            elif hasattr(prof, 'count') and prof.count > 0:
                first: typing.Any = prof.item(0)
                if hasattr(first, 'parentSketch'):
                    info['profile_sketch'] = first.parentSketch.name
        except Exception as e:
            info['profile_error'] = repr(e)
        return info

    def _extract_hole(self, hole: adsk.fusion.HoleFeature) -> typing.Dict[str, typing.Any]:
        info: typing.Dict[str, typing.Any] = {
            'feature_kind': 'Hole',
            'operation': self._operation_to_string(hole.operation),
        }
        try:
            info['hole_diameter_mm'] = self._to_mm(hole.holeDiameter.value)
            info['hole_diameter_expression'] = hole.holeDiameter.expression
        except Exception:
            pass
        try:
            info['hole_depth_mm'] = self._to_mm(hole.holeDepth.value)
        except Exception:
            pass
        try:
            info['hole_type'] = str(hole.holeType)
        except Exception:
            pass
        return info

    def _extract_fillet(self, fillet: adsk.fusion.FilletFeature) -> typing.Dict[str, typing.Any]:
        info: typing.Dict[str, typing.Any] = {'feature_kind': 'Fillet'}
        try:
            edge_sets: adsk.fusion.FilletEdgeSets = fillet.edgeSets
            edge_count: int = 0
            radii_mm: typing.List[float] = []
            for j in range(edge_sets.count):
                es: typing.Any = edge_sets.item(j)
                if hasattr(es, 'edges'):
                    edge_count += es.edges.count
                if hasattr(es, 'radius') and es.radius is not None:
                    radii_mm.append(self._to_mm(es.radius.value))
            info['edge_count'] = edge_count
            info['radii_mm'] = radii_mm
        except Exception as e:
            info['fillet_error'] = repr(e)
        return info

    def _extract_chamfer(self, chamfer: adsk.fusion.ChamferFeature) -> typing.Dict[str, typing.Any]:
        info: typing.Dict[str, typing.Any] = {'feature_kind': 'Chamfer'}
        try:
            edges: adsk.core.ObjectCollection = chamfer.edges
            info['edge_count'] = edges.count
        except Exception as e:
            info['chamfer_error'] = repr(e)
        return info

    def _extract_revolve(self, rev: adsk.fusion.RevolveFeature) -> typing.Dict[str, typing.Any]:
        info: typing.Dict[str, typing.Any] = {
            'feature_kind': 'Revolve',
            'operation': self._operation_to_string(rev.operation),
        }
        try:
            ext: typing.Any = rev.extentDefinition
            if hasattr(ext, 'angle') and ext.angle is not None:
                info['angle_deg'] = float(ext.angle.value)
        except Exception:
            pass
        return info

    # ── Sketches and dimensions (where parametric intent lives) ──────────

    def _extract_sketches(self) -> typing.List[typing.Dict[str, typing.Any]]:
        out: typing.List[typing.Dict[str, typing.Any]] = []
        for sketch in self.ctx.root_comp.sketches:
            out.append(self._extract_sketch_full(sketch))
        return out

    def _extract_sketch_full(self, sketch: adsk.fusion.Sketch) -> typing.Dict[str, typing.Any]:
        info: typing.Dict[str, typing.Any] = {
            'name': sketch.name,
            'is_visible': sketch.isVisible,
            'profile_count': sketch.profiles.count,
            'dimensions': [],
            'constraints': [],
        }
        try:
            ref: typing.Any = sketch.referencePlane
            info['reference_plane_type'] = type(ref).__name__
            if hasattr(ref, 'name'):
                info['reference_plane_name'] = ref.name
        except Exception:
            pass
        try:
            dims: adsk.fusion.SketchDimensions = sketch.sketchDimensions
            for j in range(dims.count):
                d: adsk.fusion.SketchDimension = dims.item(j)
                dim_info: typing.Dict[str, typing.Any] = {
                    'type': type(d).__name__,
                    'is_driving': d.isDrivingDimension,
                }
                try:
                    p: adsk.fusion.ModelParameter = d.parameter
                    dim_info['parameter_name'] = p.name
                    dim_info['parameter_expression'] = p.expression
                    dim_info['value_mm'] = (
                        self._to_mm(p.value) if p.unit in LENGTH_UNITS else float(p.value)
                    )
                except Exception:
                    pass
                info['dimensions'].append(dim_info)
        except Exception as e:
            info['dimensions_error'] = repr(e)
        try:
            cons: adsk.fusion.GeometricConstraints = sketch.geometricConstraints
            counts: typing.Dict[str, int] = {}
            for j in range(cons.count):
                c: typing.Any = cons.item(j)
                kind: str = type(c).__name__
                counts[kind] = counts.get(kind, 0) + 1
            info['constraint_counts'] = counts
        except Exception as e:
            info['constraints_error'] = repr(e)
        return info

    # ── Bodies ───────────────────────────────────────────────────────────

    def _extract_bodies(self) -> typing.List[typing.Dict[str, typing.Any]]:
        out: typing.List[typing.Dict[str, typing.Any]] = []
        bodies: adsk.fusion.BRepBodies = self.ctx.root_comp.bRepBodies
        for j in range(bodies.count):
            b: adsk.fusion.BRepBody = bodies.item(j)
            info: typing.Dict[str, typing.Any] = {
                'name': b.name,
                'is_solid': b.isSolid,
                'face_count': b.faces.count,
                'edge_count': b.edges.count,
                'vertex_count': b.vertices.count,
            }
            try:
                bb: adsk.core.BoundingBox3D = b.boundingBox
                info['bounding_box_mm'] = {
                    'min': [
                        self._to_mm(bb.minPoint.x),
                        self._to_mm(bb.minPoint.y),
                        self._to_mm(bb.minPoint.z),
                    ],
                    'max': [
                        self._to_mm(bb.maxPoint.x),
                        self._to_mm(bb.maxPoint.y),
                        self._to_mm(bb.maxPoint.z),
                    ],
                }
            except Exception:
                pass
            try:
                props: adsk.fusion.PhysicalProperties = b.physicalProperties
                info['volume_mm3'] = float(props.volume) * 1000.0  # cm^3 -> mm^3
            except Exception:
                pass
            out.append(info)
        return out

    # ── Best-effort FusionKit candidate spec ─────────────────────────────

    @staticmethod
    def _build_candidate_spec(
        payload: typing.Dict[str, typing.Any],
    ) -> typing.Dict[str, typing.Any]:
        """
        Best-effort flat dict of user parameter names to mm values.
        Auto-generated d1/d2/... names are excluded even if they leak into user params.

        This is the starting point for hand-merging into a FusionKit JSON spec.
        Names will likely need PascalCase conversion to match the project's
        component config conventions; the caller does that pass.
        """
        spec: typing.Dict[str, typing.Any] = {}
        for p in payload.get('user_parameters', []):
            name: str = p['name']
            if name.startswith('d') and name[1:].isdigit():
                continue
            spec[name] = p['value']
        return spec
