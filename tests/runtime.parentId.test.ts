import { describe, it, expect } from 'vitest';
import { runModel } from '@/model/runtime';
import { queryOf } from '@/model/scene/query';
import type { SceneNode } from '@/domain/cabinet/types';

/**
 * PR-A coverage: every SceneNode now carries a `parentId` (id of its parent,
 * or null for top-level). It's populated by `collect()` for the legacy
 * `in:` path and by `adopt()` for the new `children: [...]` path. SceneQuery
 * reads `parentId` directly instead of inferring from a tree walk.
 */

function findById(nodes: readonly SceneNode[], id: string): SceneNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const child = findById(n.children, id);
    if (child) return child;
  }
  return null;
}

describe('parentId — top-level vs adopted nodes', () => {
  it('top-level cabinet has parentId === null', () => {
    const result = runModel(
      `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0] });`,
    );
    expect(result.error).toBeUndefined();
    const cabinets = result.nodes.filter((n) => n.type === 'cabinet');
    expect(cabinets).toHaveLength(1);
    expect(cabinets[0].parentId).toBeNull();
  });

  it('legacy `in:` shelf has parentId === cabinet.id', () => {
    const result = runModel(
      `const a = api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0] });
       api.shelf({ in: a, y: 600 });`,
    );
    expect(result.error).toBeUndefined();
    const cab = result.nodes.find((n) => n.type === 'cabinet')!;
    const shelf = findById(result.nodes, `shelf#${cab.callIndex + 5 + 1}`);
    // The shelf is a child of the cabinet — fall back to walking children if
    // the synthesised id assumption above is off.
    const actualShelf =
      shelf ?? cab.children.find((c) => c.type === 'shelf') ?? null;
    expect(actualShelf).not.toBeNull();
    expect(actualShelf!.parentId).toBe(cab.id);
  });

  it('frame panels created inside api.cabinet have parentId === cabinet.id', () => {
    const result = runModel(
      `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0] });`,
    );
    expect(result.error).toBeUndefined();
    const cab = result.nodes[0];
    expect(cab.children.length).toBeGreaterThan(0);
    for (const panel of cab.children) {
      expect(panel.parentId).toBe(cab.id);
    }
  });

  it('standalone api.shelf (no `in:`) is top-level with parentId === null', () => {
    const result = runModel(`api.shelf({ y: 600 });`);
    expect(result.error).toBeUndefined();
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].type).toBe('shelf');
    expect(result.nodes[0].parentId).toBeNull();
  });
});

describe('adopt-on-evaluate via `children: [...]`', () => {
  it('children call evaluates first as top-level, then is adopted by cabinet', () => {
    const result = runModel(
      `api.cabinet({
         width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0],
         children: [
           api.shelf({ y: 600 }),
         ],
       });`,
    );
    expect(result.error).toBeUndefined();

    // Only the cabinet sits at top level; the shelf was adopted.
    const top = result.nodes;
    expect(top.filter((n) => n.type === 'cabinet')).toHaveLength(1);
    expect(top.filter((n) => n.type === 'shelf')).toHaveLength(0);

    // The shelf is in cabinet.children with parentId set.
    const cab = top[0];
    const shelf = cab.children.find((c) => c.type === 'shelf');
    expect(shelf).toBeDefined();
    expect(shelf!.parentId).toBe(cab.id);
  });

  it('multiple children are all adopted', () => {
    const result = runModel(
      `api.cabinet({
         width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0],
         children: [
           api.shelf({ y: 600 }),
           api.door({ side: 'left' }),
         ],
       });`,
    );
    expect(result.error).toBeUndefined();
    const cab = result.nodes[0];
    const adoptedTypes = cab.children
      .filter((c) => c.type === 'shelf' || c.type === 'door')
      .map((c) => c.type)
      .sort();
    expect(adoptedTypes).toEqual(['door', 'shelf']);
    for (const c of cab.children) {
      expect(c.parentId).toBe(cab.id);
    }
  });

  it('top-level call ordering: shelf gets a callIndex BEFORE its adopting cabinet', () => {
    // Argument-evaluation order: the inner api.shelf runs before the outer
    // api.cabinet, so the shelf claims an earlier callIndex despite ending up
    // as the cabinet's child.
    const result = runModel(
      `api.cabinet({
         width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0],
         children: [api.shelf({ y: 600 })],
       });`,
    );
    const cab = result.nodes[0];
    const shelf = cab.children.find((c) => c.type === 'shelf')!;
    expect(shelf.callIndex).toBeLessThan(cab.callIndex);
  });
});

describe('adopt() invariants', () => {
  it('throws when a node is referenced in two `children` arrays (single-parent invariant)', () => {
    // Same shelf placed in two cabinets. The first cabinet adopts it; when
    // the second cabinet tries, parentId is already set → throw → captured
    // as result.error.
    const result = runModel(
      `const s = api.shelf({ y: 600 });
       api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0], children: [s] });
       api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [1000, 0, 0], children: [s] });`,
    );
    expect(result.error).toBeDefined();
    expect(result.error).toContain('already a child');
  });
});

describe('SceneQuery.parent uses node.parentId', () => {
  it('returns the parent id for a child node', () => {
    const result = runModel(
      `const a = api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0] });
       api.shelf({ in: a, y: 600 });`,
    );
    const q = queryOf(result);
    const cab = result.nodes.find((n) => n.type === 'cabinet')!;
    const shelf = cab.children.find((c) => c.type === 'shelf')!;
    expect(q.parent(shelf.id)).toBe(cab.id);
    expect(q.parent(cab.id)).toBeNull();
  });

  it('queryOf returns the same instance for the same RunResult', () => {
    const result = runModel(`api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18 });`);
    const a = queryOf(result);
    const b = queryOf(result);
    expect(a).toBe(b);
  });
});
