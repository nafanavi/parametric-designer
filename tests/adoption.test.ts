import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock repair so adoption commits don't drift into the LLM branch.
const repairMock = vi.hoisted(() => vi.fn());
vi.mock('@/model/repair', () => ({ repairSource: repairMock }));

import {
  findChildrenArrayRange,
  insertArrayElement,
} from '@/model/ast/rewrite';
import { runModel } from '@/model/runtime';
import { queryOf } from '@/model/scene/query';
import {
  findCabinetUnderRay,
  snapToCabinetInterior,
  snippetForAdoption,
} from '@/viewer/dragController';
import { useModelStore } from '@/store/modelStore';
import { CATALOG_ITEMS } from '@/editor/catalog';

/**
 * Find the first `api.cabinet(...)` call's byte range by matching balanced
 * parens. Pragmatic test helper — the AST helpers under test do their own
 * proper parsing.
 */
function firstCabinetCallRange(src: string): { start: number; end: number } {
  const start = src.indexOf('api.cabinet');
  if (start < 0) throw new Error('no api.cabinet call found');
  let i = src.indexOf('(', start);
  let depth = 1;
  i++;
  while (i < src.length && depth > 0) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') depth--;
    i++;
  }
  return { start, end: i };
}

describe('findChildrenArrayRange', () => {
  it('returns the byte range of `children: [...]` inclusive of brackets', () => {
    const src = `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, children: [] });`;
    const cab = firstCabinetCallRange(src);
    const r = findChildrenArrayRange(src, cab);
    expect(r).not.toBeNull();
    expect(src[r!.start]).toBe('[');
    expect(src[r!.end - 1]).toBe(']');
  });

  it('returns null when the call has no `children` field', () => {
    const src = `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18 });`;
    const cab = firstCabinetCallRange(src);
    expect(findChildrenArrayRange(src, cab)).toBeNull();
  });

  it('returns null when `children` is not an array literal', () => {
    const src = `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, children: makeChildren() });`;
    const cab = firstCabinetCallRange(src);
    expect(findChildrenArrayRange(src, cab)).toBeNull();
  });
});

describe('insertArrayElement', () => {
  it('inserts into an empty `[]`', () => {
    const src = `api.cabinet({ width: 800, children: [] });`;
    const cab = firstCabinetCallRange(src);
    const arr = findChildrenArrayRange(src, cab)!;
    expect(insertArrayElement(src, arr, `api.shelf({ y: 600 })`)).toBe(
      `api.cabinet({ width: 800, children: [api.shelf({ y: 600 })] });`,
    );
  });

  it('inserts into an inline `[ a ]`', () => {
    const src = `api.cabinet({ width: 800, children: [api.shelf({ y: 600 })] });`;
    const cab = firstCabinetCallRange(src);
    const arr = findChildrenArrayRange(src, cab)!;
    expect(insertArrayElement(src, arr, `api.door({ side: 'left' })`)).toBe(
      `api.cabinet({ width: 800, children: [api.shelf({ y: 600 }), api.door({ side: 'left' })] });`,
    );
  });

  it('inserts onto a new line in a multi-line array, matching the existing indent', () => {
    const src =
      `api.cabinet({\n` +
      `  width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0],\n` +
      `  children: [\n` +
      `    api.shelf({ y: 600 }),\n` +
      `  ],\n` +
      `});\n`;
    const cab = firstCabinetCallRange(src);
    const arr = findChildrenArrayRange(src, cab)!;
    const out = insertArrayElement(src, arr, `api.door({ side: 'left' })`);
    expect(out).toContain('api.shelf({ y: 600 }),');
    expect(out).toContain(`api.door({ side: 'left' }),`);
    // Source still runs cleanly.
    const result = runModel(out);
    expect(result.error).toBeUndefined();
    const cabNode = result.nodes[0];
    if (cabNode.type !== 'cabinet') throw new Error('expected cabinet');
    expect(cabNode.children.filter((c) => c.type === 'shelf')).toHaveLength(1);
    expect(cabNode.children.filter((c) => c.type === 'door')).toHaveLength(1);
  });
});

describe('findCabinetUnderRay', () => {
  const TWO_CABS = `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0], children: [] });
api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [1500, 0, 1000], children: [] });`;

  const downRay = (x: number, z: number) =>
    ({ origin: [x, 10000, z] as const, dir: [0, -1, 0] as const });

  it('finds the cabinet whose footprint the ray passes through', () => {
    const result = runModel(TWO_CABS);
    const query = queryOf(result);
    const cabs = result.nodes.filter((n) => n.type === 'cabinet');
    const a = downRay(0, 0);
    const b = downRay(1500, 1000);
    expect(findCabinetUnderRay(result, query, a.origin, a.dir)?.id).toBe(cabs[0].id);
    expect(findCabinetUnderRay(result, query, b.origin, b.dir)?.id).toBe(cabs[1].id);
  });

  it('returns null when the ray misses every cabinet', () => {
    const result = runModel(TWO_CABS);
    const query = queryOf(result);
    const r = downRay(700, 0);
    expect(findCabinetUnderRay(result, query, r.origin, r.dir)).toBeNull();
  });

  it('honours excludeId', () => {
    const result = runModel(TWO_CABS);
    const query = queryOf(result);
    const cab0 = result.nodes[0];
    const r = downRay(0, 0);
    expect(findCabinetUnderRay(result, query, r.origin, r.dir, cab0.id)).toBeNull();
  });

  it('picks the nearer cabinet when the ray passes through both (front-to-back)', () => {
    const result = runModel(TWO_CABS);
    const query = queryOf(result);
    const cabs = result.nodes.filter((n) => n.type === 'cabinet');
    const cab0 = cabs.find((c) => c.type === 'cabinet' && c.params.position[0] === 0)!;
    const aimAt0 = findCabinetUnderRay(
      result,
      query,
      [-5000, 900, 0],
      [1, 0, 0],
    );
    expect(aimAt0?.id).toBe(cab0.id);
    const cab1 = cabs.find((c) => c.type === 'cabinet' && c.params.position[0] === 1500)!;
    const aimAt1 = findCabinetUnderRay(
      result,
      query,
      [800, 900, 1000],
      [1, 0, 0],
    );
    expect(aimAt1?.id).toBe(cab1.id);
  });

  it('reports the world Y where the ray first pierces the cabinet', () => {
    const result = runModel(TWO_CABS);
    const query = queryOf(result);
    // Down-ray over cab0 — top face is at y = height = 1800.
    const hit = findCabinetUnderRay(result, query, [0, 10000, 0], [0, -1, 0]);
    expect(hit?.entryY).toBe(1800);
    // Horizontal +X ray at y=900 — enters cab0's left wall at x = -400.
    // Entry Y equals the ray's Y at entry, which is 900 throughout.
    const side = findCabinetUnderRay(result, query, [-5000, 900, 0], [1, 0, 0]);
    expect(side?.entryY).toBe(900);
  });
});

describe('snapToCabinetInterior', () => {
  it('centres XZ on the cabinet position and clamps Y to interior', () => {
    const result = runModel(
      `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [100, 50, 200], children: [] });`,
    );
    const cab = result.nodes[0];
    if (cab.type !== 'cabinet') throw new Error('expected cabinet');
    // Cursor world Y way past the interior top → snaps to interior max.
    const snapped = snapToCabinetInterior(cab, queryOf(result), 99999);
    expect(snapped[0]).toBe(100); // cabinet x
    expect(snapped[2]).toBe(200); // cabinet z
    const halfT = 9;
    expect(snapped[1]).toBe(50 + 1800 - 18 - halfT); // interior max in WORLD coords
  });
});

describe('moveSelectionIntoCabinet — combined remove + insert in one commit', () => {
  beforeEach(() => repairMock.mockReset());

  it('moves a top-level shelf into a cabinet that comes AFTER it in source', () => {
    const SRC =
      `api.shelf({ y: 0, position: [200, 600, 100] });\n` +
      `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0], children: [] });\n`;
    useModelStore.setState({ source: SRC, selection: null, result: runModel(SRC), isRepairing: false });

    const result = useModelStore.getState().result;
    const cab = result.nodes.find((n) => n.type === 'cabinet')!;
    const shelf = result.nodes.find((n) => n.type === 'shelf')!;
    useModelStore.getState().select(shelf.id);

    return useModelStore.getState().moveSelectionIntoCabinet(cab.id, `api.shelf({ y: 600 })`).then(() => {
      const after = useModelStore.getState();
      expect(after.result.error).toBeUndefined();
      // Top-level shelf is gone.
      expect(after.result.nodes.filter((n) => n.type === 'shelf')).toHaveLength(0);
      // Cabinet now has a shelf child.
      const cabAfter = after.result.nodes.find((n) => n.type === 'cabinet')!;
      if (cabAfter.type !== 'cabinet') throw new Error('expected cabinet');
      const shelfChild = cabAfter.children.find((c) => c.type === 'shelf');
      expect(shelfChild).toBeDefined();
      expect(shelfChild!.parentId).toBe(cabAfter.id);
    });
  });

  it('moves a top-level shelf into a cabinet that comes BEFORE it in source', () => {
    const SRC =
      `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0], children: [] });\n` +
      `api.shelf({ y: 0, position: [200, 600, 100] });\n`;
    useModelStore.setState({ source: SRC, selection: null, result: runModel(SRC), isRepairing: false });

    const result = useModelStore.getState().result;
    const cab = result.nodes.find((n) => n.type === 'cabinet')!;
    const shelf = result.nodes.find((n) => n.type === 'shelf')!;
    useModelStore.getState().select(shelf.id);

    return useModelStore.getState().moveSelectionIntoCabinet(cab.id, `api.shelf({ y: 800 })`).then(() => {
      const after = useModelStore.getState();
      expect(after.result.error).toBeUndefined();
      expect(after.result.nodes.filter((n) => n.type === 'shelf')).toHaveLength(0);
      const cabAfter = after.result.nodes.find((n) => n.type === 'cabinet')!;
      if (cabAfter.type !== 'cabinet') throw new Error('expected cabinet');
      expect(cabAfter.children.find((c) => c.type === 'shelf')).toBeDefined();
    });
  });

  it('no-ops when the target cabinet has no children array literal in source', () => {
    const SRC =
      `api.shelf({ y: 0, position: [200, 600, 100] });\n` +
      `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0] });\n`;
    useModelStore.setState({ source: SRC, selection: null, result: runModel(SRC), isRepairing: false });

    const before = useModelStore.getState().source;
    const cab = useModelStore.getState().result.nodes.find((n) => n.type === 'cabinet')!;
    const shelf = useModelStore.getState().result.nodes.find((n) => n.type === 'shelf')!;
    useModelStore.getState().select(shelf.id);

    return useModelStore.getState().moveSelectionIntoCabinet(cab.id, `api.shelf({ y: 600 })`).then(() => {
      expect(useModelStore.getState().source).toBe(before);
    });
  });
});

describe('snippetForAdoption derived from live node', () => {
  it('shelf preserves the inset the user set on the standalone form', () => {
    // Live shelf with inset=50 (e.g. user authored or property-panel-edited).
    const src = `api.shelf({ y: 0, position: [100, 600, 50], inset: 50 });`;
    const result = runModel(src);
    expect(result.error).toBeUndefined();
    const shelf = result.nodes[0];
    if (shelf.type !== 'shelf') throw new Error('expected shelf');
    const snippet = snippetForAdoption(shelf, 800)!;
    expect(snippet).toContain('y: 800');
    expect(snippet).toContain('inset: 50');
  });

  it('door preserves the side the user selected', () => {
    const src = `api.door({ side: 'right', position: [100, 900, 50] });`;
    const result = runModel(src);
    const door = result.nodes[0];
    if (door.type !== 'door') throw new Error('expected door');
    const snippet = snippetForAdoption(door, 0)!;
    expect(snippet).toContain(`side: 'right'`);
  });

  it('drawer preserves height', () => {
    const src = `api.drawer({ y: 0, height: 350, position: [100, 175, 50] });`;
    const result = runModel(src);
    const drawer = result.nodes[0];
    if (drawer.type !== 'drawer') throw new Error('expected drawer');
    const snippet = snippetForAdoption(drawer, 400)!;
    expect(snippet).toContain('y: 400');
    expect(snippet).toContain('height: 350');
  });

  it('returns null for cabinet and panel (non-adoptable types)', () => {
    const src =
      `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0] });\n` +
      `api.panel({ width: 600, height: 1200, thickness: 18, position: [0, 0, 0] });`;
    const result = runModel(src);
    const cab = result.nodes.find((n) => n.type === 'cabinet')!;
    const panel = result.nodes.find((n) => n.type === 'panel')!;
    expect(snippetForAdoption(cab, 0)).toBeNull();
    expect(snippetForAdoption(panel, 0)).toBeNull();
  });

  it('every adoptable catalog item produces a snippet that runs inside a cabinet', () => {
    for (const item of CATALOG_ITEMS) {
      if (!item.adoptable) continue;
      // Materialise the item via its top-level code so we get a live node
      // with an `adoptionInput` populated, then derive its child snippet.
      const topLevel = item.code(100, item.defaultSize[1] / 2, 50);
      const initial = runModel(topLevel);
      expect(initial.error).toBeUndefined();
      const node = initial.nodes[0];
      const snippet = snippetForAdoption(node, 600)!;
      const src = `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0], children: [${snippet}] });`;
      const result = runModel(src);
      expect(result.error, `${item.id}: ${result.error}`).toBeUndefined();
      const cab = result.nodes[0];
      if (cab.type !== 'cabinet') throw new Error('expected cabinet');
      expect(cab.children.find((c) => c.type === item.nodeType)).toBeDefined();
    }
  });

  it('non-adoptable items have adoptable === false', () => {
    const cab = CATALOG_ITEMS.find((c) => c.id === 'cabinet-800')!;
    const panel = CATALOG_ITEMS.find((c) => c.id === 'panel-600')!;
    expect(cab.adoptable).toBe(false);
    expect(panel.adoptable).toBe(false);
  });
});
