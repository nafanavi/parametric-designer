# CoreAPI — contract

The CoreAPI is the seam between the platform and a BREP kernel. It is intentionally narrow: primitives, transforms, booleans, snapshot. Anything domain-specific belongs above this line, not in it.

Source of truth: [src/core/api.ts](../src/core/api.ts) · [src/core/types.ts](../src/core/types.ts)

## Operations

| Method | Returns | Notes |
| --- | --- | --- |
| `box(params)` | `SolidId` | `params.size = [w, h, d]` in millimetres. Optional `transform` for initial pose. |
| `translate(id, delta)` | `SolidId` | Pure: returns a **new** SolidId. Inputs are not mutated. |
| `union(a, b)` | `SolidId` | Boolean merge. Both inputs remain queryable. |
| `subtract(a, b)` | `SolidId` | `a` minus `b`. Order-sensitive. |
| `snapshot(id)` | `SolidSnapshot` | Triangulated mesh + AABB + transform. Called by the viewer per frame's render pass — implementations should cache. |
| `list()` | `readonly SolidId[]` | Diagnostic — every solid ever created in this kernel session. |
| `reset()` | `void` | Disposes everything. The runtime calls this implicitly by constructing a fresh kernel per run. |

## Invariants any implementation must hold

1. **Pure operation semantics.** `union(a, b)` does not delete `a` or `b`. Operations always produce a new `SolidId`. This is what enables `git`-style undo/redo: the kernel state is an append-only log of ops.
2. **Stable `SolidId`s for the lifetime of the kernel instance.** A SolidId returned in one tick must still resolve to the same solid until `reset()`.
3. **Units are millimetres.** The viewer downscales at the scene root. Do not introduce other unit systems inside the kernel.
4. **Right-handed Y-up coordinate system.** Same convention as the viewer; saves us a transform.
5. **`snapshot()` must include a valid AABB.** The viewer uses it for selection visuals and (later) culling.

## Replacing the stub with ClassCAD

`createStubCore()` in [src/core/stub.ts](../src/core/stub.ts) is the reference implementation. A ClassCAD-backed core needs to:

1. **Open a CCAPI WebSocket session** at module init. Use a singleton — one connection per browser tab.
2. **Translate each CoreAPI call** into ClassCAD's equivalent op. Most are 1:1.
3. **Generate `SolidId`s on the client side** (counter or UUID) and maintain a `Map<SolidId, ccapiHandle>`. Don't leak kernel handles upward.
4. **Implement `snapshot()` async-cached.** A ClassCAD triangulation round-trip is too slow for a synchronous call. Options:
   - Pre-triangulate on every op and store the latest mesh on the client.
   - Make `snapshot()` synchronous against a local cache; populate the cache eagerly after each op.
5. **Be sandboxed per session.** No global kernel state. Each `runModel()` should produce a fresh kernel (or at minimum a fresh namespace).

## What does **not** belong in the CoreAPI

- Anything named after a domain concept (`cabinet`, `panel`, `door`).
- UI metadata (labels, icons, group names) — that's a DomainAPI concern.
- Persistence, history, undo logic — handled at a higher layer.
- Coordinate-space conversions (mm↔in, Y-up↔Z-up) — these belong in adapters at the edges of the system, not in the kernel.

## Extending the CoreAPI

Adding a new primitive (`cylinder`, `sphere`, `extrudeProfile`) is cheap. Adding a new *abstraction* — material assignment, units, transactions — needs justification, because every implementation now has to honour it. Default to: "can this be expressed in terms of existing ops above the CoreAPI?" If yes, put it in a DomainAPI utility.
