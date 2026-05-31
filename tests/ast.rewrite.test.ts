import { describe, it, expect } from 'vitest';
import { rewriteParamDefault, hasRewritableParam } from '@/model/ast/rewrite';

describe('rewriteParamDefault (AST-located byte edits)', () => {
  it('replaces a single-quoted param default with the new value', () => {
    const src = `api.cabinet({ width: param('width', 800) });`;
    expect(rewriteParamDefault(src, 'width', 1200)).toBe(
      `api.cabinet({ width: param('width', 1200) });`,
    );
  });

  it('replaces a double-quoted param default — preserves the original quotes', () => {
    const src = `api.cabinet({ width: param("width", 800) });`;
    // Byte-edit only touches the literal; surrounding text (incl. quote style) is preserved.
    expect(rewriteParamDefault(src, 'width', 1200)).toBe(
      `api.cabinet({ width: param("width", 1200) });`,
    );
  });

  it('preserves surrounding whitespace exactly', () => {
    const src = `param(  'depth' ,   400   )`;
    // Old regex implementation collapsed whitespace; AST byte-edit leaves it alone.
    expect(rewriteParamDefault(src, 'depth', 500)).toBe(`param(  'depth' ,   500   )`);
  });

  it('handles negative current defaults', () => {
    const src = `param('offset', -10)`;
    expect(rewriteParamDefault(src, 'offset', 25)).toBe(`param('offset', 25)`);
  });

  it('handles decimal current defaults', () => {
    const src = `param('ratio', 0.5)`;
    expect(rewriteParamDefault(src, 'ratio', 0.75)).toBe(`param('ratio', 0.75)`);
  });

  it('rewrites all occurrences of the same name', () => {
    const src = `param('w', 100); param('w', 200);`;
    expect(rewriteParamDefault(src, 'w', 999)).toBe(`param('w', 999); param('w', 999);`);
  });

  it('leaves unrelated params untouched', () => {
    const src = `param('width', 800); param('height', 1800);`;
    expect(rewriteParamDefault(src, 'width', 900)).toBe(
      `param('width', 900); param('height', 1800);`,
    );
  });

  it('does not match a param name that is only a prefix substring', () => {
    const src = `param('widthCm', 80)`;
    expect(rewriteParamDefault(src, 'width', 900)).toBe(`param('widthCm', 80)`);
  });

  it('returns the source unchanged when the param is not declared', () => {
    const src = `api.cabinet({ width: 800 });`;
    expect(rewriteParamDefault(src, 'width', 1200)).toBe(src);
  });

  it('does not rewrite param calls whose default is an expression', () => {
    const src = `param('width', 800 + 100)`;
    // Computed default — ambiguous to edit literally, so we leave it alone.
    expect(rewriteParamDefault(src, 'width', 1200)).toBe(src);
  });

  // ─── New cases the regex implementation got wrong ───

  it('does not match a param call inside a single-line comment', () => {
    const src = `// param('width', 800)\nparam('width', 100);`;
    const out = rewriteParamDefault(src, 'width', 999);
    // The comment must stay verbatim; only the real call gets rewritten.
    expect(out).toBe(`// param('width', 800)\nparam('width', 999);`);
  });

  it('does not match a param call inside a block comment', () => {
    const src = `/* param('width', 800) */\nparam('width', 100);`;
    const out = rewriteParamDefault(src, 'width', 999);
    expect(out).toBe(`/* param('width', 800) */\nparam('width', 999);`);
  });

  it('does not match a param call inside a string literal', () => {
    const src = `const note = "use param('width', 999)";\nparam('width', 100);`;
    const out = rewriteParamDefault(src, 'width', 999);
    expect(out).toBe(`const note = "use param('width', 999)";\nparam('width', 999);`);
  });

  it('handles multi-line param calls', () => {
    const src = `param(\n  'width',\n  800\n);`;
    expect(rewriteParamDefault(src, 'width', 1200)).toBe(`param(\n  'width',\n  1200\n);`);
  });

  it('rewrites only the literal-default call when literal and computed share a name', () => {
    const src = `param('w', 100); param('w', 800 + 100);`;
    const out = rewriteParamDefault(src, 'w', 999);
    expect(out).toBe(`param('w', 999); param('w', 800 + 100);`);
  });

  it('returns the source unchanged when parsing fails', () => {
    // Half-typed source from the editor textarea.
    const src = `api.cabinet({ width: param('width', 800),`; // unclosed
    expect(rewriteParamDefault(src, 'width', 1200)).toBe(src);
  });
});

describe('hasRewritableParam', () => {
  it('returns true for a literal-default param call', () => {
    expect(hasRewritableParam(`param('w', 10)`, 'w')).toBe(true);
  });

  it('returns false when the name is absent', () => {
    expect(hasRewritableParam(`param('h', 10)`, 'w')).toBe(false);
  });

  it('returns false when the default is non-literal', () => {
    expect(hasRewritableParam(`param('w', 10 + 1)`, 'w')).toBe(false);
  });

  it('returns false for matches that only appear in comments', () => {
    expect(hasRewritableParam(`// param('w', 10)`, 'w')).toBe(false);
  });

  it('returns false when parsing fails', () => {
    expect(hasRewritableParam(`param('w', 10`, 'w')).toBe(false);
  });
});
