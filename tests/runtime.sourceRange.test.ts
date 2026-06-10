import { describe, it, expect } from 'vitest';
import { runModel } from '@/model/runtime';
import type { SceneNode } from '@/domain/cabinet/types';

function walkAll(nodes: readonly SceneNode[]): SceneNode[] {
  const out: SceneNode[] = [];
  const visit = (ns: readonly SceneNode[]) => {
    for (const n of ns) {
      out.push(n);
      visit(n.children);
    }
  };
  visit(nodes);
  return out;
}

describe('sourceRange threading through the runtime', () => {
  it('attaches sourceRange to every cabinet/shelf/door created via api.X', () => {
    const source = `
api.cabinet({
  width: 800, height: 1800, depth: 400, thickness: 18,
  children: [
    api.shelf({ y: 600 }),
    api.door({ side: 'left' }),
  ],
});
`;
    const result = runModel(source);
    expect(result.error).toBeUndefined();

    const cab = result.nodes.find((n) => n.type === 'cabinet')!;
    expect(cab.sourceRange).toBeDefined();
    expect(source.slice(cab.sourceRange!.start, cab.sourceRange!.end)).toMatch(
      /^api\.cabinet\(\{[\s\S]*children:[\s\S]*\}\)$/,
    );

    const shelf = walkAll(result.nodes).find((n) => n.type === 'shelf')!;
    expect(shelf.sourceRange).toBeDefined();
    expect(source.slice(shelf.sourceRange!.start, shelf.sourceRange!.end)).toBe(
      'api.shelf({ y: 600 })',
    );

    const door = walkAll(result.nodes).find((n) => n.type === 'door')!;
    expect(door.sourceRange).toBeDefined();
    expect(source.slice(door.sourceRange!.start, door.sourceRange!.end)).toBe(
      "api.door({ side: 'left' })",
    );
  });

  it('frame panels inherit the cabinet call source range', () => {
    const source = `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18 });`;
    const result = runModel(source);
    const cab = result.nodes[0]!;
    const framePanels = cab.children.filter((c) => c.type === 'panel');
    expect(framePanels).toHaveLength(5);
    for (const panel of framePanels) {
      expect(panel.sourceRange).toEqual(cab.sourceRange);
    }
  });

  it('each call in a loop gets its OWN sourceRange — the same one, since they come from the same line', () => {
    const source = `
for (let i = 0; i < 3; i++) {
  api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [i * 1000, 0, 0] });
}
`;
    const result = runModel(source);
    const cabinets = result.nodes.filter((n) => n.type === 'cabinet');
    expect(cabinets).toHaveLength(3);
    const ranges = cabinets.map((c) => c.sourceRange);
    expect(ranges[0]).toEqual(ranges[1]);
    expect(ranges[1]).toEqual(ranges[2]);
    expect(ranges[0]).toBeDefined();
  });

  it('nested api calls each report their own range', () => {
    // Synthetic: `api.cabinet({extra: api.panel(...)})` — both should resolve
    // independently. We can't actually nest in our cabinet API (cabinet won't
    // accept `extra`), so we exercise the wrapper directly via an instrumented
    // source that uses both `api.cabinet` and `api.panel`.
    const source = `
api.panel({ width: 100, height: 100, thickness: 10, position: [0, 0, 0] });
api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18 });
`;
    const result = runModel(source);
    const panel = result.nodes.find((n) => n.type === 'panel')!;
    const cabinet = result.nodes.find((n) => n.type === 'cabinet')!;
    expect(panel.sourceRange).toBeDefined();
    expect(cabinet.sourceRange).toBeDefined();
    expect(panel.sourceRange).not.toEqual(cabinet.sourceRange);
    // Each range slices to the correct call text.
    expect(source.slice(panel.sourceRange!.start, panel.sourceRange!.end)).toMatch(/^api\.panel\(/);
    expect(source.slice(cabinet.sourceRange!.start, cabinet.sourceRange!.end)).toMatch(/^api\.cabinet\(/);
  });
});
