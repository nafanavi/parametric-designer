# Cabinet Studio

Low-code platform for parametric 3D/2D modeling apps ("Vercel for 3D apps"). Initial scratch focuses on cabinets/furniture.

## Core idea (architectural invariants — preserve these)

- **Parametric model = TypeScript source** calling a DomainAPI built on a CoreAPI.
- **CoreAPI** wraps a BREP kernel (target: ClassCAD; currently stub). Primitives + booleans + queries only — no domain knowledge.
- **DomainAPI** is per-vertical (cabinets, windows, …). Returns typed `SceneNode`s for editor traceability.
- **Visual editor (Puck-style).** Selecting a 3D object retrieves the DomainAPI call stack that produced it and exposes every parameter at every level for editing.
- **Direct manipulation in viewport.** Drag/resize/click writes back to source, never hidden state.
- **3D containers (flexbox-style).** Children expose `min`/`max`/`preferred`; container resize reflows, child resize may push neighbours.
- **Auto-generated React UI.** Property panels and catalog entries derive from typed DomainAPI signatures and `param('name', default)` calls. Per-vertical overrides on top.
- **Source is the only canonical state.** Every edit (slider, drag, catalog drop, LLM) round-trips through the source string. Enables Git history, undo/redo, branching, collab.
- **Functional, pure evaluation.** Same source → same scene; no clocks/randomness/IO. Underpins deterministic undo and server-side reconstruction.
- **Authoring in millimetres.** Convert once at the viewer boundary.
- **Performance is first-class.** Hundreds of cabinets / thousands of solids must stay responsive. Don't block memoization, incremental rebuilds, instancing, or server-side kernel offload.

Temporary simplifications are fine; decisions that would force a rewrite to enable any of the above are not. Flag trade-offs.

New verticals go in [src/domain/<area>/](src/domain/) — CoreAPI must not gain domain knowledge.

## Tech stack

React 18 · Next.js 14 (App Router) · TypeScript · Three.js (`@react-three/fiber` + `drei`) · Zustand · Tailwind. Package manager: **npm**.

Geometry engine target: [ClassCAD](https://classcad.ch). Stubbed at [src/core/stub.ts](src/core/stub.ts); swap point is [src/core/api.ts](src/core/api.ts).

## Deep docs (read before changing the relevant layer)

- [docs/architecture.md](docs/architecture.md) — source → scene → selection → edit roundtrip.
- [docs/core-api.md](docs/core-api.md) — CoreAPI contract + BREP invariants. Read before wiring ClassCAD.
- [docs/domain-api.md](docs/domain-api.md) — adding verticals or entities.

## Reviewing user proposals

When the user suggests an approach, **don't jump to coding**. First, as an independent senior engineer:

- Analyse the proposal — what's right, risky, load-bearing vs. incidental.
- If a materially better alternative exists, propose it concretely: which Core idea constraints it preserves, which layers it touches, which failure modes it avoids. "Cleaner" is not enough.
- If the user's proposal is already right, say so and proceed. Don't manufacture alternatives.
- Only implement once the user picks a direction.

## Known shortcuts (scratch-stage, not load-bearing)

- Source evaluated via `new Function(...)` — plain JS, not real TS. Upgrade: in-browser transpile (sucrase/swc).
- Stub CoreAPI: every solid renders as a box; `union`/`subtract` collapse to first operand. Replace with ClassCAD preserving `CoreAPI`.
- AST rewrites via acorn cover property writes, `children:` array insert, and call deletion ([src/model/ast/rewrite.ts](src/model/ast/rewrite.ts)).

## Logs

- **Plans** → [.notes/plans/](.notes/plans/) as `YYYY-MM-DD-HHMM-<slug>.md` for non-trivial refactor plans / design proposals / "what I'd do next" recommendations. Skip trivial one-liners.
- **Reviews** → [.notes/reviews/](.notes/reviews/), same filename convention, for non-trivial `/code-review` / `/security-review` / manual passes with at least one actionable finding. Header: date, branch, range, tool. Findings ranked by severity, each with `file:line`, failure scenario, fix direction.

## Commands

```bash
npm run dev          # :3000
npm run build
npm run type-check   # tsc --noEmit
npm run lint
```

`node`/`npm`/`npx` on PATH via `~/bin/` wrappers — call directly, don't source nvm.
