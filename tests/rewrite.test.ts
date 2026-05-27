import { describe, it, expect } from 'vitest';
import { rewriteParamDefault, hasRewritableParam } from '@/model/rewrite';

describe('rewriteParamDefault', () => {
  it('replaces a single-quoted param default with the new value', () => {
    const src = `api.cabinet({ width: param('width', 800) });`;
    expect(rewriteParamDefault(src, 'width', 1200)).toBe(
      `api.cabinet({ width: param('width', 1200) });`,
    );
  });

  it('replaces a double-quoted param default', () => {
    const src = `api.cabinet({ width: param("width", 800) });`;
    expect(rewriteParamDefault(src, 'width', 1200)).toBe(
      `api.cabinet({ width: param('width', 1200) });`,
    );
  });

  it('tolerates extra whitespace inside the param call', () => {
    const src = `param(  'depth' ,   400   )`;
    expect(rewriteParamDefault(src, 'depth', 500)).toBe(`param('depth', 500)`);
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
});
