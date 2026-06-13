/**
 * Initial parametric model. This string is loaded into the editor on first run.
 *
 * The source is a regular JS function body — any modern syntax is fair game:
 * `function`/`const`/`let`, loops, arrow functions, destructuring, array
 * methods. `api` (the DomainAPI) is the implicit global.
 *
 * Parts compose by nesting: a cabinet's shelves, doors, and drawers go in
 * its `children: [...]` field. Each child's geometry (size, position) is
 * re-derived from the parent during adoption, so `y` inside a cabinet means
 * "height above the cabinet floor" while a top-level `api.shelf({y: 600})`
 * means world-Y (useful for drag-and-drop from a palette).
 *
 * Per-instance editing: clicking a part in the viewport opens its parameters
 * in the panel. Each cabinet below is its own top-level call, so editing one
 * only affects that one. Each shelf/door is its own nested call too — edits
 * are local.
 */
export const EXAMPLE_MODEL_SOURCE = `// Parametric cabinet model.
// 'api' (DomainAPI) is in scope. Click any part in the viewport to edit.

api.cabinet({
  width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0],
  children: [
    api.shelf({ y: 459 }),
    api.shelf({ y: 900 }),
    api.shelf({ y: 1341 }),
    api.door({ side: 'left' }),
    api.door({ side: 'right' }),
  ],
});

api.cabinet({
  width: 800, height: 1800, depth: 400, thickness: 18, position: [1000, 0, 0],
  children: [
    api.shelf({ y: 459 }),
    api.shelf({ y: 900 }),
    api.shelf({ y: 1341 }),
    api.door({ side: 'left' }),
    api.door({ side: 'right' }),
  ],
});

api.cabinet({
  width: 800, height: 1800, depth: 400, thickness: 18, position: [2000, 0, 0], rotation: [0, 90, 0],
  children: [
    api.shelf({ y: 459 }),
    api.shelf({ y: 900 }),
    api.shelf({ y: 1341 }),
    api.door({ side: 'left' }),
    api.door({ side: 'right' }),
  ],
});
`
