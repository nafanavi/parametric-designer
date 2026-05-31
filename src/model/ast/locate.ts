import { simple as walkSimple } from 'acorn-walk';
import type { Node } from 'acorn';
import { parseSource } from './parse';

export interface Range {
  readonly start: number;
  readonly end: number;
}

interface CallExpressionNode extends Node {
  type: 'CallExpression';
  callee: Node & { type?: string; name?: string };
  arguments: ArgNode[];
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

type ArgNode = LiteralNode | UnaryExpressionNode | Node;

/**
 * Returns the source ranges of the *second argument* of every
 * `param('<name>', <numeric-literal>)` call in the source.
 *
 * Only matches calls whose second argument is a numeric literal or a unary
 * negation of one (so `-10` works). Computed defaults like `800 + 100`
 * are deliberately left out — we can't safely substitute a number there
 * without changing semantics.
 *
 * Returns `[]` on parse failure (graceful no-op).
 */
export function findParamLiteralRanges(source: string, name: string): Range[] {
  const ast = parseSource(source);
  if (!ast) return [];

  const ranges: Range[] = [];

  walkSimple(ast, {
    CallExpression(node) {
      const call = node as CallExpressionNode;
      if (
        call.callee.type !== 'Identifier' ||
        call.callee.name !== 'param' ||
        call.arguments.length < 2
      ) {
        return;
      }
      const first = call.arguments[0];
      if (!isStringLiteral(first) || first.value !== name) return;

      const second = call.arguments[1];
      if (!isNumericLiteralOrNegation(second)) return;

      const start = (second as Node).start;
      const end = (second as Node).end;
      if (typeof start === 'number' && typeof end === 'number') {
        ranges.push({ start, end });
      }
    },
  });

  return ranges;
}

function isStringLiteral(node: Node | undefined): node is LiteralNode {
  if (!node || node.type !== 'Literal') return false;
  return typeof (node as LiteralNode).value === 'string';
}

function isNumericLiteralOrNegation(node: Node | undefined): boolean {
  if (!node) return false;
  if (node.type === 'Literal' && typeof (node as LiteralNode).value === 'number') {
    return true;
  }
  if (node.type === 'UnaryExpression') {
    const u = node as UnaryExpressionNode;
    return (
      u.operator === '-' &&
      u.argument.type === 'Literal' &&
      typeof (u.argument as LiteralNode).value === 'number'
    );
  }
  return false;
}
