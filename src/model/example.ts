/**
 * Initial parametric model. This string is loaded into the editor on first run.
 *
 * The source is a regular JS function body — any modern syntax is fair game:
 * `function`/`const`/`let`, loops, arrow functions, destructuring, array
 * methods. `api` (the DomainAPI) and `param(name, defaultValue)` are the only
 * implicit globals.
 *
 * Every `param('name', <number-literal>)` declaration in the source shows up
 * in the Parameters panel; editing it there rewrites the literal in place.
 *
 * The new compositional API: `api.cabinet({...})` makes the frame only; add
 * shelves/doors/drawers with `api.shelf/door/drawer({ in: cab, ... })`.
 * Helpers like `evenShelves` below are just user-land JS — compose as you like.
 */
export const EXAMPLE_MODEL_SOURCE = `// Parametric cabinet model.
// 'api' (DomainAPI) and 'param(name, default)' are in scope.

const evenShelves = (cab, count) => {
  const innerH = cab.params.height - 2 * cab.params.thickness;
  for (let i = 1; i <= count; i++) {
    api.shelf({ in: cab, y: cab.params.thickness + (innerH * i) / (count + 1) });
  }
};

const createRow = (n, step) => {
  for (let i = 0; i < n; i++) {
    const cab = api.cabinet({
      width: param('width', 800),
      height: param('height', 1800),
      depth: param('depth', 400),
      thickness: 18,
      position: [i * step, 0, 0],
    });
    evenShelves(cab, param('shelves', 3));
    api.door({ in: cab, side: 'left' });
    api.door({ in: cab, side: 'right' });
  }
};

createRow(param('count', 3), 1000);
`;
