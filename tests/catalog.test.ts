import { describe, it, expect } from 'vitest';
import { runModel } from '@/model/runtime';
import { CATALOG_ITEMS, dropCentre } from '@/editor/catalog';

/**
 * Catalog snippets are the source-side artefact of a palette drop. They have
 * to (a) parse, (b) run, and (c) produce a node at the position the drop
 * landed. These tests run each item's emitted code through `runModel` and
 * spot-check the resulting node.
 */

describe('catalog snippets', () => {
  it('every item emits source that runs cleanly', () => {
    for (const item of CATALOG_ITEMS) {
      const centre = dropCentre(item, 100, 200);
      const code = item.code(centre[0], centre[1], centre[2]);
      const result = runModel(code);
      expect(result.error, `item ${item.id} produced error: ${result.error}`).toBeUndefined();
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].type).toBe(item.nodeType);
    }
  });

  it('cabinet snippet places the cabinet at the cursor floor point', () => {
    const cab = CATALOG_ITEMS.find((c) => c.id === 'cabinet-800')!;
    const centre = dropCentre(cab, 300, -150);
    const result = runModel(cab.code(centre[0], centre[1], centre[2]));
    expect(result.nodes[0].type).toBe('cabinet');
    if (result.nodes[0].type === 'cabinet') {
      // Cabinet's `position` is its floor pivot (y=0), x/z match the drop.
      expect(result.nodes[0].params.position).toEqual([300, 0, -150]);
    }
  });

  it('shelf snippet round-trips a top-level position through source', () => {
    const shelf = CATALOG_ITEMS.find((c) => c.id === 'shelf')!;
    const centre = dropCentre(shelf, 500, 0);
    const result = runModel(shelf.code(centre[0], centre[1], centre[2]));
    expect(result.nodes[0].type).toBe('shelf');
    if (result.nodes[0].type === 'shelf') {
      // The shelf sits centred on the floor at the drop x/z — its centre Y
      // is at half the default thickness (9 mm).
      expect(result.nodes[0].params.position[0]).toBe(500);
      expect(result.nodes[0].params.position[2]).toBe(0);
      // Y comes from `dropCentre(shelf, ...)` which is defaultSize[1]/2 = 9.
      expect(result.nodes[0].params.position[1]).toBe(9);
    }
  });

  it('door snippet round-trips a top-level position through source', () => {
    const door = CATALOG_ITEMS.find((c) => c.id === 'door')!;
    const centre = dropCentre(door, 1000, 200);
    const result = runModel(door.code(centre[0], centre[1], centre[2]));
    expect(result.nodes[0].type).toBe('door');
    if (result.nodes[0].type === 'door') {
      expect(result.nodes[0].params.position[0]).toBe(1000);
      expect(result.nodes[0].params.position[2]).toBe(200);
      // Door height default is 1798 → centre Y is 899.
      expect(result.nodes[0].params.position[1]).toBe(899);
    }
  });
});

describe('dropCentre', () => {
  it('floorPivot items put y at 0 (cabinets sit on the floor)', () => {
    const cab = CATALOG_ITEMS.find((c) => c.id === 'cabinet-800')!;
    expect(dropCentre(cab, 100, 200)).toEqual([100, 0, 200]);
  });

  it('centreOnFloor items lift y by half their default height', () => {
    const panel = CATALOG_ITEMS.find((c) => c.id === 'panel-600')!;
    expect(dropCentre(panel, 0, 0)).toEqual([0, 600, 0]); // height=1200 → centre y=600
  });
});

describe('position round-trips through standalone geometry', () => {
  it('standalone shelf with position uses world coords, not [0, y, 0]', () => {
    const src = `api.shelf({ y: 0, position: [150, 600, 50] });`;
    const result = runModel(src);
    expect(result.error).toBeUndefined();
    expect(result.nodes[0].type).toBe('shelf');
    if (result.nodes[0].type === 'shelf') {
      expect(result.nodes[0].params.position).toEqual([150, 600, 50]);
    }
  });

  it('standalone door with position uses world coords', () => {
    const src = `api.door({ side: 'full', position: [10, 900, 20] });`;
    const result = runModel(src);
    expect(result.error).toBeUndefined();
    expect(result.nodes[0].type).toBe('door');
    if (result.nodes[0].type === 'door') {
      expect(result.nodes[0].params.position).toEqual([10, 900, 20]);
    }
  });

  it('standalone drawer with position uses world coords', () => {
    const src = `api.drawer({ y: 0, height: 200, position: [5, 100, 10] });`;
    const result = runModel(src);
    expect(result.error).toBeUndefined();
    expect(result.nodes[0].type).toBe('drawer');
    if (result.nodes[0].type === 'drawer') {
      expect(result.nodes[0].params.position).toEqual([5, 100, 10]);
    }
  });

  it('adopted shelf default position is cabinet-interior centred at input.y', () => {
    // Without an explicit `position`, the cabinet computes the local
    // centred placement from `y`.
    const src = `api.cabinet({
      width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0],
      children: [api.shelf({ y: 600 })],
    });`;
    const result = runModel(src);
    expect(result.error).toBeUndefined();
    const cab = result.nodes[0];
    if (cab.type !== 'cabinet') throw new Error('expected cabinet');
    const shelf = cab.children.find((c) => c.type === 'shelf')!;
    if (shelf.type !== 'shelf') throw new Error('expected shelf');
    // Position is cabinet-LOCAL: X centred at 0, Y above floor.
    expect(shelf.params.position[1]).toBe(600);
    expect(shelf.params.position[0]).toBe(0);
  });

  it('adopted shelf honours an explicit cabinet-local position override', () => {
    // PR-2: an explicit `position` on an adopted child wins over the
    // default `y`-only placement. The position is cabinet-LOCAL.
    const src = `api.cabinet({
      width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0],
      children: [api.shelf({ y: 600, position: [50, 700, 30] })],
    });`;
    const result = runModel(src);
    expect(result.error).toBeUndefined();
    const cab = result.nodes[0];
    if (cab.type !== 'cabinet') throw new Error('expected cabinet');
    const shelf = cab.children.find((c) => c.type === 'shelf')!;
    if (shelf.type !== 'shelf') throw new Error('expected shelf');
    expect(shelf.params.position).toEqual([50, 700, 30]);
  });
});
