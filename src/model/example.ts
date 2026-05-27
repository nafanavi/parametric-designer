/**
 * Initial parametric model. This string is loaded into the editor on first run.
 * Anything callable on `api` (the DomainAPI) and `param(name, defaultValue)`
 * is available.
 */
export const EXAMPLE_MODEL_SOURCE = `// Parametric cabinet model
api.cabinet({
  width: param('width', 800),
  height: param('height', 1800),
  depth: param('depth', 400),
  thickness: 18,
  shelves: param('shelves', 3),
  doors: 2,
  position: [0, 0, 0],
});
`;
