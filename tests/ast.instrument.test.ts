import { describe, it, expect } from 'vitest';
import { instrumentApiCalls } from '@/model/ast/instrument';

describe('instrumentApiCalls', () => {
  it('wraps a single api.cabinet call with __withLoc preserving the original call text', () => {
    const src = `api.cabinet({ width: 800 });`;
    const out = instrumentApiCalls(src);
    // Original call text appears verbatim inside the wrap.
    expect(out).toContain('api.cabinet({ width: 800 })');
    expect(out).toContain('__withLoc(');
    expect(out).toContain(',()=>api.cabinet({ width: 800 })');
  });

  it('emits ranges that point back at the original call text', () => {
    const src = `api.cabinet({ width: 800 });`;
    const callStart = src.indexOf('api.cabinet');
    const callEnd = src.indexOf(')') + 1;
    const out = instrumentApiCalls(src);
    expect(out).toContain(`__withLoc(${callStart},${callEnd},`);
    // Original slice matches what we wrap.
    expect(src.slice(callStart, callEnd)).toBe('api.cabinet({ width: 800 })');
  });

  it('wraps every api.X call, leaving non-api calls untouched', () => {
    const src =
      `api.cabinet({ width: 800 });\n` +
      `api.shelf({ y: 600 });\n` +
      `unrelated();\n`;
    const out = instrumentApiCalls(src);
    expect(out).toContain('__withLoc');
    // Cabinet and shelf both wrapped.
    expect(out.match(/__withLoc\(/g)?.length).toBe(2);
    // `unrelated()` left alone — its text appears un-wrapped.
    expect(out).toContain('unrelated();');
    expect(out).not.toContain('__withLoc(.+unrelated');
  });

  it('handles nested api calls — outer and inner are both wrapped', () => {
    const src = `api.cabinet({ extra: api.helper() });`;
    const out = instrumentApiCalls(src);
    expect(out.match(/__withLoc\(/g)?.length).toBe(2);
  });

  it('returns the source unchanged when there are no api calls', () => {
    const src = `const x = 1; foo(); bar.baz();`;
    expect(instrumentApiCalls(src)).toBe(src);
  });

  it('returns the source unchanged on parse failure', () => {
    const src = `api.cabinet({ width:`; // unterminated
    expect(instrumentApiCalls(src)).toBe(src);
  });

  it('does not wrap bare `api(...)` or computed access `api[name](...)`', () => {
    const src = `api(); api['cabinet']({});`;
    const out = instrumentApiCalls(src);
    expect(out).toBe(src);
  });

  it('produces source that parses again', () => {
    const src = `
      api.cabinet({
        width: 800,
        children: [
          api.shelf({ y: 600 }),
          api.door({ side: 'left' }),
        ],
      });
    `;
    const out = instrumentApiCalls(src);
    // The instrumented output must be valid JS — sanity check via new Function.
    expect(() => new Function('api', '__withLoc', out)).not.toThrow();
  });
});
