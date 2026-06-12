import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock repair so adoption commits don't drift into the LLM branch.
const repairMock = vi.hoisted(() => vi.fn());
vi.mock('@/model/repair', () => ({ repairSource: repairMock }));

import {
  findChildrenArrayRange,
  insertArrayElement,
} from '@/model/ast/rewrite';
import { runModel } from '@/model/runtime';
import {
  findCabinetUnderCursor,
  snapToCabinetInterior,
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

describe('findCabinetUnderCursor', () => {
  const TWO_CABS = `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0], children: [] });
api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [1500, 0, 1000], children: [] });`;

  it('returns the cabinet id whose XZ footprint contains the cursor', () => {
    const result = runModel(TWO_CABS);
    const cabs = result.nodes.filter((n) => n.type === 'cabinet');
    expect(findCabinetUnderCursor(result, 0, 0)).toBe(cabs[0].id);
    expect(findCabinetUnderCursor(result, 1500, 1000)).toBe(cabs[1].id);
  });

  it('returns null when the cursor sits between cabinets', () => {
    const result = runModel(TWO_CABS);
    expect(findCabinetUnderCursor(result, 700, 0)).toBeNull(); // gap between cab[0] right edge (400) and cab[1] left edge (1100)
  });

  it('honours excludeId — a part dragged inside its own footprint never finds itself', () => {
    const result = runModel(TWO_CABS);
    const cab0 = result.nodes[0];
    expect(findCabinetUnderCursor(result, 0, 0, cab0.id)).toBeNull();
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
    const snapped = snapToCabinetInterior(cab, 99999);
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

describe('catalog adoption snippets', () => {
  it('every adoptable item emits a child snippet that runs inside a cabinet', () => {
    for (const item of CATALOG_ITEMS) {
      if (!item.childCode) continue;
      const childSnippet = item.childCode(600);
      const src = `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0], children: [${childSnippet}] });`;
      const result = runModel(src);
      expect(result.error, `child of ${item.id} produced error: ${result.error}`).toBeUndefined();
      const cab = result.nodes[0];
      if (cab.type !== 'cabinet') throw new Error('expected cabinet');
      expect(cab.children.find((c) => c.type === item.nodeType)).toBeDefined();
    }
  });

  it('non-adoptable items have null childCode (cabinet, panel)', () => {
    const cabItem = CATALOG_ITEMS.find((c) => c.id === 'cabinet-800')!;
    const panelItem = CATALOG_ITEMS.find((c) => c.id === 'panel-600')!;
    expect(cabItem.childCode).toBeNull();
    expect(panelItem.childCode).toBeNull();
  });
});
