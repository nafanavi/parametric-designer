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
 * plain numeric literal — or, when `value` is an array of numbers, with an
 * `[a, b, c]` literal (the common case for `position: [x, y, z]` on
 * cabinets and standalone panels). When the property is absent from the
 * call's argument object, it is inserted just before the closing `}` so
 * first-time edits (e.g. rotating a cabinet that was authored without a
 * `rotation` field) take effect.
 */
export function rewriteCallProperty(
  source: string,
  callRange: SourceRange,
  propertyName: string,
  value: number | readonly number[],
): string {
  const literal = Array.isArray(value) ? `[${value.join(', ')}]` : String(value);
  const target = findCallProperties(source, callRange).find((p) => p.name === propertyName);
  if (target) {
    return source.slice(0, target.valueRange.start) + literal + source.slice(target.valueRange.end);
  }
  const insertion = findArgObjectInsertionPoint(source, callRange);
  if (!insertion) return source;
  const piece = insertion.isEmpty
    ? `${propertyName}: ${literal}`
    : `, ${propertyName}: ${literal}`;
  return source.slice(0, insertion.at) + piece + source.slice(insertion.at);
}

/**
 * Locate the byte just before the closing `}` of the first argument's
 * object literal for the call at `callRange`. Returned with `isEmpty` so
 * callers can choose between `name: value` and `, name: value`. Null when
 * the call has no first argument or that argument isn't an object literal.
 */
function findArgObjectInsertionPoint(
  source: string,
  callRange: SourceRange,
): { at: number; isEmpty: boolean } | null {
  const ast = parseSource(source);
  if (!ast) return null;
  let out: { at: number; isEmpty: boolean } | null = null;
  walkSimple(ast, {
    CallExpression(node) {
      const call = node as CallExpressionNode;
      if (call.start !== callRange.start || call.end !== callRange.end) return;
      if (call.arguments.length === 0) return;
      const arg = call.arguments[0];
      if (arg.type !== 'ObjectExpression') return;
      const obj = arg as ObjectExpressionNode;
      out = { at: obj.end - 1, isEmpty: obj.properties.length === 0 };
    },
  });
  return out;
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
 * If `callRange` is a direct element of an `ArrayExpression` (typically a
 * cabinet's `children: [...]`), returns the byte slice to remove — the
 * element plus its surrounding comma/whitespace, chosen so the array stays
 * well-formed:
 *
 *   - non-last element: eat element + trailing comma + whitespace up to the
 *     next element's start.
 *   - last element: eat the preceding comma + whitespace + element.
 *   - sole element: eat just the element.
 *
 * Returns null when the call isn't a direct array element. Multi-line and
 * single-line arrays both work; we trim by source offsets, not by lines.
 */
interface ArrayExpressionNode extends Node {
  type: 'ArrayExpression';
  elements: Array<Node | null>;
}

/**
 * Byte range of a cabinet (or any `api.X(...)` call's) `children: [...]`
 * array literal — inclusive of the surrounding `[` `]`. Used by drag-and-drop
 * to insert a new child into an existing cabinet's children array.
 * Returns null when the call has no `children` property or the property's
 * value isn't an array literal.
 */
export function findChildrenArrayRange(
  source: string,
  callRange: SourceRange,
): SourceRange | null {
  const props = findCallProperties(source, callRange);
  const children = props.find((p) => p.name === 'children');
  if (!children) return null;
  const slice = source.slice(children.valueRange.start, children.valueRange.end);
  // Cheap structural check — the value must be an array literal. Any other
  // shape (a function call returning an array, a variable, etc.) needs
  // different handling.
  if (slice[0] !== '[' || slice[slice.length - 1] !== ']') return null;
  return children.valueRange;
}

/**
 * Insert a new element at the end of an array literal. Handles both empty
 * arrays and non-empty arrays:
 *
 *   - empty `[]`             →  `[ newCode ]`
 *   - inline `[ a, b ]`      →  `[ a, b, newCode ]`
 *   - multi-line `[\n  a,\n]` →  `[\n  a,\n  newCode,\n]`
 *
 * The indent for multi-line arrays is sniffed from the last element's
 * line. Returns the source unchanged when `arrayRange` doesn't point at a
 * `[ ... ]` literal.
 */
export function insertArrayElement(
  source: string,
  arrayRange: SourceRange,
  newCode: string,
): string {
  if (source[arrayRange.start] !== '[' || source[arrayRange.end - 1] !== ']') {
    return source;
  }
  const inner = source.slice(arrayRange.start + 1, arrayRange.end - 1);

  // Empty (or whitespace-only) array: `[]` or `[   ]`.
  if (inner.trim() === '') {
    return (
      source.slice(0, arrayRange.start) +
      '[' + newCode + ']' +
      source.slice(arrayRange.end)
    );
  }

  // Non-empty: detect whether the array's last element is on its own
  // indented line (multi-line form) or inline. Strategy:
  //   - Find the last non-whitespace char before the closing `]`.
  //   - If a newline appears between it and `]`, this is multi-line: use
  //     the indent of that last element's line for the new line.
  //   - Otherwise inline: append `, newCode` just before `]`.
  let last = arrayRange.end - 2;
  while (last > arrayRange.start && /\s/.test(source[last])) last--;
  const trailingSlice = source.slice(last + 1, arrayRange.end - 1);
  const multiLine = trailingSlice.includes('\n');

  let insertion: string;
  let insertAt: number;
  if (multiLine) {
    // Sniff the indent of the line containing `last` — `last` is the last
    // non-whitespace character before the closing `]`. If that character is
    // a comma, the existing trailing element already has its separator;
    // otherwise we need to add one before our new element.
    const lastIsComma = source[last] === ',';
    let lineStart = last;
    while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart--;
    const indentMatch = source.slice(lineStart, last).match(/^\s*/);
    const indent = indentMatch ? indentMatch[0] : '';
    insertion = lastIsComma
      ? `${indent}${newCode},\n`
      : `,\n${indent}${newCode},\n`;
    // Insert just before the start of the line that holds `]`, so the
    // closing bracket's existing indent is preserved.
    let closeLineStart = arrayRange.end - 1;
    while (closeLineStart > 0 && source[closeLineStart - 1] !== '\n') closeLineStart--;
    insertAt = closeLineStart;
  } else {
    insertion = `, ${newCode}`;
    insertAt = arrayRange.end - 1; // just before `]`
  }
  return source.slice(0, insertAt) + insertion + source.slice(insertAt);
}

export function findEnclosingArrayElement(
  source: string,
  callRange: SourceRange,
): SourceRange | null {
  const ast = parseSource(source);
  if (!ast) return null;

  let best: { array: ArrayExpressionNode; index: number; element: Node } | null = null;

  walkAncestor(ast, {
    ArrayExpression(node, _state, _ancestors) {
      const arr = node as ArrayExpressionNode;
      for (let i = 0; i < arr.elements.length; i++) {
        const el = arr.elements[i];
        if (!el) continue;
        if (el.start === callRange.start && el.end === callRange.end) {
          if (!best || arr.end - arr.start < best.array.end - best.array.start) {
            best = { array: arr, index: i, element: el };
          }
        }
      }
    },
  });

  if (!best) return null;
  // Compiler can't tell that `best` is non-null inside this closure variant.
  const { array, index, element } = best as {
    array: ArrayExpressionNode;
    index: number;
    element: Node;
  };
  const elements = array.elements;
  const realElements = elements.filter((e): e is Node => e !== null);

  if (realElements.length === 1) {
    // Sole element: also eat a trailing comma if the source has one (common
    // in multi-line arrays). Leaving it behind makes `[ , ]` — a hole — and
    // hands the parent a `[undefined]` children array, which crashes
    // downstream consumers that dereference `child.parentId`.
    let end = element.end;
    while (end < source.length && /\s/.test(source[end])) end++;
    if (source[end] === ',') end++;
    return { start: element.start, end };
  }

  // Find the index in the "real elements" sub-list. We treat null holes as
  // anchors that don't participate in comma-eating.
  const realIndex = realElements.indexOf(element);
  if (realIndex < realElements.length - 1) {
    // Non-last: extend forward to the next real element's start.
    return { start: element.start, end: realElements[realIndex + 1].start };
  }
  // Last real element: extend backward to the previous real element's end.
  return { start: realElements[realIndex - 1].end, end: element.end };
}

/**
 * Removes the enclosing statement that contains `callRange`, including its
 * leading indentation and a single trailing newline (so we don't leave a
 * blank line behind). Returns the source unchanged if no enclosing
 * statement is found.
 *
 * Honest caveat: if downstream code references a name introduced by the
 * deleted statement (e.g. deleting `const a = api.cabinet(...)` while a
 * sibling call still reads `a.params.width`), the resulting source will
 * throw at runtime. We surface the error via `RunResult.error`; the caller
 * is responsible for any cascade.
 */
export function removeCallStatement(source: string, callRange: SourceRange): string {
  // Children of `api.cabinet({ children: [...] })` aren't statements — they
  // live as array elements. Try the array-element path first so that
  // deleting a nested shelf removes just its slot, not the enclosing
  // cabinet's whole statement.
  const arrEl = findEnclosingArrayElement(source, callRange);
  if (arrEl) {
    return source.slice(0, arrEl.start) + source.slice(arrEl.end);
  }

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
