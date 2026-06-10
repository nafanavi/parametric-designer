import { simple as walkSimple } from 'acorn-walk';
import type { Node } from 'acorn';
import { parseSource } from './parse';

/**
 * AST transform that wraps every `api.X(...)` call in the model source so the
 * runtime can capture its source location.
 *
 * Each matching call:
 *
 *     api.cabinet({ width: 800 })
 *
 * is rewritten to:
 *
 *     __withLoc(<start>, <end>, () => api.cabinet({ width: 800 }))
 *
 * where `<start>` / `<end>` are byte offsets into the ORIGINAL (pre-transform)
 * source. The session injects a `__withLoc(start, end, fn)` helper that:
 *   1. saves the previous "current location",
 *   2. sets the current location to `[start, end]`,
 *   3. invokes `fn()` (the original call) and returns its result,
 *   4. restores the previous location in a `finally`.
 *
 * Using a wrapper instead of an extra argument means:
 *  - api function signatures don't change,
 *  - nested calls work (e.g. `api.cabinet({width: api.helper()})` — each
 *    inner wrap save/restores the loc),
 *  - return values pass through transparently (the original call's value
 *    flows back through the arrow and the wrapper).
 *
 * Returns the source unchanged if parsing fails or no `api.X` calls exist.
 */
export function instrumentApiCalls(source: string, wrapperName = '__withLoc'): string {
  const ast = parseSource(source);
  if (!ast) return source;

  const wraps: Array<{ start: number; end: number }> = [];

  walkSimple(ast, {
    CallExpression(node) {
      const call = node as Node & {
        callee: { type?: string; computed?: boolean; object?: { type?: string; name?: string } };
        start: number;
        end: number;
      };
      const callee = call.callee;
      if (
        callee.type === 'MemberExpression' &&
        callee.computed !== true &&
        callee.object?.type === 'Identifier' &&
        callee.object.name === 'api'
      ) {
        wraps.push({ start: call.start, end: call.end });
      }
    },
  });

  if (wraps.length === 0) return source;

  // Position-event scan: at each char position emit any wrap-closes whose
  // `end === pos`, then any wrap-opens whose `start === pos`, then the
  // original char. Outer wraps open before inner (sorted by descending end
  // at the same start) so the resulting source is well-formed for nested
  // `api.cabinet({ children: [api.shelf(...)] })`-style calls.
  const opensAt = new Map<number, Array<{ start: number; end: number }>>();
  const closesAt = new Map<number, number>();
  for (const w of wraps) {
    let list = opensAt.get(w.start);
    if (!list) { list = []; opensAt.set(w.start, list); }
    list.push(w);
    closesAt.set(w.end, (closesAt.get(w.end) ?? 0) + 1);
  }
  for (const list of opensAt.values()) {
    list.sort((a, b) => b.end - a.end);
  }

  let out = '';
  for (let pos = 0; pos <= source.length; pos++) {
    const closesHere = closesAt.get(pos) ?? 0;
    for (let i = 0; i < closesHere; i++) out += ')';
    const opensHere = opensAt.get(pos);
    if (opensHere) {
      for (const w of opensHere) {
        out += `${wrapperName}(${w.start},${w.end},()=>`;
      }
    }
    if (pos < source.length) out += source[pos];
  }
  return out;
}
