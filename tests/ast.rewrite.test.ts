import { describe, it, expect } from 'vitest';
import {
  findCallProperties,
  rewriteCallProperty,
} from '@/model/ast/rewrite';
import { parseSource } from '@/model/ast/parse';

/**
 * Helper: parses `source`, walks to the first `api.X(...)` call, and returns
 * its source range. Used to feed the per-instance helpers without having to
 * eyeball offsets in test code.
 */
function firstApiCallRange(source: string): { start: number; end: number } {
  const ast = parseSource(source);
  if (!ast) throw new Error('parse failed');
  let found: { start: number; end: number } | null = null;
  // walk manually — keep it dependency-free in the test fixture.
  const visit = (n: { type?: string; start?: number; end?: number; [k: string]: unknown }): void => {
    if (found) return;
    if (
      n.type === 'CallExpression' &&
      (n.callee as { type?: string; object?: { type?: string; name?: string } } | undefined)?.type ===
        'MemberExpression' &&
      (n.callee as { object?: { type?: string; name?: string } }).object?.type === 'Identifier' &&
      (n.callee as { object?: { type?: string; name?: string } }).object?.name === 'api'
    ) {
      found = { start: n.start ?? 0, end: n.end ?? 0 };
      return;
    }
    for (const key of Object.keys(n)) {
      const val = n[key];
      if (val && typeof val === 'object') {
        if (Array.isArray(val)) {
          for (const item of val) {
            if (item && typeof item === 'object') visit(item as Parameters<typeof visit>[0]);
          }
        } else {
          visit(val as Parameters<typeof visit>[0]);
        }
      }
    }
  };
  visit(ast as unknown as Parameters<typeof visit>[0]);
  if (!found) throw new Error('no api.X call found');
  return found;
}

describe('findCallProperties', () => {
  it('lists every property of a call with its source range and current value', () => {
    const src = `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18 });`;
    const range = firstApiCallRange(src);
    const props = findCallProperties(src, range);

    expect(props.map((p) => p.name)).toEqual(['width', 'height', 'depth', 'thickness']);
    expect(props.map((p) => p.currentNumber)).toEqual([800, 1800, 400, 18]);

    // Each valueRange should slice back to exactly the literal text.
    for (const p of props) {
      const slice = src.slice(p.valueRange.start, p.valueRange.end);
      expect(slice).toBe(String(p.currentNumber));
    }
  });

  it('reads through param(name, default) and reports the literal default', () => {
    const src = `api.cabinet({ width: param('width', 800), height: 1800 });`;
    const range = firstApiCallRange(src);
    const props = findCallProperties(src, range);

    const width = props.find((p) => p.name === 'width')!;
    expect(width.currentNumber).toBe(800);
    // The full param(...) call is the value range, not just the literal.
    expect(src.slice(width.valueRange.start, width.valueRange.end)).toBe(`param('width', 800)`);
  });

  it('handles negative literals', () => {
    const src = `api.cabinet({ offset: -10 });`;
    const range = firstApiCallRange(src);
    const off = findCallProperties(src, range).find((p) => p.name === 'offset')!;
    expect(off.currentNumber).toBe(-10);
  });

  it('reports currentNumber=null for non-numeric or computed values', () => {
    const src = `api.cabinet({ side: 'left', width: 800 + 100, position: [0, 0, 0] });`;
    const range = firstApiCallRange(src);
    const props = findCallProperties(src, range);

    const byName = Object.fromEntries(props.map((p) => [p.name, p]));
    expect(byName.side.currentNumber).toBeNull();
    expect(byName.width.currentNumber).toBeNull();
    expect(byName.position.currentNumber).toBeNull();
  });

  it('returns [] for an unknown call range', () => {
    const src = `api.cabinet({ width: 800 });`;
    expect(findCallProperties(src, { start: 9999, end: 99999 })).toEqual([]);
  });

  it('returns [] on parse failure', () => {
    expect(findCallProperties(`api.cabinet({`, { start: 0, end: 13 })).toEqual([]);
  });
});

describe('rewriteCallProperty', () => {
  it('replaces a numeric literal at the property', () => {
    const src = `api.cabinet({ width: 800, height: 1800 });`;
    const range = firstApiCallRange(src);
    expect(rewriteCallProperty(src, range, 'width', 1200)).toBe(
      `api.cabinet({ width: 1200, height: 1800 });`,
    );
  });

  it('decouples from param(): replaces the whole param(...) call with a literal', () => {
    const src = `api.cabinet({ width: param('width', 800), height: 1800 });`;
    const range = firstApiCallRange(src);
    expect(rewriteCallProperty(src, range, 'width', 1200)).toBe(
      `api.cabinet({ width: 1200, height: 1800 });`,
    );
  });

  it('preserves surrounding whitespace and other properties', () => {
    const src = `api.cabinet({\n  width:   800,\n  height:  1800,\n});`;
    const range = firstApiCallRange(src);
    // Only the literal `800` slot changes; the indentation/spacing stays.
    expect(rewriteCallProperty(src, range, 'width', 1200)).toBe(
      `api.cabinet({\n  width:   1200,\n  height:  1800,\n});`,
    );
  });

  it('only affects the call at the given range, not other identical calls', () => {
    const src =
      `api.cabinet({ width: 800 });\n` +
      `api.cabinet({ width: 800 });\n` +
      `api.cabinet({ width: 800 });`;
    // Grab the SECOND call's range (skip past the first).
    const secondStart = src.indexOf('api.cabinet', 1);
    const secondRange = { start: secondStart, end: secondStart + 'api.cabinet({ width: 800 })'.length };
    const out = rewriteCallProperty(src, secondRange, 'width', 1200);
    expect(out).toBe(
      `api.cabinet({ width: 800 });\n` +
        `api.cabinet({ width: 1200 });\n` +
        `api.cabinet({ width: 800 });`,
    );
  });

  it('returns the source unchanged when the property is missing', () => {
    const src = `api.cabinet({ width: 800 });`;
    const range = firstApiCallRange(src);
    expect(rewriteCallProperty(src, range, 'height', 1800)).toBe(src);
  });

  it('returns the source unchanged for unparseable input', () => {
    const src = `api.cabinet({ width:`;
    expect(rewriteCallProperty(src, { start: 0, end: src.length }, 'width', 1200)).toBe(src);
  });
});
