# buerli — Cabinet Studio

Low-code platform for parametric 3D/2D modeling apps. Goal: "Vercel for 3D apps" — let teams build Ikea-Planner-class configurators in weeks, not years. This repo is the initial scratch focused on the cabinet/furniture domain.

## Core idea (the architecture must preserve these)

- **Parametric model = TypeScript source code** that calls a DomainAPI built on a CoreAPI.
- **CoreAPI** wraps a BREP kernel (target: ClassCAD; currently a stub). It exposes primitives + boolean ops + queries — nothing domain-specific.
- **DomainAPI** is per-vertical (cabinets, windows, kitchens). It returns typed `SceneNode`s for UI/editor traceability.
- **Action functions** return expression trees / `SourceEdit`s — they correspond to UI buttons that mutate the model source.
- **Visual editor**: selecting a 3D object → find its originating call → expose its params for editing. The link between source code and 3D scene is the whole point.
- Functional nature of the model enables client+server BREP/triangulation, distributed caching, and Git-based undo/collab. Keep the runtime pure where possible.

## Tech stack

React 18 · Next.js 14 (App Router) · TypeScript · Three.js (via `@react-three/fiber` + `drei`) · Zustand · Tailwind. Package manager: **npm**.

Geometry engine target: [ClassCAD](https://classcad.ch). Currently stubbed — see [src/core/stub.ts](src/core/stub.ts). The CoreAPI interface in [src/core/api.ts](src/core/api.ts) is the swap point.

## Layout

```
src/
├── core/                  CoreAPI — BREP abstraction (kernel-agnostic)
├── domain/cabinet/        DomainAPI for cabinets + Action functions
├── model/                 ParametricModel source + runtime (evaluates source → scene)
├── viewer/                R3F scene + selection
├── editor/                UI shell: source / properties / actions panels
└── store/                 Zustand (source, overrides, selection, run result)
```

## Deep docs

Before changing a layer, read the relevant contract:

- [docs/architecture.md](docs/architecture.md) — end-to-end flow, what each layer owns, the roundtrip from source → scene → selection → edit.
- [docs/core-api.md](docs/core-api.md) — CoreAPI contract + invariants any BREP implementation must hold. Read this before wiring ClassCAD.
- [docs/domain-api.md](docs/domain-api.md) — guidelines for adding new verticals (windows, kitchens, …) or new entities within a vertical.

## Conventions

- Model authoring uses **millimetres**. The viewer applies `scale={0.001}` once at the root group. Don't sprinkle conversions through domain code.
- `SceneNode.callIndex` is a per-run counter assigned by the runtime — it's the bridge between a clicked mesh and its originating DomainAPI call. Keep it stable and monotonically increasing as the source is read top-to-bottom.
- DomainAPI functions must register their node via `ctx.collect(node)` so the runtime can build the tree. Don't return nodes without collecting.
- `param(name, defaultValue)` auto-registers into the parameter registry on first call. The property panel reads from this registry — never hard-code param UI.
- New domain entities go in [src/domain/<area>/](src/domain/) with `types.ts`, `api.ts`, `actions.ts`. The CoreAPI must not gain domain knowledge.

## Known shortcuts (scratch-stage, not load-bearing)

- Source is evaluated via `new Function(...)`; it's plain JS, not real TS. Upgrade path: in-browser transpile (sucrase/swc).
- Stub CoreAPI: every solid renders as a box; `union`/`subtract` collapse to the first operand. Replace with ClassCAD-backed kernel preserving the same `CoreAPI` interface.
- `SourceEdit.replace` does literal string substitution (no AST). True source roundtripping needs a TypeScript AST pass — deliberately deferred.

## Commands

```bash
npm run dev          # dev server on :3000
npm run build        # production build
npm run type-check   # tsc --noEmit
npm run lint
```

## Environment

`node`/`npm`/`npx` are available on PATH in Git Bash via wrappers at `~/bin/` that exec the newest nvm-installed version. Call them directly — do not source nvm.
