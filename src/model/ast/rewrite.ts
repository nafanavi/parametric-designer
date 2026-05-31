import { findParamLiteralRanges } from './locate';

/**
 * AST-located source rewrite that keeps the editor UI and the model source
 * in sync. Replaces the regex-based predecessor: a `param('name', <literal>)`
 * call is found via the parser, so the match never fires inside strings or
 * comments, and `param('name', 800 + 100)` (computed default) is properly
 * left untouched.
 *
 * The edit itself is byte-level — we splice the literal's source range
 * directly. Whitespace, comments, and the rest of the source are preserved
 * exactly as the user wrote them.
 */

export function rewriteParamDefault(
  source: string,
  name: string,
  value: number,
): string {
  const ranges = findParamLiteralRanges(source, name);
  if (ranges.length === 0) return source;

  // Apply right-to-left so earlier offsets stay valid as we splice.
  const sorted = [...ranges].sort((a, b) => b.start - a.start);
  let out = source;
  const literal = String(value);
  for (const { start, end } of sorted) {
    out = out.slice(0, start) + literal + out.slice(end);
  }
  return out;
}

/** Does `source` contain at least one rewritable `param(name, <literal>)`? */
export function hasRewritableParam(source: string, name: string): boolean {
  return findParamLiteralRanges(source, name).length > 0;
}
