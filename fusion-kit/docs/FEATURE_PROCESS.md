# FEATURE_PROCESS.md — How to Add Feature Enhancements to FusionKit

## Overview

This document defines how new features flow through the FusionKit system, what Claude Code context files need updating, and the standard structure for feature specifications.

---

## Feature Enhancement Workflow

### Step 1: Write the Feature Spec

Create a markdown file in `docs/features/` named `FEATURE_<short_name>.md`.

Every feature spec must include:

```markdown
# FEATURE: <Title>
## Status: Planned | In Progress | Complete
## Priority: High | Medium | Low
## Phase: <which implementation phase>

## Problem Statement
What does this feature solve? Why is it needed?

## Geometry / Domain Analysis  
Technical details, diagrams, math, constraints.

## Implementation Plan
### Files to create/modify:
| File | Action | Description |
|------|--------|-------------|

### Acceptance criteria:
1. ...
2. ...

## Test Cases
| Input | Expected | Notes |
|-------|----------|-------|

## Dependencies
What must be complete before this can start?
```

### Step 2: Update Claude Code Context

When starting work on a feature, update these context files:

| File | What to update |
|------|----------------|
| `CLAUDE_CODE_CONTEXT.md` | Add the feature to "Current Work" section. Add any new API gotchas discovered. |
| `IMPLEMENTATION_PLAN.md` | Check off completed items. Add new sub-tasks if the feature creates them. |
| `ARCHITECTURE.md` | If new classes/modules are added, update the class listing and data flow diagram. |
| `INVENTORY.md` | If migrating more old code, update the migration map. |
| `docs/features/FEATURE_<name>.md` | Update status from Planned → In Progress → Complete. |

### Step 3: Implement

Follow these conventions (documented in `CLAUDE_CODE_CONTEXT.md`):

- **Fully qualified types on every variable, parameter, and return**
- **Create the test file first** (in `tests/`) — even if it can only run outside Fusion
- **One module per concern** — don't bloat existing files
- **Register new components** in `fusionkit/components/__init__.py`
- **Add new param types** to the relevant `_default_param_types()` classmethod

### Step 4: Test

- Run `python -m unittest discover -s tests -v` for all non-Fusion tests
- In Fusion 360, run `scripts/run_component.py` with each relevant JSON config
- Compare output geometry to reference STLs if available

### Step 5: Update Context & Close

- Mark the feature as Complete in its spec
- Update `IMPLEMENTATION_PLAN.md` with checked boxes
- If new JSON config keys were added, update `configs/defaults/base_config.json`
- If new component types were added, update the registry

---

## What Goes in Claude Code Context

When starting a Claude Code session, load these files as context:

### Always load:
- `CLAUDE_CODE_CONTEXT.md` — API facts, conventions, do-not-break list
- `ARCHITECTURE.md` — class design, data flow, JSON schema

### Load when relevant:
- `IMPLEMENTATION_PLAN.md` — when planning or prioritizing work
- `INVENTORY.md` — when migrating old code or understanding heritage
- `docs/features/FEATURE_<name>.md` — the specific feature being worked on

### Load the code files being modified:
- The specific module files (e.g., `fusionkit/fasteners/bolt.py`)
- The test files (e.g., `tests/test_fasteners.py`)
- Relevant JSON configs

### Do NOT load:
- All Python files at once (context window waste)
- Old/migrated code files (GLPipeClamp11.py etc.) unless actively comparing

---

## Feature Backlog

Track planned features here. Move to individual spec files when work begins.

### Phase 1 (Core + PipeClamp)
- [x] Core framework (AppContext, UnitConverter, ParamLoader, Logger)
- [x] Geometry primitives (shapes, profile selector, sketch manager)
- [x] Feature operations (extrude, hole patterns, split, combine)
- [x] PipeClamp component (full migration)
- [x] STL export and state dump
- [ ] **Validate all 9 pipeclamp configs produce correct geometry** ← first Fusion test

### Phase 2 (LunaWrench + HiHatCyl)
- [x] LunaWrench (single + double-sided) code written
- [x] HiHatCylinder code written
- [ ] Validate in Fusion 360

### Phase 3 (Fasteners + Plates)
- [x] Bolt/Nut/FastenerPair dataclasses with standard catalogs
- [ ] **Smart fastener selection for pipe clamps** → see `FEATURE_smart_fastener_selection.md`
- [x] MountingPlate component (basic)
- [ ] L-Bracket component
- [ ] Camera mount adapters (DSLR, GoPro, phone)

### Phase 4 (Kit Assembly)
- [x] KitBuilder stub
- [ ] Assembly step execution (position, mate, fasten)
- [ ] BOM with purchased parts (McMaster part numbers)

### Phase 5 (Pipe Shape Fitting)
- [ ] Test loop generator for irregular pipe shapes
- [ ] 3D scan → parametric cross-section fitting
- [ ] Iterative measurement workflow

### Phase 6 (PVC Scaffolding)
- [ ] PVC pipe segments
- [ ] Standard fittings catalog (formufit)
- [ ] Room layout → scaffolding generator

### Phase 7 (Database + GUI)
- [ ] Postgres schema
- [ ] Python ↔ Postgres adapter
- [ ] TypeScript/Quasar/Vue GUI

---

## Adding a New Component Type

1. Create `fusionkit/components/<name>.py` with a class inheriting `ComponentBase`
2. Implement `build()` and `_default_param_types()`
3. Add the class to `COMPONENT_REGISTRY` in `fusionkit/components/__init__.py`
4. Create JSON config(s) in `configs/components/<name>/`
5. Test with `scripts/run_component.py`

## Adding a New Fastener Type

1. Add dimensions to the lookup tables in `fusionkit/fasteners/bolt.py` or `nut.py`
2. Create a JSON spec in `configs/fasteners/`
3. Add unit tests in `tests/test_fasteners.py`

## Adding a New Catalog Entry

1. Add data to the appropriate module in `fusionkit/catalog/`
2. Reference in component code via import
