/**
 * Initial parametric model. This string is loaded into the editor on first run.
 *
 * The source is a regular JS function body — any modern syntax is fair game:
 * `function`/`const`/`let`, loops, arrow functions, destructuring, array
 * methods. `api` (the DomainAPI) is the implicit global.
 *
 * The compositional cabinet API: `api.cabinet({...})` builds the frame; add
 * shelves/doors/drawers with `api.shelf/door/drawer({ in: cab, ... })`.
 * Helpers like `evenShelves` below are just user-land JS — compose freely.
 *
 * Per-instance editing: clicking a part in the viewport opens its parameters
 * in the panel. Each cabinet below is its own top-level call, so editing one
 * only affects that one. Shelves inside `evenShelves` share a single source
 * call — editing any shelf there re-spaces every shelf the helper emitted.
 * Inline the api.shelf calls if you want per-shelf control.
 */
export const EXAMPLE_MODEL_SOURCE = `// Parametric cabinet model.
// 'api' (DomainAPI) is in scope. Click any part in the viewport to edit.

const evenShelves = (cab, count) => {
  const innerH = cab.params.height - 2 * cab.params.thickness;
  for (let i = 1; i <= count; i++) {
    api.shelf({ in: cab, y: cab.params.thickness + (innerH * i) / (count + 1) });
  }
};

const a = api.cabinet({
  width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0],
});
evenShelves(a, 3);
api.door({ in: a, side: 'left' });
api.door({ in: a, side: 'right' });

const b = api.cabinet({
  width: 800, height: 1800, depth: 400, thickness: 18, position: [1000, 0, 0],
});
evenShelves(b, 3);
api.door({ in: b, side: 'left' });
api.door({ in: b, side: 'right' });

const c = api.cabinet({
  width: 800, height: 1800, depth: 400, thickness: 18, position: [2000, 0, 0],
});
evenShelves(c, 3);
api.door({ in: c, side: 'left' });
api.door({ in: c, side: 'right' });
`;
