import { describe, it, expect } from 'vitest';
import { runModel } from '@/model/runtime';
import { queryOf } from '@/model/scene/query';
import {
  clamp,
  getDragSpec,
  projectDragToSource,
} from '@/viewer/dragController';

/**
 * Drag rules are the architecture's only "what's user-meaningful per part
 * type" contract today. These tests pin the rules down so future verticals
 * (kitchen, wardrobe) can extend by pattern instead of re-discovery.
 */

const NESTED_CAB = `api.cabinet({
  width: 800, height: 1800, depth: 400, thickness: 18, position: [100, 0, 200],
  children: [
    api.shelf({ y: 600 }),
    api.door({ side: 'left' }),
    api.drawer({ y: 100, height: 200 }),
  ],
});
`;

describe('getDragSpec', () => {
  it('cabinet (top-level) is draggable on XZ only', () => {
    const result = runModel(NESTED_CAB);
    const cab = result.nodes[0];
    const spec = getDragSpec(cab, queryOf(result));
    expect(spec).not.toBeNull();
    expect(spec!.axes).toEqual({ x: true, y: false, z: true });
    expect(spec!.yBounds).toBeNull();
    expect(spec!.write).toEqual({ kind: 'positionArray', originalY: 0 });
    expect(spec!.originalWorld).toEqual([100, 0, 200]);
  });

  it('shelf (inside cabinet) is Y-only with interior clamp', () => {
    const result = runModel(NESTED_CAB);
    const cab = result.nodes[0];
    if (cab.type !== 'cabinet') throw new Error('expected cabinet');
    const shelf = cab.children.find((c) => c.type === 'shelf');
    if (!shelf || shelf.type !== 'shelf') throw new Error('expected shelf');

    const spec = getDragSpec(shelf, queryOf(result));
    expect(spec).not.toBeNull();
    expect(spec!.axes).toEqual({ x: false, y: true, z: false });
    // Interior: thickness + half-thickness = 27 .. height - thickness - half = 1773
    expect(spec!.yBounds).toEqual({ min: 27, max: 1773 });
    expect(spec!.write.kind).toBe('yScalar');
    if (spec!.write.kind === 'yScalar') {
      expect(spec!.write.parentFloorY).toBe(0); // cabinet sits at y=0
    }
  });

  it('drawer (inside cabinet) gets the same Y-only spec as a shelf', () => {
    const result = runModel(NESTED_CAB);
    const cab = result.nodes[0];
    if (cab.type !== 'cabinet') throw new Error('expected cabinet');
    const drawer = cab.children.find((c) => c.type === 'drawer');
    if (!drawer || drawer.type !== 'drawer') throw new Error('expected drawer');

    const spec = getDragSpec(drawer, queryOf(result));
    expect(spec).not.toBeNull();
    expect(spec!.axes).toEqual({ x: false, y: true, z: false });
    expect(spec!.write.kind).toBe('yScalar');
  });

  it('door is not draggable in v1', () => {
    const result = runModel(NESTED_CAB);
    const cab = result.nodes[0];
    if (cab.type !== 'cabinet') throw new Error('expected cabinet');
    const door = cab.children.find((c) => c.type === 'door')!;
    expect(getDragSpec(door, queryOf(result))).toBeNull();
  });

  it('standalone panel is XYZ-draggable', () => {
    const src = `api.panel({ width: 600, height: 1200, thickness: 18, position: [50, 100, 150] });`;
    const result = runModel(src);
    const panel = result.nodes[0];
    const spec = getDragSpec(panel, queryOf(result));
    expect(spec).not.toBeNull();
    expect(spec!.axes).toEqual({ x: true, y: true, z: true });
    expect(spec!.write).toEqual({ kind: 'positionArray', originalY: 100 });
  });

  it('top-level shelf/drawer are not draggable in v1 (no x/z in source)', () => {
    const result = runModel(`api.shelf({ y: 600 });\napi.drawer({ y: 100, height: 200 });`);
    for (const n of result.nodes) {
      expect(getDragSpec(n, queryOf(result))).toBeNull();
    }
  });
});

describe('clamp', () => {
  it('returns the value when in range', () => {
    expect(clamp(50, 0, 100)).toBe(50);
  });
  it('clamps below the min', () => {
    expect(clamp(-10, 0, 100)).toBe(0);
  });
  it('clamps above the max', () => {
    expect(clamp(200, 0, 100)).toBe(100);
  });
});

describe('projectDragToSource', () => {
  it('positionArray honors the axis mask (cabinet XZ keeps Y at originalY)', () => {
    const result = runModel(`api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [100, 50, 200] });`);
    const cab = result.nodes[0];
    const spec = getDragSpec(cab, queryOf(result))!;
    // Pretend the user dragged the cursor up by 999mm — Y must be ignored.
    const out = projectDragToSource(spec, [250.123, 1049, 400.456]);
    expect(out.name).toBe('position');
    expect(out.value).toEqual([250.1, 50, 400.5]); // Y locked to 50; coords rounded to 0.1
  });

  it('yScalar subtracts the parent floor and clamps to interior bounds', () => {
    const result = runModel(NESTED_CAB);
    const cab = result.nodes[0];
    if (cab.type !== 'cabinet') throw new Error('expected cabinet');
    const shelf = cab.children.find((c) => c.type === 'shelf')!;
    const spec = getDragSpec(shelf, queryOf(result))!;

    // World Y way past the cabinet's interior top.
    const out = projectDragToSource(spec, [0, 99999, 0]);
    expect(out.name).toBe('y');
    expect(out.value).toBe(1773); // yBounds.max from the spec
  });

  it('yScalar clamps to interior min when the user drags below the floor', () => {
    const result = runModel(NESTED_CAB);
    const cab = result.nodes[0];
    if (cab.type !== 'cabinet') throw new Error('expected cabinet');
    const shelf = cab.children.find((c) => c.type === 'shelf')!;
    const spec = getDragSpec(shelf, queryOf(result))!;

    const out = projectDragToSource(spec, [0, -500, 0]);
    expect(out.name).toBe('y');
    expect(out.value).toBe(27); // yBounds.min
  });

  it('positionArray rounds to 0.1mm precision', () => {
    const result = runModel(`api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0] });`);
    const cab = result.nodes[0];
    const spec = getDragSpec(cab, queryOf(result))!;
    const out = projectDragToSource(spec, [123.456789, 0, 200.731234]);
    expect(out.value).toEqual([123.5, 0, 200.7]);
  });
});
