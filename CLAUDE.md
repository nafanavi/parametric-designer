# buerli — Cabinet Studio

Low-code platform for parametric 3D/2D modeling apps. Goal: "Vercel for 3D apps" — let teams build Ikea-Planner-class configurators in weeks, not years. This repo is the initial scratch focused on the cabinet/furniture domain.

## Core idea (the architecture must preserve these)

- **Parametric model = TypeScript source code** that calls a DomainAPI built on a CoreAPI.
- **CoreAPI** wraps a BREP kernel (target: ClassCAD; currently a stub). It exposes primitives + boolean ops + queries — nothing domain-specific.
- **DomainAPI** is per-vertical (cabinets, windows, kitchens). It returns typed `SceneNode`s for UI/editor traceability.
- **Action functions** return expression trees / `SourceEdit`s — they correspond to UI buttons that mutate the model source.
- **Visual editor (Puck-style).** Selecting a 3D object retrieves the call stack of DomainAPI calls that produced it, enumerates every parameter at every level, and exposes them for friendly editing. Great UI comes from this link between source code and 3D model, backed by the rich-type system of the authoring language.
- **Direct manipulation in the viewport.** Drag to move, handles to resize, click to edit — every interaction writes back to the source, never to hidden state.
- **3D containers (flexbox-style).** Cabinets first, then other verticals. Containers lay out children by rules (gap, distribution, alignment). Children expose `min`/`max`/`preferred` size hints; resizing the container reflows them, and resizing a child respects the container and may push neighbours.
- **Auto-generated React UI.** Property panels, action buttons, and inspectors all derive from the typed DomainAPI signatures and from `param('name', default)` calls in the source. Developers polish per-vertical overrides on top.
- **Source is the only canonical state.** Every edit — slider, drag, action button, LLM prompt — round-trips through the source string. This is what enables Git-based history, undo/redo, branching, and online collaboration almost for free.
- **Functional, pure evaluation.** Same source → same scene; no clocks, randomness, or hidden IO. Underpins deterministic undo, server-side reconstruction, and distributed caching.
- **Authoring uses millimetres.** Conversions happen once at the viewer boundary, never sprinkled through domain code.
- **Performance is a first-class constraint.** Large models — hundreds of cabinets, thousands of solids — must stay responsive end-to-end. Avoid patterns that would block memoization, incremental rebuilds, instanced rendering, or server-side kernel offload.

Temporary simplifications are fine and expected; architectural decisions that would force a big rewrite to enable any of the above are not. When in doubt, flag the trade-off.

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

## Working notes

- New verticals go in [src/domain/<area>/](src/domain/). The CoreAPI must not gain domain knowledge.
- Implementation conventions (how nodes register, how params are declared, how the runtime tracks call origins) live in the code and may evolve. Refer to current files when in doubt; flag any change that conflicts with Core idea.

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
