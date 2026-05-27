# DomainAPI — guidelines for new verticals

Each vertical (cabinets, windows, kitchens, decks…) lives under `src/domain/<area>/` and exposes:

- `types.ts` — `SceneNode` variants and `*Params` interfaces.
- `api.ts` — pure factory that takes a `DomainContext` and returns the per-vertical API.
- `actions.ts` — UI-facing action functions returning `SourceEdit`s.

Reference implementation: [src/domain/cabinet/](../src/domain/cabinet/).

## What a DomainAPI function must do

Every function on a DomainAPI:

1. **Asks the runtime for a `callIndex`** via `ctx.nextCall()`. This is the bridge from a clicked mesh back to a source call site.
2. **Creates its geometry through the CoreAPI**, never directly via Three.js or kernel handles.
3. **Returns a `SceneNode`** with `type`, `id`, `callIndex`, `params`, `solids`, and (optionally) `children`.
4. **Registers itself** with `ctx.collect(node)` so the runtime can build the tree. Failing to collect = invisible in the viewer.

```ts
function panel(params) {
  const idx = ctx.nextCall();
  const solid = core.box({
    size: [params.width, params.height, params.thickness],
    transform: { translation: params.position },
  });
  return ctx.collect({
    type: 'panel',
    id: `panel#${idx}`,
    callIndex: idx,
    params,
    solids: [solid],
    children: [],
  });
}
```

## SceneNode design rules

- **Container nodes** (e.g. `cabinet`) have children and may aggregate `solids` for selection convenience. The viewer renders **leaves only** — don't double-paint.
- **Leaf nodes** own one or more `solids` directly and have `children: []`.
- `id` must be stable across re-runs *given the same source and params*. Use `${type}#${callIndex}` plus a per-child disambiguator if the call produces multiple leaves.
- `params` is the source of truth for the PropertyPanel. Put **all** values that should be editable here, even computed ones — the panel currently shows it read-only, but the AST-edit upgrade will use this object verbatim.

## Action functions

Actions are pure: they return `SourceEdit`s, never apply them themselves. The editor decides when and how to apply.

```ts
{
  id: 'add-cabinet',
  label: 'Add Cabinet',
  group: 'create',
  run: () => ({
    kind: 'append',
    code: `api.cabinet({ width: param('w2', 600), ... });\n`,
  }),
}
```

Guidelines:

- Group actions logically (`create`, `modify`, `query`). The UI may render groups as toolbar sections.
- Prefer **adding new `param(...)` calls with fresh names** in generated code (e.g. `param('w2', 600)`) so two added cabinets get independent param entries.
- Actions can be parametric themselves later (e.g. "Add door to selected cabinet") — they'll receive selection context as an argument. Keep `run()`'s signature open to that.

## When to add a new entity

Add a new entity (e.g. `cornice`, `toeKick`) when:

- It has its own params worth editing in the panel, **and**
- It maps to a distinguishable region in the 3D scene the user might want to click.

Otherwise, fold it into an existing entity as internal geometry. A `panel` is a panel even if it's used as a back, a side, or a shelf-divider — the cabinet aggregates the layout.

## Cross-vertical reuse

Common primitives (boards, joints, hardware) will eventually live in a shared `src/domain/_shared/` module so windows + cabinets + kitchens can compose them. **Don't pre-extract** — wait until the second vertical actually needs the same thing, then lift it.

## Anti-patterns

- ❌ Returning a `SceneNode` without `ctx.collect(node)`-ing it. The runtime won't see it.
- ❌ Calling Three.js from inside DomainAPI. Geometry only flows out via CoreAPI → snapshot → viewer.
- ❌ Hard-coding `param()` keys to fixed names across calls — two cabinets would share a width input.
- ❌ Hiding parameters from the `params` field "because they're computed". The PropertyPanel and (future) AST writeback both rely on `params` being complete.
- ❌ Embedding UI text (`label`, `tooltip`) inside `SceneNode`. Keep UI metadata in the Action functions and PropertyPanel, not in the geometry tree.
