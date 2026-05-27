/**
 * Source-level rewrites that keep the editor UI and the model source in sync.
 *
 * The model source is the single source of truth — a `param(name, default)`
 * call IS the parameter's value, both for the runtime and the property panel.
 * When the user edits a value in the panel we rewrite the matching literal in
 * the source, then re-run.
 *
 * This is a literal/regex pass, not an AST pass. It only matches `param(...)`
 * calls whose default is a numeric literal (`123`, `-4`, `0.5`). Calls with
 * computed defaults (e.g. `param('w', 800 + 100)`) are deliberately left
 * untouched — those can't be edited from the panel without ambiguity.
 */

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const paramCallPattern = (name: string) =>
  new RegExp(
    String.raw`param\(\s*(['"])` +
      escapeRegex(name) +
      String.raw`\1\s*,\s*-?\d+(?:\.\d+)?\s*\)`,
    'g',
  );

/**
 * Replace the default literal of every `param('<name>', <literal>)` call in
 * `source` with `value`. Returns the source unchanged when no match exists.
 */
export function rewriteParamDefault(
  source: string,
  name: string,
  value: number,
): string {
  return source.replace(paramCallPattern(name), `param('${name}', ${value})`);
}

/** Does `source` contain at least one rewritable `param(name, <literal>)`? */
export function hasRewritableParam(source: string, name: string): boolean {
  return paramCallPattern(name).test(source);
}
