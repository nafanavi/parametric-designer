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
 */
export const EXAMPLE_MODEL_SOURCE = `// Parametric cabinet model.
// 'api' (DomainAPI) and 'param(name, default)' are in scope.

const createRow = (n, step) => {
  for (let i = 0; i < n; i++) {
    api.cabinet({
      width: param('width', 800),
      height: param('height', 1800),
      depth: param('depth', 400),
      thickness: 18,
      shelves: param('shelves', 3),
      doors: 2,
      position: [i * step, 0, 0],
    });
  }
}

createRow(param('count', 3), 1000);
`
