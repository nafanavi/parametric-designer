import { describe, it, expect } from 'vitest';
import {
  findCallProperties,
  rewriteCallProperty,
  findEnclosingStatement,
  removeCallStatement,
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

  it('rewrites an array literal value when a number[] is passed', () => {
    const src = `api.cabinet({ width: 800, position: [0, 0, 0] });`;
    const range = firstApiCallRange(src);
    expect(rewriteCallProperty(src, range, 'position', [100, 0, 200])).toBe(
      `api.cabinet({ width: 800, position: [100, 0, 200] });`,
    );
  });

  it('rewrites a non-array existing value (e.g. a `param()` call) with an array literal', () => {
    // Pathological but valid: the property was a function call returning an
    // array. The array rewrite still replaces just the value-range — the
    // function call disappears, replaced by an inline literal.
    const src = `api.cabinet({ position: param('xyz', [0, 0, 0]) });`;
    const range = firstApiCallRange(src);
    expect(rewriteCallProperty(src, range, 'position', [10, 20, 30])).toBe(
      `api.cabinet({ position: [10, 20, 30] });`,
    );
  });
});

describe('findEnclosingStatement', () => {
  it('finds an ExpressionStatement around a top-level call', () => {
    const src = `api.shelf({ y: 600 });`;
    const range = firstApiCallRange(src);
    const stmt = findEnclosingStatement(src, range);
    expect(stmt).toEqual({ start: 0, end: src.length });
  });

  it('finds a VariableDeclaration around `const cab = api.cabinet(...)`', () => {
    const src = `const cab = api.cabinet({ width: 800 });`;
    const range = firstApiCallRange(src);
    const stmt = findEnclosingStatement(src, range);
    expect(stmt).toEqual({ start: 0, end: src.length });
  });

  it('finds the innermost enclosing statement for nested calls', () => {
    // The shelf's enclosing statement is the inner ExpressionStatement,
    // not the outer VariableDeclaration that defines the helper.
    const src =
      `const helper = () => {\n` +
      `  api.shelf({ y: 600 });\n` +
      `};`;
    // `firstApiCallRange` walks the full AST and returns the first api.X call.
    const target = firstApiCallRange(src);
    const stmt = findEnclosingStatement(src, target);
    expect(stmt).not.toBeNull();
    expect(src.slice(stmt!.start, stmt!.end).trim()).toBe(`api.shelf({ y: 600 });`);
    // And it's shorter than the full helper declaration.
    expect(stmt!.end - stmt!.start).toBeLessThan(src.length);
  });

  it('returns null on parse failure', () => {
    expect(findEnclosingStatement(`api.shelf({`, { start: 0, end: 11 })).toBeNull();
  });
});

describe('removeCallStatement', () => {
  it('removes a single-line ExpressionStatement and its trailing newline', () => {
    const src =
      `api.cabinet({ width: 800 });\n` +
      `api.shelf({ y: 600 });\n` +
      `api.door({ side: 'left' });\n`;
    const shelfStart = src.indexOf('api.shelf');
    const shelfRange = { start: shelfStart, end: shelfStart + `api.shelf({ y: 600 })`.length };
    expect(removeCallStatement(src, shelfRange)).toBe(
      `api.cabinet({ width: 800 });\n` +
        `api.door({ side: 'left' });\n`,
    );
  });

  it('removes a multi-line VariableDeclaration with object-literal argument', () => {
    const src =
      `const a = api.cabinet({\n` +
      `  width: 800,\n` +
      `  height: 1800,\n` +
      `});\n` +
      `api.door({ side: 'left' });\n`;
    const cabStart = src.indexOf('api.cabinet');
    // The CallExpression range is just the api.cabinet({...}) span.
    // Find its end by counting matched braces.
    let depth = 0;
    let i = cabStart;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) { i++; break; }
      }
      i++;
    }
    const cabRange = { start: cabStart, end: i };
    const out = removeCallStatement(src, cabRange);
    // Everything from `const a = ` through `});` plus its trailing newline goes.
    expect(out).toBe(`api.door({ side: 'left' });\n`);
  });

  it('preserves indentation outside the deleted statement', () => {
    const src =
      `function build() {\n` +
      `  api.cabinet({ width: 800 });\n` +
      `  api.shelf({ y: 600 });\n` +
      `}\n`;
    const shelfStart = src.indexOf('api.shelf');
    const shelfRange = { start: shelfStart, end: shelfStart + `api.shelf({ y: 600 })`.length };
    expect(removeCallStatement(src, shelfRange)).toBe(
      `function build() {\n` +
        `  api.cabinet({ width: 800 });\n` +
        `}\n`,
    );
  });

  it('returns the source unchanged when no enclosing statement is found', () => {
    const src = `api.shelf({ y: 600 });`;
    expect(removeCallStatement(src, { start: 999, end: 9999 })).toBe(src);
  });

  it('returns the source unchanged on parse failure', () => {
    const src = `api.shelf({`;
    expect(removeCallStatement(src, { start: 0, end: src.length })).toBe(src);
  });

  // A whole-line scan must not eat sibling statements that share a line
  // with the target.
  it('does not eat sibling statements that share a line', () => {
    const src = `api.cabinet({ width: 800 }); api.shelf({ y: 600 });\n`;
    const cabStart = src.indexOf('api.cabinet');
    const cabRange = {
      start: cabStart,
      end: cabStart + `api.cabinet({ width: 800 })`.length,
    };
    const out = removeCallStatement(src, cabRange);
    // The shelf must survive.
    expect(out).toContain('api.shelf({ y: 600 })');
    // The cabinet declaration is gone.
    expect(out).not.toContain('api.cabinet');
  });

  // Deleting the braceless body of an if/while/for must not leave the control
  // attached to whatever comes next (which would silently rebind semantics).
  // The fix lifts the deletion to the parent.
  it('lifts the deletion past a braceless `if` body', () => {
    const src =
      `api.cabinet({ width: 800 });\n` +
      `if (someCond) api.shelf({ y: 600 });\n` +
      `api.door({ side: 'left' });\n`;
    const shelfStart = src.indexOf('api.shelf');
    const shelfRange = {
      start: shelfStart,
      end: shelfStart + `api.shelf({ y: 600 })`.length,
    };
    const out = removeCallStatement(src, shelfRange);
    // The whole `if (...) ...;` line is gone — the door is no longer conditional.
    expect(out).toBe(
      `api.cabinet({ width: 800 });\n` + `api.door({ side: 'left' });\n`,
    );
  });

  it('lifts the deletion past a braceless `while` body', () => {
    const src = `let i = 0;\nwhile (i < 3) api.shelf({ y: 100 * i++ });\n`;
    const shelfStart = src.indexOf('api.shelf');
    const shelfRange = {
      start: shelfStart,
      end: shelfStart + `api.shelf({ y: 100 * i++ })`.length,
    };
    const out = removeCallStatement(src, shelfRange);
    expect(out).toBe(`let i = 0;\n`);
  });

  it('does NOT lift when the body is wrapped in a block', () => {
    const src =
      `if (cond) {\n` +
      `  api.shelf({ y: 600 });\n` +
      `  api.door({ side: 'left' });\n` +
      `}\n`;
    const shelfStart = src.indexOf('api.shelf');
    const shelfRange = {
      start: shelfStart,
      end: shelfStart + `api.shelf({ y: 600 })`.length,
    };
    const out = removeCallStatement(src, shelfRange);
    // The if and the door are preserved; only the shelf line is gone.
    expect(out).toBe(
      `if (cond) {\n` + `  api.door({ side: 'left' });\n` + `}\n`,
    );
  });

  // Array-element delete: a child inside `api.cabinet({ children: [...] })`
  // should be removed from the array, not the whole enclosing statement.
  describe('children: [...] array elements', () => {
    it('removes a middle element and keeps siblings + the enclosing cabinet', () => {
      const src =
        `api.cabinet({\n` +
        `  width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0],\n` +
        `  children: [\n` +
        `    api.shelf({ y: 600 }),\n` +
        `    api.door({ side: 'left' }),\n` +
        `    api.door({ side: 'right' }),\n` +
        `  ],\n` +
        `});\n`;
      const leftStart = src.indexOf(`api.door({ side: 'left' })`);
      const leftRange = {
        start: leftStart,
        end: leftStart + `api.door({ side: 'left' })`.length,
      };
      const out = removeCallStatement(src, leftRange);
      expect(out).toContain('api.shelf({ y: 600 })');
      expect(out).toContain(`api.door({ side: 'right' })`);
      expect(out).not.toContain(`api.door({ side: 'left' })`);
      // Cabinet itself is preserved.
      expect(out).toContain('api.cabinet(');
    });

    it('removes the last element and consumes its preceding comma', () => {
      const src =
        `api.cabinet({\n` +
        `  width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0],\n` +
        `  children: [\n` +
        `    api.shelf({ y: 600 }),\n` +
        `    api.door({ side: 'right' }),\n` +
        `  ],\n` +
        `});\n`;
      const doorStart = src.indexOf(`api.door({ side: 'right' })`);
      const doorRange = {
        start: doorStart,
        end: doorStart + `api.door({ side: 'right' })`.length,
      };
      const out = removeCallStatement(src, doorRange);
      expect(out).toContain('api.shelf({ y: 600 })');
      expect(out).not.toContain(`api.door({ side: 'right' })`);
      expect(out).toContain('api.cabinet(');
    });

    it('removes a sole element from the children array', () => {
      const src =
        `api.cabinet({\n` +
        `  width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0],\n` +
        `  children: [api.shelf({ y: 600 })],\n` +
        `});\n`;
      const shelfStart = src.indexOf('api.shelf');
      const shelfRange = {
        start: shelfStart,
        end: shelfStart + `api.shelf({ y: 600 })`.length,
      };
      const out = removeCallStatement(src, shelfRange);
      expect(out).not.toContain('api.shelf');
      expect(out).toContain('api.cabinet(');
    });
  });
});
