# buerli — Cabinet Studio (scratch)

Low-code platform for parametric 3D configurators. This scratch focuses on the
cabinet/furniture domain end-to-end so the architecture can be evaluated
before wiring in a real BREP kernel.

## Architecture

```
src/
├── core/                  # CoreAPI — BREP abstraction
│   ├── api.ts             # interface: box, translate, union, subtract, snapshot
│   └── stub.ts            # in-memory stand-in; swap for ClassCAD later
├── domain/cabinet/        # DomainAPI for cabinets
│   ├── api.ts             # cabinet, panel, shelf, door, drawer
│   └── actions.ts         # Action functions → SourceEdit (UI toolbar)
├── model/                 # ParametricModel as source code
│   ├── runtime.ts         # evaluates source string → scene tree + params
│   └── example.ts         # initial source loaded into the editor
├── viewer/                # Three.js scene (R3F)
│   ├── Scene.tsx
│   └── SolidMesh.tsx
├── editor/                # Visual editor shell
│   ├── EditorLayout.tsx
│   ├── ActionToolbar.tsx
│   ├── SourcePanel.tsx
│   └── PropertyPanel.tsx
└── store/
    └── modelStore.ts      # Zustand: source, overrides, selection, run result
```

## How a change flows through the system

1. User edits the source text (or clicks an action button → applies a `SourceEdit`).
2. `runModel()` evaluates the source with `api` (DomainAPI) and `param()` in scope.
3. Each DomainAPI call drops a `SceneNode` into the tree and creates `SolidId`s
   in the CoreAPI.
4. The viewer reads leaves, fetches snapshots from `core.snapshot(id)`, renders.
5. Clicking a mesh sets `selection` → PropertyPanel shows the originating call's
   params; the auto-generated `param()` inputs let the user retune live.

## Replacing the stub kernel

`createStubCore()` in `src/core/stub.ts` returns the `CoreAPI` interface. A
ClassCAD-backed implementation needs to fulfil the same contract — start a
CCAPI WebSocket session, translate `box`/`translate`/boolean calls into kernel
ops, and produce `SolidSnapshot { mesh, aabb, transform }` from the kernel's
triangulation.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000.
