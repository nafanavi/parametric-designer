import { describe, it, expect } from 'vitest';
import { runModel } from '@/model/runtime';

describe('runtime — modern JS in model source', () => {
  it('supports function declarations + for loops + closures over api/param', () => {
    const source = `
      function createNCabs(n, step) {
        for (let i = 0; i < n; i++) {
          api.cabinet({
            width: param('width', 800),
            height: param('height', 1800),
            depth: param('depth', 400),
            thickness: 18,
            position: [i * step, 0, 0],
          });
        }
      }
      createNCabs(4, 1000);
    `;

    const result = runModel(source);

    expect(result.error).toBeUndefined();
    const cabinets = result.nodes.filter((n) => n.type === 'cabinet');
    expect(cabinets).toHaveLength(4);

    const xs = cabinets.map((c) => (c.type === 'cabinet' ? c.params.position[0] : NaN));
    expect(xs).toEqual([0, 1000, 2000, 3000]);

    // param() in a loop registers once and shares the value across iterations.
    expect(result.params.get('width')?.value).toBe(800);
  });

  it('supports arrow functions, const, array methods, and template literals', () => {
    const source = `
      const widths = [600, 800, 1000];
      widths.forEach((w, i) => {
        api.cabinet({
          width: w,
          height: 1800,
          depth: 400,
          thickness: 18,
          position: [i * 1200, 0, 0],
        });
      });
    `;

    const result = runModel(source);

    expect(result.error).toBeUndefined();
    const cabinets = result.nodes.filter((n) => n.type === 'cabinet');
    expect(cabinets).toHaveLength(3);
    const ws = cabinets.map((c) => (c.type === 'cabinet' ? c.params.width : NaN));
    expect(ws).toEqual([600, 800, 1000]);
  });

  it('supports destructuring, spread, and helper composition', () => {
    const source = `
      const base = { thickness: 18, height: 1800, depth: 400 };
      const at = (x) => ({ ...base, width: 800, position: [x, 0, 0] });
      [0, 1000, 2000].map(at).forEach((p) => api.cabinet(p));
    `;

    const result = runModel(source);

    expect(result.error).toBeUndefined();
    expect(result.nodes.filter((n) => n.type === 'cabinet')).toHaveLength(3);
  });

  it('supports the compositional shelf/door API with `in:` references', () => {
    const source = `
      const cab = api.cabinet({
        width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0],
      });
      api.shelf({ in: cab, y: 600 });
      api.shelf({ in: cab, y: 1200 });
      api.door({ in: cab, side: 'left' });
      api.door({ in: cab, side: 'right' });
    `;

    const result = runModel(source);

    expect(result.error).toBeUndefined();
    const cabinets = result.nodes.filter((n) => n.type === 'cabinet');
    expect(cabinets).toHaveLength(1);
    const cab = cabinets[0]!;
    // 5 frame panels + 2 shelves + 2 doors as children.
    expect(cab.children.filter((c) => c.type === 'panel')).toHaveLength(5);
    expect(cab.children.filter((c) => c.type === 'shelf')).toHaveLength(2);
    expect(cab.children.filter((c) => c.type === 'door')).toHaveLength(2);
  });

  it('reports a runtime error from inside a loop without crashing', () => {
    const source = `
      for (let i = 0; i < 3; i++) {
        if (i === 2) throw new Error('boom');
        api.cabinet({
          width: 800, height: 1800, depth: 400, thickness: 18,
          position: [i * 1000, 0, 0],
        });
      }
    `;

    const result = runModel(source);

    expect(result.error).toBe('boom');
    // The two cabinets created before the throw are still in the tree.
    expect(result.nodes.filter((n) => n.type === 'cabinet')).toHaveLength(2);
  });

  it('rejects shelf/door/drawer when `in:` is not a cabinet', () => {
    const source = `api.shelf({ in: { type: 'panel', params: {} }, y: 100 });`;
    const result = runModel(source);
    expect(result.error).toMatch(/cabinet/);
  });
});
