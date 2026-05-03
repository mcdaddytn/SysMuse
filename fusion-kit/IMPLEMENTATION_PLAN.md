# IMPLEMENTATION_PLAN.md — Phased Build Plan

## Phase 1: Core Framework + PipeClamp Migration (Week 1-2)

**Goal**: Reproduce all existing pipeclamp configs through the new framework.

### 1.1 Core infrastructure
- [ ] `core/enums.py` — Port all enums from SketchEnums.py
- [ ] `core/app_context.py` — AppContext with named registries
- [ ] `core/unit_converter.py` — UnitConverter (mm→cm)
- [ ] `core/param_loader.py` — ParamLoader with type coercion
- [ ] `core/logger.py` — FusionLogger (file + optional UI)

### 1.2 Geometry primitives
- [ ] `geometry/sketch_manager.py` — SketchManager
- [ ] `geometry/shapes.py` — CircleShape, RectangleShape, FilletedRectWithCircleCutout
- [ ] `geometry/profile_selector.py` — ProfileSelector (by bounding box, by area)

### 1.3 Feature operations
- [ ] `features/extrude.py` — ExtrudeOp (new_body, cut)
- [ ] `features/hole_patterns.py` — BoltHoleSpec, HolePatternDriller, NotchCarver
- [ ] `features/split.py` — BodySplitter
- [ ] `features/combine.py` — BodyCombiner

### 1.4 PipeClamp component
- [ ] `components/component_base.py` — ComponentBase ABC
- [ ] `components/pipe_clamp.py` — PipeClamp (full migration of GLPipeClamp11.py)

### 1.5 Export
- [ ] `export/stl_exporter.py` — STLExporter
- [ ] `export/state_dumper.py` — StateDumper

### 1.6 Entry point + validation
- [ ] `scripts/run_component.py` — Entry point script
- [ ] Validate: build all 9 pipeclamp JSON configs, compare STL output to originals

**Acceptance criteria**: Every pipeclamp JSON config produces identical geometry to the original GLPipeClamp11.py script.

---

## Phase 2: LunaWrench + HiHatCylinder (Week 2-3)

**Goal**: Prove the framework handles diverse component types.

### 2.1 Additional geometry
- [ ] `geometry/shapes.py` — Add RotatedRectangle (for wrench spokes)
- [ ] `geometry/shape_transforms.py` — rotate_point, radial_pattern, trim_lines_outside_circle

### 2.2 LunaWrench components
- [ ] `components/luna_wrench.py` — LunaWrench (single-sided)
- [ ] `components/luna_wrench.py` — DoubleSidedLunaWrench (with handle)
- [ ] Validate: lunawrench3.json and lunawrenchds2.json produce correct geometry

### 2.3 HiHatCylinder
- [ ] `components/hi_hat_cylinder.py` — HiHatCylinder
- [ ] Validate: hihatcyl.json produces correct geometry

**Acceptance criteria**: All three component types build successfully from JSON configs.

---

## Phase 3: Fastener System + Mounting Plates (Week 3-4)

**Goal**: Intelligent fastener selection and mounting plate generation.

### 3.1 Fastener catalog
- [ ] `fasteners/bolt.py` — Bolt dataclass with standard dimensions
- [ ] `fasteners/nut.py` — Nut dataclass with hex well geometry
- [ ] `fasteners/fastener_pair.py` — FastenerPair with length calculation
- [ ] `configs/fasteners/` — M3, M4, M5, M6 bolt/nut JSON specs
- [ ] `fasteners/mcmaster_catalog.py` — Part number lookup (start with M4 family)

### 3.2 Smart bolt length calculation
Given: material_thickness, head_depth, nut_thickness, clearance
Calculate: minimum bolt length, well depths, countersink dimensions

### 3.3 Mounting plates
- [ ] `components/mounting_plate.py` — MountingPlate: configurable hole patterns on flat plate
- [ ] `components/l_bracket.py` — LBracket: 90° bracket with holes on both faces

### 3.4 Pipe dimension catalog
- [ ] `catalog/pipe_dimensions.py` — Standard PVC OD/ID table (nominal → actual)
- [ ] `catalog/pvc_catalog.py` — Formufit fitting dimensions

**Acceptance criteria**: Can generate a pipe clamp with auto-calculated bolt lengths for any standard PVC pipe size.

---

## Phase 4: Kit Assembly System (Week 4-6)

**Goal**: Build complete kits from JSON definitions.

### 4.1 Kit infrastructure
- [ ] `assembly/kit_definition.py` — KitDefinition: parse kit JSON
- [ ] `assembly/assembly_step.py` — AssemblyStep: position, mate, fasten
- [ ] `assembly/kit_builder.py` — KitBuilder: orchestrate full kit build

### 4.2 Camera mount kit
- [ ] `components/camera_mount.py` — CameraMount adapters (DSLR, GoPro, phone)
- [ ] `configs/kits/camera_pvc_mount.json` — Full camera-on-PVC kit definition
- [ ] Build and validate complete camera mount kit

### 4.3 BOM generation
- [ ] `assembly/bom_generator.py` — Generate bill of materials (parts to print, parts to purchase)

**Acceptance criteria**: A single JSON kit config produces all components, positions them, generates BOM and assembly instructions.

---

## Phase 5: Pipe Shape Fitting (Week 6-8)

**Goal**: Handle non-cylindrical mounting surfaces (bike frames, etc.)

### 5.1 Shape fitting workflow
- [ ] `components/pipe_adapter.py` — PipeAdapter: elliptical and irregular cross-sections
- [ ] Test loop generator: print thin cross-section rings for physical fitting
- [ ] Iterative feedback loop: measure → generate test → adjust → finalize

### 5.2 3D scan integration
- [ ] Import point cloud / mesh from 3D scan
- [ ] Fit parametric cross-section to scanned data
- [ ] Generate clamp matching scanned profile

---

## Phase 6: PVC Scaffolding System (Week 8-10)

**Goal**: Full scaffolding design from room layout.

### 6.1 Scaffolding components
- [ ] PVC pipe segments (parametric length)
- [ ] Standard fittings (tees, elbows, 4-way, caps, casters)
- [ ] Custom 3D-printed adapters where standard fittings don't exist

### 6.2 Room layout integration
- [ ] Import room dimensions / furniture positions
- [ ] Auto-generate scaffolding frame to fit room
- [ ] Camera and lighting position planning

---

## Phase 7: Database + GUI (Week 10+)

**Goal**: Replace JSON configs with database-driven GUI.

### 7.1 Postgres schema
- [ ] Design tables mirroring JSON config structure
- [ ] Python ↔ Postgres adapter (psycopg2 or SQLAlchemy)
- [ ] Migration scripts from JSON → database

### 7.2 TypeScript/Quasar/Vue GUI
- [ ] Express API server with Prisma ORM
- [ ] Component configurator UI
- [ ] Kit builder UI with visual positioning
- [ ] Build queue management

---

## Cross-Cutting Tooling

Reverse-engineering and developer-experience tooling that supports work across all phases.

### Timeline Extractor (Reverse Engineering)
- [x] `fusionkit/export/timeline_extractor.py` — `TimelineExtractor` class
- [x] `scripts/extract_timeline.py` — Fusion 360 entry-point script
- [x] `tests/test_timeline_extractor.py` — outside-Fusion unit tests
- [ ] Validate against existing `pipeclamp15` build (run inside Fusion)
- [ ] Validate iterative loop end-to-end: build → Connector adds chamfer → extract → diff

See `docs/features/FEATURE_timeline_extractor.md`.

---

## Testing Strategy

### Unit tests (outside Fusion 360)
- ParamLoader: JSON parsing, type coercion, defaults merging
- UnitConverter: mm→cm conversion accuracy
- ProfileSelector: mock profile selection logic
- BoltHoleSpec: length calculations

### Integration tests (inside Fusion 360)
- Build each component type from each JSON config
- Compare body count, bounding box dimensions to expected values
- Visual inspection of generated geometry

### Regression tests
- Export STL from each config
- Binary or mesh-diff comparison against reference STLs
- Flag any geometry changes from code refactoring
