# Architecture

The platform is layered so each layer can change without forcing changes in the others. The contract between layers is what matters; the implementations behind each contract are interchangeable.

```
┌───────────────────────────────────────────────────────────────┐
│ Editor UI (src/editor)                                        │
│   CatalogPanel · SourcePanel · PropertyPanel · Viewer         │
│   - Catalog drag and viewport drag write through AST rewrites │
│   - Property panel reads `param()` registry + selection       │
└───────────────────────────────────────────────────────────────┘
                       │ (mutates source / overrides)
                       ▼
┌───────────────────────────────────────────────────────────────┐
│ Store (src/store/modelStore.ts) — Zustand                     │
│   source · overrides · selection · result                     │
└───────────────────────────────────────────────────────────────┘
                       │ runs whenever source/overrides change
                       ▼
┌───────────────────────────────────────────────────────────────┐
│ Model Runtime (src/model/runtime.ts)                          │
│   - Evaluates source string                                   │
│   - Binds `api` (DomainAPI) and `param()` into scope          │
│   - Collects SceneNodes + param registry + errors             │
└───────────────────────────────────────────────────────────────┘
                       │ uses
                       ▼
┌───────────────────────────────────────────────────────────────┐
│ DomainAPI (src/domain/<area>)                                 │
│   Cabinet · Panel · Shelf · Door · Drawer · …                 │
│   - Returns typed SceneNodes (tree)                           │
│   - Each node owns SolidIds it created in the CoreAPI         │
└───────────────────────────────────────────────────────────────┘
                       │ uses
                       ▼
┌───────────────────────────────────────────────────────────────┐
│ CoreAPI (src/core)                                            │
│   box · translate · union · subtract · snapshot               │
│   - Stub today; ClassCAD-backed later                         │
└───────────────────────────────────────────────────────────────┘
                       │ produces
                       ▼
┌───────────────────────────────────────────────────────────────┐
│ Viewer (src/viewer)                                           │
│   - Reads scene-tree leaves                                   │
│   - Fetches `core.snapshot(id)` → meshes                      │
│   - Click → store.select(nodeId)                              │
└───────────────────────────────────────────────────────────────┘
```

## The roundtrip

1. **Author** writes/edits parametric source: `api.cabinet({ width: param('width', 800), ... })`.
2. **Runtime** evaluates the source. Each DomainAPI call:
   - asks `ctx.nextCall()` for a stable `callIndex`,
   - creates one or more `SolidId`s in the CoreAPI,
   - returns a `SceneNode` and `ctx.collect(node)`s it into the tree.
3. **Param registry** is populated as `param(name, default)` is invoked. Overrides from the store are substituted before defaults.
4. **Viewer** walks the tree to its leaves and fetches `core.snapshot(solidId)` for each — produces meshes.
5. **User clicks a mesh** → `store.select(node.id)`. The PropertyPanel resolves the selection back to its `params` and shows `callIndex` so it's visible which call produced this part.
6. **Edits** (slider, drag, catalog drop, LLM) → produce a new source string (AST helpers in [src/model/ast/rewrite.ts](../src/model/ast/rewrite.ts) for in-place rewrites, plain concatenation for top-level catalog drops) → store commits it → re-run.

## Why this shape

- **Source-as-model** keeps the model expressive without committing to a constraint solver. Anything the host language can express, the model can express.
- **CoreAPI as a thin BREP interface** means the kernel can be swapped (ACIS, Parasolid, CGM, ClassCAD, or the stub) without touching domain or editor code.
- **DomainAPI per vertical** means the UI can be auto-generated from typed function signatures — the editor for "cabinets" looks different from "windows" without forking the platform.

## Future shape (notes)

- Replace `new Function(...)` with a real TS transpile so the model is true TypeScript with type-checked API calls.
- Move CoreAPI execution server-side for distributed/cached BREP generation; ship triangulation to the client.
