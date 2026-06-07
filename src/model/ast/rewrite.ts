import { simple as walkSimple, ancestor as walkAncestor } from 'acorn-walk';
import type { Node } from 'acorn';
import { parseSource } from './parse';
import type { SourceRange } from './types';

/**
 * Per-instance, AST-located source rewrites. The byte range of a property's
 * value is the only piece of state we surface; what's IN that range (a
 * literal, a `param(...)` read, an expression) is an internal concern.
 *
 * Used by the editor's selection panel:
 *
 *   1. `findCallProperties(source, callRange)` lists every property of the
 *      call's first argument with its source range and current value.
 *   2. `rewriteCallProperty(source, callRange, name, value)` replaces that
 *      range with a numeric literal. If the value was `param(...)`, this
 *      decouples the call from the shared param.
 */

export interface CallProperty {
  readonly name: string;
  /** Byte range of the value expression (right-hand side of the property). */
  readonly valueRange: SourceRange;
  /** Current value if it parses as a number, else `null`. */
  readonly currentNumber: number | null;
}

interface CallExpressionNode extends Node {
  type: 'CallExpression';
  callee: Node & { type?: string; name?: string };
  arguments: Node[];
}

interface PropertyNode extends Node {
  type: 'Property';
  key: Node & { type?: string; name?: string; value?: unknown };
  value: Node;
  computed?: boolean;
}

interface ObjectExpressionNode extends Node {
  type: 'ObjectExpression';
  properties: Node[];
}

interface LiteralNode extends Node {
  type: 'Literal';
  value: unknown;
}

interface UnaryExpressionNode extends Node {
  type: 'UnaryExpression';
  operator: string;
  argument: Node;
}

function propertyKeyName(p: PropertyNode): string | null {
  if (p.computed) return null;
  if (p.key.type === 'Identifier' && typeof p.key.name === 'string') return p.key.name;
  if (p.key.type === 'Literal' && typeof p.key.value === 'string') return p.key.value;
  return null;
}

/** Best-effort numeric extraction. Returns null for anything that isn't a
 *  number literal, a negative literal, or a `param('name', <literal>)` call. */
function extractNumber(node: Node): number | null {
  if (node.type === 'Literal' && typeof (node as LiteralNode).value === 'number') {
    return (node as LiteralNode).value as number;
  }
  if (node.type === 'UnaryExpression') {
    const u = node as UnaryExpressionNode;
    if (
      u.operator === '-' &&
      u.argument.type === 'Literal' &&
      typeof (u.argument as LiteralNode).value === 'number'
    ) {
      return -((u.argument as LiteralNode).value as number);
    }
  }
  if (node.type === 'CallExpression') {
    const inner = node as CallExpressionNode;
    if (
      inner.callee.type === 'Identifier' &&
      inner.callee.name === 'param' &&
      inner.arguments.length >= 2
    ) {
      return extractNumber(inner.arguments[1]);
    }
  }
  return null;
}

/**
 * Returns every direct property of the object passed as the first argument
 * to the call at `callRange`. Computed keys and spread elements are skipped.
 */
export function findCallProperties(source: string, callRange: SourceRange): CallProperty[] {
  const ast = parseSource(source);
  if (!ast) return [];

  const out: CallProperty[] = [];

  walkSimple(ast, {
    CallExpression(node) {
      const call = node as CallExpressionNode;
      if (call.start !== callRange.start || call.end !== callRange.end) return;
      if (call.arguments.length === 0) return;
      const arg = call.arguments[0];
      if (arg.type !== 'ObjectExpression') return;

      for (const prop of (arg as ObjectExpressionNode).properties) {
        if (prop.type !== 'Property') continue;
        const p = prop as PropertyNode;
        const name = propertyKeyName(p);
        if (!name) continue;
        out.push({
          name,
          valueRange: { start: p.value.start, end: p.value.end },
          currentNumber: extractNumber(p.value),
        });
      }
    },
  });

  return out;
}

/**
 * Per-instance rewrite. Replaces the property's value at `callRange` with a
 * plain numeric literal. Returns the source unchanged if the property isn't
 * found.
 */
export function rewriteCallProperty(
  source: string,
  callRange: SourceRange,
  propertyName: string,
  value: number,
): string {
  const target = findCallProperties(source, callRange).find((p) => p.name === propertyName);
  if (!target) return source;
  return source.slice(0, target.valueRange.start) + String(value) + source.slice(target.valueRange.end);
}

// ─── deletion ──────────────────────────────────────────────────────

/**
 * Smallest source range of the statement that *contains* `callRange`.
 * Looks at `ExpressionStatement` (e.g. `api.shelf({...});`) and
 * `VariableDeclaration` (e.g. `const cab = api.cabinet({...});`).
 * Returns null if the call isn't inside one of those.
 *
 * When the enclosing statement is the braceless body of a control statement
 * (`if`/`else`/`while`/`do`/`for`/`for-in`/`for-of`), the range is lifted
 * to the control statement itself — deleting just the body would otherwise
 * leave the control attached to whatever comes next, silently shifting
 * semantics with no runtime error to trigger repair. We climb the ancestor
 * chain repeatedly so nested braceless bodies (`if (a) if (b) shelf();`)
 * lift all the way out.
 */
interface NodeWithSlots extends Node {
  type: string;
  body?: Node;
  consequent?: Node;
  alternate?: Node;
}

function liftThroughBracelessControl(
  ancestors: readonly Node[],
  start: number,
  end: number,
): { start: number; end: number } {
  let curStart = start;
  let curEnd = end;
  // ancestors[len-1] is the matched node itself; walk parents leaf→root.
  for (let i = ancestors.length - 2; i >= 0; i--) {
    const parent = ancestors[i] as NodeWithSlots;
    const directBody =
      (parent.type === 'IfStatement' &&
        ((parent.consequent && parent.consequent.start === curStart && parent.consequent.end === curEnd) ||
          (parent.alternate && parent.alternate.start === curStart && parent.alternate.end === curEnd))) ||
      ((parent.type === 'WhileStatement' ||
        parent.type === 'DoWhileStatement' ||
        parent.type === 'ForStatement' ||
        parent.type === 'ForInStatement' ||
        parent.type === 'ForOfStatement') &&
        parent.body &&
        parent.body.start === curStart &&
        parent.body.end === curEnd);
    if (!directBody) break;
    curStart = parent.start;
    curEnd = parent.end;
  }
  return { start: curStart, end: curEnd };
}

export function findEnclosingStatement(
  source: string,
  callRange: SourceRange,
): SourceRange | null {
  const ast = parseSource(source);
  if (!ast) return null;

  let best: SourceRange | null = null;

  const consider = (node: Node, ancestors: readonly Node[]) => {
    if (node.start > callRange.start || node.end < callRange.end) return;
    const lifted = liftThroughBracelessControl(ancestors, node.start, node.end);
    if (!best || lifted.end - lifted.start < best.end - best.start) {
      best = lifted;
    }
  };

  walkAncestor(ast, {
    ExpressionStatement(node, _state, ancestors) {
      consider(node, ancestors as readonly Node[]);
    },
    VariableDeclaration(node, _state, ancestors) {
      consider(node, ancestors as readonly Node[]);
    },
  });

  return best;
}

/**
 * Removes the enclosing statement that contains `callRange`, including its
 * leading indentation and a single trailing newline (so we don't leave a
 * blank line behind). Returns the source unchanged if no enclosing
 * statement is found.
 *
 * Honest caveat: if downstream code references a name introduced by the
 * deleted statement (e.g. deleting `const cab = api.cabinet(...)` while
 * `api.shelf({ in: cab, ... })` remains), the resulting source will throw
 * at runtime. We surface the error via `RunResult.error`; the caller is
 * responsible for any cascade.
 */
export function removeCallStatement(source: string, callRange: SourceRange): string {
  const stmt = findEnclosingStatement(source, callRange);
  if (!stmt) return source;

  // Find the bounds of the source line containing stmt.
  let lineStart = stmt.start;
  while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart--;
  let lineEnd = stmt.end;
  while (lineEnd < source.length && source[lineEnd] !== '\n') lineEnd++;

  // Only consume leading indent / trailing newline when the statement is
  // alone on its line. Otherwise — e.g. `const a = api.cabinet(...); api.shelf(...);`
  // on a single line — a whole-line delete would silently take out the
  // sibling. Mixed lines fall back to deleting just stmt.start..stmt.end so
  // unrelated code is preserved (at the cost of a leftover space or two).
  const leadingIsWhitespace = /^\s*$/.test(source.slice(lineStart, stmt.start));
  const trailingIsWhitespace = /^\s*$/.test(source.slice(stmt.end, lineEnd));

  if (leadingIsWhitespace && trailingIsWhitespace) {
    const consumeNewline = lineEnd < source.length ? 1 : 0;
    return source.slice(0, lineStart) + source.slice(lineEnd + consumeNewline);
  }
  return source.slice(0, stmt.start) + source.slice(stmt.end);
}
